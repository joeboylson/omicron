import type { EngineInterface, Register } from 'claude-code'

// Omicron's add-on. Follows this conversation's inbox through
// `omicron sessions inbox <conversation>`, which prints each waiting message
// as one JSON line, and puts it into the window as if typed, once Claude is
// free. Omicron leaves messages there for a session open in a window it
// doesn't host. Written by Omicron, which fills in OMICRON below.
const OMICRON = '__OMICRON__'

// The running follower, ended when the conversation changes (/clear).
let follower: AsyncIterator<unknown> | undefined

async function follow($: EngineInterface, conversation: string) {
  const stream = $.process.spawn({ argv: [OMICRON, 'sessions', 'inbox', conversation] })
  follower = stream[Symbol.asyncIterator]()
  let rest = ''
  try {
    for await (const piece of stream as AsyncIterable<{ stream?: string; text?: string }>) {
      if (piece.stream !== 'stdout' || piece.text === undefined) continue
      rest += piece.text
      for (let end = rest.indexOf('\n'); end >= 0; end = rest.indexOf('\n')) {
        const line = rest.slice(0, end)
        rest = rest.slice(end + 1)
        if (line !== '') await $.prompt.submit({ text: JSON.parse(line) as string, asUser: true })
      }
    }
  } catch {
    // Omicron isn't installed where it was, or the follower was replaced.
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await follower?.return?.()
    void follow($, await $.session.id())
    return started
  })
}
