export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getUserId } from '@/lib/get-user-id'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const userId = await getUserId()
  const { conversationId } = await req.json()

  const project = await prisma.subjectProject.findUnique({
    where: { id },
    include: { track: { select: { userId: true } } },
  })

  if (!project || project.track.userId !== userId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  await prisma.subjectProject.update({
    where: { id },
    data: { exploreConvId: conversationId },
  })

  return NextResponse.json({ success: true })
}
