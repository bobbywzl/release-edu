import { NextRequest, NextResponse } from 'next/server'
import { dbStore } from '@/lib/db-store'
import { getUserId } from '@/lib/get-user-id'

// GET /api/conversations/[id] — get conversation with messages
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const userId = await getUserId()
  const store = dbStore.forUser(userId)

  const conv = await store.getConversation(id)
  if (!conv) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({
    id: conv.id,
    title: conv.title,
    context: conv.context,
    createdAt: conv.createdAt,
    updatedAt: conv.updatedAt,
    messages: conv.messages.map(m => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt,
      // Attachment info (uploaded images/files) rides in metadata.
      metadata: (m as { metadata?: string | null }).metadata ?? null,
    })),
  })
}

// PATCH /api/conversations/[id] — update title/context
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const userId = await getUserId()
  const store = dbStore.forUser(userId)
  const body = await req.json().catch(() => ({})) as { title?: string; context?: string }

  const conv = await store.updateConversation(id, body)
  if (!conv) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({ id: conv.id, title: conv.title, context: conv.context })
}

// DELETE /api/conversations/[id] — delete conversation
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const userId = await getUserId()
  const store = dbStore.forUser(userId)

  const deleted = await store.deleteConversation(id)
  if (!deleted) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({ success: true })
}
