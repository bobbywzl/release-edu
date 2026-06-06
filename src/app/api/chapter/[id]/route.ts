import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getUserId } from '@/lib/get-user-id'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const userId = await getUserId()

  const chapter = await prisma.chapter.findUnique({
    where: { id },
    include: { track: { select: { name: true, userId: true, color: true } } },
  })

  if (!chapter || chapter.track.userId !== userId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json({
    chapter: {
      id: chapter.id,
      title: chapter.title,
      description: chapter.description,
      content: chapter.content,
      keyTopics: JSON.parse(chapter.keyTopics || '[]'),
      status: chapter.status,
      estimatedMinutes: chapter.estimatedMinutes,
      trackId: chapter.trackId,
      trackName: chapter.track.name,
      trackColor: chapter.track.color,
      sessionScore: chapter.sessionScore ?? 0,
      sessionConvId: chapter.sessionConvId ?? null,
    },
  })
}
