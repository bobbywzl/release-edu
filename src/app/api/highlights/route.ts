export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getUserId } from '@/lib/get-user-id'

// GET /api/highlights?conversationId=xxx
export async function GET(req: NextRequest) {
  const userId = await getUserId()
  const conversationId = req.nextUrl.searchParams.get('conversationId')
  if (!conversationId) {
    return NextResponse.json({ highlights: [] })
  }

  const highlights = await prisma.messageHighlight.findMany({
    where: { userId, conversationId },
    orderBy: { createdAt: 'asc' },
  })

  return NextResponse.json({ highlights })
}

// POST /api/highlights
export async function POST(req: NextRequest) {
  const userId = await getUserId()
  const body = await req.json()
  const { conversationId, messageId, selectedText, startOffset, endOffset, color, comment } = body

  if (!conversationId || !messageId || !selectedText || startOffset == null || endOffset == null) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const highlight = await prisma.messageHighlight.create({
    data: {
      userId,
      conversationId,
      messageId,
      selectedText,
      startOffset,
      endOffset,
      color: color || 'amber',
      comment: comment || null,
    },
  })

  return NextResponse.json({ highlight }, { status: 201 })
}
