/**
 * Re-run project-inspiration generation for any profile in the saved
 * stress-test JSON whose inspirations failed (typically due to truncation
 * at the 3000-token cap). Increases max_tokens to 5000.
 *
 * Run: npx tsx scripts/stress-test-recover-inspirations.ts
 */
import * as dotenv from 'dotenv'
import Anthropic from '@anthropic-ai/sdk'
import * as fs from 'fs'
import * as path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: true })

interface SavedResult {
  label: string
  name: string
  age: number
  curriculum?: { tracks: Array<{ name: string; type: string; modules: Array<{ title: string }> }> }
  inspirations?: unknown
  inspirationsRaw?: string
  inspirationsError?: string
}

const PROFILE_META: Record<string, { interests: string[]; aspirations: string; occupation: string; education: string }> = {
  '45yo lawyer → AI safety': {
    interests: ['AI alignment', 'AI safety research', 'mechanistic interpretability', 'policy of advanced AI', 'decision theory', 'philosophy of mind'],
    aspirations: 'Contribute a published technical-policy bridge paper to the AI safety community within 18 months',
    occupation: 'former corporate lawyer, sabbatical to study AI safety',
    education: 'JD, Harvard Law',
  },
  '16yo chess + decision theory': {
    interests: ['competitive chess', 'chess endgames', 'decision theory', 'game theory', 'probability', 'cognitive bias'],
    aspirations: 'Reach 2200 USCF rating and win a state-level scholastic decision-theory or math olympiad event',
    occupation: 'high school junior, chess club captain',
    education: 'high school',
  },
}

function buildInspirationsPrompt(
  meta: { interests: string[]; aspirations: string; occupation: string; education: string },
  age: number,
  curriculum: { tracks: Array<{ name: string; modules: Array<{ title: string }> }> }
): string {
  const curriculumSummary = curriculum.tracks.map(t => {
    const chapterTitles = t.modules.map(c => c.title).join(', ')
    return `Track: "${t.name}" — Chapters: ${chapterTitles}`
  }).join('\n')

  return `You are designing capstone project briefs for a student. Each brief must be concrete enough that the student could open it and start working immediately — like a syllabus assignment, not a vague suggestion.

**Student Profile:**
- Interests: ${meta.interests.join(', ')}
- Aspirations: ${meta.aspirations}
- Age: ${age}, Occupation: ${meta.occupation}, Education: ${meta.education}

**Their Curriculum:**
${curriculumSummary}

---

## QUALITY RULES — every project must follow these

**TITLE QUALITY — three non-negotiable rules: SPECIFIC, COMPREHENSIVE, SIMPLE.**
- **SPECIFIC** — name the actual artifact, not the act of building one. "A Caesar Cipher Visualizer with Real-Time Frequency Analysis" ✓ — "Build a project on cryptography" ✗. "An Interactive Coral Reef Health Dashboard Using NOAA Data" ✓ — "A practical project on marine biology" ✗.
- **COMPREHENSIVE** — the title alone tells the student what they're building. No "Capstone Project", no "Final Project", no "Build Something With X".
- **SIMPLE** — readable, audience-calibrated. Not jargon-stacked, not pretentious.
- FORBIDDEN PATTERNS (will be rejected): "Build: A capstone project showcasing your mastery", "Build: A starter project that demonstrates the core ideas of [X]", "Build: A practical project that solves a real problem using [X]", "Capstone Project", "Final Project", "[X] Showcase", "Mastery Project", any title that starts with "Build: A [adjective] project". The title must name the artifact, not describe its category.

**DESCRIPTION QUALITY**
- 2-3 sentences. State what the student will produce, who/what it serves, and the central technical/intellectual challenge.
- Drop the phrase "this project" — just describe what it IS.

**MILESTONES — REQUIRED, 4-6 per project**
Every project must include a concrete sequence of milestones — phases the student would actually pass through. Each milestone is one specific deliverable, not a vague phase.
- Each milestone names a tangible artifact or measurable checkpoint
- Order them in the actual sequence the student would tackle them
- The last milestone is the finished, presentable thing

**SKILLS — 3-5 per project**
Specific technical or intellectual skills built.

**DELIVERABLE — 1 sentence**
What the finished thing IS, in concrete terms. Demo-able, shareable, screenshot-able.

---

Generate 4 projects:
- One each spanning: creative/artistic, analytical/research, technical/build, social/collaborative
- Drawn from different tracks where possible (variety > all-from-one-track)
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
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY!
  const client = new Anthropic({ apiKey })

  const file = path.resolve(process.cwd(), 'tmp/curriculum-and-projects-stress-test.json')
  const data = JSON.parse(fs.readFileSync(file, 'utf8')) as SavedResult[]

  for (const r of data) {
    if (!r.inspirationsError || !r.curriculum) continue
    const meta = PROFILE_META[r.label]
    if (!meta) {
      console.warn(`No PROFILE_META for ${r.label}, skipping`)
      continue
    }
    console.log(`Recovering inspirations for ${r.label}...`)
    try {
      const resp = await client.messages.create({
        model: 'claude-opus-4-8',
        max_tokens: 5000,
        messages: [{ role: 'user', content: buildInspirationsPrompt(meta, r.age, r.curriculum) }],
      })
      const text = (resp.content[0] as { type: string; text?: string }).text ?? ''
      r.inspirationsRaw = text
      const m = text.match(/\[[\s\S]*\]/)
      if (!m) throw new Error('No JSON array found')
      r.inspirations = JSON.parse(m[0])
      delete r.inspirationsError
      console.log(`OK (${(r.inspirations as unknown[]).length} projects)`)
    } catch (e) {
      r.inspirationsError = (e as Error).message
      console.error(`FAILED: ${r.inspirationsError}`)
    }
  }

  fs.writeFileSync(file, JSON.stringify(data, null, 2))
  console.log(`Updated → ${file}`)
}

main().catch(e => { console.error(e); process.exit(1) })
