# Curriculum Engine — AI as Guru

Read FOUNDATION.md. This spec implements the core vision: "Multi-agentic AI tutor — personalized multimodal content at scale."

## Core Concept

Bob (AI tutor) is NOT just a chatbot. Bob is the **curriculum architect**. Through continuous conversation, Bob:
1. Assesses the student's baseline in core subjects
2. Discovers personality, interests, learning style, strengths
3. Generates a fully personalized curriculum
4. Continuously refines it based on ongoing interaction
5. Logs insights about the student after every meaningful exchange

## Student Journey Flow

### Phase 1: Onboarding Assessment (New User)
When a new student joins, they go through an onboarding flow:

1. **Welcome screen** — "Let's discover your path" (not a test, a conversation)
2. **Bob's initial conversation** — Bob asks about:
   - What excites them (open-ended)
   - What they're curious about
   - What they find easy / hard in school
   - Their hobbies, projects, dreams
3. **Core subject baseline** — Quick adaptive assessment in:
   - Math (logic, arithmetic, algebra readiness)
   - Literature (reading comprehension, writing expression)
   - History (critical thinking, cause/effect reasoning)
   - Science (observation, hypothesis, basic concepts)
   - NOT graded tests — conversational assessment via Bob
4. Bob synthesizes this into an initial student profile

### Phase 2: Curriculum Generation
Based on the profile, Bob generates a personalized curriculum:

- **Strength-aligned projects** (80% of curriculum):
  - Calculation-strong → engineering, data science, architecture projects
  - Creative/divergent → art, design, storytelling, music projects
  - Social/empathetic → psychology, community, leadership projects
  - Logical/systematic → CS, research, analysis projects
- **Core content modules** (20% of curriculum):
  - Math, literature, history, science assignments
  - Adapted to student's level and learning style
  - Delivered efficiently to maximize project time

### Phase 3: Ongoing Refinement
As the student progresses:
- Bob notices patterns (struggles, breakthroughs, new interests)
- Curriculum auto-adjusts: new projects proposed, difficulty adapted
- Bob makes **memory logs** after every substantive exchange
- Long-term personality model deepens over time

## Implementation

### 1. Student Onboarding Flow

**New page: src/app/dashboard/onboarding/page.tsx**
- Full-screen conversational onboarding (just Bob + student, no chrome)
- Bob drives the conversation with structured phases
- Progress indicator at top: "Getting to know you" → "Core foundations" → "Building your path"
- After onboarding, generates initial curriculum
- Redirect to dashboard with curriculum populated

**When to show:** If student has no curriculum yet (no CurriculumPlan in DB/demo store), redirect to onboarding.

### 2. AI Memory Log System

**New data structure — StudentInsight:**
```typescript
interface StudentInsight {
  id: string
  studentId: string
  type: 'personality' | 'interest' | 'strength' | 'weakness' | 'preference' | 'aspiration' | 'breakthrough' | 'struggle' | 'style'
  content: string  // what Bob observed
  confidence: number // 0-1, how sure Bob is
  source: string  // which conversation this came from
  createdAt: string
}
```

**How it works:**
- After EVERY chat exchange (every assistant response), run a background insight extraction
- Bob's system prompt explicitly tells him to be inquisitive — ask probing questions, notice patterns
- The extraction prompt analyzes the conversation and outputs structured insights
- Insights accumulate and feed back into the system prompt for next conversation
- Bob effectively "remembers" the student across all conversations

**Update to system prompt:**
Add a section that injects all accumulated insights:
```
## What I Know About This Student
- [personality] Highly creative, prefers visual learning (confidence: 0.8)
- [interest] Fascinated by space and astrophysics (confidence: 0.9)
- [strength] Strong spatial reasoning and pattern recognition (confidence: 0.7)
- [weakness] Struggles with long-form writing (confidence: 0.6)
- [preference] Prefers hands-on projects over reading (confidence: 0.85)
- [aspiration] Wants to be an aerospace engineer (confidence: 0.7)
```

**System prompt additions for inquisitiveness:**
```
You are deeply curious about this student. Your goal is not just to teach — it's to UNDERSTAND who they are.

In every conversation:
- Ask at least one probing question about their interests, feelings, or thought process
- Notice patterns: if they light up about a topic, dig deeper
- If they struggle, ask "what specifically feels hard?" not just "do you need help?"
- Periodically ask about their goals, dreams, what they'd build if they could build anything
- Reference past conversations: "Last time you mentioned X — have you thought more about that?"
- Be genuinely curious, not interrogative. Like a wise mentor who cares.

After each exchange, internally note:
- Any new interests or passions mentioned
- Signs of strength or struggle
- Personality traits revealed (introvert/extrovert, creative/systematic, etc.)
- Learning style indicators (visual, hands-on, reading, discussion)
- Career or life aspirations
```

### 3. Curriculum Plan Data Structure

**New type: CurriculumPlan**
```typescript
interface CurriculumPlan {
  id: string
  studentId: string
  generatedAt: string
  lastUpdatedAt: string
  version: number  // increments when curriculum is refined
  
  // Student profile summary (AI-generated)
  profileSummary: string
  primaryStrengths: string[]
  primaryInterests: string[]
  learningStyle: string
  personalityTraits: string[]
  
  // The actual curriculum
  tracks: CurriculumTrack[]
  
  // 80/20 split
  projectModules: CurriculumModule[]  // 80%
  coreModules: CurriculumModule[]     // 20%
}

interface CurriculumTrack {
  id: string
  name: string  // e.g., "Aerospace Engineering Path", "Creative Computing"
  description: string
  color: string
  modules: string[]  // module IDs in order
}

interface CurriculumModule {
  id: string
  title: string
  description: string
  type: 'project' | 'core-content'
  subject: string
  trackId: string
  status: 'not-started' | 'in-progress' | 'completed'
  progress: number  // 0-100
  estimatedHours: number
  prerequisites: string[]
  skills: string[]  // competencies developed
  aiRationale: string  // why Bob chose this for this student
}
```

### 4. My Curriculum Page (MAJOR NEW SECTION)

**New page: src/app/dashboard/curriculum/page.tsx**

This is the main view — what the student sees as "their path."

**Layout:**
- Header: student's name + AI-generated tagline ("Your Aerospace Engineering Journey" or "Exploring Creative Technology")
- Profile card: AI's understanding of the student (strengths, interests, style) — editable by student
- **Track visualization**: each track as a horizontal swim lane
  - Projects (80%) shown as larger cards with rich detail
  - Core modules (20%) shown as compact items
  - Clear progress indicators per module
  - Current module highlighted
  - Upcoming modules preview
- **Overall progress ring**: total curriculum completion %
- **AI rationale**: expandable "Why this curriculum?" section explaining Bob's choices
- **Request changes**: button to chat with Bob about adjusting the curriculum

**Design:**
- Clean, inspiring, personal
- Student should feel "this was made FOR ME"
- Each project card shows: title, what they'll build, skills gained, estimated time
- Each core module shows: subject, topic, format, estimated time
- Color-coded by track

### 5. Update Sidebar
Add "My Curriculum" as a primary nav item (between Dashboard and Roadmap, or replace Roadmap).
Icon: Sparkles or GraduationCap

### 6. Update Dashboard Home
- Show curriculum progress as the primary stat
- "Continue where you left off" → links to current module
- Show Bob's latest insight or encouragement

### 7. Demo Mode Curriculum
For demo mode, pre-generate a curriculum for Alex Chen:
- Profile: Strong in math/logic, interested in game development and AI, visual learner
- Tracks:
  1. "Game Development & Interactive Media" — main project track
  2. "AI & Machine Learning Foundations" — secondary project track
  3. "Core Foundations" — math, writing, history, science
- 8-10 project modules, 4-5 core modules
- Some completed, some in-progress, some upcoming
- Include AI rationale for each

### 8. API Routes
- GET /api/curriculum — get student's curriculum plan
- POST /api/curriculum/generate — trigger curriculum generation (calls Claude)
- PATCH /api/curriculum/module/[id] — update module progress
- POST /api/insights — save a student insight
- GET /api/insights — get all insights for a student

### 9. Update Chat API
After every assistant response:
1. Run insight extraction in background (don't block the response)
2. Save any new insights to the store
3. These insights feed into the next conversation's system prompt

The insight extraction prompt:
```
Analyze this conversation exchange and extract any insights about the student.
For each insight, provide:
- type: personality | interest | strength | weakness | preference | aspiration | breakthrough | struggle | style
- content: what you observed (1 sentence)
- confidence: 0.0 to 1.0

Only extract CLEAR signals. Don't guess. If nothing notable, return empty array.
Return as JSON array.
```

## Implementation Order
1. Types + demo data (CurriculumPlan, StudentInsight, demo curriculum)
2. Insight system (extraction after each chat, storage, injection into system prompt)
3. Update system prompt to be more inquisitive + include accumulated insights
4. My Curriculum page
5. Onboarding flow (can be simplified for v1 — just redirect to chat with onboarding prompt)
6. Update sidebar + dashboard
7. API routes
8. Build + test

## Don't Break
- Existing chat functionality
- Project pages + storage
- Progress page
- Settings
- Admin pages
