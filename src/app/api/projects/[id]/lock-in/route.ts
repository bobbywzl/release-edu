import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '@/lib/get-user-id'
import prisma from '@/lib/prisma'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const userId = await getUserId()

  // Verify ownership via track
  const project = await prisma.subjectProject.findUnique({
    where: { id },
    include: { track: { select: { userId: true } } },
  })

  if (!project || project.track.userId !== userId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Cap: max 2 active projects at a time
  const activeCount = await prisma.subjectProject.count({
    where: {
      track: { userId },
      status: { in: ['in-progress', 'approved'] },
    },
  })
  if (activeCount >= 2) {
    return NextResponse.json({
      error: 'Project cap reached',
      message: 'You already have 2 active projects. Complete or pause one before locking in a new one.',
    }, { status: 400 })
  }

  const updated = await prisma.subjectProject.update({
    where: { id },
    // Lock-in marks the project as actively started — stamp startedAt the
    // first time it transitions out of planning/proposal.
    data: {
      status: 'in-progress',
      startedAt: project.startedAt ?? new Date(),
    } as { status: string; startedAt: Date },
  })

  return NextResponse.json({ success: true, project: updated })
}
