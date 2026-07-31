export const dynamic = 'force-dynamic'

/**
 * GET /api/insights — the OPEN LEARNER MODEL read endpoint.
 *
 * Research (Long & Aleven 2017): making the learner model legible to the
 * learner improves learning. Returns Bob's curated, ranked memory so the
 * dashboard can show "What Bob knows about you" transparently.
 */
import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getUserId } from '@/lib/get-user-id'
import { getTopInsights } from '@/lib/insight-memory'

export async function GET() {
  const userId = await getUserId()
  const insights = await getTopInsights(userId, { limit: 24 }).catch(() => [])
  // The TRUE constellation size — the display list above is ranked and
  // capped, so counters must not read its length (that made the star count
  // wander between loads as the ranking shifted around the cap).
  const total = await prisma.insight.count({ where: { userId, status: 'active' } }).catch(() => insights.length)
  return NextResponse.json({
    total,
    insights: insights.map(i => ({
      id: i.id,
      type: i.type,
      content: i.content,
      confidence: i.confidence,
      importance: i.importance,
      timesObserved: i.timesObserved,
      source: i.source,
      // Reinforcement stamp — powers the dashboard's weekly "what Bob
      // figured out about you this week" digest card.
      lastConfirmedAt: i.lastConfirmedAt,
    })),
  })
}
