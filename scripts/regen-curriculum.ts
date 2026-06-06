// One-off regeneration script — calls Claude with the user's saved profile,
// saves real AI-generated tracks/chapters to the DB. Use to recover from
// stuck-with-fallback states.
//
// Usage: npx tsx scripts/regen-curriculum.ts <userEmail>

import { PrismaClient } from '@prisma/client'
import Anthropic from '@anthropic-ai/sdk'
import { dbStore } from '../src/lib/db-store'
import { normalizeCurriculumTracks } from '../src/lib/title-normalize'

const prisma = new PrismaClient()

const email = process.argv[2]
if (!email) {
  console.error('Usage: npx tsx scripts/regen-curriculum.ts <userEmail>')
  process.exit(1)
}

async function main() {
  const u = await prisma.user.findUnique({ where: { email }, include: { studentProfile: true } })
  if (!u || !u.studentProfile) {
    console.error(`No user/profile found for ${email}`)
    process.exit(1)
  }
  const sp = u.studentProfile

  const parseList = (v: string | null | undefined): string[] => {
    if (!v) return []
    try { const p = JSON.parse(v); return Array.isArray(p) ? p : [v] } catch { return [v] }
  }

  const profile = {
    interests: parseList(sp.interests),
    strengths: parseList(sp.strengths),
    weaknesses: parseList(sp.weaknesses),
    learningStyle: sp.learningStyle || 'visual',
    personalityTraits: [],
    aspirations: sp.aspirations || '',
    educationFrustrations: [],
    baselineAssessment: { math: 5, writing: 5, science: 5, history: 5, criticalThinking: 5 },
  }

  // Pull setup metadata for learner context (age, education, etc.)
  let learnerProfileLine = ''
  try {
    const meta = sp.roadmapState ? (JSON.parse(sp.roadmapState as string)?._profileMeta ?? {}) : {}
    let age: number | null = null
    if (meta.birthdate) {
      const birth = new Date(meta.birthdate)
      const today = new Date()
      age = today.getFullYear() - birth.getFullYear()
      if (today < new Date(today.getFullYear(), birth.getMonth(), birth.getDate())) age--
    }
    learnerProfileLine = [
      meta.name, age != null ? `${age} years old` : null, meta.occupation, meta.education,
      meta.isIndividual ? 'learning independently' : (meta.organization ? `at ${meta.organization}` : null),
    ].filter(Boolean).join(', ')
  } catch { /* ignore */ }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY not set in environment')
    process.exit(1)
  }
  const client = new Anthropic({ apiKey })

  const prompt = `You are an educational curriculum designer. Create a personalized curriculum plan for a student with this profile:

${learnerProfileLine ? `**Learner Profile:** ${learnerProfileLine} — CRITICAL: calibrate ALL curriculum complexity, depth, vocabulary, pacing, and example choices to this profile.\n` : ''}**Interests:** ${profile.interests.join(', ')}
**Strengths:** ${profile.strengths.join(', ')}
**Weaknesses:** ${profile.weaknesses.join(', ')}
**Learning Style:** ${profile.learningStyle}
**Aspirations:** ${profile.aspirations}

Create EXACTLY 3 interest-based courses (type: "project") and EXACTLY 3 foundation courses (type: "core"). Each course has 3-4 chapters.

Chapter titles MUST be specific, textbook-style topics — names of actual concepts. NOT generic phase labels like "Foundations", "Key Concepts", "Advanced Topics", "Applications". A student should know what the chapter teaches just from the title.

Examples of good chapter titles by interest:
- Organic farming → "Soil Microbiology and Cover Cropping", "Composting Chemistry and Nutrient Cycling", "Integrated Pest Management"
- Agricultural research → "Field Trial Design and Statistical Methods", "Crop Yield Modeling", "Hypothesis-Driven Agronomy"
- Modern agritech → "Precision Agriculture and Remote Sensing", "Hydroponics and Controlled Environment Agriculture", "Farm Data and IoT Systems"

Foundation courses must be specific traditional disciplines (e.g. "Plant Biology", "Soil Chemistry", "Agricultural Economics") — NEVER "Mathematical Foundations" or "Communication and Writing" or other generic catch-all names.

Return ONLY valid JSON, no markdown:
{
  "profileSummary": "1-2 sentences about the student",
  "primaryStrengths": [...],
  "primaryInterests": [...],
  "learningStyle": "...",
  "personalityTraits": [...],
  "tracks": [
    {
      "name": "[Formal Course Title]", "description": "...", "color": "#3B82F6", "type": "project",
      "projectIdea": "Build: [specific capstone project that synthesizes the chapters]",
      "modules": [
        {"title": "[Specific concept]", "description": "Learn X because it enables Y for your goal of Z", "type": "project", "subject": "...", "estimatedHours": 10, "skills": ["...", "..."], "aiRationale": "...", "status": "in-progress"},
        {"title": "[Next specific concept]", "description": "...", "type": "project", "subject": "...", "estimatedHours": 10, "skills": ["...", "..."], "aiRationale": "...", "status": "not-started"}
      ]
    }
  ]
}`

  console.log('Calling Claude (claude-sonnet-4-6, 16000 max_tokens)...')
  const result = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 16000,
    messages: [{ role: 'user', content: prompt }],
  })

  const textBlock = result.content[0] as { type: string; text?: string }
  const text = (textBlock?.text || '').trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()

  let generated: {
    profileSummary: string
    primaryStrengths: string[]
    primaryInterests: string[]
    learningStyle: string
    personalityTraits: string[]
    tracks: Array<{
      name: string; description: string; color: string; type: string;
      projectIdea?: string;
      modules: Array<{ title: string; description: string; type: string; subject: string; estimatedHours: number; skills: string[]; aiRationale: string; status: string }>;
    }>;
  }
  try {
    generated = JSON.parse(text)
  } catch (err) {
    console.error('JSON parse failed:', err)
    console.error('Raw response:', text.slice(0, 500))
    process.exit(1)
  }

  console.log(`Got ${generated.tracks.length} tracks from Claude. Saving...`)

  const store = dbStore.forUser(u.id)
  const normalizedTracks = normalizeCurriculumTracks(generated.tracks)

  await store.setCurriculumPlan({
    profileSummary: generated.profileSummary,
    primaryStrengths: generated.primaryStrengths,
    primaryInterests: generated.primaryInterests,
    learningStyle: generated.learningStyle,
    personalityTraits: generated.personalityTraits,
    version: 1,
    tracks: normalizedTracks.map((t, idx) => ({
      name: t.name,
      description: t.description,
      color: t.color,
      type: t.type,
      projectIdea: t.projectIdea,
      order: idx,
      modules: t.modules.map((m, midx) => ({
        title: m.title,
        description: m.description,
        type: m.type,
        subject: m.subject,
        estimatedHours: m.estimatedHours,
        skills: m.skills,
        aiRationale: m.aiRationale,
        status: m.status,
        order: midx,
      })),
    })),
  })

  console.log('Saved. Verifying...')
  const tracks = await prisma.track.findMany({ where: { userId: u.id }, include: { chapters: true } })
  for (const t of tracks) {
    console.log(`\n${t.name} [${t.type}]:`)
    t.chapters.forEach(c => console.log('  -', c.title))
  }

  await prisma.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
