import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * Auto-lock cron: locks any curriculum plan whose 3-day browse period has expired
 * but hasn't been manually locked yet.
 * Should be called periodically (e.g. every hour via Vercel cron or external trigger).
 */
export async function GET() {
  const now = new Date()
  const browseWindowDays = 3

  // Find all plans that are NOT locked but were generated more than 3 days ago
  const expiredPlans = await prisma.curriculumPlan.findMany({
    where: {
      lockedAt: null,
      generatedAt: { lt: new Date(now.getTime() - browseWindowDays * 24 * 60 * 60 * 1000) },
    },
    select: { id: true, userId: true, generatedAt: true },
  })

  if (expiredPlans.length === 0) {
    return NextResponse.json({ locked: 0, message: 'No expired browse periods found' })
  }

  // Auto-lock them
  const ids = expiredPlans.map(p => p.id)
  const result = await prisma.curriculumPlan.updateMany({
    where: { id: { in: ids } },
    data: { lockedAt: now },
  })

  console.log(`[Auto-Lock Cron] Locked ${result.count} curriculum plans: ${expiredPlans.map(p => p.userId).join(', ')}`)

  return NextResponse.json({
    locked: result.count,
    plans: expiredPlans.map(p => ({ userId: p.userId, generatedAt: p.generatedAt })),
  })
}
