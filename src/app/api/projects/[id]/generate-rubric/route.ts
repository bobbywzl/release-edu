export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getUserId } from '@/lib/get-user-id'
import Anthropic from '@anthropic-ai/sdk'

export interface RubricCriterion {
  name: string
  description: string
  weight: number // percentage, sum = 100
  levels: {
    needsWork: string
    meetsStandard: string
    exceedsStandard: string
  }
}

export interface ProjectRubric {
  generatedAt: string
  projectTitle: string
  criteria: RubricCriterion[]
  realWorldContext: string // brief description of professional standard for this type of project
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const userId = await getUserId()

  const project = await prisma.subjectProject.findFirst({
    where: { id },
    include: {
      track: {
        include: {
          chapters: { select: { title: true, keyTopics: true }, orderBy: { order: 'asc' } },
        },
      },
    },
  })

  if (!project || project.track.userId !== userId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Return existing rubric if already generated
  if (project.rubric) {
    return NextResponse.json({ rubric: JSON.parse(project.rubric) })
  }

  // Load student profile for calibration
  const profile = await prisma.studentProfile.findUnique({
    where: { userId },
    select: { roadmapState: true, interests: true, aspirations: true },
  })
  const profileMeta = profile?.roadmapState
    ? (JSON.parse(profile.roadmapState as string)?._profileMeta ?? {})
    : {}

  const learnerProfile = [
    profileMeta.age ? `${profileMeta.age} years old` : null,
    profileMeta.occupation,
    profileMeta.education,
  ].filter(Boolean).join(', ')

  const interests = profile?.interests ? JSON.parse(profile.interests as string) : []
  const chapters = project.track.chapters as { title: string; keyTopics?: string[] | string }[]
  const curriculumSummary = chapters.map(c => {
    const topics = c.keyTopics
      ? (Array.isArray(c.keyTopics) ? c.keyTopics : JSON.parse(c.keyTopics as string))
      : []
    return `${c.title}${topics.length ? ` (${topics.join(', ')})` : ''}`
  }).join('; ')

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'AI not configured' }, { status: 500 })

  const client = new Anthropic({ apiKey })

  const prompt = `You are creating an evaluation rubric for a student project.

**Project:** "${project.title}"
${project.description ? `**Description:** ${project.description}` : ''}
**Subject Track:** ${project.track.name}
**Curriculum covered:** ${curriculumSummary || 'general'}
**Student profile:** ${learnerProfile || 'student'}
**Interests:** ${interests.join(', ') || 'general'}

Create a rigorous, specific evaluation rubric with 4-6 criteria. The rubric must:
1. Be specific to THIS project type (not generic)
2. Reference what professional/academic work of this type looks like in the real world (GitHub repos, published papers, portfolios, industry standards — whatever applies)
3. Be calibrated to the student's level (${learnerProfile || 'student'}) — expectations should be achievable but challenging for their background
4. Cover both the conceptual/intellectual quality AND the execution/craft quality

For each criterion, the level descriptions must be CONCRETE and SPECIFIC to this project — not vague phrases like "demonstrates understanding" but actual observable qualities like "the cipher implementation handles edge cases including empty strings, unicode input, and wrap-around at Z".

Return ONLY valid JSON, no markdown:
{
  "generatedAt": "${new Date().toISOString()}",
  "projectTitle": "${project.title}",
  "realWorldContext": "2-3 sentences describing what professional/academic work of this type looks like and where to find examples",
  "criteria": [
    {
      "name": "Criterion name",
      "description": "What this criterion measures",
      "weight": 20,
      "levels": {
        "needsWork": "Specific description of what insufficient work looks like for THIS project",
        "meetsStandard": "Specific description of what solid, complete work looks like",
        "exceedsStandard": "Specific description of what exceptional, professional-grade work looks like"
      }
    }
  ]
}`

  try {
    const response = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    })

    {
      const { recordAnthropicUsage } = await import('@/lib/usage')
      recordAnthropicUsage(response.usage, { userId, model: 'claude-opus-4-8', feature: 'project' })
    }
    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('No JSON in response')

    const rubric: ProjectRubric = JSON.parse(jsonMatch[0])

    // Normalize weights to sum to 100
    const totalWeight = rubric.criteria.reduce((s, c) => s + c.weight, 0)
    if (totalWeight !== 100) {
      rubric.criteria = rubric.criteria.map(c => ({ ...c, weight: Math.round(c.weight / totalWeight * 100) }))
    }

    await prisma.subjectProject.update({
      where: { id },
      data: { rubric: JSON.stringify(rubric) },
    })

    return NextResponse.json({ rubric })
  } catch (err) {
    console.error('[generate-rubric]', err)
    return NextResponse.json({ error: 'Generation failed' }, { status: 500 })
  }
}
