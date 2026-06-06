# AI Tutor Backend — Full Specification

Read FOUNDATION.md first. The AI tutor is Pillar 1 of Release EDU's two-pillar model (AI tutor + Human Tutor-Mentors).

## Philosophy (from FOUNDATION.md)
- Socratic method: ask probing questions, don't just give answers
- Celebrate mistakes as learning opportunities
- Discovery method: students rediscover knowledge paths
- Personalization: adapts to learning style, pace, attention span, expertise
- MAIT: Massive Adaptive Interactive Text — diverges to explore misunderstandings
- Fast mapping + slow solving: intuition training paired with rigorous logic
- "Explain like talking to a 5th grader" when needed
- AI replaces mechanical delivery; good teachers become mentors

## Architecture

### 1. Database Layer (Prisma + SQLite for now)

Install prisma and @prisma/client. Create schema at prisma/schema.prisma:

```prisma
datasource db {
  provider = "sqlite"
  url      = "file:./dev.db"
}

generator client {
  provider = "prisma-client-js"
}

model User {
  id            String    @id @default(cuid())
  email         String    @unique
  name          String?
  image         String?
  role          String    @default("student") // "student" | "teacher" | "admin"
  createdAt     DateTime  @default(now())
  conversations Conversation[]
  studentProfile StudentProfile?
  teacherConfig  TeacherConfig?
}

model StudentProfile {
  id              String   @id @default(cuid())
  userId          String   @unique
  user            User     @relation(fields: [userId], references: [id])
  learningStage   Int      @default(1) // 1-4 per FOUNDATION.md stages
  xp              Int      @default(0)
  streak          Int      @default(0)
  learningStyle   String?  // visual, auditory, kinesthetic, reading
  pacePreference  String?  // slow, moderate, fast
  interests       String?  // JSON array of interest areas
  strengths       String?  // JSON array
  weaknesses      String?  // JSON array
  aspirations     String?  // free text from student
  currentProjects String?  // JSON array of active project IDs
  roadmapState    String?  // JSON: which nodes completed, in-progress, etc.
  updatedAt       DateTime @updatedAt
}

model Conversation {
  id          String    @id @default(cuid())
  userId      String
  user        User      @relation(fields: [userId], references: [id])
  title       String    @default("New Conversation")
  context     String?   // topic/subject context for this conversation
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  messages    Message[]
}

model Message {
  id             String       @id @default(cuid())
  conversationId String
  conversation   Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  role           String       // "user" | "assistant" | "system"
  content        String
  metadata       String?      // JSON: tokens used, latency, etc.
  createdAt      DateTime     @default(now())
}

model TeacherConfig {
  id                  String  @id @default(cuid())
  userId              String  @unique
  user                User    @relation(fields: [userId], references: [id])
  // Global AI tutor settings this teacher controls
  socraticIntensity   Int     @default(7)  // 1-10: how much to question vs. tell
  hintLevel           Int     @default(5)  // 1-10: how readily to give hints
  difficultyBias      Int     @default(5)  // 1-10: push harder vs. comfort zone
  celebrateMistakes   Boolean @default(true)
  encourageExploration Boolean @default(true)
  focusTopics         String? // JSON array: topics to emphasize
  restrictedTopics    String? // JSON array: topics to avoid/redirect
  customInstructions  String? // free text: additional teacher instructions for AI
  tonePreference      String  @default("warm") // warm, professional, casual, strict
  maxResponseLength   Int     @default(500) // rough word limit
  allowProjectIdeas   Boolean @default(true)
  allowCareerAdvice   Boolean @default(true)
  updatedAt           DateTime @updatedAt
}
```

### 2. Student Context Engine (src/lib/student-context.ts)

Create a module that aggregates all student data into a context object:

```typescript
interface StudentContext {
  profile: {
    name: string
    learningStage: number // 1-4
    stageName: string // "Motivation & Inspiration" etc.
    xp: number
    streak: number
    learningStyle: string | null
    pacePreference: string | null
  }
  progress: {
    overallCompletion: number // percentage
    subjectBreakdown: { subject: string; mastery: number }[]
    recentTopics: string[] // last 5 topics studied
    strugglingTopics: string[] // topics with low scores
    excellingTopics: string[] // topics with high scores
  }
  roadmap: {
    currentNodes: string[] // in-progress node names
    completedNodes: string[] // completed node names
    availableNodes: string[] // unlocked but not started
    suggestedNext: string[] // AI recommendation for next topics
  }
  projects: {
    active: { name: string; progress: number; description: string }[]
    completed: { name: string; competencies: string[] }[]
  }
  aspirations: string | null
  interests: string[]
  recentConversationSummary: string | null // last 3 conversations summarized
}
```

This function pulls from the database and mock data to build a complete picture. Used every time a chat message is sent.

### 3. Dynamic System Prompt Builder (src/lib/system-prompt.ts)

Build the system prompt dynamically from StudentContext + TeacherConfig:

```typescript
function buildSystemPrompt(studentContext: StudentContext, teacherConfig: TeacherConfig): string
```

The system prompt should:
- Set the AI's identity as the Release EDU tutor
- Include the student's current context (stage, progress, struggles, goals)
- Apply teacher's configuration (Socratic intensity, hint level, tone, restrictions)
- Include the 4 learning stages framework
- Include the discovery method and MAIT approach
- Include specific instructions based on learning stage:
  - Stage 1 (Motivation): Focus on inspiring, showing cool applications, sparking curiosity
  - Stage 2 (Review): Give feedback, suggest adjustments, help build flexible curricula
  - Stage 3 (Self-Guided): Be a co-pilot, support curiosity-driven exploration, project help
  - Stage 4 (Expert Feedback): Provide deep expert analysis, career advice, edge cases
- Respect restricted topics
- Adapt language to student's level

### 4. Enhanced Chat API (src/app/api/chat/route.ts)

Rewrite the chat API route:

```typescript
// POST /api/chat
// Body: { conversationId?: string, message: string }
// Response: streaming text/event-stream

// Flow:
// 1. Authenticate user (from session)
// 2. Get or create conversation
// 3. Save user message to database
// 4. Build StudentContext from database
// 5. Get TeacherConfig (from assigned teacher or defaults)
// 6. Build dynamic system prompt
// 7. Fetch last N messages from conversation for context
// 8. Call Anthropic Claude Opus (claude-opus-4-0-20250514) with streaming
// 9. Stream response back to client
// 10. On completion, save assistant message to database
// 11. After every 5 messages, update conversation title via a quick Claude call
```

Use the Anthropic SDK with streaming:
```typescript
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const stream = anthropic.messages.stream({
  model: 'claude-opus-4-0-20250514',
  max_tokens: 4096,
  system: dynamicSystemPrompt,
  messages: conversationHistory,
})
```

### 5. Conversation Management APIs

Create these API routes:

```
GET    /api/conversations          — list user's conversations
POST   /api/conversations          — create new conversation
GET    /api/conversations/[id]     — get conversation with messages
DELETE /api/conversations/[id]     — delete conversation
PATCH  /api/conversations/[id]     — update title/context
```

### 6. Teacher Admin Panel

Create new pages:

**src/app/dashboard/admin/page.tsx** — Teacher dashboard:
- Overview: number of students, active conversations today, common topics
- Student list with quick stats (stage, XP, last active)
- Quick actions: view student's conversations, adjust their AI settings

**src/app/dashboard/admin/students/[id]/page.tsx** — Individual student view:
- Student's profile, progress, roadmap state
- Their recent conversations (read-only, with search)
- AI tutor config for this specific student (overrides global)
- Notes section for teacher observations

**src/app/dashboard/admin/ai-config/page.tsx** — Global AI tutor configuration:
- Sliders: Socratic intensity (1-10), hint level (1-10), difficulty bias (1-10)
- Toggles: celebrate mistakes, encourage exploration, allow project ideas, allow career advice
- Tone selector: warm / professional / casual / strict
- Focus topics (multi-select from curriculum topics)
- Restricted topics (multi-select + custom input)
- Custom instructions textarea
- Max response length slider
- Preview panel: shows example of how the AI would respond with current settings
- Save with confirmation

**src/app/dashboard/admin/conversations/page.tsx** — Conversation browser:
- Searchable list of all student conversations
- Filter by student, date, topic
- Click to read full conversation
- Flag/bookmark notable conversations
- Export conversation as PDF/markdown

### 7. Update Chat UI (src/app/dashboard/chat/page.tsx)

- Wire up to real API routes (conversations CRUD + streaming chat)
- Conversation sidebar pulls from database
- New conversation button creates via API
- Messages stream from Claude Opus
- Show student's context summary in a collapsible panel ("The AI knows about you:")
- Allow student to update their aspirations/interests from chat settings
- "What should I learn next?" quick prompt that uses roadmap context

### 8. Student Profile Update Flow

After certain chat interactions, the AI tutor should suggest profile updates:
- If student mentions new interests → prompt to add to profile
- If student expresses career aspirations → save to aspirations field
- If student struggles repeatedly → flag topic as weakness
- If student excels → flag topic as strength

Create a lightweight "insight extraction" that runs after each conversation:
- POST /api/insights/extract — takes conversation ID, uses a quick Claude Haiku call to extract:
  - New interests mentioned
  - Aspirations expressed
  - Topics struggling with
  - Topics excelling at
  - Suggested learning stage adjustment

### 9. Mock/Demo Mode

For demo mode (no database), create an in-memory store that mimics the database:
- Pre-populated student profile for "Alex Chen" (the demo student)
- 3 sample conversations with realistic messages
- Teacher config with sensible defaults
- All CRUD operations work against in-memory store
- Chat still calls Claude Opus if API key is set, falls back to smart mock responses

The mock responses should be contextual — they should reference the student's mock progress data, not generic responses.

### 10. Environment Variables

Add to .env.example:
```
# Required for AI Tutor
ANTHROPIC_API_KEY=your_key_here

# Database (auto-created SQLite file)
DATABASE_URL="file:./prisma/dev.db"
```

## Implementation Order
1. Prisma schema + database setup + seed data
2. Student context engine
3. System prompt builder
4. Enhanced chat API with streaming
5. Conversation management APIs
6. Update chat UI to use real APIs
7. Teacher admin pages
8. Insight extraction
9. Demo mode fallbacks
10. Test everything works

## Critical: Keep the existing UI working throughout. Don't break the dashboard, roadmap, progress, or projects pages.
