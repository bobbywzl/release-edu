/**
 * Mutable work data store — per-user isolation for demo mode.
 * Initializes from static demo-work-data and provides get/set methods
 * for syllabi, homework, quizzes, and projects per trackId.
 * Follows the same forUser pattern as demo-store.ts.
 */
import * as fs from 'fs'
import * as path from 'path'
import type { SubjectSyllabus, ContentChapter, Homework, Quiz, SubjectProject } from '@/types'
import { demoSyllabi, demoHomework, demoQuizzes, demoProjects } from './demo-work-data'

// ── Types ──────────────────────────────────────────────────

interface WorkState {
  syllabi: Record<string, SubjectSyllabus>
  homework: Record<string, Homework[]>
  quizzes: Record<string, Quiz[]>
  projects: Record<string, SubjectProject>
  saveTimer: ReturnType<typeof setTimeout> | null
}

// ── Persistence helpers ────────────────────────────────────

function sanitizeUserId(userId: string): string {
  return userId.replace(/[^a-zA-Z0-9]/g, '-')
}

function getPersistFile(userId: string): string {
  const sanitized = sanitizeUserId(userId)
  return path.join(process.cwd(), 'prisma', `work-state-${sanitized}.json`)
}

interface PersistedWorkState {
  syllabi: Record<string, SubjectSyllabus>
  homework: Record<string, Homework[]>
  quizzes: Record<string, Quiz[]>
  projects: Record<string, SubjectProject>
}

function loadPersistedState(userId: string): Partial<PersistedWorkState> {
  try {
    const filePath = getPersistFile(userId)
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'))
    }
  } catch { /* ignore */ }
  return {}
}

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj))
}

// ── Per-user state management ──────────────────────────────

const userStates = new Map<string, WorkState>()

function isDemoUser(userId: string): boolean {
  return userId === 'demo' || userId === 'demo-student-1'
}

function getOrCreateWorkState(userId: string): WorkState {
  const existing = userStates.get(userId)
  if (existing) return existing

  const persisted = loadPersistedState(userId)
  const isDemo = isDemoUser(userId)

  const state: WorkState = {
    syllabi: persisted.syllabi ?? (isDemo ? deepClone(demoSyllabi) : {}),
    homework: persisted.homework ?? (isDemo ? deepClone(demoHomework) : {}),
    quizzes: persisted.quizzes ?? (isDemo ? deepClone(demoQuizzes) : {}),
    projects: persisted.projects ?? (isDemo ? deepClone(demoProjects) : {}),
    saveTimer: null,
  }

  userStates.set(userId, state)
  return state
}

function saveWorkState(userId: string) {
  const state = userStates.get(userId)
  if (!state) return

  if (state.saveTimer) clearTimeout(state.saveTimer)
  state.saveTimer = setTimeout(() => {
    try {
      const persisted: PersistedWorkState = {
        syllabi: state.syllabi,
        homework: state.homework,
        quizzes: state.quizzes,
        projects: state.projects,
      }
      fs.writeFileSync(getPersistFile(userId), JSON.stringify(persisted), 'utf8')
    } catch { /* ignore */ }
  }, 500)
}

// ── User-scoped store interface ────────────────────────────

export interface WorkScopedStore {
  // Syllabi
  getSyllabus(trackId: string): SubjectSyllabus | null
  updateSyllabus(trackId: string, data: { title?: string; description?: string; chapters?: Partial<ContentChapter>[] }): SubjectSyllabus | null

  // Chapters
  addChapter(trackId: string, data: Partial<ContentChapter>): ContentChapter | null
  updateChapter(trackId: string, chapterId: string, data: Partial<ContentChapter>): ContentChapter | null

  // Homework
  getHomework(trackId: string): Homework[]
  addHomework(trackId: string, data: Partial<Homework>): Homework
  updateHomework(trackId: string, homeworkId: string, data: Partial<Homework>): Homework | null

  // Quizzes
  getQuizzes(trackId: string): Quiz[]
  addQuiz(trackId: string, data: Partial<Quiz>): Quiz

  // Projects
  getProject(trackId: string): SubjectProject | null
  updateProjectApproval(trackId: string, status: 'approved' | 'needs-revision', feedback?: string): SubjectProject | null

  // All data (for get-track-data)
  getAllSyllabi(): Record<string, SubjectSyllabus>
  getAllHomework(): Record<string, Homework[]>
  getAllQuizzes(): Record<string, Quiz[]>
  getAllProjects(): Record<string, SubjectProject>
}

function createWorkScopedStore(userId: string): WorkScopedStore {
  return {
    getSyllabus(trackId: string): SubjectSyllabus | null {
      const state = getOrCreateWorkState(userId)
      return state.syllabi[trackId] ?? null
    },

    updateSyllabus(trackId: string, data: { title?: string; description?: string; chapters?: Partial<ContentChapter>[] }): SubjectSyllabus | null {
      const state = getOrCreateWorkState(userId)
      const syllabus = state.syllabi[trackId]
      if (!syllabus) return null

      if (data.title) syllabus.title = data.title
      if (data.description) syllabus.description = data.description
      if (data.chapters) {
        for (const chUpdate of data.chapters) {
          if (chUpdate.id) {
            const idx = syllabus.chapters.findIndex(c => c.id === chUpdate.id)
            if (idx !== -1) {
              syllabus.chapters[idx] = { ...syllabus.chapters[idx], ...chUpdate } as ContentChapter
            }
          }
        }
      }

      saveWorkState(userId)
      return { ...syllabus }
    },

    addChapter(trackId: string, data: Partial<ContentChapter>): ContentChapter | null {
      const state = getOrCreateWorkState(userId)
      const syllabus = state.syllabi[trackId]
      if (!syllabus) return null

      const newChapter: ContentChapter = {
        id: `ch-${Date.now()}`,
        trackId,
        title: data.title ?? 'New Chapter',
        description: data.description ?? '',
        order: data.order ?? syllabus.chapters.length + 1,
        status: data.status ?? 'not-started',
        content: data.content ?? '',
        estimatedMinutes: data.estimatedMinutes ?? 30,
        keyTopics: data.keyTopics ?? [],
        ...data,
      }

      syllabus.chapters.push(newChapter)
      saveWorkState(userId)
      return { ...newChapter }
    },

    updateChapter(trackId: string, chapterId: string, data: Partial<ContentChapter>): ContentChapter | null {
      const state = getOrCreateWorkState(userId)
      const syllabus = state.syllabi[trackId]
      if (!syllabus) return null

      const idx = syllabus.chapters.findIndex(c => c.id === chapterId)
      if (idx === -1) return null

      syllabus.chapters[idx] = { ...syllabus.chapters[idx], ...data } as ContentChapter
      saveWorkState(userId)
      return { ...syllabus.chapters[idx] }
    },

    getHomework(trackId: string): Homework[] {
      const state = getOrCreateWorkState(userId)
      return state.homework[trackId] ?? []
    },

    addHomework(trackId: string, data: Partial<Homework>): Homework {
      const state = getOrCreateWorkState(userId)
      if (!state.homework[trackId]) state.homework[trackId] = []

      const newHw: Homework = {
        id: `hw-${Date.now()}`,
        trackId,
        title: data.title ?? 'New Homework',
        description: data.description ?? '',
        instructions: data.instructions ?? '',
        status: data.status ?? 'not-started',
        competencies: data.competencies ?? [],
        estimatedMinutes: data.estimatedMinutes ?? 30,
        ...data,
      }

      state.homework[trackId].push(newHw)
      saveWorkState(userId)
      return { ...newHw }
    },

    updateHomework(trackId: string, homeworkId: string, data: Partial<Homework>): Homework | null {
      const state = getOrCreateWorkState(userId)
      const hwList = state.homework[trackId]
      if (!hwList) return null

      const idx = hwList.findIndex(h => h.id === homeworkId)
      if (idx === -1) return null

      hwList[idx] = { ...hwList[idx], ...data } as Homework
      saveWorkState(userId)
      return { ...hwList[idx] }
    },

    getQuizzes(trackId: string): Quiz[] {
      const state = getOrCreateWorkState(userId)
      return state.quizzes[trackId] ?? []
    },

    addQuiz(trackId: string, data: Partial<Quiz>): Quiz {
      const state = getOrCreateWorkState(userId)
      if (!state.quizzes[trackId]) state.quizzes[trackId] = []

      const newQuiz: Quiz = {
        id: `quiz-${Date.now()}`,
        trackId,
        title: data.title ?? 'New Quiz',
        description: data.description ?? '',
        status: data.status ?? 'not-started',
        questions: data.questions ?? [],
        totalPoints: data.totalPoints ?? 0,
        ...data,
      }

      state.quizzes[trackId].push(newQuiz)
      saveWorkState(userId)
      return { ...newQuiz }
    },

    getProject(trackId: string): SubjectProject | null {
      const state = getOrCreateWorkState(userId)
      return state.projects[trackId] ?? null
    },

    updateProjectApproval(trackId: string, status: 'approved' | 'needs-revision', feedback?: string): SubjectProject | null {
      const state = getOrCreateWorkState(userId)
      const project = state.projects[trackId]
      if (!project) return null

      project.status = status
      if (feedback) project.mentorFeedback = feedback
      saveWorkState(userId)
      return { ...project }
    },

    getAllSyllabi(): Record<string, SubjectSyllabus> {
      const state = getOrCreateWorkState(userId)
      return { ...state.syllabi }
    },

    getAllHomework(): Record<string, Homework[]> {
      const state = getOrCreateWorkState(userId)
      return { ...state.homework }
    },

    getAllQuizzes(): Record<string, Quiz[]> {
      const state = getOrCreateWorkState(userId)
      return { ...state.quizzes }
    },

    getAllProjects(): Record<string, SubjectProject> {
      const state = getOrCreateWorkState(userId)
      return { ...state.projects }
    },
  }
}

// ── Exported store ─────────────────────────────────────────

const defaultStore = createWorkScopedStore('demo')

export const workStore = {
  ...defaultStore,

  forUser(userId: string): WorkScopedStore {
    return createWorkScopedStore(userId)
  },
}
