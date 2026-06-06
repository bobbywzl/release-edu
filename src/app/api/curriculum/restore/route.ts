export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '@/lib/get-user-id'
import prisma from '@/lib/prisma'

const RESTORE_WINDOW_HOURS = 24

// POST — restore an archived curriculum (CurriculumBlock) back into live state.
// Only allowed within the 24-hour window after reset, only for the user's own
// archive, and only if a curriculum doesn't already exist (avoids merge conflicts).
export async function POST(req: NextRequest) {
  const userId = await getUserId()
  const body = await req.json().catch(() => ({})) as { archiveId?: string }
  const archiveId = body.archiveId

  if (!archiveId) {
    return NextResponse.json({ error: 'archiveId required' }, { status: 400 })
  }

  const block = await prisma.curriculumBlock.findUnique({ where: { id: archiveId } })
  if (!block || block.userId !== userId) {
    return NextResponse.json({ error: 'Archive not found' }, { status: 404 })
  }

  const cutoff = new Date(Date.now() - RESTORE_WINDOW_HOURS * 60 * 60 * 1000)
  if (block.archivedAt < cutoff) {
    return NextResponse.json({ error: 'Restore window has expired' }, { status: 410 })
  }

  // Refuse if user already has a live curriculum — restore is meant for the
  // post-reset gap, not for blowing away active work.
  const existing = await prisma.curriculumPlan.findFirst({ where: { userId } })
  if (existing) {
    return NextResponse.json({ error: 'A curriculum already exists. Reset it before restoring.' }, { status: 409 })
  }

  type ArchivedTrack = {
    name: string
    type: string
    color: string
    progress: number
    chapters: Array<{
      title: string
      status: string
      sessionScore: number | null
      keyTopics: string | null
    }>
  }
  let tracks: ArchivedTrack[]
  try {
    tracks = JSON.parse(block.tracksJson) as ArchivedTrack[]
  } catch {
    return NextResponse.json({ error: 'Archive is corrupted' }, { status: 500 })
  }

  // Recreate the curriculum plan
  await prisma.curriculumPlan.create({
    data: {
      userId,
      profileSummary: block.profileSummary,
      primaryInterests: block.primaryInterests,
      primaryStrengths: block.primaryStrengths,
      learningStyle: block.learningStyle,
      generatedAt: block.startedAt,
      lastUpdatedAt: new Date(),
      version: 1,
    },
  })

  // Recreate tracks + chapters in original order
  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i]
    const track = await prisma.track.create({
      data: {
        userId,
        name: t.name,
        type: t.type,
        color: t.color,
        progress: t.progress ?? 0,
        order: i,
        trackStatus: 'active',
      },
    })
    if (t.chapters?.length) {
      await prisma.chapter.createMany({
        data: t.chapters.map((c: ArchivedTrack['chapters'][number], ci: number) => ({
          trackId: track.id,
          title: c.title,
          status: c.status ?? 'not-started',
          sessionScore: c.sessionScore,
          keyTopics: c.keyTopics,
          order: ci,
        })),
      })
    }
  }

  // Re-flip the onboarded flag
  await prisma.studentProfile.updateMany({
    where: { userId },
    data: { isOnboarded: true },
  })

  // Delete the archive — it's been restored, not needed as a separate snapshot.
  // (Portfolio data lives elsewhere; CurriculumBlock is purely the post-reset
  // restore-window snapshot.)
  await prisma.curriculumBlock.delete({ where: { id: archiveId } })

  return NextResponse.json({ success: true })
}
