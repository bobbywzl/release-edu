# Build Task

Read FOUNDATION.md first — it contains the complete Release EDU vision, philosophy, and business model. Every design decision should reflect that document. Reference it constantly.

Build a complete Release EDU student dashboard as a Next.js 14 app with Tailwind CSS and TypeScript.

## Key Foundations (from FOUNDATION.md)
- Four Stages of Learning: Motivation & Inspiration → Review & Adjustment → Self-Guided Learning → Expert Feedback
- 80/20 Rule: 80% creative/project-based, 20% mandated curriculum
- Non-linear learning: metacognitive, connections between concepts (NOT simple→complex linear paths)
- Discovery method: students rediscover knowledge paths; joy of discovery
- MAIT: Massive Adaptive Interactive Text; diverges to explore misunderstandings
- Gamification: XP, streaks, leaderboard, avatar growth
- Projects > Exams: competency-based certification
- Two pillars: AI tutor + Human Tutor-Mentors
- Cultural goal: Allow people to become who they are meant to be

## Features to Build

### 1. Authentication
- Google OAuth login (NextAuth.js with Google provider)
- Clean login page with Release EDU branding
- Protected routes

### 2. Knowledge Roadmap (CORE — Obsidian-style graph)
- Interactive node-graph visualization (use react-force-graph-2d)
- Nodes = concepts/topics, edges = prerequisite relationships
- Color-coded: completed (green), in-progress (blue), locked (gray), available (white)
- Click node for details, resources, estimated time
- Zoom, pan, drag
- Cluster by subject (Math, CS, Psychology, Finance)
- Show student's current position in knowledge web
- This MUST feel like a second-brain knowledge graph, NOT a linear list
- Reflects non-linear learning philosophy from FOUNDATION.md

### 3. Curriculum Progress
- Overall progress % with animated bar
- Per-subject breakdown
- Current learning stage indicator (the 4 stages from FOUNDATION.md)
- Weekly streaks and XP (gamification from FOUNDATION.md)
- Mini milestones/achievements
- Show 80/20 split: project-based vs mandated curriculum progress

### 4. AI Tutor Chat
- Full chat UI (sidebar for history, main area for messages)
- User/AI message bubbles
- Calls Claude Opus via /api/chat (Anthropic SDK, model: claude-opus-4-0-20250514)
- System prompt: Socratic method, encouraging, adapts to student, celebrates mistakes, probing questions, discovery-oriented (per FOUNDATION.md teaching philosophy)
- Student can discuss: aspirations, projects, problems, career goals, course material
- Markdown rendering (react-markdown)
- Typing indicator + streaming responses
- Graceful fallback to mock responses if no API key

### 5. Dashboard Home
- Welcome card with name + streak
- Quick stats: courses in progress, projects active, XP, learning stage
- Recent activity feed
- Upcoming tasks
- Quick links to active courses

### 6. Design
- Minimalist, professional, modern
- Dark mode default + light toggle
- shadcn/ui components
- Deep navy (#0A1628) bg, electric blue (#3B82F6) accents, clean whites
- framer-motion animations
- Mobile-first responsive
- Sidebar nav: Dashboard, Roadmap, Progress, AI Tutor, Projects, Settings

### 7. Mock Data
- Realistic CS student data, 30+ knowledge graph nodes with prerequisites
- Sample AI tutor chat history
- Progress across multiple subjects

### Tech
- Next.js 14 App Router, TypeScript, Tailwind, shadcn/ui
- NextAuth.js, Anthropic SDK, react-force-graph-2d, framer-motion, react-markdown

Create .env.example with all needed vars. Must run with `npm run dev` after env setup.
