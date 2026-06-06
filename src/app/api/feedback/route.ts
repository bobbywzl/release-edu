export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getUserId } from '@/lib/get-user-id'

// POST — upsert feedback for a message
export async function POST(req: NextRequest) {
  const userId = await getUserId()
  const body = await req.json()
  const { messageId, conversationId, rating, comment, mode, chapterId } = body as {
    messageId: string
    conversationId: string
    rating: number
    comment?: string
    mode?: string
    chapterId?: string
  }

  if (!messageId || !conversationId || (rating !== 1 && rating !== -1)) {
    return NextResponse.json({ error: 'Invalid feedback' }, { status: 400 })
  }

  const feedback = await prisma.messageFeedback.upsert({
    where: {
      userId_messageId: { userId, messageId },
    },
    update: { rating, comment: comment ?? null },
    create: {
      userId,
      conversationId,
      messageId,
      rating,
      comment: comment ?? null,
      mode: mode ?? null,
      chapterId: chapterId ?? null,
    },
  })

  // Auto-collect positive examples for prompt evolution
  if (rating === 1 && chapterId) {
    try {
      // Get the chapter's session score and track name
      const chapter = await prisma.chapter.findUnique({
        where: { id: chapterId },
        select: { sessionScore: true, track: { select: { name: true } } },
      })
      const sessionScore = chapter?.sessionScore ?? 0
      const category = chapter?.track?.name || 'unknown'

      if (sessionScore > 70) {
        // Check collection cap: max 50 approved examples per category
        const approvedCount = await prisma.trainingExample.count({
          where: { category: { contains: category, mode: 'insensitive' }, approved: true },
        })

        if (approvedCount < 50) {
          // Get the message content and its preceding user message
          const msg = await prisma.message.findUnique({
            where: { id: messageId },
            select: { content: true, conversationId: true, createdAt: true },
          })
          if (msg) {
            // Find the user message immediately before this assistant message
            const userMsg = await prisma.message.findFirst({
              where: {
                conversationId: msg.conversationId,
                role: 'user',
                createdAt: { lt: msg.createdAt },
              },
              orderBy: { createdAt: 'desc' },
              select: { content: true },
            })

            if (userMsg) {
              await prisma.trainingExample.create({
                data: {
                  category,
                  userMessage: userMsg.content,
                  bobResponse: msg.content,
                  sessionScore,
                  rating: 1,
                  approved: false,
                },
              })
            }
          }
        }
      }
    } catch (err) {
      console.error('[TrainingExample] Failed to collect:', err)
    }
  }

  return NextResponse.json(feedback)
}

// GET — get all feedback for a conversation
export async function GET(req: NextRequest) {
  const userId = await getUserId()
  const conversationId = req.nextUrl.searchParams.get('conversationId')

  if (!conversationId) {
    return NextResponse.json({ error: 'conversationId required' }, { status: 400 })
  }

  const feedback = await prisma.messageFeedback.findMany({
    where: { userId, conversationId },
    select: { messageId: true, rating: true },
  })

  return NextResponse.json(feedback)
}
