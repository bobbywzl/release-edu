export const dynamic = 'force-dynamic'
export const maxDuration = 45

/**
 * GET /api/user/judge-health — live diagnostic for the checkpoint-judging
 * model chain. Open it in the browser while signed in (the middleware's
 * user-API gate protects it) and it pings each judge model with a tiny
 * request, reporting exactly which are reachable and how fast — so a
 * "trouble connecting" report becomes a definitive diagnosis instead of a
 * guessing round. Costs a few tokens per call (usage tag 'other').
 */
import { NextResponse } from 'next/server'
import { getUserId } from '@/lib/get-user-id'
import { getJudgeModel } from '@/lib/model-resolver'
import { CHAT_MODELS, NO_THINKING } from '@/lib/chat-model-router'

export async function GET() {
  const userId = await getUserId()
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ ok: false, error: 'ANTHROPIC_API_KEY missing' }, { status: 503 })

  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const client = new Anthropic({ apiKey })
  const resolved = await getJudgeModel().catch(() => '(resolver failed)')

  const models = Array.from(new Set<string>([resolved, CHAT_MODELS.sonnet, CHAT_MODELS.opus])).filter(m => m.startsWith('claude'))
  const attempts: Array<{ model: string; ok: boolean; ms: number; error?: string }> = []
  for (const model of models) {
    const started = Date.now()
    try {
      const res = await client.messages.create({
        model,
        max_tokens: 8,
        ...NO_THINKING,
        messages: [{ role: 'user', content: 'Reply with exactly: ok' }],
      }, { timeout: 12000, maxRetries: 0 })
      try {
        const { recordAnthropicUsage } = await import('@/lib/usage')
        recordAnthropicUsage(res.usage, { userId, model, feature: 'other' })
      } catch { /* non-critical */ }
      attempts.push({ model, ok: true, ms: Date.now() - started })
    } catch (err) {
      attempts.push({
        model, ok: false, ms: Date.now() - started,
        error: `${(err as { status?: number })?.status ?? ''} ${String((err as Error)?.message ?? err).slice(0, 200)}`.trim(),
      })
    }
  }

  return NextResponse.json({
    ok: attempts.some(a => a.ok),
    resolvedJudgeModel: resolved,
    pinned: { sonnet: CHAT_MODELS.sonnet, opus: CHAT_MODELS.opus },
    attempts,
    at: new Date().toISOString(),
  })
}
