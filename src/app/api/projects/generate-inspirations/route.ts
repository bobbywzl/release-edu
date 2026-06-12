export const dynamic = 'force-dynamic'
// Long-running AI generation — without an explicit maxDuration, Vercel
// kills the function at the plan default before Claude finishes.
export const maxDuration = 300

import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getUserId } from '@/lib/get-user-id'
import Anthropic from '@anthropic-ai/sdk'

export async function POST() {
  const userId = await getUserId()

  // A transient session failure resolves to 'anonymous' — without this guard
  // it falls through to the track query, finds nothing, and answers
  // "No curriculum found", which reads like a real (and very confusing)
  // generation failure. Signal it as auth so the client can retry.
  if (userId === 'anonymous' || userId === 'unknown') {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  // Get curriculum tracks + chapters for context
  const tracks = await prisma.track.findMany({
    where: { userId },
    include: {
      chapters: { select: { title: true, keyTopics: true }, orderBy: { order: 'asc' } },
      projects: { select: { title: true } },
    },
  })

  if (tracks.length === 0) {
    return NextResponse.json({ error: 'No curriculum found' }, { status: 400 })
  }

  // Get student profile for context
  const profile = await prisma.studentProfile.findUnique({
    where: { userId },
    select: { interests: true, aspirations: true, roadmapState: true },
  })

  const interests = profile?.interests ? JSON.parse(profile.interests as string) : []
  const aspirations = profile?.aspirations || ''
  const profileMeta = profile?.roadmapState
    ? (JSON.parse(profile.roadmapState as string)?._profileMeta ?? {})
    : {}

  // Build curriculum summary
  const curriculumSummary = tracks.map(t => {
    const chapterTitles = (t.chapters as { title: string }[]).map(c => c.title).join(', ')
    const existingProjects = (t.projects as { title: string }[]).map(p => p.title)
    return `Track: "${t.name}" — Chapters: ${chapterTitles}${existingProjects.length > 0 ? ` | Existing projects: ${existingProjects.join(', ')}` : ''}`
  }).join('\n')

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'AI not configured' }, { status: 500 })
  }

  const client = new Anthropic({ apiKey })

  const prompt = `You are designing capstone project briefs for a student. Each brief must be concrete enough that the student could open it and start working immediately — like a syllabus assignment, not a vague suggestion.

**Student Profile:**
- Interests: ${interests.join(', ') || 'general learning'}
- Aspirations: ${aspirations || 'not specified'}
- Age: ${profileMeta.age || 'unknown'}, Occupation: ${profileMeta.occupation || 'student'}, Education: ${profileMeta.education || 'unknown'}

**Their Curriculum:**
${curriculumSummary}

---

## QUALITY RULES — every project must follow these

**TITLE QUALITY — three non-negotiable rules: SPECIFIC, COMPREHENSIVE, SIMPLE.**
- **SPECIFIC** — name the actual artifact, not the act of building one. "A Caesar Cipher Visualizer with Real-Time Frequency Analysis" ✓ — "Build a project on cryptography" ✗. "An Interactive Coral Reef Health Dashboard Using NOAA Data" ✓ — "A practical project on marine biology" ✗.
- **COMPREHENSIVE** — the title alone tells the student what they're building. No "Capstone Project", no "Final Project", no "Build Something With X".
- **SIMPLE** — readable, audience-calibrated. Not jargon-stacked, not pretentious.
- **CONCISE** — 3-8 words, hard maximum ~60 characters. The title is the artifact's NAME; every explanation, option, or sub-deliverable belongs in the description, never the title.
- FORBIDDEN PATTERNS (will be rejected): "Build: A capstone project showcasing your mastery", "Build: A starter project that demonstrates the core ideas of [X]", "Build: A practical project that solves a real problem using [X]", "Capstone Project", "Final Project", "[X] Showcase", "Mastery Project", any title that starts with "Build: A [adjective] project". The title must name the artifact, not describe its category.

**DESCRIPTION QUALITY**
- 2-3 sentences. State what the student will produce, who/what it serves, and the central technical/intellectual challenge.
- Drop the phrase "this project" — just describe what it IS.
- Bad: "This project lets you apply RSA encryption in a real-world way." ✗
- Good: "A browser-based message vault that encrypts notes with RSA-2048 keys generated client-side, decrypts them with a passphrase, and shows the math behind every step. Tackles the gap between using crypto libraries and understanding what they actually do." ✓

**MILESTONES — REQUIRED, 4-6 per project**
Every project must include a concrete sequence of milestones — phases the student would actually pass through. Each milestone is one specific deliverable, not a vague phase ("Research" ✗ → "Source 10 NOAA reef-monitoring datasets and document the schema of each" ✓).
- Each milestone names a tangible artifact or measurable checkpoint
- Order them in the actual sequence the student would tackle them
- The last milestone is the finished, presentable thing

**SKILLS — 3-5 per project**
Specific technical or intellectual skills built. "Public-key cryptography" ✓ — "Programming" ✗.

**DELIVERABLE — 1 sentence**
What the finished thing IS, in concrete terms. Demo-able, shareable, screenshot-able.

---

Generate 4 projects:
- One each spanning: creative/artistic, analytical/research, technical/build, social/collaborative
- Drawn from different tracks where possible (variety > all-from-one-track)
- NO duplicates of existing projects above
- Calibrated to the student's age, occupation, and skill baseline

Return ONLY valid JSON array — no markdown, no explanation:
[
  {
    "title": "The specific artifact name",
    "description": "2-3 sentences naming what it is and the central challenge",
    "trackName": "Track name from curriculum",
    "overview": "Same as description but can elaborate slightly",
    "skills": ["specific skill 1", "specific skill 2", "specific skill 3"],
    "milestones": ["Milestone 1 — concrete deliverable", "Milestone 2 — ...", "Milestone 3 — ...", "Milestone 4 — ...", "Milestone 5 — finished, presentable artifact"],
    "deliverable": "1 sentence describing the final demo-able thing"
  }
]`

  try {
    // 4000 tokens: 4 projects × (title, description, overview, skills, 4-6
    // milestones, deliverable) — 3000 risked truncated JSON, which surfaced
    // as an opaque "Generation failed".
    const response = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    })

    {
      const { recordAnthropicUsage } = await import('@/lib/usage')
      recordAnthropicUsage(response.usage, { userId, model: 'claude-opus-4-8', feature: 'project' })
    }
    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    const jsonMatch = text.match(/\[[\s\S]*\]/)
    if (!jsonMatch) throw new Error('No JSON found')

    const ideas = JSON.parse(jsonMatch[0]) as {
      title: string
      description: string
      trackName: string
      overview?: string
      skills?: string[]
      milestones?: string[]
      deliverable?: string
    }[]

    // Sweep out stale generic inspirations from before the prompt fixes.
    // These are SubjectProject rows in 'planning' status whose titles match
    // the old hardcoded fallback templates. Custom user-created projects
    // (any other title pattern) are preserved.
    const userTrackIds = tracks.map(t => t.id)
    await prisma.subjectProject.deleteMany({
      where: {
        trackId: { in: userTrackIds },
        status: 'planning',
        OR: [
          { title: { startsWith: 'Build: A capstone project showcasing' } },
          { title: { startsWith: 'Build: A starter project that demonstrates' } },
          { title: { startsWith: 'Build: A practical project that solves' } },
          { title: { contains: 'showcasing your mastery' } },
        ],
      },
    })

    // Save to DB. Cache the rich detail (overview/skills/milestones/deliverable)
    // in the `proposal` JSON field so the InspirationCard's expanded view
    // can render it instantly without a second LLM call to /details.
    const created = await Promise.all(
      ideas.map(async idea => {
        const track = tracks.find(t => t.name.toLowerCase().includes(idea.trackName.toLowerCase()))
          || tracks[0]
        // Boundary rule: short artifact-name titles, comprehensive descriptions.
        // If the model wrote a brief into the title anyway, condense it and
        // fold the detail into the description.
        const { condenseProjectTitle } = await import('@/lib/title-normalize')
        const { title, overflow } = condenseProjectTitle(idea.title)
        const description = [overflow, idea.description].filter(Boolean).join(' ')
        const proposalCache = JSON.stringify({
          overview: idea.overview || description,
          skills: idea.skills || [],
          firstSteps: idea.milestones || [],
          deliverable: idea.deliverable || '',
        })
        const project = await prisma.subjectProject.create({
          data: {
            trackId: track.id,
            title,
            description,
            status: 'planning',
            progress: 0,
            proposal: proposalCache,
          },
        })
        // Also persist milestones as structured rows so they can drive
        // progress tracking and aren't just text inside the JSON cache.
        if (idea.milestones?.length) {
          await prisma.projectMilestone.createMany({
            data: idea.milestones.map((title, i) => ({
              projectId: project.id,
              title,
              order: i,
            })),
          })
        }
        return project
      })
    )

    return NextResponse.json({ projects: created, count: created.length })
  } catch (err) {
    console.error('[generate-inspirations]', err)
    return NextResponse.json({ error: 'Generation failed' }, { status: 500 })
  }
}
