/**
 * POST /api/conversations/[id]/review-notes
 *
 * On-demand: turns the WHOLE conversation into clean, exam-ready study notes
 * (Markdown). The chat's Review panel renders these and offers a PDF download.
 * Not generated automatically — only when the student asks for it.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '@/lib/get-user-id'
import { dbStore } from '@/lib/db-store'

export const maxDuration = 60

// Strip machine-only fenced blocks so the notes model sees clean teaching prose.
function stripBlocks(text: string): string {
  return text
    .replace(/```(?:quiz|problem|progress|reflection|expectations|image|mermaid|chart|funcplot|submission-review)\n[\s\S]*?```/g, '')
    .replace(/\[CHAPTER_MASTERED\]/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'AI is not configured.' }, { status: 503 })

  const store = dbStore.forUser(userId)
  const conv = await store.getConversation(id) // ownership-scoped (where id+userId)
  if (!conv) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })

  const transcript = conv.messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => {
      const content = m.role === 'assistant' ? stripBlocks(m.content) : m.content.trim()
      if (!content) return ''
      return `${m.role === 'user' ? 'STUDENT' : 'TUTOR'}: ${content}`
    })
    .filter(Boolean)
    .join('\n\n')
    .slice(-16000) // keep the most recent ~16k chars of the lesson

  if (!transcript.trim()) {
    return NextResponse.json({ error: 'Nothing to summarize yet — have a conversation first.' }, { status: 400 })
  }

  let langDirective = ''
  try {
    const { getUserLanguage } = await import('@/lib/get-user-language')
    if ((await getUserLanguage(userId)) === 'zh') {
      langDirective = '\n\nWrite the notes ENTIRELY in Simplified Chinese (简体中文); keep formulas, chemical notation, and standard technical/proper nouns as appropriate.'
    }
  } catch { /* default English */ }

  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const client = new Anthropic({ apiKey })
    const result = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2800,
      messages: [{
        role: 'user',
        content: `Create clean, exam-ready STUDY NOTES in Markdown from this tutoring conversation${conv.title ? ` ("${conv.title}")` : ''}. Capture everything important that was taught: key concepts, definitions, processes and sequences, formulas, important distinctions, and worked examples.

Format:
- Start with a single \`# <topic>\` title.
- Use \`##\` section headings, **bold** for key terms, bullet lists, and Markdown tables where they genuinely clarify.
- Keep math/chemical notation readable (e.g. NH4+, NO3-, or LaTeX such as $N_2$).
- Concise but complete and logically organized — a student should be able to revise from these notes alone.
- Output ONLY the Markdown notes. No preamble ("Here are your notes"), no quiz/progress blocks, no closing remarks.${langDirective}

CONVERSATION:
${transcript}`,
      }],
    })
    try {
      const { recordAnthropicUsage } = await import('@/lib/usage')
      recordAnthropicUsage(result.usage, { userId, model: 'claude-haiku-4-5-20251001', feature: 'other' })
    } catch { /* non-critical */ }

    const notes = (result.content[0] as { type: string; text?: string })?.text?.trim() ?? ''
    if (!notes) return NextResponse.json({ error: 'Could not generate notes.' }, { status: 502 })
    return NextResponse.json({ notes, title: conv.title || 'Review Notes' })
  } catch (err) {
    console.error('[review-notes] generation failed:', err)
    return NextResponse.json({ error: 'Could not generate notes right now.' }, { status: 502 })
  }
}
