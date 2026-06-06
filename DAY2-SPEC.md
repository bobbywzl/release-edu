# Day 2 Build Spec — Three Major Features

Read FOUNDATION.md for all educational philosophy context.
Read CURRICULUM-ENGINE-SPEC.md for existing curriculum architecture.

## Feature 1: AI Architect Bob — Deep Curriculum Integration

Bob is not just a chatbot. Bob is the **curriculum architect** who actively builds and modifies the student's learning path.

### Tool-Use Pattern for Chat API

Update src/app/api/chat/route.ts to give Bob "tools" — structured actions he can take during conversation:

**Available tools Bob can call (via structured output parsing):**

1. `create_module` — Create a new curriculum module (project or core-content)
   - params: title, description, type, subject, trackId, estimatedHours, skills[], aiRationale
   - Adds to the student's curriculum plan

2. `update_module` — Update an existing module's status or details
   - params: moduleId, status?, progress?, title?, description?

3. `create_track` — Create a new curriculum track
   - params: name, description, color

4. `update_student_profile` — Update the student's profile based on conversation
   - params: learningStyle?, strengths[], weaknesses[], interests[], aspirations?

5. `search_resources` — Use Gemini to search the web for learning resources
   - params: query, subject
   - Returns: list of relevant URLs, articles, videos

6. `analyze_image` — Use Gemini to analyze an uploaded image
   - params: imageUrl, context
   - Returns: analysis text

**Implementation approach:**
- Add a second system prompt section that describes available tools as JSON schema
- After Bob's response, parse for tool calls (look for ```tool blocks or JSON in response)
- Execute tool calls server-side
- For curriculum changes: update the demo store immediately, return updated data to client
- Client receives tool results via a custom header or SSE event

**Simpler alternative (implement this one):**
- After each Bob response, run a "curriculum action extraction" call (like insight extraction)
- Use Claude to analyze: "Did Bob suggest any curriculum changes? If so, extract them as structured JSON"
- Auto-apply minor changes (progress updates, profile updates)
- Queue major changes (new modules, track changes) for the 2-week review cycle
- Send real-time updates to the client via the response stream

### New API: POST /api/curriculum/apply-action
Accepts structured curriculum actions and applies them to the store:
```typescript
type CurriculumAction = 
  | { type: 'create_module', data: Partial<CurriculumModule> }
  | { type: 'update_module', moduleId: string, data: Partial<CurriculumModule> }
  | { type: 'update_profile', data: Partial<StudentProfile> }
  | { type: 'suggest_change', description: string, modules: Partial<CurriculumModule>[] }
```

### Update Chat UI
- When Bob makes a curriculum change, show a toast: "Bob updated your curriculum"
- Add a "pending changes" indicator if changes are queued for review
- Show inline curriculum cards in chat when Bob proposes a new module

## Feature 2: New Student Onboarding Flow

### New page: src/app/dashboard/onboarding/page.tsx

**Full-screen immersive experience — no sidebar, no nav, just Bob and the student.**

**Flow phases (Bob drives the conversation):**

**Phase 1: Welcome (1-2 messages)**
- "Hey! I'm Bob, your learning architect. I'm going to build you a personalized curriculum — but first, I need to get to know you."
- Warm, casual, non-intimidating

**Phase 2: Interest Discovery (3-5 messages)**
- "What gets you excited? What could you spend hours doing without getting bored?"
- "If you could build anything — an app, a robot, a business, a piece of art — what would it be?"
- "What subjects in school do you actually enjoy? And which ones feel like a chore?"
- Bob probes deeper based on answers

**Phase 3: Core Subject Baseline (4-6 messages)**
- NOT a test. Conversational assessment.
- Math: "Let me throw a puzzle at you..." (logic/reasoning question)
- Writing: "Describe [topic] to me in a few sentences" (expression assessment)
- Science: "Why do you think [phenomenon] happens?" (reasoning)
- History: "What's something from history that you think changed everything?" (critical thinking)
- Bob assesses level from responses, doesn't grade explicitly

**Phase 4: Learning Style Discovery (2-3 messages)**
- "When you're learning something new, do you prefer to: read about it, watch someone do it, try it yourself, or talk it through?"
- "Do you work better in long sessions or short bursts?"
- "Do you like working alone or with others?"

**Phase 5: Curriculum Generation (1-2 messages)**
- "Okay, I think I have a great picture of who you are. Give me a moment to build your learning path..."
- Loading animation while curriculum generates
- "Here's what I've built for you!" — shows a summary of the generated curriculum
- "Ready to start? Let's go!"

**Technical implementation:**
- Onboarding page has its own chat interface (simplified, full-screen)
- System prompt is specifically for onboarding (different from regular tutoring)
- After Phase 5, Bob calls the curriculum generation API
- POST /api/curriculum/generate — takes student profile, interests, baseline results
  - Uses Claude to generate a full CurriculumPlan
  - Saves to demo store
- Redirect to /dashboard with newly generated curriculum

**When to show onboarding:**
- Check in middleware or dashboard layout: if student has no curriculum, redirect to /onboarding
- For demo mode: add a "Start Fresh" button on login page that triggers onboarding
- After onboarding completes, set a flag so it doesn't show again

### Onboarding System Prompt:
```
You are Bob, the learning architect for Release EDU. You're meeting a new student for the first time.

Your goal: Get to know this student deeply enough to build them a personalized curriculum.

You need to discover:
1. Their interests and passions (what excites them)
2. Their strengths and weaknesses (academic and personal)
3. Their learning style (visual, hands-on, reading, discussion)
4. Their baseline level in core subjects (math, writing, science, history)
5. Their aspirations (what they want to become/build)
6. Their personality (introvert/extrovert, systematic/creative, etc.)

Guidelines:
- Be warm and casual. This is NOT an exam.
- Ask ONE question at a time. Don't overwhelm.
- React genuinely to their answers ("Oh that's cool!", "I can work with that")
- For baseline assessment, use puzzles and open-ended questions, not tests
- Keep it moving — aim for 12-18 total messages to complete onboarding
- At the end, summarize what you learned and preview their curriculum

After gathering enough information, output a structured profile:
[PROFILE_COMPLETE]
{
  "interests": [...],
  "strengths": [...],
  "weaknesses": [...],
  "learningStyle": "...",
  "personalityTraits": [...],
  "aspirations": "...",
  "baselineAssessment": {
    "math": 1-10,
    "writing": 1-10,
    "science": 1-10,
    "history": 1-10,
    "criticalThinking": 1-10
  }
}
```

### Visual Design:
- Dark background, centered chat
- Bob's messages on the left with a small avatar
- Student's messages on the right
- Progress indicator at top: dots showing which phase they're in
- Typing animation for Bob
- Smooth transitions between phases
- At the end: animated reveal of their curriculum summary before redirecting

## Feature 3: Gemini Integration

### Install Google AI SDK
```bash
npm install @google/generative-ai
```

### New module: src/lib/gemini.ts
```typescript
import { GoogleGenerativeAI } from '@google/generative-ai'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)

// Web research for curriculum content
export async function searchForResources(query: string, subject: string): Promise<{
  title: string, url: string, type: string, description: string
}[]> {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })
  const result = await model.generateContent(
    `Find 5 high-quality learning resources for: "${query}" in the subject of ${subject}.
    For each, provide: title, url (real URLs), type (video/article/course/exercise), brief description.
    Return as JSON array.`
  )
  // Parse and return
}

// Image analysis for multimodal learning
export async function analyzeImage(imageBase64: string, context: string): Promise<string> {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })
  const result = await model.generateContent([
    { text: `Analyze this image in the context of: ${context}. Describe what you see and any educational relevance.` },
    { inlineData: { mimeType: 'image/jpeg', data: imageBase64 } }
  ])
  return result.response.text()
}

// Research a topic for curriculum building
export async function researchTopic(topic: string): Promise<string> {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })
  const result = await model.generateContent(
    `Research this topic for educational curriculum design: "${topic}".
    Provide: key concepts to cover, prerequisite knowledge needed, 
    suggested project ideas, real-world applications, and recommended learning sequence.
    Be thorough but concise.`
  )
  return result.response.text()
}
```

### Integration points:

1. **Chat API** — When Bob needs to research something for curriculum:
   - Bob's response contains a research intent
   - Server calls Gemini for research
   - Results fed back to Bob's next turn

2. **Image upload in chat** — Student sends an image:
   - New endpoint: POST /api/chat/image
   - Accepts multipart with image + message
   - Gemini analyzes image
   - Analysis passed to Claude as context for Bob's response
   - Update chat UI to support image uploads (camera/upload button in chat input)

3. **Curriculum generation** — When building new curriculum:
   - Gemini researches each proposed track/topic
   - Finds real resources (videos, articles, exercises)
   - Results included in the curriculum modules

4. **Chat UI updates:**
   - Add image upload button next to chat input (camera icon)
   - Show uploaded images in chat as thumbnails
   - When Bob researches something, show a subtle "Researching..." indicator

## Implementation Order
1. Install @google/generative-ai
2. Create src/lib/gemini.ts
3. Build onboarding page + onboarding system prompt
4. Build curriculum generation API (POST /api/curriculum/generate)
5. Update chat API with curriculum action extraction
6. Add image upload to chat UI + API
7. Wire Gemini research into curriculum generation
8. Add "Start Fresh" flow for onboarding
9. Update middleware to redirect new users to onboarding
10. Test full flow: sign up → onboarding → curriculum → dashboard
11. Run npm run build, fix all errors

## Don't Break
- Existing dashboard, chat, roadmap, progress, projects, settings, admin pages
- Existing Architect Bob chat functionality
- Google OAuth login
- Demo mode
