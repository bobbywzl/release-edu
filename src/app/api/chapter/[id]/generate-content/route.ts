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
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'No API key' }, { status: 500 })

  // Fetch chapter with track info
  const chapterWithTrack = await prisma.chapter.findUnique({
    where: { id },
    include: { track: { select: { name: true, userId: true, description: true, type: true } } },
  })

  if (!chapterWithTrack || chapterWithTrack.track.userId !== userId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Don't regenerate if already rich content (> 500 chars and not placeholder)
  if (
    chapterWithTrack.content &&
    chapterWithTrack.content.length > 500 &&
    !chapterWithTrack.content.includes('Content will be generated')
  ) {
    return NextResponse.json({ content: chapterWithTrack.content, cached: true })
  }

  // Fetch student profile for personalisation context
  const profile = await prisma.studentProfile.findUnique({
    where: { userId },
    select: { aspirations: true, learningStyle: true, interests: true },
  })

  const interests = profile?.interests
    ? JSON.parse(profile.interests as string).join(', ')
    : 'not specified'
  const keyTopics = chapterWithTrack.keyTopics
    ? JSON.parse(chapterWithTrack.keyTopics as string)
    : []

  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const client = new Anthropic({ apiKey })

  const prompt = `You are a world-class educator writing comprehensive course material.

Generate a complete, rich chapter syllabus for:

**Chapter:** ${chapterWithTrack.title}
**Subject:** ${chapterWithTrack.track.name}
**Key Topics:** ${keyTopics.join(', ')}
**Student interests:** ${interests}
**Learning style:** ${profile?.learningStyle || 'not specified'}

Write the full chapter content in structured markdown. This will be the authoritative source material Bob uses to teach this chapter. Include:

1. **Overview** — 2-3 sentences explaining what this chapter is about and why it matters
2. **Core Concepts** — For each key topic: clear definition, explanation, and a concrete real-world example. Be thorough and precise.
3. **Key Distinctions** — Common confusions or important nuances students must understand (3-5 points)
4. **Examples & Analogies** — 2-3 worked examples or analogies that make abstract concepts tangible
5. **Common Misconceptions** — What students typically get wrong and why
6. **Connections** — How this chapter connects to other concepts in ${chapterWithTrack.track.name}
7. **Learning Objectives** — Numbered list of exactly what the student will be able to do after mastering this chapter
8. **Practice Question Preview** — 3 example questions that will appear in the problem set (don't give answers)

Write at depth appropriate for genuine mastery, not surface familiarity. Be precise, not padded.`

  try {
    const result = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 8000,
      messages: [{ role: 'user', content: prompt }],
    })

    {
      const { recordAnthropicUsage } = await import('@/lib/usage')
      recordAnthropicUsage(result.usage, { userId, model: 'claude-opus-4-8', feature: 'chapter' })
    }
    let content = (result.content[0] as { text: string }).text?.trim() || ''

    // If output hit the token cap, repair common mid-sentence truncation so the
    // renderer never displays unterminated code spans / open table rows.
    if (result.stop_reason === 'max_tokens') {
      // Close any unterminated inline code spans (odd number of backticks).
      const tickCount = (content.match(/`/g) || []).length
      if (tickCount % 2 === 1) content += '`'
      // Drop a dangling final line that looks like a partial table row or fragment.
      const lines = content.split('\n')
      const last = lines[lines.length - 1]?.trim() || ''
      if (last && /[|`*_]\s*$/.test(last) && !last.endsWith('|') === false) {
        // Trim incomplete trailing line to avoid mid-sentence truncation artifacts.
        lines.pop()
        content = lines.join('\n').trimEnd()
      }
      content += '\n\n_(Content truncated — open in chat to continue.)_'
    }

    // Save to DB
    await prisma.chapter.update({
      where: { id },
      data: { content },
    })

    return NextResponse.json({ content, cached: false })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
