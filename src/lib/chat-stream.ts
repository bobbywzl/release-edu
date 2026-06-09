'use client'
/**
 * Module-scope chat stream registry.
 *
 * Bob's streaming responses already keep flowing after the chat page
 * unmounts (the reader loop lives in a closure, not the component) — what
 * was missing is a way for a REMOUNTED chat page to find and re-attach to
 * an in-flight stream. This registry holds the accumulated text per
 * conversation at module scope, so navigating away and back shows the live
 * streaming bubble exactly where it left off — like the Claude apps.
 *
 * The chat page's send functions pump through pumpChatStream() instead of
 * an inline reader loop; on mount / conversation switch the page calls
 * getActiveChatStream() + subscribeChatStream() to re-attach.
 */

export interface ChatStreamState {
  conversationId: string
  content: string
  done: boolean
  startedAt: number
}

const streams = new Map<string, ChatStreamState>()
const listeners = new Map<string, Set<(s: ChatStreamState) => void>>()

function emit(conversationId: string) {
  const state = streams.get(conversationId)
  if (!state) return
  listeners.get(conversationId)?.forEach(fn => fn(state))
}

/** The in-flight (or just-finished) stream for a conversation, if any. */
export function getActiveChatStream(conversationId: string): ChatStreamState | null {
  return streams.get(conversationId) ?? null
}

/** Subscribe to a conversation's stream updates. Returns an unsubscribe fn. */
export function subscribeChatStream(
  conversationId: string,
  fn: (s: ChatStreamState) => void,
): () => void {
  let set = listeners.get(conversationId)
  if (!set) {
    set = new Set()
    listeners.set(conversationId, set)
  }
  set.add(fn)
  return () => {
    set?.delete(fn)
    if (set && set.size === 0) listeners.delete(conversationId)
  }
}

/**
 * Pump a streaming response body, mirroring the accumulated text into the
 * registry. Returns the full text. On stream error (including user abort)
 * it rethrows after finalizing — use getActiveChatStream() to recover the
 * partial content in that case.
 */
export async function pumpChatStream(
  conversationId: string,
  body: ReadableStream<Uint8Array>,
  onChunk?: (full: string) => void,
): Promise<string> {
  const state: ChatStreamState = { conversationId, content: '', done: false, startedAt: Date.now() }
  streams.set(conversationId, state)
  emit(conversationId)

  const reader = body.getReader()
  const decoder = new TextDecoder()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      state.content += decoder.decode(value, { stream: true })
      onChunk?.(state.content)
      emit(conversationId)
    }
    return state.content
  } finally {
    state.done = true
    emit(conversationId)
    // Keep the finished stream around briefly so a page re-attaching right
    // at completion still sees it, then drop it — the message is in the DB
    // by then and the conversation reload takes over.
    setTimeout(() => {
      if (streams.get(conversationId) === state) streams.delete(conversationId)
    }, 15_000)
  }
}
