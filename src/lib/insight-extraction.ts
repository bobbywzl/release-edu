/**
 * Background insight extraction — the write path of the personalization
 * moat. Lifted verbatim from the legacy chat route so the Tree product's
 * node chats keep feeding the same curated student memory.
 *
 * Anti-hallucination rules and reinforce-over-duplicate behavior are
 * critical here — see insight-memory.ts for the read path.
 */
import { pickBackgroundModel } from '@/lib/chat-model-router'

export async function extractInsightsBackground(
  apiKey: string,
  userMessage: string,
  assistantResponse: string,
  storeUserId: string,
): Promise<void> {
  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const client = new Anthropic({ apiKey })

    // Existing memory goes into the prompt so Haiku REINFORCES instead of
    // duplicating, and the student's language keeps memory consistent with
    // the rest of their experience.
    const [{ getTopInsights, maybeConsolidateInsights, INSIGHT_TYPES }, { getUserLanguage }] = await Promise.all([
      import('@/lib/insight-memory'),
      import('@/lib/get-user-language'),
    ])
    const [existing, lang] = await Promise.all([
      getTopInsights(storeUserId, { limit: 30 }),
      getUserLanguage(storeUserId),
    ])
    const existingListing = existing.map(i => `${i.id} | ${i.type} | ${i.content.slice(0, 120)}`).join('\n')

    const result = await client.messages.create({
      // Background insight extractor — emits new-insight / reinforce ops.
      // Classification with calibrated scoring, well within Haiku capability.
      model: pickBackgroundModel(),
      max_tokens: 600,
      messages: [{
        role: 'user',
        content: `You maintain an AI tutor's long-term memory about a student. Analyze this exchange and extract insights ABOUT THE STUDENT.

Student said: "${userMessage.slice(0, 500)}"
Tutor responded (CONTEXT ONLY): "${assistantResponse.slice(0, 500)}"

ANTI-HALLUCINATION RULES — violating these corrupts the student's profile:
- Extract ONLY from what the STUDENT said or demonstrated. The tutor's response is context for understanding the student's words — NEVER attribute topics, examples, or enthusiasm from the tutor's response to the student.
- A topic the tutor mentioned is NOT a student interest unless the student independently expressed curiosity about it.
- Only CLEAR, evidenced signals. If you would have to infer or guess, return nothing. Returning [] is the correct answer for most routine exchanges.

KNOWN INSIGHTS (id | type | content):
${existingListing || '(none yet)'}

If the exchange CONFIRMS a known insight, reinforce it instead of writing a duplicate.

Return ONLY a JSON array of operations (or [] if nothing notable):
- New: {"op":"new","type":"<one of: personality|interest|strength|weakness|preference|aspiration|breakthrough|struggle|style>","content":"one sentence, written in ${lang === 'zh' ? 'Simplified Chinese (简体中文)' : 'English'}","confidence":0.0-1.0,"importance":0.0-1.0}
- Reinforce: {"op":"reinforce","id":"<known insight id>"}

importance rubric: durable traits, aspirations, learning-style ≈ 0.7–1.0; recurring topical strengths/struggles ≈ 0.4–0.7; one-off topic confusion or passing remarks ≈ 0.1–0.3.`,
      }],
    })

    try {
      const { recordAnthropicUsage } = await import('@/lib/usage')
      recordAnthropicUsage(result.usage, { userId: storeUserId, model: pickBackgroundModel(), feature: 'insight' })
    } catch { /* non-critical */ }
    const text = (result.content[0] as { type: string; text?: string })?.text?.trim()
    if (!text || text === '[]') return
    const jsonMatch = text.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return

    const parsed = JSON.parse(jsonMatch[0]) as Array<
      | { op: 'new'; type: string; content: string; confidence: number; importance?: number }
      | { op: 'reinforce'; id: string }
    >
    if (!Array.isArray(parsed)) return

    const prisma = (await import('@/lib/prisma')).default
    const validTypes = new Set<string>(INSIGHT_TYPES)
    const knownIds = new Set(existing.map(i => i.id))
    const clamp01 = (n: unknown, fallback: number) =>
      typeof n === 'number' && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback

    const byId = new Map(existing.map(i => [i.id, i]))
    for (const op of parsed) {
      if (op.op === 'reinforce' && knownIds.has(op.id)) {
        const prev = byId.get(op.id)
        await prisma.insight.update({
          where: { id: op.id },
          data: {
            timesObserved: { increment: 1 },
            lastConfirmedAt: new Date(),
            // Each independent confirmation nudges confidence up, capped at 1.
            confidence: Math.min(1, (prev?.confidence ?? 0.5) + 0.05),
          },
        }).catch(() => null)
      } else if (op.op === 'new' && validTypes.has(op.type) && typeof op.content === 'string' && op.content.trim()) {
        await prisma.insight.create({
          data: {
            userId: storeUserId,
            type: op.type,
            content: op.content.trim().slice(0, 300),
            confidence: clamp01(op.confidence, 0.5),
            importance: clamp01(op.importance, 0.4),
            source: `chat-${new Date().toISOString().split('T')[0]}`,
          },
        }).catch(() => null)
      }
    }

    // Keep memory curated: merge duplicates / retire off-track insights once
    // the active set grows past the threshold (no-op otherwise).
    void maybeConsolidateInsights(storeUserId, apiKey)
  } catch {
    // Non-critical
  }
}
