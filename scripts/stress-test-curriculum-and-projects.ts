/**
 * Stress-test BOTH curriculum generation AND project-inspiration generation
 * against 7 varied synthetic learner profiles, using the production prompts
 * verbatim. Saves raw output to tmp/ and prints a per-profile report.
 *
 * Run: npx tsx scripts/stress-test-curriculum-and-projects.ts
 */
import * as dotenv from 'dotenv'
import Anthropic from '@anthropic-ai/sdk'
import * as fs from 'fs'
import * as path from 'path'

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
  baselineAssessment: { math: number; writing: number; science: number; history: number; criticalThinking: number }
}

interface SyntheticLearner {
  label: string
  name: string
  age: number
  occupation: string
  education: string
  profile: OnboardingProfile
}

const LEARNERS: SyntheticLearner[] = [
  {
    label: '13yo cryptography',
    name: 'Maya',
    age: 13,
    occupation: '8th grader',
    education: 'middle school',
    profile: {
      interests: ['cryptography', 'ciphers', 'codebreaking', 'number theory', 'puzzles', 'history of espionage'],
      strengths: ['math puzzles', 'pattern recognition', 'memory for trivia'],
      weaknesses: ['long-form essays', 'patience for abstract proofs'],
      learningStyle: 'hands-on with puzzles',
      personalityTraits: ['curious', 'persistent', 'playful'],
      aspirations: 'Decode a real WW2 Enigma message myself and build a working Enigma simulator from scratch',
      baselineAssessment: { math: 8, writing: 5, science: 6, history: 6, criticalThinking: 8 },
    },
  },
  {
    label: '19yo quant finance',
    name: 'Daniel',
    age: 19,
    occupation: 'university sophomore (econ major)',
    education: 'undergraduate',
    profile: {
      interests: ['quantitative finance', 'value investing', 'options pricing', 'market microstructure', 'company due diligence', 'macroeconomics'],
      strengths: ['calculus', 'spreadsheet modeling', 'reading 10-Ks'],
      weaknesses: ['programming beyond Python basics', 'real-time mental arithmetic'],
      learningStyle: 'reading + problem sets',
      personalityTraits: ['analytical', 'competitive', 'methodical'],
      aspirations: 'Land a quant intern role at a top hedge fund and run a small personal value-investing portfolio with documented theses',
      baselineAssessment: { math: 9, writing: 7, science: 6, history: 6, criticalThinking: 9 },
    },
  },
  {
    label: '27yo career-switcher game dev (Unity)',
    name: 'Priya',
    age: 27,
    occupation: 'former marketing analyst transitioning to game dev',
    education: 'BA communications',
    profile: {
      interests: ['game development', 'Unity engine', 'C# scripting', 'level design', '3D modeling basics', 'indie game business'],
      strengths: ['storytelling', 'project management', 'visual design intuition'],
      weaknesses: ['linear algebra', 'low-level performance optimization'],
      learningStyle: 'project-based + tutorials',
      personalityTraits: ['driven', 'creative', 'self-taught'],
      aspirations: 'Ship a polished 2D narrative-driven indie game on Steam within 12 months',
      baselineAssessment: { math: 6, writing: 8, science: 5, history: 5, criticalThinking: 7 },
    },
  },
  {
    label: '35yo marine biology PhD candidate',
    name: 'Ezra',
    age: 35,
    occupation: 'PhD candidate, marine biology',
    education: 'MSc marine science',
    profile: {
      interests: ['coral reef ecology', 'ocean acidification', 'marine vertebrate behavior', 'population genetics', 'underwater acoustics', 'conservation policy'],
      strengths: ['fieldwork', 'statistical analysis in R', 'scientific writing'],
      weaknesses: ['public speaking', 'machine learning methods'],
      learningStyle: 'reading primary literature + applied analysis',
      personalityTraits: ['rigorous', 'patient', 'introverted'],
      aspirations: 'Publish a high-impact paper linking coral microbiome shifts to bleaching resilience and influence Pacific reef policy',
      baselineAssessment: { math: 7, writing: 9, science: 10, history: 6, criticalThinking: 9 },
    },
  },
  {
    label: '45yo lawyer → AI safety',
    name: 'Helen',
    age: 45,
    occupation: 'former corporate lawyer, sabbatical to study AI safety',
    education: 'JD, Harvard Law',
    profile: {
      interests: ['AI alignment', 'AI safety research', 'mechanistic interpretability', 'policy of advanced AI', 'decision theory', 'philosophy of mind'],
      strengths: ['analytical reasoning', 'reading dense papers', 'legal/policy writing'],
      weaknesses: ['linear algebra', 'Python machine learning stack'],
      learningStyle: 'paper reading + structured discussion',
      personalityTraits: ['rigorous', 'skeptical', 'long-attention-span'],
      aspirations: 'Contribute a published technical-policy bridge paper to the AI safety community within 18 months',
      educationFrustrations: ['lectures that prioritize coverage over depth', 'no-real-world-stakes assignments'],
      baselineAssessment: { math: 6, writing: 10, science: 6, history: 8, criticalThinking: 10 },
    },
  },
  {
    label: '16yo chess + decision theory',
    name: 'Theo',
    age: 16,
    occupation: 'high school junior, chess club captain',
    education: 'high school',
    profile: {
      interests: ['competitive chess', 'chess endgames', 'decision theory', 'game theory', 'probability', 'cognitive bias'],
      strengths: ['pattern recognition', 'calculation under time pressure', 'memorization'],
      weaknesses: ['long writing assignments', 'unstructured open problems'],
      learningStyle: 'problem-set drills + analysis',
      personalityTraits: ['competitive', 'focused', 'introverted'],
      aspirations: 'Reach 2200 USCF rating and win a state-level scholastic decision-theory or math olympiad event',
      baselineAssessment: { math: 9, writing: 6, science: 7, history: 6, criticalThinking: 9 },
    },
  },
  {
    label: '60yo retiree — Roman history + Latin',
    name: 'Margaret',
    age: 60,
    occupation: 'retired high school teacher',
    education: 'BA English literature',
    profile: {
      interests: ['ancient Roman history', 'classical Latin', 'Roman archaeology', 'late Republic politics', 'Latin poetry (Virgil, Horace)', 'epigraphy'],
      strengths: ['reading comprehension', 'discipline with daily study', 'historical context'],
      weaknesses: ['memorizing inflectional paradigms quickly', 'computer-based tools'],
      learningStyle: 'textbook + translation exercises',
      personalityTraits: ['patient', 'methodical', 'reflective'],
      aspirations: 'Translate a passage of Virgil unaided and visit major Roman archaeological sites with informed eyes',
      baselineAssessment: { math: 5, writing: 9, science: 5, history: 9, criticalThinking: 8 },
    },
  },
]

// ---------- Curriculum prompt (mirrors src/app/api/curriculum/generate/route.ts) ----------
function buildCurriculumPrompt(l: SyntheticLearner): string {
  const p = l.profile
  const learnerProfileLine = [
    l.name,
    `${l.age} years old`,
    l.occupation,
    l.education,
    'learning independently (no formal school/org)',
  ].filter(Boolean).join(', ')

  const topInterest = p.interests[0] ?? 'technology'
  // Production has a real Tavily research call here; we use a minimal placeholder
  // since we're testing the prompt itself, not the research integration.
  const researchContext = ''
  const curriculaResearch = ''

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

**1. INTEREST-BASED TRACK (type: "project") — EXACTLY 3 courses, ~75–80% of total hours**

**HARD REQUIREMENT: Generate exactly 3 distinct interest-based courses — not 2, not 4. A curriculum with any other count is invalid and will be rejected.**

These courses go DEEP into the student's specific interest area. They are specialized, field-specific, and directly about what the student loves.

**NAMING RULE — NON-NEGOTIABLE:**
- Use formal academic course titles like you'd see in a university course catalog
- Examples: "Stochastic Calculus", "Market Microstructure", "Bayesian Probability & Inference", "Buddhist Epistemology", "Game Engine Architecture"
- NEVER append "Path", "Track", "Journey", "Module", or "Basics" to the name
- NEVER use vague names like "Intro to [topic]", "Build Something Real", "[Topic] Fundamentals"
- Each name must be a precise sub-discipline, not a generic umbrella term

**DO NOT ECHO THE STUDENT'S INTERESTS AS COURSE NAMES — THIS IS THE #1 FAILURE MODE.**
The student's stated interests (e.g. "cryptosecurity", "investing", "company due diligence") are DOMAINS, not courses. Each domain must be DECOMPOSED into 3 specific sub-disciplines. A course named after the domain itself is invalid and will be rejected.
- Student says "cryptosecurity" → INVALID course names: "Cryptosecurity", "Cryptosecurity I", "Advanced Cryptosecurity". VALID: "Symmetric Cryptography & Block Ciphers", "Public-Key Infrastructure & RSA", "Network Security Protocols (TLS, IPsec, Tor)"
- Student says "investing" → INVALID: "Investing", "Investing II". VALID: "Equity Valuation & DCF Modeling", "Behavioral Finance & Market Psychology", "Portfolio Theory & Risk Management"
- Student says "company due diligence" → INVALID: "Company Due Diligence". VALID: "Financial Statement Analysis", "Operational & Legal Diligence", "Industry & Competitive Landscape Analysis"
- Student says "game development" → INVALID: "Game Development". VALID: "Game Engine Architecture", "Procedural Level Design", "Multiplayer Networking & Replication"
- Student says "marine biology" → INVALID: "Marine Biology". VALID: "Coral Reef Ecology", "Marine Vertebrate Behavior", "Ocean Chemistry & pH Dynamics"

The test: read your course name aloud. If it's the same word a casual person would use to describe the entire domain ("she's into cryptosecurity"), it's wrong. Course names should sound like the second-week-of-class title, not the first-day-introduce-yourself title.

**COURSE DESCRIPTION QUALITY — three rules: SPECIFIC, COMPREHENSIVE, SIMPLE.**
Each course's description (1-2 sentences) must:
- **SPECIFIC**: name the actual concepts/methods covered, not vague claims. ✗ "Master the foundations of cryptography." ✓ "Covers symmetric ciphers (AES, ChaCha20), block-cipher modes, and key management — with hands-on implementation in Python."
- **COMPREHENSIVE**: a student reading just the description should know what they'll be able to do at the end. List 2-3 concrete capabilities or topics.
- **SIMPLE**: plain language calibrated to the student's age. No marketing fluff ("unlock", "master", "transform", "journey", "dive deep"). State what the course is.
- FORBIDDEN OPENERS: "Master…", "Unlock…", "Dive into…", "Explore the world of…", "Embark on…", "Journey through…". Just describe the content.

**TITLE CASE — MANDATORY for both course names AND chapter titles:**
- Capitalize every meaningful word: "Game Engine Architecture", NOT "Game engine architecture"
- Small grammatical words ("of", "and", "in", "the", "for", "to") stay lowercase mid-phrase: "Philosophy of Mind", "Theory and Practice"
- The first and last word are always capitalized regardless
- This applies to EVERY title in the JSON — course names, chapter titles, projectIdea text. Lowercase mid-sentence words anywhere will fail review.

**CHAPTERS ARE LEARNING CONTENT ONLY — NEVER PROJECTS.**

This is the most important rule. Chapters teach concepts, theory, principles, and technique. They are NOT "build something" units. The app has a SEPARATE projects section — every interest course already has its own "projectIdea" field (one capstone per course) where building/creating/shipping work belongs. Chapters are the textbook; the project section is the lab.

- A chapter title that names a project, build, ship, hands-on activity, or capstone is INVALID and will be rejected.
- "Capstone Project", "First Hands-On Project", "Build Your First X", "End-to-End System Project", "Final Project", "Project Workshop", "Hackathon Sprint", "Practicum" — all FORBIDDEN as chapter titles. They belong in the "projectIdea" field, not in "modules".
- Even when a chapter teaches a skill that's used in projects, the chapter title must name the CONCEPT being taught, not the act of building. "Procedural Level Design" ✓ (a concept) — "Build a Procedural Level" ✗ (an activity).

**CHAPTER TITLE QUALITY — three non-negotiable rules: SPECIFIC, COMPREHENSIVE, SIMPLE.**
- **SPECIFIC** — name the actual concept, not a phase, stage, or progress label. Every title must contain at least one concrete technical noun drawn from the course's discipline. "Bayes' Theorem in Practice" ✓ — "Advanced Topics" ✗. "Modular Arithmetic and Caesar Ciphers" ✓ — "Core Principles" ✗. "RSA Encryption" ✓ — "Foundations and Vocabulary" ✗.
- **COMPREHENSIVE** — the title alone must describe the core of what the chapter teaches. A student reading the title with no other context should know what they'll learn. If the title could plausibly belong to any course, it's wrong.
- **SIMPLE** — plain, audience-calibrated language. A 12-year-old's chapter title is not jargon-stacked; a graduate student's chapter title is precise but not pretentious. One concept per title — don't string three together.
- Read like a real textbook's table of contents.
- FORBIDDEN PATTERNS (these will be rejected): progress labels — "Foundations and Vocabulary", "Core Principles", "Advanced Topics", "Tools and Techniques", "Real-World Applications", "Professional Practice"; project-shaped titles — "Capstone Project", "Hands-On Project", "End-to-End System Project", "First [X] Project", "Build a [X]", "Building a [X] System", "Ship Your First [X]"; templated titles — "Intro to [course]", "[course] Fundamentals", "Tools & Techniques for [course]".
- Do NOT echo the course name in chapter titles ("Introduction to Game Programming" inside the "Game Programming" course is redundant).
- Examples of good chapter titles: "Random Variables and Distributions", "Bid-Ask Spreads and Order Flow", "The Anchoring Effect", "Brownian Motion and Random Walks", "RSA Encryption", "Maillard Reaction and Flavor Compound Formation", "Modular Arithmetic: Clock Math and Its Cryptographic Powers".

Examples by interest:
- Prediction markets → "Stochastic Calculus", "Market Microstructure", "Bayesian Probability & Prediction Markets", "Expected Value Theory", "Psychology of Risk & Decision-Making"
- Buddhist philosophy → "Tibetan Buddhist Studies", "Buddhist Epistemology & Logic", "Philosophy of Mind in Buddhism", "Comparative Buddhist Schools"
- Game development → "Game Engine Architecture", "Procedural Level Design", "Narrative Systems & Storytelling", "Multiplayer Networking"
- Marine biology → "Coral Reef Ecology", "Marine Vertebrate Behavior", "Ocean Chemistry & pH Dynamics"

The student should recognize these courses as directly about their passion — not adjacent to it.

---

**2. FOUNDATION TRACK (type: "core") — EXACTLY 3 courses**

**HARD REQUIREMENT: Generate exactly 3 distinct foundation courses — not 2, not 4. A curriculum with any other count is invalid and will be rejected.**

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
- NOT mini-courses ("Introduction to Probability"), NOT vague ("Key Concepts"), NOT projects ("Capstone Project", "Build Your First Model", "Hands-On Practicum"). Projects belong in the course's "projectIdea" field, never as chapters.

**Chapter requirements:**
- Each course needs 3–4 chapters
- Each chapter covers ONE focused CONCEPT — something a student could learn in 1–2 study sessions (5–12 hours). Chapters are about understanding, not building. The capstone project is a separate field, not a chapter.
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

IMPORTANT: Every entry in "tracks" represents a COURSE (terminology note: the JSON field is named "tracks" for backward compat, but each entry is a course inside one of the two tracks — Foundations or Interest-Based — distinguished by its "type" field). Every entry MUST have a "type" field — either "project" or "core". Every "project" entry MUST include a "projectIdea" field with a creative capstone project title (NOT just the course name — it should describe what the student would actually BUILD). Generate EXACTLY 3 interest-based courses AND EXACTLY 3 foundation courses — 6 courses total. Any other count is invalid. Each course must have 3–4 chapters with specific topic titles. Each course's "modules" array contains the full chapter objects (NOT string IDs). Do NOT include any "id" fields anywhere.`
}

// ---------- Project inspirations prompt (mirrors src/app/api/projects/generate-inspirations/route.ts) ----------
function buildInspirationsPrompt(
  l: SyntheticLearner,
  curriculum: { tracks: Array<{ name: string; modules: Array<{ title: string }> }> }
): string {
  const interests = l.profile.interests
  const aspirations = l.profile.aspirations
  const profileMeta = { age: l.age, occupation: l.occupation, education: l.education }
  // Build curriculumSummary the same way the production endpoint does — track name + chapter titles, no existing projects.
  const curriculumSummary = curriculum.tracks.map(t => {
    const chapterTitles = t.modules.map(c => c.title).join(', ')
    return `Track: "${t.name}" — Chapters: ${chapterTitles}`
  }).join('\n')

  return `You are designing capstone project briefs for a student. Each brief must be concrete enough that the student could open it and start working immediately — like a syllabus assignment, not a vague suggestion.

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
}

// ---------- Types for parsed curriculum / inspirations ----------
interface ParsedCurriculum {
  profileSummary: string
  primaryInterests?: string[]
  tracks: Array<{
    name: string
    description: string
    type: string
    projectIdea?: string
    modules: Array<{ title: string; description: string; subject?: string; estimatedHours?: number }>
  }>
}

interface ParsedInspiration {
  title: string
  description: string
  trackName: string
  overview?: string
  skills?: string[]
  milestones?: string[]
  deliverable?: string
}

interface ProfileResult {
  label: string
  name: string
  age: number
  curriculum?: ParsedCurriculum
  curriculumRaw?: string
  curriculumError?: string
  inspirations?: ParsedInspiration[]
  inspirationsRaw?: string
  inspirationsError?: string
}

async function processOne(
  client: Anthropic,
  l: SyntheticLearner,
): Promise<ProfileResult> {
  const result: ProfileResult = { label: l.label, name: l.name, age: l.age }
  console.log(`[${l.label}] Generating curriculum...`)
  try {
    const cResp = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 12000,
      messages: [{ role: 'user', content: buildCurriculumPrompt(l) }],
    })
    const text = (cResp.content[0] as { type: string; text?: string }).text?.trim() ?? ''
    result.curriculumRaw = text
    const cleaned = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
    result.curriculum = JSON.parse(cleaned) as ParsedCurriculum
    console.log(`[${l.label}] Curriculum OK (${result.curriculum.tracks.length} courses)`)
  } catch (e) {
    result.curriculumError = (e as Error).message
    console.error(`[${l.label}] Curriculum FAILED: ${result.curriculumError}`)
    return result
  }

  console.log(`[${l.label}] Generating project inspirations...`)
  try {
    const iResp = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 3000,
      messages: [{ role: 'user', content: buildInspirationsPrompt(l, result.curriculum!) }],
    })
    const text = (iResp.content[0] as { type: string; text?: string }).text ?? ''
    result.inspirationsRaw = text
    const m = text.match(/\[[\s\S]*\]/)
    if (!m) throw new Error('No JSON array found')
    result.inspirations = JSON.parse(m[0]) as ParsedInspiration[]
    console.log(`[${l.label}] Inspirations OK (${result.inspirations.length} projects)`)
  } catch (e) {
    result.inspirationsError = (e as Error).message
    console.error(`[${l.label}] Inspirations FAILED: ${result.inspirationsError}`)
  }
  return result
}

async function processBatch(
  client: Anthropic,
  learners: SyntheticLearner[],
): Promise<ProfileResult[]> {
  return Promise.all(learners.map(l => processOne(client, l)))
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY not set in .env')
    process.exit(1)
  }
  const client = new Anthropic({ apiKey })

  const all: ProfileResult[] = []
  // Run in parallel batches of 3.
  for (let i = 0; i < LEARNERS.length; i += 3) {
    const slice = LEARNERS.slice(i, i + 3)
    console.log(`\n=== Batch ${Math.floor(i / 3) + 1} (${slice.map(s => s.label).join(' | ')}) ===`)
    const batchResults = await processBatch(client, slice)
    all.push(...batchResults)
  }

  const outPath = path.resolve(process.cwd(), 'tmp/curriculum-and-projects-stress-test.json')
  fs.writeFileSync(outPath, JSON.stringify(all, null, 2))
  console.log(`\nSaved raw results → ${outPath}`)

  // Print per-profile sections.
  console.log('\n\n=================== REPORT ===================\n')
  for (let i = 0; i < all.length; i++) {
    const r = all[i]
    const learner = LEARNERS[i]
    const interests = learner.profile.interests.slice(0, 3).join(', ')
    console.log(`\n## Profile ${i + 1}: ${learner.age}-year-old ${learner.occupation}, interested in ${interests}`)
    if (r.curriculumError) {
      console.log(`  [CURRICULUM ERROR] ${r.curriculumError}`)
      if (r.curriculumRaw) console.log(`  raw (first 500): ${r.curriculumRaw.slice(0, 500)}`)
      continue
    }
    const c = r.curriculum!
    console.log(`\n### Curriculum`)
    console.log(`**Profile summary:** ${c.profileSummary}`)
    const interestCourses = c.tracks.filter(t => t.type === 'project')
    const foundationCourses = c.tracks.filter(t => t.type === 'core')
    console.log(`\n**Interest courses:**`)
    for (const tc of interestCourses) {
      console.log(`- ${tc.name} — ${tc.description}`)
      for (const m of tc.modules) console.log(`  - ${m.title}`)
      if (tc.projectIdea) console.log(`  (projectIdea: ${tc.projectIdea})`)
    }
    console.log(`\n**Foundation courses:**`)
    for (const tc of foundationCourses) {
      console.log(`- ${tc.name} — ${tc.description}`)
      for (const m of tc.modules) console.log(`  - ${m.title}`)
    }
    console.log(`\n### Project Inspirations`)
    if (r.inspirationsError) {
      console.log(`  [INSPIRATIONS ERROR] ${r.inspirationsError}`)
      if (r.inspirationsRaw) console.log(`  raw (first 400): ${r.inspirationsRaw.slice(0, 400)}`)
    } else if (r.inspirations) {
      for (let j = 0; j < r.inspirations.length; j++) {
        const ins = r.inspirations[j]
        console.log(`${j + 1}. **${ins.title}** (track: ${ins.trackName})`)
        console.log(`   ${ins.description}`)
        if (ins.milestones?.length) {
          console.log(`   Milestones: ${ins.milestones.map((m, k) => `${k + 1}) ${m}`).join('  ')}`)
        }
        if (ins.skills?.length) console.log(`   Skills: ${ins.skills.join(', ')}`)
        if (ins.deliverable) console.log(`   Deliverable: ${ins.deliverable}`)
      }
    }
  }
  console.log('\n=================== END REPORT ===================\n')
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
