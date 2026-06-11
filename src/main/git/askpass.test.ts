import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { execFileSync, spawn } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ts from 'typescript'
import { AskpassServer } from './askpass'

// The shim ships as TypeScript and is bundled at build time, but these tests
// must run it the way git will — as a separate process. It is deliberately
// self-contained (single file, node builtins only), so transpiling just it to
// CommonJS and spawning the result exercises the exact code that ships.
//
// The shim is spawned under NODE, not the test runner: in production it always
// runs under Electron's node (ELECTRON_RUN_AS_NODE), never bun. `node` is taken
// from PATH, like `git` below.
const NODE = 'node'

// The cross-process round-trip tests can only run under node. bun's `net` does
// not honour this half-open protocol: once the shim half-closes (FIN) to mark
// end-of-prompt, a reply the server writes *after* awaiting its responder (see
// AskpassServer.answer in askpass.ts) is silently dropped — the shim then sees
// an empty reply and exits non-zero. Node, which hosts the server in production
// (Electron's main process), delivers the reply correctly, so this is a bun
// test-runner limitation, not a product bug. These tests therefore skip under
// bun and run under node; the pure string logic is covered everywhere by
// askpass-prompt.test.ts. The cancelled/unreachable cases below stay enabled:
// they assert a non-zero exit either way, so they're runtime-robust.
const needsNodeServer = test.skipIf('bun' in process.versions)

let dir: string
let shimJs: string

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'gitgrove-askpass-test-'))
  const source = readFileSync(join(__dirname, 'askpass-main.ts'), 'utf8')
  const out = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  shimJs = join(dir, 'askpass-main.cjs')
  writeFileSync(shimJs, out)
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** Run the shim exactly as git would: prompt in argv, socket path in env. */
function runShim(
  socketPath: string,
  prompt: string
): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(NODE, [shimJs, prompt], {
      env: { ...process.env, GITGROVE_ASKPASS_SOCKET: socketPath }
    })
    let stdout = ''
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString('utf8')
    })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, stdout }))
  })
}

describe('AskpassServer + shim', () => {
  needsNodeServer('an answered prompt reaches stdout with exit 0', async () => {
    const kinds: string[] = []
    const server = new AskpassServer({
      responder: (prompt) => {
        kinds.push(prompt.kind)
        return Promise.resolve('s3cret with spaces ✓')
      }
    })
    await server.listen()
    try {
      const result = await runShim(server.socketPath, "Username for 'https://github.com': ")
      expect(result.code).toBe(0)
      // git/ssh strip the one trailing newline the helper prints.
      expect(result.stdout).toBe('s3cret with spaces ✓\n')
      expect(kinds).toEqual(['username'])
    } finally {
      await server.close()
    }
  })

  test('a cancelled prompt exits non-zero with no output', async () => {
    const server = new AskpassServer({ responder: () => Promise.resolve(null) })
    await server.listen()
    try {
      const result = await runShim(server.socketPath, "Password for 'https://github.com': ")
      expect(result.code).toBe(1)
      expect(result.stdout).toBe('')
    } finally {
      await server.close()
    }
  })

  needsNodeServer('an unanswered prompt times out, aborts the responder and cancels', async () => {
    let aborted = false
    const server = new AskpassServer({
      timeoutMs: 50,
      responder: (_prompt, signal) =>
        new Promise((resolve) => {
          // Never answer; only react to the timeout, like a dead renderer.
          signal.addEventListener('abort', () => {
            aborted = true
            resolve(null)
          })
        })
    })
    await server.listen()
    try {
      const result = await runShim(server.socketPath, "Password for 'https://github.com': ")
      expect(result.code).toBe(1)
      expect(result.stdout).toBe('')
      expect(aborted).toBe(true)
    } finally {
      await server.close()
    }
  })

  test('the shim exits non-zero when the server is unreachable', async () => {
    const result = await runShim(join(dir, 'no-such-socket.sock'), 'Password: ')
    expect(result.code).toBe(1)
    expect(result.stdout).toBe('')
  })
})

describe('real git routes prompts through GIT_ASKPASS', () => {
  needsNodeServer('fetch from an auth-demanding remote asks username then password', async () => {
    const kinds: string[] = []
    const server = new AskpassServer({
      responder: (prompt) => {
        kinds.push(prompt.kind)
        return Promise.resolve(prompt.kind === 'username' ? 'user' : 'wrong-secret')
      }
    })
    await server.listen()
    // A fake remote: every request gets 401 + WWW-Authenticate, which is all
    // it takes to make git prompt. No git server needed.
    const remote = createServer((_req, res) => {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="test"' })
      res.end('auth required')
    })
    await new Promise<void>((resolve) => remote.listen(0, '127.0.0.1', resolve))
    const port = (remote.address() as AddressInfo).port
    try {
      // GIT_ASKPASS takes no arguments, so adapt with the same kind of
      // wrapper script production uses (askpass.ts), pointing at node instead
      // of an Electron binary.
      const wrapper = join(dir, 'wrapper.sh')
      writeFileSync(
        wrapper,
        `#!/bin/sh\nGITGROVE_ASKPASS_SOCKET='${server.socketPath}' ` +
          `exec ${NODE} "${shimJs}" "$@"\n`
      )
      chmodSync(wrapper, 0o755)
      const repo = join(dir, 'repo')
      mkdirSync(repo)
      execFileSync('git', ['init', '-q'], { cwd: repo })
      // The fetch is expected to fail — the fake remote rejects everything.
      // What this pins is that git routed its prompts to our askpass chain.
      // Spawned async (never execFileSync): the fake remote and the askpass
      // server live on THIS event loop, which a sync spawn would deadlock.
      const exitCode = await new Promise<number | null>((resolve, reject) => {
        const child = spawn(
          'git',
          ['-c', 'credential.helper=', 'fetch', `http://127.0.0.1:${port}/repo.git`],
          {
            cwd: repo,
            env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: wrapper },
            stdio: 'ignore'
          }
        )
        child.on('error', reject)
        child.on('close', resolve)
      })
      expect(exitCode === 0).toBe(false)
      expect(kinds).toEqual(['username', 'password'])
    } finally {
      await server.close()
      await new Promise<void>((resolve) => remote.close(() => resolve()))
    }
  })
})
