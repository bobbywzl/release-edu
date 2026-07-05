export const dynamic = 'force-dynamic'

/**
 * GET /api/insights — the OPEN LEARNER MODEL read endpoint.
 *
 * Research (Long & Aleven 2017): making the learner model legible to the
 * learner improves learning. Returns Bob's curated, ranked memory so the
 * dashboard can show "What Bob knows about you" transparently.
 */
import { NextResponse } from 'next/server'
import { getUserId } from '@/lib/get-user-id'
import { getTopInsights } from '@/lib/insight-memory'

export async function GET() {
  const userId = await getUserId()
  const insights = await getTopInsights(userId, { limit: 24 }).catch(() => [])
  return NextResponse.json({
    insights: insights.map(i => ({
      id: i.id,
      type: i.type,
      content: i.content,
      confidence: i.confidence,
      importance: i.importance,
      timesObserved: i.timesObserved,
      source: i.source,
    })),
  })
}
