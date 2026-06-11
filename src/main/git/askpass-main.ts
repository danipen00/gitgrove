// Standalone askpass shim — the program (via a tiny wrapper script, see
// askpass.ts) that git and ssh invoke when they need a credential. The
// wrapper relaunches GitGrove's own binary with ELECTRON_RUN_AS_NODE=1 and
// this script, so prompting needs no extra runtime shipped with the app.
//
// Contract with the in-app askpass server (askpass.ts):
//   • argv[2] (the helper's first real argument) is the prompt text.
//   • GITGROVE_ASKPASS_SOCKET names the unix socket / Windows named pipe.
//   • Request framing is end-of-stream: send the prompt, half-close, read the
//     reply until the server closes. The reply is '+<secret>' for an answer
//     or '!' for cancel — constants duplicated from askpass.ts on purpose, so
//     this file stays dependency-free and bundles self-contained (it must run
//     outside the main process, with nothing else from the app available).
//
// Exit code is the protocol with git: 0 with the secret on stdout hands the
// credential over; non-zero makes git abort the operation cleanly.

import { connect } from 'node:net'

const socketPath = process.env.GITGROVE_ASKPASS_SOCKET
const prompt = process.argv[2] ?? ''

function cancel(): never {
  process.exit(1)
}

if (!socketPath) cancel()

// Watchdog: if the app dies mid-prompt and the socket never closes, exit
// non-zero once the server's 10-minute answer budget (plus slack) is over —
// git must never be left waiting on a zombie helper. unref'd so the timer
// itself doesn't keep this process alive after a normal reply.
setTimeout(cancel, 11 * 60 * 1000).unref()

const socket = connect(socketPath)
socket.setEncoding('utf8')
socket.on('error', cancel)

let reply = ''
socket.on('data', (chunk: string) => {
  reply += chunk
})
socket.on('end', () => {
  if (reply.startsWith('+')) {
    // git and ssh read one line and strip the trailing newline themselves.
    // Exit from the write callback: stdout to a pipe is asynchronous in node,
    // and a bare process.exit() can drop the not-yet-flushed secret.
    process.stdout.write(`${reply.slice(1)}\n`, () => process.exit(0))
    return
  }
  cancel()
})

// Send the prompt and half-close: FIN is the end-of-request marker, so no
// escaping or length-prefixing is ever needed for arbitrary prompt text.
socket.end(prompt)
