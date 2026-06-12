import { NextRequest, NextResponse } from 'next/server'
import { setChapterStatus } from '@/lib/status-cascade'
import { getUserId } from '@/lib/get-user-id'
import prisma from '@/lib/prisma'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const { status } = await req.json()
  const userId = await getUserId()

  // Verify ownership
  const chapter = await prisma.chapter.findUnique({
    where: { id },
    include: { track: { select: { userId: true, name: true } } },
  })
  if (!chapter || chapter.track.userId !== userId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  if (!['not-started', 'in-progress', 'completed'].includes(status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }

  await setChapterStatus(id, status)

  // Mastering a chapter flips matching struggle insights to "resolved" —
  // they stop steering Bob's teaching and become portfolio growth material.
  if (status === 'completed') {
    try {
      const { markStrugglesResolved } = await import('@/lib/insight-memory')
      void markStrugglesResolved(userId, `${chapter.title} ${chapter.track.name}`)
    } catch { /* non-critical */ }
  }

  return NextResponse.json({ success: true, chapterId: id, status })
}
