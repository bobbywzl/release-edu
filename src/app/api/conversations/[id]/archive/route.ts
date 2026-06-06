export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getUserId } from '@/lib/get-user-id'

// POST — snapshot conversation messages to ConversationArchive before deletion
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const userId = await getUserId()
  const { linkedType, linkedId, linkedTitle } = await req.json()

  // Verify conversation belongs to user
  const conv = await prisma.conversation.findUnique({
    where: { id },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  })
  if (!conv || conv.userId !== userId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Snapshot messages
  const messagesJson = JSON.stringify(
    conv.messages.map(m => ({
      role: m.role,
      content: m.content,
      createdAt: m.createdAt.toISOString(),
    }))
  )

  const archive = await prisma.conversationArchive.create({
    data: {
      userId,
      originalConvId: id,
      linkedType,
      linkedId,
      linkedTitle,
      messagesJson,
    },
  })

  return NextResponse.json({ archiveId: archive.id })
}

// GET — retrieve archived messages for a linked chapter/project
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const userId = await getUserId()

  // id here is the conversation id — find archive by originalConvId
  const archive = await prisma.conversationArchive.findFirst({
    where: { originalConvId: id, userId },
    orderBy: { archivedAt: 'desc' },
  })

  if (!archive) {
    return NextResponse.json({ archive: null })
  }

  return NextResponse.json({
    archive: {
      id: archive.id,
      linkedType: archive.linkedType,
      linkedId: archive.linkedId,
      linkedTitle: archive.linkedTitle,
      messages: JSON.parse(archive.messagesJson),
      archivedAt: archive.archivedAt.toISOString(),
    },
  })
}
