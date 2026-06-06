// Manual compaction endpoint — invoked by the /compact slash command in chat.
// Forces a summarization of older messages even on shorter conversations,
// then persists the summary on the Conversation row.
import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getUserId } from '@/lib/get-user-id'
import { compactHistory } from '@/lib/chat-compaction'

export const dynamic = 'force-dynamic'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const userId = await getUserId()

  const conv = await prisma.conversation.findFirst({
    where: { id, userId },
    select: { id: true, messages: { select: { id: true, role: true, content: true }, orderBy: { createdAt: 'asc' } } },
  })
  if (!conv) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })

  const msgs = conv.messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({ id: m.id, role: m.role as 'user' | 'assistant', content: m.content }))

  if (msgs.length < 4) {
    return NextResponse.json({
      compacted: false,
      droppedMessages: 0,
      summaryLength: 0,
      message: 'Not enough messages to compact yet.',
    })
  }

  const result = await compactHistory(id, msgs, process.env.ANTHROPIC_API_KEY, { force: true })

  // Re-read the summary from DB to confirm it was persisted.
  const updated = await prisma.conversation.findUnique({
    where: { id },
    select: { summary: true, summaryThroughId: true },
  })

  return NextResponse.json({
    compacted: result.compacted,
    droppedMessages: result.droppedMessages,
    summaryLength: updated?.summary?.length ?? 0,
    summaryThroughId: updated?.summaryThroughId ?? null,
  })
}
