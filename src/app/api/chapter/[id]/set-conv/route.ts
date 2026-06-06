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

  const chapter = await prisma.chapter.findUnique({
    where: { id },
    include: { track: { select: { userId: true } } },
  })

  if (!chapter || chapter.track.userId !== userId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  await prisma.chapter.update({
    where: { id },
    data: { sessionConvId: conversationId },
  })

  return NextResponse.json({ success: true })
}
