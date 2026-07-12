export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/conversations/[id] — full transcript of ANY user's
 * conversation, for the admin conversation browser. The owner-scoped
 * /api/conversations/[id] 404s for conversations the admin doesn't own,
 * which left the browser's reading pane permanently empty.
 */
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { adminApiGuard } from '@/lib/admin-auth'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await adminApiGuard(); if (denied) return denied
  const { id } = await params

  const conversation = await prisma.conversation.findUnique({
    where: { id },
    include: {
      messages: { orderBy: { createdAt: 'asc' } },
      user: { select: { id: true, name: true, email: true } },
    },
  })
  if (!conversation) {
    return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
  }
  return NextResponse.json(conversation)
}
