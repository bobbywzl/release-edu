export const dynamic = 'force-dynamic'

/**
 * POST /api/xp/feature { badgeId, featured } — toggle whether an earned badge
 * is featured on the portfolio/résumé. Capped at 4 featured badges so the
 * résumé stays curated, not cluttered.
 */
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getUserId } from '@/lib/get-user-id'

const FEATURED_CAP = 4

export async function POST(req: NextRequest) {
  const userId = await getUserId()
  const { badgeId, featured } = (await req.json().catch(() => ({}))) as { badgeId?: string; featured?: boolean }
  if (!badgeId || typeof featured !== 'boolean') {
    return NextResponse.json({ error: 'badgeId and featured are required' }, { status: 400 })
  }

  try {
    if (featured) {
      const count = await prisma.userBadge.count({ where: { userId, featured: true } })
      if (count >= FEATURED_CAP) {
        return NextResponse.json({ error: `You can feature at most ${FEATURED_CAP} badges.`, cap: FEATURED_CAP }, { status: 409 })
      }
    }
    const updated = await prisma.userBadge.updateMany({
      where: { userId, badgeId },
      data: { featured },
    })
    if (updated.count === 0) {
      return NextResponse.json({ error: 'Badge not earned yet' }, { status: 404 })
    }
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Badges are not available yet' }, { status: 503 })
  }
}
