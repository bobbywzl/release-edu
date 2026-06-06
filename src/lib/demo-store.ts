/**
 * Multi-tenant in-memory demo store — per-user data isolation.
 * Each user gets their own conversations, profile, curriculum, insights, etc.
 * Pre-populated with Alex Chen's profile and sample conversations for 'demo' user.
 */
import type { CurriculumPlan } from '@/types'

export interface DemoUser {
  id: string
  email: string
  name: string
  role: string
}

export interface DemoStudentProfile {
  id: string
  userId: string
  learningStage: number
  xp: number
  streak: number
  learningStyle: string | null
  pacePreference: string | null
  interests: string | null
  strengths: string | null
  weaknesses: string | null
  aspirations: string | null
  currentProjects: string | null
  roadmapState: string | null
}

export interface DemoMessage {
  id: string
  conversationId: string
  role: string
  content: string
  metadata: string | null
  createdAt: Date
}

export interface DemoConversation {
  id: string
  userId: string
  title: string
  context: string | null
  createdAt: Date
  updatedAt: Date
  messages: DemoMessage[]
}

export interface DemoTeacherConfig {
  id: string
  userId: string
  socraticIntensity: number
  hintLevel: number
  difficultyBias: number
  celebrateMistakes: boolean
  encourageExploration: boolean
  focusTopics: string | null
  restrictedTopics: string | null
  customInstructions: string | null
  tonePreference: string
  maxResponseLength: number
  allowProjectIdeas: boolean
  allowCareerAdvice: boolean
}

export interface DemoInsight {
  id: string
  studentId: string
  type: string
  content: string
  confidence: number
  source: string
  createdAt: string
}

// ── Pre-populated demo data ──────────────────────────────────────────────────

export const DEMO_USER: DemoUser = {
  id: 'demo-student-1',
  email: 'alex.chen@example.com',
  name: 'Alex Chen',
  role: 'student',
}

export const DEMO_TEACHER: DemoUser = {
  id: 'demo-teacher-1',
  email: 'ms.rivera@reledu.com',
  name: 'Ms. Rivera',
  role: 'mentor',
}

function createDemoProfile(): DemoStudentProfile {
  return {
    id: 'profile-1',
    userId: 'demo-student-1',
    learningStage: 3,
    xp: 3240,
    streak: 14,
    learningStyle: 'visual',
    pacePreference: 'moderate',
    interests: JSON.stringify(['algorithms', 'machine learning', 'stock markets', 'cognitive science']),
    strengths: JSON.stringify(['data structures', 'OOP', 'calculus', 'logic']),
    weaknesses: JSON.stringify(['dynamic programming', 'linear algebra', 'database optimization']),
    aspirations: 'Become a machine learning engineer or backend distributed systems architect',
    currentProjects: JSON.stringify(['Stock Portfolio Analyzer', 'Algorithm Visualizer']),
    roadmapState: JSON.stringify({
      completed: ['cs-logic', 'cs-data-structures', 'cs-oop', 'math-calculus', 'cs-web-dev', 'psych-cognitive'],
      inProgress: ['cs-algorithms', 'math-linear-algebra', 'cs-databases', 'finance-investing'],
      available: ['cs-systems', 'cs-networking', 'math-stats'],
    }),
  }
}

function createDemoConversations(): DemoConversation[] {
  return [
    {
      id: 'demo-conv-1',
      userId: 'demo-student-1',
      title: 'Understanding Big O Notation',
      context: 'algorithms',
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 2),
      updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 2),
      messages: [
        {
          id: 'msg-1',
          conversationId: 'demo-conv-1',
          role: 'user',
          content: "I'm confused about why O(n log n) is better than O(n²) for sorting. Can you help?",
          metadata: null,
          createdAt: new Date(Date.now() - 1000 * 60 * 60 * 2),
        },
        {
          id: 'msg-2',
          conversationId: 'demo-conv-1',
          role: 'assistant',
          content: `Great question — and being confused about this is actually a really common stepping stone. Before I explain, let me ask: if you had to sort 1,000 numbers vs 1,000,000 numbers, what do you intuitively think happens to the time difference between the two approaches?

Here's a hint to get you started: try plugging n = 1000 and n = 1,000,000 into both n² and n·log₂(n) and see what numbers you get. What patterns do you notice?

This connects to your Algorithm Visualizer project too — you could actually implement both approaches and watch the difference play out visually. What do you think?`,
          metadata: null,
          createdAt: new Date(Date.now() - 1000 * 60 * 60 * 2 + 30000),
        },
      ],
    },
    {
      id: 'demo-conv-2',
      userId: 'demo-student-1',
      title: 'Stock Portfolio: Risk Modeling',
      context: 'finance, projects',
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24),
      updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24),
      messages: [
        {
          id: 'msg-3',
          conversationId: 'demo-conv-2',
          role: 'user',
          content: "For my Stock Portfolio Analyzer project, how should I model risk?",
          metadata: null,
          createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24),
        },
        {
          id: 'msg-4',
          conversationId: 'demo-conv-2',
          role: 'assistant',
          content: `Excellent project direction! Risk modeling in finance is where your math background really starts to pay off.

Before diving in — what do you think "risk" actually means in the context of a stock portfolio? Take a moment to write down your intuition. Is it the chance of losing money? Volatility? Something else?

This matters because there are actually multiple *kinds* of risk:
- **Volatility risk** — how much does the price swing?
- **Correlation risk** — do your stocks move together?
- **Tail risk** — what happens in extreme market events?

Given that you're studying linear algebra right now, I'd strongly suggest starting with **portfolio variance** using covariance matrices — it's a perfect bridge between your current studies and this project. What's your current comfort level with matrix multiplication?`,
          metadata: null,
          createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 + 60000),
        },
      ],
    },
    {
      id: 'demo-conv-3',
      userId: 'demo-student-1',
      title: 'Career path: ML vs Backend?',
      context: 'career advice',
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 48),
      updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 48),
      messages: [
        {
          id: 'msg-5',
          conversationId: 'demo-conv-3',
          role: 'user',
          content: "I can't decide between ML engineering and backend distributed systems. Both interest me.",
          metadata: null,
          createdAt: new Date(Date.now() - 1000 * 60 * 60 * 48),
        },
        {
          id: 'msg-6',
          conversationId: 'demo-conv-3',
          role: 'assistant',
          content: `This is actually a wonderful dilemma to have — it means you've developed breadth in really valuable areas. And I'd push back a little on the framing of "deciding" right now.

Let me ask you something: when you're working on your Algorithm Visualizer, which moments feel most alive to you — the moment an elegant algorithm *clicks* and you understand *why* it works, or the moment you solve a tricky engineering problem about *how* to make it scale?

That distinction — the "why it works" vs "how to make it work" instinct — is often a reliable signal about where your deepest motivation lies.

Also worth considering: these paths aren't as separate as they seem. ML infrastructure engineers need distributed systems knowledge, and backend engineers at AI companies work alongside ML teams constantly. What draws you to each, specifically?`,
          metadata: null,
          createdAt: new Date(Date.now() - 1000 * 60 * 60 * 48 + 45000),
        },
      ],
    },
  ]
}

function createDemoTeacherConfig(): DemoTeacherConfig {
  return {
    id: 'config-1',
    userId: 'demo-teacher-1',
    socraticIntensity: 7,
    hintLevel: 5,
    difficultyBias: 5,
    celebrateMistakes: true,
    encourageExploration: true,
    focusTopics: JSON.stringify(['algorithms', 'data structures', 'mathematics', 'career development']),
    restrictedTopics: null,
    customInstructions: 'Emphasize connections between CS and mathematics. Encourage project-based thinking.',
    tonePreference: 'warm',
    maxResponseLength: 500,
    allowProjectIdeas: true,
    allowCareerAdvice: true,
  }
}

function createDefaultInsights(): DemoInsight[] {
  return [
    { id: "ins-1", studentId: "student-1", type: "interest", content: "Deeply fascinated by game mechanics and interactive systems", confidence: 0.9, source: "onboarding", createdAt: "2024-09-01" },
    { id: "ins-2", studentId: "student-1", type: "strength", content: "Strong logical reasoning and pattern recognition", confidence: 0.85, source: "cs-algorithms-chat", createdAt: "2024-09-15" },
    { id: "ins-3", studentId: "student-1", type: "personality", content: "Visual learner who prefers building over reading theory", confidence: 0.8, source: "onboarding", createdAt: "2024-09-01" },
    { id: "ins-4", studentId: "student-1", type: "aspiration", content: "Wants to build AI-powered games that adapt to players", confidence: 0.85, source: "chat", createdAt: "2024-10-12" },
    { id: "ins-5", studentId: "student-1", type: "style", content: "Learns best through trial-and-error with immediate feedback loops", confidence: 0.8, source: "multiple-sessions", createdAt: "2024-11-01" },
  ]
}

// ── Persistence helpers ──────────────────────────────────────────────────────
import * as fs from 'fs'
import * as path from 'path'

function sanitizeUserId(userId: string): string {
  return userId.replace(/[^a-zA-Z0-9]/g, '-')
}

function getPersistFile(userId: string): string {
  const sanitized = sanitizeUserId(userId)
  return path.join(process.cwd(), 'prisma', `demo-state-${sanitized}.json`)
}

interface PersistedState {
  conversations: DemoConversation[]
  msgCounter: number
  teacherConfig: DemoTeacherConfig
  profile: DemoStudentProfile
  insights: DemoInsight[]
  curriculumPlan: CurriculumPlan | null
}

function loadPersistedState(userId: string): Partial<PersistedState> {
  try {
    const filePath = getPersistFile(userId)
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'))
    }
    // Migration: if userId is 'demo', also check the old single file
    if (userId === 'demo' || userId === 'demo-student-1') {
      const oldFile = path.join(process.cwd(), 'prisma', 'demo-state.json')
      if (fs.existsSync(oldFile)) {
        return JSON.parse(fs.readFileSync(oldFile, 'utf8'))
      }
    }
  } catch { /* ignore */ }
  return {}
}

// ── Per-user state management ────────────────────────────────────────────────

interface UserState {
  conversations: DemoConversation[]
  msgCounter: number
  teacherConfig: DemoTeacherConfig
  profile: DemoStudentProfile
  insights: DemoInsight[]
  curriculumPlan: CurriculumPlan | null
  saveTimer: ReturnType<typeof setTimeout> | null
}

const userStates = new Map<string, UserState>()

function isDemoUser(userId: string): boolean {
  return userId === 'demo' || userId === 'demo-student-1'
}

function getOrCreateUserState(userId: string): UserState {
  const existing = userStates.get(userId)
  if (existing) return existing

  const persisted = loadPersistedState(userId)
  const isDemo = isDemoUser(userId)

  const state: UserState = {
    conversations: persisted.conversations ?? (isDemo ? createDemoConversations() : []),
    msgCounter: persisted.msgCounter ?? 100,
    teacherConfig: persisted.teacherConfig ?? createDemoTeacherConfig(),
    profile: persisted.profile ?? (isDemo ? createDemoProfile() : createEmptyProfile(userId)),
    insights: persisted.insights ?? (isDemo ? createDefaultInsights() : []),
    curriculumPlan: persisted.curriculumPlan ?? null,
    saveTimer: null,
  }

  userStates.set(userId, state)
  return state
}

function createEmptyProfile(userId: string): DemoStudentProfile {
  return {
    id: `profile-${sanitizeUserId(userId)}`,
    userId,
    learningStage: 1,
    xp: 0,
    streak: 0,
    learningStyle: null,
    pacePreference: null,
    interests: JSON.stringify([]),
    strengths: JSON.stringify([]),
    weaknesses: JSON.stringify([]),
    aspirations: null,
    currentProjects: JSON.stringify([]),
    roadmapState: JSON.stringify({ completed: [], inProgress: [], available: [] }),
  }
}

function saveUserState(userId: string) {
  const state = userStates.get(userId)
  if (!state) return

  if (state.saveTimer) clearTimeout(state.saveTimer)
  state.saveTimer = setTimeout(() => {
    try {
      const persisted: PersistedState = {
        conversations: state.conversations,
        msgCounter: state.msgCounter,
        teacherConfig: state.teacherConfig,
        profile: state.profile,
        insights: state.insights,
        curriculumPlan: state.curriculumPlan,
      }
      fs.writeFileSync(getPersistFile(userId), JSON.stringify(persisted), 'utf8')
    } catch { /* ignore */ }
  }, 500)
}

// ── User-scoped store interface ──────────────────────────────────────────────

export interface UserScopedStore {
  getUser(): DemoUser
  getTeacher(): DemoUser
  getProfile(): DemoStudentProfile
  updateProfile(updates: Partial<DemoStudentProfile>): DemoStudentProfile
  getConversations(): DemoConversation[]
  getConversation(id: string): DemoConversation | null
  createConversation(title?: string, context?: string): DemoConversation
  updateConversation(id: string, updates: { title?: string; context?: string }): DemoConversation | null
  deleteConversation(id: string): boolean
  addMessage(conversationId: string, role: string, content: string): DemoMessage | null
  getTeacherConfig(): DemoTeacherConfig
  updateTeacherConfig(updates: Partial<DemoTeacherConfig>): DemoTeacherConfig
  getAllConversations(): DemoConversation[]
  getStudents(): DemoUser[]
  reset(): void
  getInsights(): DemoInsight[]
  addInsight(insight: Omit<DemoInsight, 'id' | 'createdAt'>): DemoInsight
  getCurriculumPlan(): CurriculumPlan | null
  setCurriculumPlan(plan: CurriculumPlan): CurriculumPlan
  hasCurriculumPlan(): boolean
  clearCurriculumPlan(): void
  updateCurriculumModule(moduleId: string, updates: Partial<{ status: 'completed' | 'in-progress' | 'not-started'; progress: number; title: string; description: string }>): boolean
}

function createUserScopedStore(userId: string): UserScopedStore {
  const isDemo = isDemoUser(userId)

  return {
    getUser(): DemoUser {
      if (isDemo) return DEMO_USER
      const state = getOrCreateUserState(userId)
      return {
        id: userId,
        email: state.profile.userId || userId,
        name: userId,
        role: 'student',
      }
    },

    getTeacher(): DemoUser {
      return DEMO_TEACHER
    },

    getProfile(): DemoStudentProfile {
      const state = getOrCreateUserState(userId)
      return { ...state.profile }
    },

    updateProfile(updates: Partial<DemoStudentProfile>): DemoStudentProfile {
      const state = getOrCreateUserState(userId)
      state.profile = { ...state.profile, ...updates }
      saveUserState(userId)
      return { ...state.profile }
    },

    getConversations(): DemoConversation[] {
      const state = getOrCreateUserState(userId)
      return state.conversations.map(c => ({ ...c, messages: c.messages.slice() }))
    },

    getConversation(id: string): DemoConversation | null {
      const state = getOrCreateUserState(userId)
      const conv = state.conversations.find(c => c.id === id)
      return conv ? { ...conv, messages: [...conv.messages] } : null
    },

    createConversation(title = 'New Conversation', context?: string): DemoConversation {
      const state = getOrCreateUserState(userId)
      const conv: DemoConversation = {
        id: `conv-${Date.now()}`,
        userId,
        title,
        context: context ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
        messages: [],
      }
      state.conversations = [conv, ...state.conversations]
      saveUserState(userId)
      return { ...conv }
    },

    updateConversation(id: string, updates: { title?: string; context?: string }): DemoConversation | null {
      const state = getOrCreateUserState(userId)
      const idx = state.conversations.findIndex(c => c.id === id)
      if (idx === -1) return null
      state.conversations[idx] = { ...state.conversations[idx], ...updates, updatedAt: new Date() }
      saveUserState(userId)
      return { ...state.conversations[idx] }
    },

    deleteConversation(id: string): boolean {
      const state = getOrCreateUserState(userId)
      const before = state.conversations.length
      state.conversations = state.conversations.filter(c => c.id !== id)
      saveUserState(userId)
      return state.conversations.length < before
    },

    addMessage(conversationId: string, role: string, content: string): DemoMessage | null {
      const state = getOrCreateUserState(userId)
      const idx = state.conversations.findIndex(c => c.id === conversationId)
      if (idx === -1) return null
      const msg: DemoMessage = {
        id: `msg-${state.msgCounter++}`,
        conversationId,
        role,
        content,
        metadata: null,
        createdAt: new Date(),
      }
      state.conversations[idx].messages = [...state.conversations[idx].messages, msg]
      state.conversations[idx].updatedAt = new Date()
      saveUserState(userId)
      return { ...msg }
    },

    getTeacherConfig(): DemoTeacherConfig {
      const state = getOrCreateUserState(userId)
      return { ...state.teacherConfig }
    },

    updateTeacherConfig(updates: Partial<DemoTeacherConfig>): DemoTeacherConfig {
      const state = getOrCreateUserState(userId)
      state.teacherConfig = { ...state.teacherConfig, ...updates }
      saveUserState(userId)
      return { ...state.teacherConfig }
    },

    getAllConversations(): DemoConversation[] {
      const state = getOrCreateUserState(userId)
      return state.conversations.map(c => ({ ...c, messages: c.messages.slice() }))
    },

    getStudents(): DemoUser[] {
      if (isDemo) return [DEMO_USER]
      const state = getOrCreateUserState(userId)
      return [{
        id: userId,
        email: state.profile.userId || userId,
        name: userId,
        role: 'student',
      }]
    },

    reset() {
      const state = getOrCreateUserState(userId)
      if (isDemo) {
        state.conversations = createDemoConversations()
        state.profile = createDemoProfile()
        state.insights = createDefaultInsights()
      } else {
        state.conversations = []
        state.profile = createEmptyProfile(userId)
        state.insights = []
      }
      state.msgCounter = 100
      state.teacherConfig = createDemoTeacherConfig()
      state.curriculumPlan = null
      saveUserState(userId)
    },

    getInsights(): DemoInsight[] {
      const state = getOrCreateUserState(userId)
      return state.insights
    },

    addInsight(insight: Omit<DemoInsight, 'id' | 'createdAt'>): DemoInsight {
      const state = getOrCreateUserState(userId)
      const newInsight: DemoInsight = {
        ...insight,
        id: `ins-${Date.now()}`,
        createdAt: new Date().toISOString(),
      }
      state.insights.push(newInsight)
      saveUserState(userId)
      return newInsight
    },

    getCurriculumPlan(): CurriculumPlan | null {
      const state = getOrCreateUserState(userId)
      return state.curriculumPlan ? { ...state.curriculumPlan } : null
    },

    setCurriculumPlan(plan: CurriculumPlan): CurriculumPlan {
      const state = getOrCreateUserState(userId)
      state.curriculumPlan = { ...plan }
      saveUserState(userId)
      return { ...state.curriculumPlan }
    },

    hasCurriculumPlan(): boolean {
      const state = getOrCreateUserState(userId)
      return state.curriculumPlan !== null
    },

    clearCurriculumPlan(): void {
      const state = getOrCreateUserState(userId)
      state.curriculumPlan = null
      saveUserState(userId)
    },

    updateCurriculumModule(moduleId: string, updates: Partial<{ status: 'completed' | 'in-progress' | 'not-started'; progress: number; title: string; description: string }>): boolean {
      const state = getOrCreateUserState(userId)
      if (!state.curriculumPlan) return false
      const findAndUpdate = (modules: CurriculumPlan['projectModules']) =>
        modules.map(m => m.id === moduleId ? { ...m, ...updates } : m)
      state.curriculumPlan = {
        ...state.curriculumPlan,
        projectModules: findAndUpdate(state.curriculumPlan.projectModules),
        coreModules: findAndUpdate(state.curriculumPlan.coreModules),
        lastUpdatedAt: new Date().toISOString(),
      }
      saveUserState(userId)
      return true
    },
  }
}

// ── Exported store with backwards compatibility ──────────────────────────────

// The default demoStore delegates to the 'demo' user for backwards compat
const defaultStore = createUserScopedStore('demo')

export const demoStore = {
  // All backwards-compatible methods delegate to 'demo' user
  ...defaultStore,

  // The new multi-tenant entry point
  forUser(userId: string): UserScopedStore {
    return createUserScopedStore(userId)
  },
}
