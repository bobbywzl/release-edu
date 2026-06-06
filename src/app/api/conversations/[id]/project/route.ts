export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getUserId } from '@/lib/get-user-id'

// Returns the project associated with this conversation (if it's an explore session)
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const userId = await getUserId()

  const project = await prisma.subjectProject.findFirst({
    where: {
      exploreConvId: id,
      track: { userId },
    },
    include: {
      track: { select: { id: true, name: true } },
    },
  })

  if (!project) return NextResponse.json({ project: null })

  return NextResponse.json({
    project: {
      id: project.id,
      title: project.title,
      description: project.description,
      status: project.status,
      exploreConvId: project.exploreConvId,
      trackId: project.track.id,
      trackName: project.track.name,
    },
  })
}
