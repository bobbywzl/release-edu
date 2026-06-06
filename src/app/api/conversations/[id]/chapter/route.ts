export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getUserId } from '@/lib/get-user-id'

// Returns the chapter associated with this conversation (if it's a lesson session)
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const userId = await getUserId()

  const chapter = await prisma.chapter.findFirst({
    where: {
      sessionConvId: id,
      track: { userId },
    },
    include: {
      track: { select: { id: true, name: true, userId: true } },
    },
  })

  if (!chapter) return NextResponse.json({ chapter: null })

  return NextResponse.json({
    chapter: {
      id: chapter.id,
      title: chapter.title,
      description: chapter.description,
      keyTopics: JSON.parse(chapter.keyTopics || '[]'),
      status: chapter.status,
      sessionScore: chapter.sessionScore ?? 0,
      sessionConvId: chapter.sessionConvId,
      trackId: chapter.track.id,
      trackName: chapter.track.name,
    },
  })
}
