// Long-running AI generation — without an explicit maxDuration, Vercel
// kills the function at the plan default before Claude finishes.
export const maxDuration = 300
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getUserId } from '@/lib/get-user-id'
import { dbStore } from '@/lib/db-store'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { conversationId } = await req.json()
  const userId = await getUserId()

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'No API key' }, { status: 500 })

  const chapter = await prisma.chapter.findUnique({
    where: { id },
    select: { id: true, title: true, notes: true, track: { select: { userId: true, name: true } } },
  })
  if (!chapter || chapter.track?.userId !== userId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Get conversation messages
  const store = dbStore.forUser(userId)
  const conv = await store.getConversation(conversationId)
  const messages = (conv?.messages || [])
    .slice(-20)
    .map(m => {
      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
      return `[${m.role}]: ${content.slice(0, 500)}`
    })
    .join('\n\n')

  if (!messages) {
    return NextResponse.json({ error: 'No messages found' }, { status: 400 })
  }

  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const client = new Anthropic({ apiKey })

  const result = await client.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: `You are creating concise, scannable lecture notes from a tutoring conversation about "${chapter.title}" in ${chapter.track?.name}.

Conversation:
${messages}

Generate notes using EXACTLY this structure (keep all five sections):

## Key Concepts
- [one bullet per key concept learned, max 1-2 sentences each]

## Important Distinctions
- [things that are easy to confuse, clarified — max 1-2 sentences each]

## Examples & Analogies
- [concrete examples or analogies discussed — max 1-2 sentences each]

## Questions to Reflect On
- [thought-provoking questions for review]

## Summary
[2-3 sentence synthesis of what was covered and the key takeaway]

Rules:
- Be concise. Each bullet should be max 1-2 sentences.
- Notes should be scannable — a student should review them in under 2 minutes.
- Use clear, direct language. No filler.
- If a section has no relevant content from the conversation, include 1 bullet with "Not covered in this session."
- Do NOT include any text before or after the sections.`
    }]
  })

  {
    const { recordAnthropicUsage } = await import('@/lib/usage')
    recordAnthropicUsage(result.usage, { userId, model: 'claude-opus-4-8', feature: 'chapter' })
  }
  const noteContent = result.content[0]
  const notes = noteContent.type === 'text' ? noteContent.text?.trim() : null
  if (!notes) return NextResponse.json({ error: 'Generation failed' }, { status: 500 })

  // Save notes to chapter
  await prisma.chapter.update({ where: { id }, data: { notes } })

  return NextResponse.json({ notes })
}
