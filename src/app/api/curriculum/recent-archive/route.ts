export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getUserId } from '@/lib/get-user-id'
import prisma from '@/lib/prisma'

const RESTORE_WINDOW_HOURS = 24

// GET — return the most recent archive eligible for one-click restore (within 24h).
// Used by the onboarding page to show a "Restore your previous curriculum?" banner.
export async function GET() {
  const userId = await getUserId()
  const cutoff = new Date(Date.now() - RESTORE_WINDOW_HOURS * 60 * 60 * 1000)

  const block = await prisma.curriculumBlock.findFirst({
    where: { userId, archivedAt: { gte: cutoff } },
    orderBy: { archivedAt: 'desc' },
    select: {
      id: true,
      title: true,
      primaryInterests: true,
      totalChapters: true,
      completedChapters: true,
      overallProgress: true,
      archivedAt: true,
    },
  })

  if (!block) return NextResponse.json({ archive: null })

  const expiresAt = new Date(block.archivedAt)
  expiresAt.setHours(expiresAt.getHours() + RESTORE_WINDOW_HOURS)

  return NextResponse.json({
    archive: {
      id: block.id,
      title: block.title,
      primaryInterests: block.primaryInterests ? JSON.parse(block.primaryInterests) as string[] : [],
      totalChapters: block.totalChapters,
      completedChapters: block.completedChapters,
      overallProgress: block.overallProgress,
      archivedAt: block.archivedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    },
  })
}
