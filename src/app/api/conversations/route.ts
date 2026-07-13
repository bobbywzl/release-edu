import { NextRequest, NextResponse } from 'next/server'
import { dbStore } from '@/lib/db-store'
import { getUserId } from '@/lib/get-user-id'

// GET /api/conversations — list user's conversations
export async function GET() {
  const userId = await getUserId()
  const store = dbStore.forUser(userId)
  const convs = await store.getConversations()

  return NextResponse.json(
    convs.map(c => ({
      id: c.id,
      title: c.title,
      context: c.context,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      preview: c.messages[0]?.content?.slice(0, 80) ?? '',
      messageCount: c._count.messages,
    }))
  )
}

// POST /api/conversations — create new conversation
export async function POST(req: NextRequest) {
  const userId = await getUserId()
  const store = dbStore.forUser(userId)
  const body = await req.json().catch(() => ({})) as { title?: string; context?: string }

  const conv = await store.createConversation(body.title ?? 'New Conversation', body.context)

  return NextResponse.json({
    id: conv.id,
    title: conv.title,
    context: conv.context,
    createdAt: conv.createdAt,
    updatedAt: conv.updatedAt,
    preview: '',
    messageCount: 0,
  }, { status: 201 })
}
