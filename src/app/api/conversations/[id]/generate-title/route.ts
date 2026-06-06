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
  const { userMessage, assistantMessage } = await req.json()

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'No API key' }, { status: 500 })

  // Verify conversation belongs to user
  const conv = await prisma.conversation.findUnique({ where: { id } })
  if (!conv || conv.userId !== userId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const client = new Anthropic({ apiKey })

    const result = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 30,
      messages: [{
        role: 'user',
        content: `Generate a short, descriptive title (max 5 words) for this conversation. Be specific about the topic — like Gemini chat titles.

User: ${userMessage.slice(0, 300)}
Assistant: ${assistantMessage.slice(0, 300)}

Reply with ONLY the title, no quotes, no punctuation at end.`,
      }],
    })

    const title = (result.content[0] as any).text?.trim().slice(0, 60) || conv.title
    await prisma.conversation.update({ where: { id }, data: { title } })
    return NextResponse.json({ title })
  } catch {
    return NextResponse.json({ title: conv.title })
  }
}
