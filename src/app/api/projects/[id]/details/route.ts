export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getUserId } from '@/lib/get-user-id'

// GET — generate or return cached project details
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const userId = await getUserId()
  const apiKey = process.env.ANTHROPIC_API_KEY

  const project = await prisma.subjectProject.findUnique({
    where: { id },
    include: { track: { include: { chapters: { select: { title: true }, take: 5 } } } },
  })

  if (!project || project.track.userId !== userId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Return cached details if they exist
  if (project.proposal) {
    try {
      const cached = JSON.parse(project.proposal)
      if (cached.overview) return NextResponse.json({ details: cached })
    } catch { /* not JSON, fall through */ }
  }

  if (!apiKey) {
    return NextResponse.json({ details: null, error: 'No API key' })
  }

  const chapterTitles = project.track.chapters.map(c => c.title).join(', ')

  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const client = new Anthropic({ apiKey })

    // Haiku, not Opus: this is a 500-token micro-task the user actively
    // waits on behind a spinner — Opus latency here read as "not working".
    const result = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `Generate concise project details for a student capstone project.

Project: ${project.title}
Subject: ${project.track.name}
Description: ${project.description}
Related chapters: ${chapterTitles || 'N/A'}

Output JSON only:
{
  "overview": "2-sentence description of what the student will build and why it matters",
  "skills": ["skill 1", "skill 2", "skill 3", "skill 4"],
  "firstSteps": ["Step 1 — specific first action", "Step 2", "Step 3"],
  "deliverable": "What the final output looks like (1 sentence)"
}`,
      }],
    })

    {
      const { recordAnthropicUsage } = await import('@/lib/usage')
      recordAnthropicUsage(result.usage, { userId, model: 'claude-haiku-4-5-20251001', feature: 'project' })
    }
    const text = (result.content[0] as { text: string }).text?.trim()
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('No JSON')

    const details = JSON.parse(jsonMatch[0])

    // Cache in proposal field
    await prisma.subjectProject.update({
      where: { id },
      data: { proposal: JSON.stringify(details) },
    })

    return NextResponse.json({ details })
  } catch (err) {
    // Surface the failure — a silent null left the card looking broken
    // (spinner disappears, nothing renders, no way to retry).
    console.error('[project-details]', err)
    return NextResponse.json({ details: null, error: 'Could not generate details' })
  }
}
