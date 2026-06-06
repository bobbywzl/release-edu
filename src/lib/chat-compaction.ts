/**
 * Chat compaction — replaces older messages with a Haiku-generated summary
 * so long conversations don't bloat every Claude request (quadratic token
 * cost = linear latency growth = user-visible lag).
 *
 * Strategy:
 *   • Keep the last KEEP_RECENT messages verbatim (they carry the active
 *     teaching context Bob needs for the next turn).
 *   • Replace everything older with a single synthetic "user" message:
 *       [PRIOR CONVERSATION SUMMARY] ...
 *     Claude treats this as context, not as the actual student speaking.
 *   • Cache the summary on the Conversation row keyed by the messageId it
 *     stops at — we only regenerate when new messages have aged past the
 *     KEEP_RECENT window.
 */

import Anthropic from '@anthropic-ai/sdk'
import prisma from '@/lib/prisma'

const COMPACT_TRIGGER = 18  // start compacting once conversation crosses this many turns
const KEEP_RECENT = 10      // last N messages kept verbatim
const REFRESH_EVERY = 8     // re-summarize after this many new messages land
const FORCE_KEEP_RECENT = 6 // when manually forced via /compact, trim more aggressively

interface Msg {
  id: string
  role: 'user' | 'assistant'
  content: string
}

export interface CompactedHistory {
  compacted: boolean
  history: Array<{ role: 'user' | 'assistant'; content: string }>
  /** Token-equivalent savings hint for logging. */
  droppedMessages: number
}

/**
 * Compact a message history. If the conversation has more than COMPACT_TRIGGER
 * messages, returns: [summary message] + last KEEP_RECENT messages. Otherwise
 * returns the full history unchanged. Always cheap when no compaction is
 * needed — only one DB read.
 */
export async function compactHistory(
  conversationId: string,
  messages: Msg[],
  apiKey: string | undefined,
  opts: { force?: boolean } = {},
): Promise<CompactedHistory> {
  // Force-compact (via /compact slash command) trims aggressively even on
  // short conversations — anything >= 4 messages gets a summary. Auto-mode
  // only kicks in past the normal trigger.
  const minMessages = opts.force ? 4 : COMPACT_TRIGGER
  if (messages.length <= minMessages) {
    return {
      compacted: false,
      history: messages.map(m => ({ role: m.role, content: m.content })),
      droppedMessages: 0,
    }
  }

  const keep = opts.force ? FORCE_KEEP_RECENT : KEEP_RECENT
  const cutoffIndex = Math.max(0, messages.length - keep)
  const olderMessages = messages.slice(0, cutoffIndex)
  const recentMessages = messages.slice(cutoffIndex)
  const cutoffId = olderMessages[olderMessages.length - 1]?.id

  // Read cached summary if present.
  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { summary: true, summaryThroughId: true },
  }).catch(() => null)

  let summary = conv?.summary ?? null
  const cachedCutoff = conv?.summaryThroughId ?? null

  // Decide whether to regenerate the summary.
  // - No cache at all → regenerate.
  // - Cache exists but new messages have aged past KEEP_RECENT since last
  //   summary → regenerate (every REFRESH_EVERY new aged-out messages).
  let needRegenerate = opts.force || !summary || !cachedCutoff
  if (!needRegenerate && cachedCutoff) {
    const cachedCutoffIdx = messages.findIndex(m => m.id === cachedCutoff)
    if (cachedCutoffIdx < 0) {
      // Cached cutoff message no longer exists (rare — message deleted).
      needRegenerate = true
    } else {
      const newAgedOut = cutoffIndex - 1 - cachedCutoffIdx
      if (newAgedOut >= REFRESH_EVERY) needRegenerate = true
    }
  }

  if (needRegenerate && apiKey) {
    try {
      const fresh = await summarize(apiKey, olderMessages)
      if (fresh) {
        summary = fresh
        await prisma.conversation.update({
          where: { id: conversationId },
          data: { summary, summaryThroughId: cutoffId },
        }).catch(() => null)
      }
    } catch {
      // Fall back to last cached summary, or to no summary (full history).
    }
  }

  if (!summary) {
    // No summary available — fall back to full history (no compaction this turn).
    return {
      compacted: false,
      history: messages.map(m => ({ role: m.role, content: m.content })),
      droppedMessages: 0,
    }
  }

  return {
    compacted: true,
    history: [
      {
        role: 'user',
        content: `[PRIOR CONVERSATION SUMMARY — system-generated, not the student speaking. Treat this as your memory of what came before in this lesson. The actual recent exchanges follow this message.]\n\n${summary}\n\n[END SUMMARY]`,
      },
      ...recentMessages.map(m => ({ role: m.role, content: m.content })),
    ],
    droppedMessages: olderMessages.length,
  }
}

async function summarize(apiKey: string, messages: Msg[]): Promise<string | null> {
  if (messages.length === 0) return null
  // Truncate very long messages to keep the summary prompt cheap. Bob's
  // long teaching responses tend to repeat structure; the first 600 chars
  // of each is enough context for a meaningful summary.
  const transcript = messages
    .map(m => {
      const role = m.role === 'user' ? 'STUDENT' : 'BOB'
      const content = m.content.length > 600
        ? m.content.slice(0, 600) + '…'
        : m.content
      return `${role}: ${content}`
    })
    .join('\n\n')

  const client = new Anthropic({ apiKey })
  try {
    const result = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      messages: [{
        role: 'user',
        content: `You are compacting the earlier portion of a tutoring conversation so an AI tutor (Bob) can continue teaching without re-reading 30+ raw messages. Write the compact memo Bob would actually USE next turn — not a chronological recap. Third person, no first/second person, no addressing the student.

Output exactly these labeled sections (skip any that have no content). Keep total under 500 words. Use concrete concept names, not vague phrases.

CONCEPTS BOB TAUGHT (quiz-eligible)
— bullet list of every concept Bob actually walked through (defined, illustrated, worked an example for). Be specific: "Itô's lemma applied to geometric Brownian motion" not "stochastic calculus".

CONCEPTS BOB MENTIONED BUT DID NOT TEACH
— anything that came up but wasn't fully delivered. NOT quiz-eligible.

STUDENT'S DEMONSTRATED UNDERSTANDING
— what they got right and in what form (recall vs application vs synthesis).

STUDENT'S STRUGGLES / PERSISTENT GAPS
— specific concepts they got wrong, partial, or asked Bob to re-explain. Carry forward STUCK_ON from prior reflections.

STUDENT PERFORMANCE STATE
— most recent streak/difficulty signals: e.g. "STREAK_CORRECT=2, CURRENT_DIFFICULTY=3, NEXT_DIFFICULTY=3".

PERSONAL CONTEXT MENTIONED
— anything about the student's interests, profession, age, goals, side projects.

ACTIVE THREAD / WHERE WE LEFT OFF
— the LAST unresolved teaching beat. One or two sentences. Bob will pick up from this.

EARLIER CONVERSATION (oldest first):

${transcript}

Return ONLY the compact memo, no preamble or trailing commentary.`,
      }],
    })
    const text = (result.content[0] as { type: string; text?: string })?.text?.trim()
    return text || null
  } catch {
    return null
  }
}
