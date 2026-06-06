export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getUserId } from '@/lib/get-user-id'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const userId = await getUserId()

  const project = await prisma.subjectProject.findUnique({
    where: { id },
    include: { track: { select: { id: true, name: true, userId: true } } },
  })

  if (!project || project.track.userId !== userId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json({
    project: {
      id: project.id,
      title: project.title,
      description: project.description,
      status: project.status,
      progress: project.progress,
      subject: project.track.name,
      trackId: project.track.id,
      trackName: project.track.name,
      exploreConvId: project.exploreConvId ?? null,
      lockedIn: project.status !== 'proposal',
      proposal: project.proposal ?? null,
      coverageMap: project.coverageMap ? JSON.parse(project.coverageMap) : null,
      mentorFeedback: project.mentorFeedback ?? null,
    },
  })
}
