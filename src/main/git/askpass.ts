// In-app credential prompting for git/ssh network operations — the GitHub
// Desktop pattern. exec.ts disables terminal prompts (GIT_TERMINAL_PROMPT=0),
// so without a working credential helper a private-repo clone/fetch/pull/push
// would dead-end. Instead, sync.ts layers `askpassEnv()` onto network ops:
// GIT_ASKPASS/SSH_ASKPASS point at a generated wrapper script that relaunches
// GitGrove's own binary in plain-Node mode running the shim (askpass-main.ts),
// which forwards the prompt over a local socket to the AskpassServer here.
// The registered responder (main/ipc.ts) shows the renderer's CredentialDialog
// and the answer travels back: server → socket → shim stdout → git.
//
// Secrets only ever transit this path in memory — never logged, never
// persisted (storing approved credentials via `git credential approve` is a
// possible follow-up, deliberately not done here).

import { randomBytes } from 'node:crypto'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CredentialPrompt } from '@shared/types'
import { classifyPrompt } from './askpass-prompt'

// The main bundle is ESM — reconstruct __dirname (same as main/index.ts).
const moduleDir = dirname(fileURLToPath(import.meta.url))

/**
 * Answers a credential prompt: resolve the secret, or null to cancel (git
 * aborts). The signal fires when the prompt times out unanswered — listeners
 * should tear down their UI; whatever they resolve afterwards is ignored.
 */
export type CredentialResponder = (
  prompt: CredentialPrompt,
  signal: AbortSignal
) => Promise<string | null>

// Wire protocol with the shim (askpass-main.ts keeps its own copies — it must
// bundle self-contained): request = prompt text then FIN, reply = one of
// these prefixes then FIN. End-of-stream framing needs no escaping.
const REPLY_OK = '+'
const REPLY_CANCEL = '!'

/** How long a prompt may sit unanswered before it cancels (no zombie git). */
const ANSWER_TIMEOUT_MS = 10 * 60 * 1000

export interface AskpassServerOptions {
  responder: CredentialResponder
  /** Override the unanswered-prompt timeout (tests). */
  timeoutMs?: number
}

/**
 * The local server the askpass shim connects to: a unix domain socket on
 * posix, a named pipe on Windows — node's `net` speaks both transparently.
 */
export class AskpassServer {
  readonly socketPath: string
  private server: Server | null = null

  constructor(private readonly options: AskpassServerOptions) {
    this.socketPath = newSocketPath()
  }

  async listen(): Promise<void> {
    // allowHalfOpen: the shim half-closes (FIN) to mark end-of-request;
    // without it node would answer that FIN by closing the write side too,
    // before the reply can be sent.
    this.server = createServer({ allowHalfOpen: true }, (socket) => this.handleConnection(socket))
    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject)
      this.server?.listen(this.socketPath, resolve)
    })
    if (process.platform !== 'win32') {
      // Only this user's processes may ask the app for credentials.
      await chmod(this.socketPath, 0o600)
    }
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => {
      if (this.server) this.server.close(() => resolve())
      else resolve()
    })
    // node does not unlink unix socket files on close; named pipes vanish.
    if (process.platform !== 'win32') {
      await rm(this.socketPath, { force: true }).catch(() => {})
    }
  }

  private handleConnection(socket: Socket): void {
    socket.setEncoding('utf8')
    let prompt = ''
    socket.on('data', (chunk: string) => {
      prompt += chunk
    })
    // The shim died mid-request — nothing to answer.
    socket.on('error', () => {})
    socket.on('end', () => void this.answer(socket, prompt))
  }

  private async answer(socket: Socket, prompt: string): Promise<void> {
    // Bound the wait: if nobody answers (user walked away), abort and reply
    // "cancel" so the shim exits non-zero and git aborts — the operation must
    // never hang forever on an invisible prompt.
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? ANSWER_TIMEOUT_MS)
    let reply = REPLY_CANCEL
    try {
      const secret = await this.options.responder(classifyPrompt(prompt), controller.signal)
      if (!controller.signal.aborted && secret !== null) reply = REPLY_OK + secret
    } catch {
      // A responder failure cancels the prompt; it must never crash the app.
    } finally {
      clearTimeout(timer)
    }
    socket.end(reply)
  }
}

/**
 * A collision-free socket path. macOS caps unix socket paths at 104 bytes —
 * tmpdir() plus this short name stays well under it.
 */
function newSocketPath(): string {
  const id = randomBytes(8).toString('hex')
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\gitgrove-askpass-${id}`
    : join(tmpdir(), `gitgrove-askpass-${id}.sock`)
}

// ── App-wide singleton ──────────────────────────────────────────────────────

let responder: CredentialResponder | null = null

/** Register the app's prompt UI (main/ipc.ts). Unset prompts auto-cancel. */
export function setCredentialResponder(handler: CredentialResponder): void {
  responder = handler
}

let sharedEnv: Promise<Record<string, string>> | null = null

/**
 * Environment for network git operations that routes credential prompts into
 * the app. Lazily starts the shared askpass server and writes the wrapper
 * script on first use. If setup fails (tmp dir or socket trouble) this
 * resolves to {} — the op then behaves exactly as before this feature: fail
 * fast with git's own error rather than blocking sync entirely.
 */
export function askpassEnv(): Promise<Record<string, string>> {
  if (!sharedEnv) {
    sharedEnv = createAskpassEnv().catch(() => {
      sharedEnv = null // retry on the next network op
      return {}
    })
  }
  return sharedEnv
}

async function createAskpassEnv(): Promise<Record<string, string>> {
  const server = new AskpassServer({
    responder: (prompt, signal) => (responder ? responder(prompt, signal) : Promise.resolve(null))
  })
  await server.listen()
  const wrapper = await writeWrapperScript()
  return {
    GIT_ASKPASS: wrapper,
    // ssh reads SSH_ASKPASS for key passphrases. Two extra levers because ssh
    // is pickier than git: SSH_ASKPASS_REQUIRE=force (OpenSSH ≥ 8.4) makes it
    // use the helper even without the legacy preconditions; older versions
    // ignore the variable but still demand DISPLAY to be set at all, so give
    // them a dummy one when the session has none.
    SSH_ASKPASS: wrapper,
    SSH_ASKPASS_REQUIRE: 'force',
    ...(process.env.DISPLAY ? {} : { DISPLAY: ':9999' }),
    // Read by the shim; exported to git's whole child tree so ssh-spawned
    // helpers see it too.
    GITGROVE_ASKPASS_SOCKET: server.socketPath
  }
}

/**
 * GIT_ASKPASS/SSH_ASKPASS must name a program the OS can exec directly — no
 * arguments allowed — so a generated wrapper script adapts the calling
 * convention: it relaunches this app's own binary as plain Node
 * (ELECTRON_RUN_AS_NODE) running the bundled shim, forwarding the prompt.
 */
async function writeWrapperScript(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'gitgrove-askpass-'))
  const electron = process.execPath
  const shim = shimPath()
  if (process.platform === 'win32') {
    // Windows can't exec a shell script or a .js file here: ssh.exe spawns
    // the helper via CreateProcess and git runs it through its sh — a .bat
    // satisfies both (cmd association for CreateProcess, and Git for
    // Windows' sh execs .bat through cmd). The GitHub Desktop approach.
    const bat = join(dir, 'askpass.bat')
    const lines = ['@echo off', 'set ELECTRON_RUN_AS_NODE=1', `"${electron}" "${shim}" %*`, '']
    await writeFile(bat, lines.join('\r\n'))
    return bat
  }
  const sh = join(dir, 'askpass.sh')
  await writeFile(sh, `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "${electron}" "${shim}" "$@"\n`)
  // ssh execs SSH_ASKPASS directly, so the script must be executable itself.
  await chmod(sh, 0o755)
  return sh
}

/**
 * The bundled shim: its own build entry (electron.vite.config.ts) emitted
 * next to the main bundle as out/main/askpass.js. In a packaged app out/
 * lives inside app.asar, which only Electron's patched fs can read — the
 * relaunched plain-Node process must load the shim from the real filesystem,
 * so electron-builder.yml asarUnpacks it and we point at the mirrored copy.
 */
function shimPath(): string {
  return join(moduleDir, 'askpass.js').replace(
    `${sep}app.asar${sep}`,
    `${sep}app.asar.unpacked${sep}`
  )
}
