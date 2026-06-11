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
// CommonJS and spawning the result under the current runtime (bun and node
// both execute plain .cjs) exercises the exact code that ships.
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
    const child = spawn(process.execPath, [shimJs, prompt], {
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
  test('an answered prompt reaches stdout with exit 0', async () => {
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

  test('an unanswered prompt times out, aborts the responder and cancels', async () => {
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
  test('fetch from an auth-demanding remote asks username then password', async () => {
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
      // wrapper script production uses (askpass.ts), pointing at the current
      // runtime instead of an Electron binary.
      const wrapper = join(dir, 'wrapper.sh')
      writeFileSync(
        wrapper,
        `#!/bin/sh\nGITGROVE_ASKPASS_SOCKET='${server.socketPath}' ` +
          `exec "${process.execPath}" "${shimJs}" "$@"\n`
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
