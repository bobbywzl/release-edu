/**
 * Stress-test the curriculum-generation prompt with diverse synthetic learners
 * and aggregate every chapter title produced. Helps surface formulaic /
 * generic-sounding titles vs specific topic titles.
 *
 * Run: npx tsx scripts/stress-test-curriculum-titles.ts
 */
import * as dotenv from 'dotenv'
import Anthropic from '@anthropic-ai/sdk'
import * as fs from 'fs'
import * as path from 'path'

// Load .env explicitly from cwd (tsx is typically run from repo root).
const envPath = path.resolve(process.cwd(), '.env')
dotenv.config({ path: envPath, override: true })

interface OnboardingProfile {
  interests: string[]
  strengths: string[]
  weaknesses: string[]
  learningStyle: string
  personalityTraits: string[]
  aspirations: string
  educationFrustrations?: string[]
  baselineAssessment: {
    math: number
    writing: number
    science: number
    history: number
    criticalThinking: number
  }
}

interface SyntheticLearner {
  label: string
  age: number
  occupation: string
  education: string
  profile: OnboardingProfile
}

const LEARNERS: SyntheticLearner[] = [
  {
    label: '12yo curious kid — cryptosecurity',
    age: 12,
    occupation: '6th grader',
    education: 'middle school',
    profile: {
      interests: ['cryptography', 'cybersecurity', 'puzzles', 'number theory', 'computer science', 'hacking ethics'],
      strengths: ['math puzzles', 'pattern recognition', 'curiosity'],
      weaknesses: ['long reading', 'patience for theory'],
      learningStyle: 'hands-on',
      personalityTraits: ['curious', 'playful', 'persistent'],
      aspirations: 'Build my own simple encryption tool I can use to send secret messages to my friends',
      baselineAssessment: { math: 7, writing: 5, science: 6, history: 4, criticalThinking: 7 },
    },
  },
  {
    label: '17yo high schooler — quant finance + value investing',
    age: 17,
    occupation: 'high school senior',
    education: 'high school',
    profile: {
      interests: ['quantitative finance', 'value investing', 'probability', 'financial markets', 'behavioral economics', 'statistics'],
      strengths: ['math', 'logical reasoning'],
      weaknesses: ['public speaking', 'writing essays'],
      learningStyle: 'reading',
      personalityTraits: ['analytical', 'competitive', 'patient'],
      aspirations: 'Build a stock screener that combines Buffett-style fundamentals with quant signals',
      baselineAssessment: { math: 9, writing: 6, science: 7, history: 6, criticalThinking: 8 },
    },
  },
  {
    label: '22yo college student — marine biology',
    age: 22,
    occupation: 'undergraduate student',
    education: 'college junior',
    profile: {
      interests: ['marine biology', 'coral reef ecology', 'ocean chemistry', 'climate impact on oceans', 'cetacean behavior', 'fieldwork methods'],
      strengths: ['biology', 'observation', 'lab skills'],
      weaknesses: ['advanced math', 'statistics'],
      learningStyle: 'hands-on',
      personalityTraits: ['empathetic', 'patient', 'detail-oriented'],
      aspirations: 'Conduct independent research on coral bleaching for my senior thesis',
      baselineAssessment: { math: 5, writing: 7, science: 8, history: 5, criticalThinking: 7 },
    },
  },
  {
    label: '30yo career switcher — classical music composition',
    age: 30,
    occupation: 'former software engineer',
    education: 'BS computer science',
    profile: {
      interests: ['classical composition', 'music theory', 'counterpoint', 'orchestration', 'film scoring', 'harmony'],
      strengths: ['structured thinking', 'piano basics'],
      weaknesses: ['ear training', 'sight reading'],
      learningStyle: 'hands-on',
      personalityTraits: ['disciplined', 'introspective'],
      aspirations: 'Compose a 10-minute string quartet that I can have performed locally',
      baselineAssessment: { math: 8, writing: 7, science: 7, history: 6, criticalThinking: 8 },
    },
  },
  {
    label: '45yo PhD researcher — AI safety',
    age: 45,
    occupation: 'AI researcher',
    education: 'PhD computer science',
    profile: {
      interests: ['AI safety', 'mechanistic interpretability', 'reinforcement learning', 'alignment theory', 'decision theory', 'agent foundations'],
      strengths: ['math', 'research methodology', 'paper-reading'],
      weaknesses: ['ML engineering tooling'],
      learningStyle: 'reading',
      personalityTraits: ['rigorous', 'skeptical'],
      aspirations: 'Publish a paper on a novel interpretability technique within 12 months',
      baselineAssessment: { math: 10, writing: 9, science: 9, history: 6, criticalThinking: 10 },
    },
  },
  {
    label: '60yo retiree — ancient Roman history',
    age: 60,
    occupation: 'retired teacher',
    education: 'BA English',
    profile: {
      interests: ['Roman Republic', 'Roman Empire', 'Latin language', 'classical archaeology', 'Mediterranean history', 'historiography'],
      strengths: ['reading comprehension', 'writing'],
      weaknesses: ['math', 'memorizing dates'],
      learningStyle: 'reading',
      personalityTraits: ['curious', 'patient', 'reflective'],
      aspirations: 'Read Caesar and Cicero in the original Latin and write a personal blog series',
      baselineAssessment: { math: 4, writing: 9, science: 5, history: 8, criticalThinking: 8 },
    },
  },
  {
    label: '14yo middle schooler — game design + Unity',
    age: 14,
    occupation: '8th grader',
    education: 'middle school',
    profile: {
      interests: ['game design', 'Unity engine', 'C# programming', 'pixel art', 'game mechanics', 'storytelling'],
      strengths: ['creativity', 'computer use'],
      weaknesses: ['algebra', 'long-form writing'],
      learningStyle: 'hands-on',
      personalityTraits: ['imaginative', 'playful'],
      aspirations: 'Ship a small 2D platformer game on itch.io that my classmates can play',
      baselineAssessment: { math: 6, writing: 5, science: 6, history: 5, criticalThinking: 7 },
    },
  },
  {
    label: '28yo philosophy enthusiast — philosophy of mind',
    age: 28,
    occupation: 'paralegal',
    education: 'BA philosophy',
    profile: {
      interests: ['philosophy of mind', 'consciousness studies', 'phenomenology', 'cognitive science', 'free will', 'qualia'],
      strengths: ['argument analysis', 'writing'],
      weaknesses: ['neuroscience details', 'mathematical formalism'],
      learningStyle: 'reading',
      personalityTraits: ['contemplative', 'precise'],
      aspirations: 'Develop and write a coherent personal essay defending a theory of consciousness',
      baselineAssessment: { math: 5, writing: 9, science: 6, history: 7, criticalThinking: 9 },
    },
  },
  {
    label: '35yo activist — climate science',
    age: 35,
    occupation: 'NGO program manager',
    education: 'MA public policy',
    profile: {
      interests: ['climate science', 'atmospheric chemistry', 'carbon cycle', 'climate modeling', 'energy systems', 'policy'],
      strengths: ['policy analysis', 'communication'],
      weaknesses: ['advanced math', 'physics'],
      learningStyle: 'discussion',
      personalityTraits: ['driven', 'collaborative'],
      aspirations: 'Lead a regional climate adaptation initiative grounded in solid scientific reasoning',
      baselineAssessment: { math: 5, writing: 8, science: 6, history: 7, criticalThinking: 8 },
    },
  },
  {
    label: '24yo amateur chef — cooking + food science',
    age: 24,
    occupation: 'line cook',
    education: 'culinary school',
    profile: {
      interests: ['food science', 'fermentation', 'Maillard chemistry', 'sous vide', 'flavor pairing', 'baking science'],
      strengths: ['knife skills', 'taste calibration'],
      weaknesses: ['chemistry vocabulary', 'metric conversions in formulas'],
      learningStyle: 'hands-on',
      personalityTraits: ['energetic', 'creative'],
      aspirations: 'Open a small fermentation-focused restaurant within 5 years',
      baselineAssessment: { math: 5, writing: 5, science: 6, history: 4, criticalThinking: 7 },
    },
  },
  {
    label: '19yo college freshman — basketball analytics',
    age: 19,
    occupation: 'college freshman',
    education: 'college freshman',
    profile: {
      interests: ['basketball analytics', 'sports statistics', 'data visualization', 'player tracking', 'machine learning', 'NBA strategy'],
      strengths: ['Excel', 'sports knowledge'],
      weaknesses: ['programming', 'calculus'],
      learningStyle: 'hands-on',
      personalityTraits: ['competitive', 'curious'],
      aspirations: 'Build a public dashboard predicting NBA player performance for next season',
      baselineAssessment: { math: 7, writing: 6, science: 6, history: 5, criticalThinking: 7 },
    },
  },
  {
    label: '38yo designer — graphic design + typography',
    age: 38,
    occupation: 'freelance graphic designer',
    education: 'BFA design',
    profile: {
      interests: ['typography', 'type design', 'editorial design', 'design history', 'color theory', 'Bauhaus'],
      strengths: ['visual sensitivity', 'software fluency'],
      weaknesses: ['type-history facts', 'mathematical letterform construction'],
      learningStyle: 'visual',
      personalityTraits: ['perfectionist', 'aesthetic'],
      aspirations: 'Design and release my own custom display typeface on a foundry platform',
      baselineAssessment: { math: 5, writing: 7, science: 5, history: 6, criticalThinking: 7 },
    },
  },
  {
    label: '16yo high schooler — robotics',
    age: 16,
    occupation: 'high school junior',
    education: 'high school',
    profile: {
      interests: ['robotics', 'embedded systems', 'control theory', 'mechanical design', 'computer vision', 'Arduino'],
      strengths: ['math', 'tinkering'],
      weaknesses: ['writing', 'history'],
      learningStyle: 'hands-on',
      personalityTraits: ['hands-on', 'persistent'],
      aspirations: 'Build a robot that competes in FIRST Robotics regionals next year',
      baselineAssessment: { math: 8, writing: 5, science: 7, history: 4, criticalThinking: 8 },
    },
  },
  {
    label: '27yo entrepreneur — fashion business',
    age: 27,
    occupation: 'aspiring founder',
    education: 'BA business',
    profile: {
      interests: ['fashion business', 'apparel manufacturing', 'sustainable fashion', 'brand marketing', 'retail economics', 'supply chain'],
      strengths: ['marketing', 'sales'],
      weaknesses: ['accounting', 'tech sketching'],
      learningStyle: 'discussion',
      personalityTraits: ['driven', 'social'],
      aspirations: 'Launch a sustainable streetwear brand with a profitable first collection',
      baselineAssessment: { math: 6, writing: 6, science: 4, history: 5, criticalThinking: 7 },
    },
  },
  {
    label: '50yo theatre tech — theatrical lighting design',
    age: 50,
    occupation: 'community-theatre volunteer',
    education: 'some college',
    profile: {
      interests: ['theatrical lighting', 'stagecraft', 'optics', 'color theory in light', 'scenography', 'electrical safety'],
      strengths: ['hands-on stage experience', 'crew leadership'],
      weaknesses: ['advanced electrical theory', 'CAD software'],
      learningStyle: 'hands-on',
      personalityTraits: ['practical', 'collaborative'],
      aspirations: 'Lead lighting design for a full mainstage show at the local regional theatre',
      baselineAssessment: { math: 5, writing: 6, science: 6, history: 5, criticalThinking: 7 },
    },
  },
]

function buildPrompt(learner: SyntheticLearner): string {
  const p = learner.profile
  const learnerProfileLine = [
    `synthetic-learner-${learner.label}`,
    `${learner.age} years old`,
    learner.occupation,
    learner.education,
    'learning independently (no formal school/org)',
  ].filter(Boolean).join(', ')

  const topInterest = p.interests[0] ?? 'technology'
  const researchContext = `[research placeholder for ${topInterest} — assume standard academic introduction covering history, methods, and core concepts]`
  const curriculaResearch = `[curricula research placeholder — assume reference to typical university programs and MOOCs covering ${p.interests.slice(0, 4).join(', ')}]`

  return `You are an educational curriculum designer. Create a personalized curriculum plan for a student with this profile:

**Learner Profile:** ${learnerProfileLine} — CRITICAL: calibrate ALL curriculum complexity, depth, vocabulary, pacing, and example choices to this profile. A 10-year-old needs simple, concrete, playful content. A 25-year-old working professional needs career-relevant, rigorous, efficient content. A graduate student needs research-grade depth.
**Interests:** ${p.interests.join(', ')}
**Strengths:** ${p.strengths.join(', ')}
**Weaknesses:** ${p.weaknesses.join(', ')}
**Learning Style:** ${p.learningStyle}
**Personality:** ${p.personalityTraits.join(', ')}
**Aspirations:** ${p.aspirations}
${p.educationFrustrations?.length ? `**What they disliked about traditional education (AVOID these in curriculum design):** ${p.educationFrustrations.join(', ')}` : ''}
**Baseline Assessment:** Math: ${p.baselineAssessment.math}/10, Writing: ${p.baselineAssessment.writing}/10, Science: ${p.baselineAssessment.science}/10, History: ${p.baselineAssessment.history}/10, Critical Thinking: ${p.baselineAssessment.criticalThinking}/10

**Research on their top interest (${topInterest}):**
${researchContext.slice(0, 800)}

**Existing curricula from real institutions (reference these for structure, topic ordering, and depth):**
${curriculaResearch.slice(0, 1200)}

---

## CURRICULUM DESIGN PRINCIPLES — APPLY ALL OF THESE

**TERMINOLOGY (use consistently — both internally in this JSON and externally to the student):**
- A **track** is one of the two top-level groupings ("Foundations" or "Interest-Based").
- A **course** is an item inside a track. (Formal academic course title.)
- A **chapter** is an item inside a course. (One focused concept, 5–12 hours.)
- Never use the words "subject" or "module" to refer to courses — always say "course". The output JSON's track names contain courses; each course's "modules" array contains chapters.

**1. TIME BUDGET — ~2 MONTHS TOTAL**
The entire curriculum (all courses + projects) should be completable in approximately 2 months of dedicated study (~150–200 total hours). Budget time accordingly:
- Interest-based courses: ~120–150 hours total across 3–5 courses (each course 25–40 hours)
- Foundation courses: ~30–50 hours total across 2–3 courses (each course 10–20 hours)
- Each chapter within a course: 5–12 hours
- Allocate time realistically — a chapter on "Measure Theory" needs more hours than "What is a Prediction Market?"

**2. BREADTH AND SPECIFICITY**
- Interest-based courses must cover the FULL landscape of the student's domain — not just one narrow slice. If someone wants quant finance, they need probability theory AND market microstructure AND risk modeling AND data analysis — not 5 variations of the same topic.
- Each course must be specific enough to have a clear identity — broad enough to contain 3–5 meaningful chapters.
- Foundation courses must each be a distinct discipline — no overlap between them, and no overlap with interest courses.

**3. LOGICAL FLOW AND COHERENCE**
- Courses should be ordered so prerequisites come first. Within each course, chapters must build on each other sequentially.
- The student should never encounter a chapter that requires knowledge from a chapter they haven't reached yet.
- Cross-course dependencies: if "Stochastic Calculus" requires "Probability Theory" (a foundation course), the foundation course should be positioned to be studied first or in parallel.
- Each chapter's description must make clear what it builds on and what it enables.

**4. RELEVANCE TO USER INTERESTS AND NEEDS**
- Every course must have a clear line connecting it to the student's stated aspirations and interests from the onboarding conversation.
- No filler courses. If a course doesn't directly serve the student's goals, it shouldn't exist.
- Chapter topics should reflect what the student would actually encounter in pursuing their aspiration — drawn from real curricula, textbooks, and professional practice in that field.

**5. INTEREST VS FOUNDATION STRUCTURE**
- **Interest-based track** = courses that are deep dives INTO the student's passion. These ARE the thing they want to learn. Specialized sub-disciplines. ~75–80% of total time.
- **Foundation track** = courses in traditional academic disciplines that SUPPORT the passion but aren't the passion itself. Adjacent disciplines that make the student more capable. ~20–25% of total time.
- The two tracks should feel complementary — a student studying both should see how foundation courses enhance their understanding of the interest courses.

**6. PERSONAL CONTEXT — AGE, PROFESSION, BACKGROUND**
- The student's age, occupation, education level, and geographic/cultural background must shape EVERY decision: topic selection, difficulty, examples, vocabulary, pacing.
- A 15-year-old high school student gets accessible foundations and discovery-oriented chapters. A 30-year-old finance professional gets rigorous, career-applicable, efficient content that respects what they already know.
- If the student's profession is relevant to their interest (e.g. a software engineer studying game dev), skip basics they already know and start at their actual level.
- Geographic/cultural context matters for examples and references — use relevant institutions, industries, and real-world contexts from their region where possible.

**7. REFERENCE REAL CURRICULA**
- Use the existing curricula research provided above as a structural reference. Your course breakdown, chapter ordering, and topic coverage should be informed by how real universities, MOOCs, and professional programs teach these subject areas.
- You don't need to copy them — but the sequence and depth should be defensible against a real syllabus. If MIT teaches stochastic calculus by starting with probability spaces before Itô's lemma, your chapters should reflect a similar logical ordering.
- Where your curriculum diverges from standard programs (because of the student's unique goals), that's fine — but the divergence should be intentional, not accidental.

---

Create courses inside TWO distinct tracks — this structure is MANDATORY in every curriculum:

---

**1. INTEREST-BASED TRACK (type: "project") — MINIMUM 3, target 3–5 courses, ~75–80% of total hours**

**HARD REQUIREMENT: You MUST generate at least 3 distinct interest-based courses. A curriculum with fewer than 3 interest-based courses is invalid and will be rejected.**

These courses go DEEP into the student's specific interest area. They are specialized, field-specific, and directly about what the student loves.

**NAMING RULE — NON-NEGOTIABLE:**
- Use formal academic course titles like you'd see in a university course catalog
- Examples: "Stochastic Calculus", "Market Microstructure", "Bayesian Probability & Inference", "Buddhist Epistemology", "Game Engine Architecture"
- NEVER append "Path", "Track", "Journey", "Module", or "Basics" to the name
- NEVER use vague names like "Intro to [topic]", "Build Something Real", "[Topic] Fundamentals"
- Each name must be a precise sub-discipline, not a generic umbrella term

**TITLE CASE — MANDATORY for both course names AND chapter titles:**
- Capitalize every meaningful word: "Game Engine Architecture", NOT "Game engine architecture"
- Small grammatical words ("of", "and", "in", "the", "for", "to") stay lowercase mid-phrase: "Philosophy of Mind", "Theory and Practice"
- The first and last word are always capitalized regardless
- This applies to EVERY title in the JSON — course names, chapter titles, projectIdea text. Lowercase mid-sentence words anywhere will fail review.

**CHAPTER TITLE QUALITY:**
- Read like a textbook table of contents — concise, specific, professional
- Do NOT echo the course name in chapter titles ("Introduction to Game Programming" inside the "Game Programming" course is redundant — say "Foundations and Vocabulary" instead)
- Examples of good chapter titles: "Random Variables and Distributions", "Bid-Ask Spreads and Order Flow", "The Anchoring Effect", "Brownian Motion and Random Walks"
- Examples of bad chapter titles: "Intro to [course]", "Your First [course] Project", "Building a [course] System", "Tools & Techniques for [course]" — these all parrot the parent course name

Examples by interest:
- Prediction markets → "Stochastic Calculus", "Market Microstructure", "Bayesian Probability & Prediction Markets", "Expected Value Theory", "Psychology of Risk & Decision-Making"
- Buddhist philosophy → "Tibetan Buddhist Studies", "Buddhist Epistemology & Logic", "Philosophy of Mind in Buddhism", "Comparative Buddhist Schools"
- Game development → "Game Engine Architecture", "Procedural Level Design", "Narrative Systems & Storytelling", "Multiplayer Networking"
- Marine biology → "Coral Reef Ecology", "Marine Vertebrate Behavior", "Ocean Chemistry & pH Dynamics"

The student should recognize these courses as directly about their passion — not adjacent to it.

---

**2. FOUNDATION TRACK (type: "core") — MINIMUM 3 courses**

**HARD REQUIREMENT: You MUST generate at least 3 distinct foundation courses. A curriculum with fewer than 3 foundation courses is invalid and will be rejected.**

These are specific traditional academic courses — not the interest itself but disciplines that support it. Each must have a precise, formal course name (e.g. "Linear Algebra", "Probability Theory", "Behavioral Economics") — NEVER just "Foundations", "Math", or "Science". Name them as a university registrar would.

Draw from the full taxonomy of academic disciplines:
- **Natural Sciences**: Physics, Chemistry, Biology, Earth Sciences, Astronomy
- **Formal Sciences**: Mathematics, Statistics, Logic, Computer Science
- **Social Sciences**: Psychology, Sociology, Economics, Political Science, Anthropology, Geography
- **Humanities**: History, Philosophy, Linguistics, Literature, Ethics
- **Applied Sciences**: Engineering principles, Environmental Science, Medicine basics
- **Arts & Culture**: Art History, Music Theory, Film Studies, Architecture

The key rule: foundation courses should be **sparsely relevant** to the interest — adjacent enough to add value, but not directly about it. They should feel like broadening general education, not an extension of the interest itself.

Examples:
- Buddhist philosophy student → Mathematics & Logic, Psychology of Consciousness, World History & Civilizations
- Game developer → Linear Algebra, Cognitive Psychology, Economics (game economies)
- Marine biologist → Chemistry, Statistics & Data Analysis, Environmental Policy
- Music producer → Physics (acoustics), Mathematics, Music History

NOT directly related (good), but adds genuine value to a well-rounded thinker in that field.

---

Additional rules:
- Foundation courses complement but do NOT duplicate the interest-based track's courses
- Each course is a distinct discipline with its own chapter progression
- Keep it focused and clean — no bloat or generic padding
- Each track MUST have a "type" field: "project" for interest-based, "core" for foundation

---

**CHAPTER DESIGN — THINK BEFORE WRITING:**

Before generating chapters for each course, reason through:
1. What is this student's current level in this domain? (Use their baseline assessment and conversation history)
2. What learning goals does this course serve for their aspirations?
3. What sequence of chapters would build understanding from their current level to competence?
4. How does each chapter connect to the next — what prerequisite understanding does it create?

**NAMING DISTINCTION — courses vs chapters:**

Course titles = formal course titles. Broad, formal, like a university course catalog.
- Good: "Stochastic Calculus", "Market Microstructure", "Probability Theory", "Behavioral Economics"
- These are the names a student would see in a course listing.

Chapter titles = lesson-level topics. Narrow, concrete, completable in 1–2 sessions.
- Good: "Random Variables & Distributions", "Bid-Ask Spreads & Order Flow", "Bayes' Theorem in Practice", "The Anchoring Effect"
- These are what you'd see in a textbook table of contents — one focused concept per chapter.
- NOT mini-courses ("Introduction to Probability"), NOT vague ("Key Concepts"), NOT project phases ("Building Your Model")

**Chapter requirements:**
- Each course needs 3–5 chapters
- Each chapter covers ONE focused concept or skill — something a student could learn in 1–2 study sessions (5–12 hours)
- The difficulty progression should be calibrated to the student's baseline — a math-strong student doesn't need "What is a Variable?", a math-weak student shouldn't start with measure theory
- Every chapter must have a clear "why" — how does mastering this chapter move the student toward their aspirations?

For each chapter: title, description (1-2 sentences explaining what the student will learn and why it matters for their goals), type ("project" or "core-content"), subject (the parent course name), estimatedHours, skills (2-3 specific skills gained), aiRationale (1 sentence connecting this chapter to the student's learning goals), status (first chapter of first track "in-progress", rest "not-started")

Return ONLY valid JSON (no markdown). Do NOT include any "id" fields — IDs will be generated by the database.
{
  "profileSummary": "1-2 sentences",
  "primaryStrengths": ["..."],
  "primaryInterests": ["..."],
  "learningStyle": "...",
  "personalityTraits": ["..."],
  "tracks": [
    {
      "name": "[Formal Academic Title e.g. Stochastic Calculus, Buddhist Epistemology]", "description": "...", "color": "#3B82F6", "type": "project",
      "projectIdea": "Build: [creative capstone project title that synthesizes all chapters in this track into one original creative work]",
      "modules": [
        {"title": "[Specific topic e.g. Brownian Motion & Random Walks]", "description": "Learn X because it enables Y for your goal of Z", "type": "project", "subject": "...", "estimatedHours": 12, "skills": ["...", "..."], "aiRationale": "...", "status": "in-progress"},
        {"title": "[Next specific topic]", "description": "...", "type": "project", "subject": "...", "estimatedHours": 10, "skills": ["...", "..."], "aiRationale": "...", "status": "not-started"}
      ]
    },
    {
      "name": "[Specific Traditional Course e.g. Linear Algebra, Probability Theory, Behavioral Economics]", "description": "...", "color": "#10B981", "type": "core",
      "modules": [
        {"title": "[Specific topic within the course]", "description": "...", "type": "core-content", "subject": "...", "estimatedHours": 8, "skills": ["...", "..."], "aiRationale": "...", "status": "not-started"}
      ]
    }
  ]
}

IMPORTANT: Every entry in "tracks" represents a COURSE (terminology note: the JSON field is named "tracks" for backward compat, but each entry is a course inside one of the two tracks — Foundations or Interest-Based — distinguished by its "type" field). Every entry MUST have a "type" field — either "project" or "core". Every "project" entry MUST include a "projectIdea" field with a creative capstone project title (NOT just the course name — it should describe what the student would actually BUILD). Generate AT LEAST 3 interest-based courses (target 3–5) AND AT LEAST 3 foundation courses. Curricula with fewer than 3 of either type are invalid. Each course must have 3–5 chapters with specific topic titles. Each course's "modules" array contains the full chapter objects (NOT string IDs). Do NOT include any "id" fields anywhere.`
}

interface Course {
  name: string
  type: string
  modules: Array<{ title: string }>
}

interface RunResult {
  label: string
  ok: boolean
  error?: string
  courses?: Array<{ name: string; type: string; chapterTitles: string[] }>
  rawTextLen?: number
}

async function runOne(client: Anthropic, learner: SyntheticLearner): Promise<RunResult> {
  try {
    const prompt = buildPrompt(learner)
    const result = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 12000,
      messages: [{ role: 'user', content: prompt }],
    })
    if (result.stop_reason === 'max_tokens') {
      console.warn(`  [WARN] ${learner.label} hit max_tokens — JSON likely truncated`)
    }
    const text = (result.content[0] as { type: string; text?: string })?.text?.trim() ?? ''
    const cleaned = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
    const parsed = JSON.parse(cleaned) as { tracks: Course[] }
    const courses = parsed.tracks.map(t => ({
      name: t.name,
      type: t.type,
      chapterTitles: (t.modules || []).map(m => m.title),
    }))
    return { label: learner.label, ok: true, courses, rawTextLen: text.length }
  } catch (err) {
    return { label: learner.label, ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY not set in env')
    process.exit(1)
  }
  const client = new Anthropic({ apiKey })

  // Optional: load prior results and only re-run profiles that failed.
  const outDir = path.join(process.cwd(), 'tmp')
  fs.mkdirSync(outDir, { recursive: true })
  const dumpPath = path.join(outDir, 'curriculum-stress-test-results.json')

  let priorResults: RunResult[] = []
  if (process.argv.includes('--retry-failed') && fs.existsSync(dumpPath)) {
    const prior = JSON.parse(fs.readFileSync(dumpPath, 'utf8')) as { results: RunResult[] }
    priorResults = prior.results.filter(r => r.ok)
    console.log(`Loaded ${priorResults.length} prior successful runs; will only re-run failures.`)
  }
  const skipLabels = new Set(priorResults.map(r => r.label))
  const learnersToRun = LEARNERS.filter(l => !skipLabels.has(l.label))

  const BATCH_SIZE = 4
  const results: RunResult[] = [...priorResults]
  for (let i = 0; i < learnersToRun.length; i += BATCH_SIZE) {
    const batch = learnersToRun.slice(i, i + BATCH_SIZE)
    console.log(`\n=== Batch ${i / BATCH_SIZE + 1}: launching ${batch.length} runs ===`)
    const batchResults = await Promise.all(batch.map(l => runOne(client, l).then(r => {
      if (r.ok) {
        const n = r.courses!.reduce((s, c) => s + c.chapterTitles.length, 0)
        console.log(`  [OK] ${r.label} — ${r.courses!.length} courses, ${n} chapters`)
      } else {
        console.log(`  [FAIL] ${r.label} — ${r.error}`)
      }
      return r
    })))
    results.push(...batchResults)
  }

  // Aggregate
  const allChapterTitles: string[] = []
  for (const r of results) {
    if (r.ok && r.courses) {
      for (const c of r.courses) {
        for (const t of c.chapterTitles) allChapterTitles.push(t)
      }
    }
  }

  const lc = (s: string) => s.toLowerCase().trim()
  const repeatCounts = new Map<string, number>()
  for (const t of allChapterTitles) {
    const k = lc(t)
    repeatCounts.set(k, (repeatCounts.get(k) ?? 0) + 1)
  }
  const sortedRepeats = [...repeatCounts.entries()].sort((a, b) => b[1] - a[1])

  const GENERIC_KEYWORDS = ['introduction', 'intro to', 'fundamentals', 'foundations', 'advanced topics', 'tools', 'real-world', 'capstone', 'practice', 'techniques', 'applications', 'end-to-end', 'hands-on', 'project', 'basics', 'overview', 'principles', 'getting started', 'key concepts', 'essentials']
  const genericHits: Array<{ title: string; matched: string[] }> = []
  for (const t of allChapterTitles) {
    const lower = lc(t)
    const matched = GENERIC_KEYWORDS.filter(k => lower.includes(k))
    if (matched.length) genericHits.push({ title: t, matched })
  }

  fs.writeFileSync(dumpPath, JSON.stringify({ results, allChapterTitles, sortedRepeats, genericHits }, null, 2))
  console.log(`\nWrote raw dump → ${dumpPath}`)

  // Print human summary
  console.log('\n\n========== PER-PROFILE RESULTS ==========\n')
  for (const r of results) {
    console.log(`### ${r.label}`)
    if (!r.ok) {
      console.log(`  ERROR: ${r.error}\n`)
      continue
    }
    for (const c of r.courses!) {
      console.log(`  [${c.type}] ${c.name}`)
      for (const t of c.chapterTitles) console.log(`     - ${t}`)
    }
    console.log()
  }

  console.log('\n========== AGGREGATE ==========')
  console.log(`Total chapter titles: ${allChapterTitles.length}`)
  console.log(`Unique titles (case-insensitive): ${repeatCounts.size}`)
  console.log(`\nTop 20 most-repeated titles:`)
  for (const [k, v] of sortedRepeats.slice(0, 20)) {
    if (v > 1) console.log(`  ${v}× ${k}`)
  }
  console.log(`\nGeneric-keyword matches: ${genericHits.length} / ${allChapterTitles.length} (${(100 * genericHits.length / Math.max(1, allChapterTitles.length)).toFixed(1)}%)`)
  const kwTotals = new Map<string, number>()
  for (const g of genericHits) for (const k of g.matched) kwTotals.set(k, (kwTotals.get(k) ?? 0) + 1)
  console.log(`\nGeneric-keyword frequency:`)
  for (const [k, v] of [...kwTotals.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${v}× ${k}`)
  }
  console.log(`\nSample generic-flagged titles:`)
  for (const g of genericHits.slice(0, 30)) console.log(`  - ${g.title}  [matched: ${g.matched.join(', ')}]`)
}

main().catch(e => { console.error(e); process.exit(1) })
