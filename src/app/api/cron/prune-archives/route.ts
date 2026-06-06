import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * Cleanup cron: enforces a per-user cap on archived CurriculumBlock rows.
 * Each user keeps the `KEEP_PER_USER` most recent archives; older ones are
 * deleted. Idempotent and safe to run on any schedule.
 *
 * The reset route already prunes when creating new archives — this cron is
 * the safety net for (a) existing users above the cap pre-this-deploy, and
 * (b) any future code path that creates a CurriculumBlock without going
 * through the reset route.
 */
const KEEP_PER_USER = 2

export async function GET() {
  // Find users who have more than KEEP_PER_USER archives.
  const offenders = await prisma.curriculumBlock.groupBy({
    by: ['userId'],
    _count: { _all: true },
    having: { userId: { _count: { gt: KEEP_PER_USER } } },
  })

  if (offenders.length === 0) {
    return NextResponse.json({ usersPruned: 0, archivesDeleted: 0 })
  }

  let totalDeleted = 0
  for (const { userId } of offenders) {
    const all = await prisma.curriculumBlock.findMany({
      where: { userId },
      orderBy: { archivedAt: 'desc' },
      select: { id: true },
    })
    if (all.length <= KEEP_PER_USER) continue
    const toDelete = all.slice(KEEP_PER_USER).map(b => b.id)
    const res = await prisma.curriculumBlock.deleteMany({ where: { id: { in: toDelete } } })
    totalDeleted += res.count
  }

  console.log(`[ArchivePrune Cron] Pruned ${totalDeleted} archive(s) across ${offenders.length} user(s)`)
  return NextResponse.json({ usersPruned: offenders.length, archivesDeleted: totalDeleted, keepPerUser: KEEP_PER_USER })
}
