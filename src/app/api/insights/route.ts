export const dynamic = 'force-dynamic'

/**
 * GET /api/insights — the OPEN LEARNER MODEL read endpoint.
 *
 * Research (Long & Aleven 2017): making the learner model legible to the
 * learner improves learning. Returns Bob's curated, ranked memory so the
 * dashboard can show "What Bob knows about you" transparently — every
 * subject-specific note labeled with the session (tree) it came from, and
 * recently-RESOLVED struggles/misconceptions included so fixed holes render
 * crossed off (progress), instead of the list only ever growing (report card).
 */
import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getUserId } from '@/lib/get-user-id'
import { getTopInsights } from '@/lib/insight-memory'

export async function GET() {
  const userId = await getUserId()
  const insights = await getTopInsights(userId, { limit: 24 }).catch(() => [])
  // Recently-closed holes: resolved struggle/misconception/weakness rows —
  // the crossing-off is the point, so ship the latest few alongside actives.
  const resolved = await prisma.insight.findMany({
    where: { userId, status: 'resolved', type: { in: ['struggle', 'misconception', 'weakness'] } },
    orderBy: { lastConfirmedAt: 'desc' },
    take: 8,
  }).catch(() => [])
  // The TRUE constellation size — the display list above is ranked and
  // capped, so counters must not read its length (that made the star count
  // wander between loads as the ranking shifted around the cap).
  const total = await prisma.insight.count({ where: { userId, status: 'active' } }).catch(() => insights.length)

  // Session labels: join the tree display titles for every referenced treeId.
  const treeIds = Array.from(new Set(
    [...insights, ...resolved].map(i => i.treeId).filter((x): x is string => !!x),
  ))
  const trees = treeIds.length > 0
    ? await prisma.problemTree.findMany({
        where: { id: { in: treeIds }, userId },
        select: { id: true, title: true, displayTitle: true },
      }).catch(() => [])
    : []
  const treeTitles: Record<string, string> = {}
  for (const t of trees) treeTitles[t.id] = (t.displayTitle || t.title).slice(0, 80)

  const shape = (i: (typeof insights)[number], status: 'active' | 'resolved') => ({
    id: i.id,
    type: i.type,
    content: i.content,
    confidence: i.confidence,
    importance: i.importance,
    timesObserved: i.timesObserved,
    source: i.source,
    status,
    treeId: i.treeId ?? null,
    treeTitle: i.treeId ? treeTitles[i.treeId] ?? null : null,
    // Reinforcement stamp — powers the dashboard's weekly "what Bob
    // figured out about you this week" digest card.
    lastConfirmedAt: i.lastConfirmedAt,
  })

  return NextResponse.json({
    total,
    insights: insights.map(i => shape(i, 'active')),
    resolved: resolved.map(i => shape(i, 'resolved')),
  })
}
