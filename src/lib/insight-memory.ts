/**
 * Insight Memory Engine — the personalization moat.
 *
 * Raw insights stream in from chat (Haiku extraction). This module turns that
 * stream into a curated, ranked "student memory":
 *
 *   - scoreInsight():       deterministic importance ranking (no AI at read time)
 *   - getTopInsights():     the filtered memory consumers should use (prompt,
 *                           portfolio, curriculum gen, UI) — never raw rows
 *   - maybeConsolidate():   background Haiku job that merges duplicates, marks
 *                           off-track insights stale, and caps active memory
 *   - markStrugglesResolved(): chapter mastery converts matching "struggle"
 *                           insights into growth events instead of stale noise
 *
 * Status lifecycle: active → merged | stale | resolved. Only `active` (and
 * pinned) insights are ever injected into prompts; resolved struggles feed the
 * portfolio's growth narrative.
 */
import prisma from '@/lib/prisma'
import type { Insight } from '@prisma/client'

export const INSIGHT_TYPES = [
  'personality', 'interest', 'strength', 'weakness', 'preference',
  'aspiration', 'breakthrough', 'struggle', 'style',
  // Tree EDU additions:
  // knowledge — verifiably ACQUIRED understanding (verified nodes, correct
  //   own-words explanations). The raw material for analogy-bridging.
  // misconception — a SYSTEMATIC wrong belief (not a slip). Per repair
  //   theory these must be refuted directly — more practice won't fix them.
  'knowledge', 'misconception',
] as const

const ACTIVE_CAP = 50          // hard ceiling on active memory per student
const CONSOLIDATE_THRESHOLD = 45
const RECENCY_HALF_LIFE_DAYS = 60

/**
 * Deterministic ranking score. Importance dominates, confidence refines,
 * recency decays gently (durable traits shouldn't vanish), and repeated
 * observations boost. Pinned insights always outrank everything.
 */
export function scoreInsight(
  i: Pick<Insight, 'importance' | 'confidence' | 'timesObserved' | 'lastConfirmedAt' | 'pinned'>,
  now: Date = new Date(),
): number {
  if (i.pinned) return 1000
  const ageDays = Math.max(0, (now.getTime() - new Date(i.lastConfirmedAt).getTime()) / 86_400_000)
  // Exponential decay floored at 0.25 — old but important memories stay usable.
  const recency = Math.max(0.25, Math.exp(-ageDays / RECENCY_HALF_LIFE_DAYS))
  const reinforcement = 1 + 0.15 * Math.log2(1 + (i.timesObserved ?? 1))
  return (0.6 * (i.importance ?? 0.5) + 0.4 * (i.confidence ?? 0.5)) * recency * reinforcement
}

/**
 * The curated memory: active insights only, ranked by score.
 * All consumers (system prompt, portfolio, curriculum gen, student-data API)
 * should read through this — never prisma.insight.findMany directly.
 */
export async function getTopInsights(
  userId: string,
  opts: { limit?: number; types?: string[] } = {},
): Promise<Insight[]> {
  const { limit = 20, types } = opts
  let rows: Insight[]
  try {
    rows = await prisma.insight.findMany({
      where: {
        userId,
        status: 'active',
        ...(types ? { type: { in: types } } : {}),
      },
    })
  } catch {
    // Schema-lag fallback: if the memory-engine columns haven't been pushed
    // to this database yet, query only the legacy columns and synthesize
    // defaults so insight consumers keep working.
    const legacy = await prisma.insight.findMany({
      where: { userId, ...(types ? { type: { in: types } } : {}) },
      select: { id: true, userId: true, type: true, content: true, confidence: true, source: true, createdAt: true },
    })
    rows = legacy.map(l => ({
      ...l,
      importance: 0.5,
      status: 'active',
      timesObserved: 1,
      lastConfirmedAt: l.createdAt,
      pinned: false,
      mergedIntoId: null,
    }))
  }
  const now = new Date()
  return rows
    .sort((a, b) => scoreInsight(b, now) - scoreInsight(a, now))
    .slice(0, limit)
}

/** Resolved struggles = growth stories for the portfolio. */
export async function getResolvedStruggles(userId: string, limit = 10): Promise<Insight[]> {
  return prisma.insight.findMany({
    where: { userId, status: 'resolved' },
    orderBy: { lastConfirmedAt: 'desc' },
    take: limit,
  })
}

/**
 * On verified mastery: struggle/weakness/misconception insights that mention
 * the mastered subject flip to `resolved` — they stop steering teaching and
 * become portfolio growth material. Misconceptions are included because a
 * passed transfer test IS the demonstration that the wrong model was
 * repaired; without this the open learner model keeps reporting beliefs the
 * student visibly no longer holds (simulation: 8 stale misconceptions after
 * three verified nodes). Matching is a conservative keyword overlap so we
 * never resolve an unrelated insight.
 */
export async function markStrugglesResolved(userId: string, subjectText: string): Promise<void> {
  try {
    const keywords = subjectText
      .split(/[\s,，、:：\-—()（）]+/)
      .map(k => k.trim().toLowerCase())
      .filter(k => k.length >= 2)
    if (keywords.length === 0) return

    const struggles = await prisma.insight.findMany({
      where: { userId, status: 'active', type: { in: ['struggle', 'weakness', 'misconception'] } },
    })
    const resolvedIds = struggles
      .filter(s => {
        const c = s.content.toLowerCase()
        return keywords.some(k => c.includes(k))
      })
      .map(s => s.id)
    if (resolvedIds.length === 0) return

    await prisma.insight.updateMany({
      where: { id: { in: resolvedIds } },
      data: { status: 'resolved', lastConfirmedAt: new Date() },
    })
  } catch { /* non-critical */ }
}

/**
 * Background consolidation. Fires only when active memory exceeds the
 * threshold; one Haiku call merges duplicates, marks off-track items stale
 * (e.g. insights from an abandoned previous curriculum direction), and the
 * deterministic cap trims the remainder. Never touches pinned insights.
 */
export async function maybeConsolidateInsights(userId: string, apiKey: string): Promise<void> {
  try {
    const activeCount = await prisma.insight.count({ where: { userId, status: 'active' } })
    if (activeCount <= CONSOLIDATE_THRESHOLD) return

    const [rows, profile] = await Promise.all([
      prisma.insight.findMany({ where: { userId, status: 'active' } }),
      prisma.studentProfile.findUnique({ where: { userId }, select: { interests: true, aspirations: true } }),
    ])
    let interests: string[] = []
    try { interests = profile?.interests ? JSON.parse(profile.interests) : [] } catch { /* ignore */ }

    const listing = rows
      .map(r => `${r.id} | ${r.type} | obs:${r.timesObserved} | ${r.content.slice(0, 140)}`)
      .join('\n')

    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const client = new Anthropic({ apiKey })
    const result = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      messages: [{
        role: 'user',
        content: `You curate a student's long-term memory for an AI tutor. Below are the student's current insights and their CURRENT learning direction. Consolidate the memory.

CURRENT INTERESTS: ${interests.join(', ') || '(unknown)'}
CURRENT ASPIRATION: ${profile?.aspirations || '(unknown)'}

INSIGHTS (id | type | timesObserved | content):
${listing}

Return ONLY valid JSON:
{
  "merge": [{"keep": "id-to-keep", "drop": ["id1", "id2"]}],
  "stale": ["ids of insights about topics/directions the student has clearly abandoned, or that contradict newer insights"],
  "resolve": ["ids of struggle/weakness insights that newer strength/breakthrough insights show are overcome"]
}

Rules:
- "merge": near-duplicate observations about the same trait/topic — keep the most specific one.
- "stale": be decisive about insights tied to a PREVIOUS curriculum direction unrelated to the current interests (e.g. old test topics). Personality/style insights are direction-independent — never mark those stale for topic mismatch.
- Never list an id in more than one bucket. If unsure, leave the insight alone.`,
      }],
    })

    try {
      const { recordAnthropicUsage } = await import('@/lib/usage')
      recordAnthropicUsage(result.usage, { userId, model: 'claude-haiku-4-5-20251001', feature: 'insight' })
    } catch { /* non-critical */ }

    const text = (result.content[0] as { type: string; text?: string })?.text ?? ''
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return
    const ops = JSON.parse(jsonMatch[0]) as {
      merge?: { keep: string; drop: string[] }[]
      stale?: string[]
      resolve?: string[]
    }

    const validIds = new Set(rows.filter(r => !r.pinned).map(r => r.id))
    const idOk = (id: unknown): id is string => typeof id === 'string' && validIds.has(id)

    for (const m of ops.merge ?? []) {
      const drop = (m.drop ?? []).filter(idOk).filter(id => id !== m.keep)
      if (!idOk(m.keep) || drop.length === 0) continue
      const dropped = rows.filter(r => drop.includes(r.id))
      const extraObs = dropped.reduce((sum, r) => sum + (r.timesObserved ?? 1), 0)
      await prisma.insight.updateMany({
        where: { id: { in: drop } },
        data: { status: 'merged', mergedIntoId: m.keep },
      })
      await prisma.insight.update({
        where: { id: m.keep },
        data: { timesObserved: { increment: extraObs }, lastConfirmedAt: new Date() },
      })
    }
    const staleIds = (ops.stale ?? []).filter(idOk)
    if (staleIds.length > 0) {
      await prisma.insight.updateMany({ where: { id: { in: staleIds } }, data: { status: 'stale' } })
    }
    const resolveIds = (ops.resolve ?? []).filter(idOk)
    if (resolveIds.length > 0) {
      await prisma.insight.updateMany({
        where: { id: { in: resolveIds } },
        data: { status: 'resolved', lastConfirmedAt: new Date() },
      })
    }

    // Deterministic cap: if still over the ceiling, the lowest-scored
    // non-pinned actives go stale. Keeps per-user memory (and prompt size) bounded.
    const remaining = await prisma.insight.findMany({ where: { userId, status: 'active' } })
    if (remaining.length > ACTIVE_CAP) {
      const now = new Date()
      const overflow = remaining
        .filter(r => !r.pinned)
        .sort((a, b) => scoreInsight(a, now) - scoreInsight(b, now))
        .slice(0, remaining.length - ACTIVE_CAP)
        .map(r => r.id)
      if (overflow.length > 0) {
        await prisma.insight.updateMany({ where: { id: { in: overflow } }, data: { status: 'stale' } })
      }
    }
  } catch (err) {
    console.error('[InsightMemory] Consolidation failed (non-critical):', err)
  }
}
