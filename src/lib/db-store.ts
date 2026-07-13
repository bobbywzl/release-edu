/**
 * Database-backed store — the single per-user data access layer.
 * Uses Prisma to query Postgres (Supabase).
 * Provides the same scoped-by-user pattern: dbStore.forUser(userId)
 */
import prisma from '@/lib/prisma'
import { condenseProjectTitle } from '@/lib/title-normalize'
import type {
  User,
  StudentProfile,
  MentorConfig,
  Conversation,
  Message,
  Insight,
  CurriculumPlan,
  Track,
  CurriculumModule,
  Chapter,
  Homework,
  Quiz,
  QuizQuestion,
  SubjectProject,
  ProjectTask,
  ProjectMilestone,
  LinkedFile,
} from '@prisma/client'

// Re-export Prisma types for convenience
export type {
  User,
  StudentProfile,
  MentorConfig,
  Conversation,
  Message,
  Insight,
  CurriculumPlan,
  Track,
  Chapter,
  Homework,
  Quiz,
  QuizQuestion,
  SubjectProject,
  ProjectTask,
  ProjectMilestone,
  LinkedFile,
}

export interface DbScopedStore {
  // User
  getOrCreateUser(email: string, name?: string, image?: string): Promise<User>

  // Profile
  getProfile(): Promise<StudentProfile | null>
  updateProfile(updates: Partial<Omit<StudentProfile, 'id' | 'userId'>>): Promise<StudentProfile>

  // Conversations
  getConversations(): Promise<(Conversation & { messages: Message[]; _count: { messages: number } })[]>
  getConversation(id: string): Promise<(Conversation & { messages: Message[] }) | null>
  createConversation(title: string, context?: string): Promise<Conversation>
  updateConversation(id: string, updates: { title?: string; context?: string }): Promise<Conversation | null>
  deleteConversation(id: string): Promise<boolean>
  addMessage(conversationId: string, role: string, content: string, metadata?: string): Promise<Message>

  // Insights
  getInsights(): Promise<Insight[]>
  addInsight(data: { type: string; content: string; confidence: number; source: string }): Promise<Insight>

  // Curriculum Plan
  getCurriculumPlan(): Promise<(CurriculumPlan & { tracks: (Track & { modules: CurriculumModule[]; chapters: Chapter[] })[] }) | null>
  setCurriculumPlan(data: {
    profileSummary?: string
    primaryStrengths?: string[]
    primaryInterests?: string[]
    learningStyle?: string
    personalityTraits?: string[]
    tracks?: Array<{
      id?: string
      name: string
      description?: string
      color?: string
      type?: string
      projectIdea?: string
      projectDescription?: string
      order?: number
      modules?: Array<{
        id?: string
        title: string
        description?: string
        type?: string
        subject?: string
        status?: string
        progress?: number
        estimatedHours?: number
        prerequisites?: string[]
        skills?: string[]
        aiRationale?: string
        order?: number
      }>
    }>
    lockedAt?: string | null
    version?: number
  }): Promise<CurriculumPlan>
  updateCurriculumModule(moduleId: string, updates: Partial<{ status: string; progress: number; title: string; description: string }>): Promise<boolean>

  // Mentor Config
  getMentorConfig(): Promise<MentorConfig | null>
  updateMentorConfig(updates: Partial<Omit<MentorConfig, 'id' | 'userId'>>): Promise<MentorConfig>

  // Work Data (replaces workStore)
  getSyllabus(trackId: string): Promise<{ chapters: Chapter[]; title: string; description: string } | null>
  getHomework(trackId: string): Promise<Homework[]>
  getQuizzes(trackId: string): Promise<(Quiz & { questions: QuizQuestion[] })[]>
  getProject(trackId: string): Promise<(SubjectProject & { tasks: ProjectTask[]; milestones: ProjectMilestone[] }) | null>

  // Work mutations
  updateSyllabus(trackId: string, data: { title?: string; description?: string; chapters?: Array<{ id?: string; title?: string; description?: string; content?: string; status?: string; estimatedMinutes?: number; keyTopics?: string[]; order?: number }> }): Promise<Track | null>
  addChapter(trackId: string, data: Partial<{ title: string; description: string; content: string; status: string; estimatedMinutes: number; keyTopics: string[]; order: number }>): Promise<Chapter | null>
  updateChapter(trackId: string, chapterId: string, data: Partial<{ title: string; description: string; content: string; status: string; estimatedMinutes: number; keyTopics: string[]; order: number }>): Promise<Chapter | null>
  addHomework(trackId: string, data: Partial<{ title: string; description: string; instructions: string; status: string; competencies: string[]; estimatedMinutes: number; chapterId: string }>): Promise<Homework>
  updateHomework(trackId: string, homeworkId: string, data: Partial<{ title: string; description: string; instructions: string; status: string; studentResponse: string; competencies: string[]; estimatedMinutes: number }>): Promise<Homework | null>
  addQuiz(trackId: string, data: Partial<{ title: string; description: string; status: string; totalPoints: number; timeLimit: number; questions: Array<{ question: string; type: string; options: string[]; correctAnswer: string; explanation: string; points: number }> }>): Promise<Quiz>
  updateProjectApproval(trackId: string, status: string, feedback?: string): Promise<SubjectProject | null>

  // Track management
  getTracks(): Promise<Track[]>
  getAllSyllabi(): Promise<Record<string, { trackId: string; title: string; description: string; chapters: Chapter[] }>>
  getAllHomework(): Promise<Record<string, Homework[]>>
  getAllQuizzes(): Promise<Record<string, (Quiz & { questions: QuizQuestion[] })[]>>
  getAllProjects(): Promise<Record<string, SubjectProject & { tasks: ProjectTask[]; milestones: ProjectMilestone[] }>>

  // Files
  getFiles(workId?: string): Promise<LinkedFile[]>
  addFile(data: { trackId?: string; workType?: string; workId?: string; driveId?: string; name: string; mimeType?: string; url?: string }): Promise<LinkedFile>
  deleteFile(id: string): Promise<boolean>

  // Account
  deleteAllData(): Promise<void>
  exportAllData(): Promise<Record<string, unknown>>
}

function createDbScopedStore(userId: string): DbScopedStore {
  // Helper: ensure the user row exists.
  async function ensureUser(): Promise<User> {
    let user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user) {
      let email = `placeholder-${userId.slice(0, 8)}@pending.edu`
      let name: string | undefined
      try {
        const { getUserInfo } = await import('@/lib/get-user-id')
        const info = await getUserInfo()
        if (info.email) email = info.email
        if (info.name) name = info.name
      } catch { /* not in request context */ }

      user = await prisma.user.upsert({
        where: { id: userId },
        update: {},
        create: { id: userId, email, name },
      })
    }
    return user
  }

  return {
    async getOrCreateUser(email: string, name?: string, image?: string): Promise<User> {
      return prisma.user.upsert({
        where: { id: userId },
        // Only update email/image on re-login — never overwrite a custom name the user has set
        update: { ...(email && { email }), ...(image && { image }) },
        create: { id: userId, email, name, image },
      })
    },

    async getProfile(): Promise<StudentProfile | null> {
      await ensureUser()
      return prisma.studentProfile.findUnique({ where: { userId } })
    },

    async updateProfile(updates): Promise<StudentProfile> {
      await ensureUser()
      return prisma.studentProfile.upsert({
        where: { userId },
        update: updates,
        create: { userId, ...updates },
      })
    },

    async getConversations() {
      await ensureUser()
      return prisma.conversation.findMany({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
        include: {
          messages: { orderBy: { createdAt: 'desc' }, take: 1 },
          _count: { select: { messages: true } },
        },
      })
    },

    async getConversation(id: string) {
      return prisma.conversation.findFirst({
        where: { id, userId },
        include: { messages: { orderBy: { createdAt: 'asc' } } },
      })
    },

    async createConversation(title: string, context?: string) {
      await ensureUser()
      return prisma.conversation.create({
        data: { userId, title, context: context ?? null },
      })
    },

    async updateConversation(id: string, updates) {
      const conv = await prisma.conversation.findFirst({ where: { id, userId } })
      if (!conv) return null
      return prisma.conversation.update({
        where: { id },
        data: {
          ...(updates.title !== undefined && { title: updates.title }),
          ...(updates.context !== undefined && { context: updates.context }),
        },
      })
    },

    async deleteConversation(id: string) {
      const conv = await prisma.conversation.findFirst({ where: { id, userId } })
      if (!conv) return false
      await prisma.conversation.delete({ where: { id } })
      return true
    },

    async addMessage(conversationId: string, role: string, content: string, metadata?: string) {
      return prisma.message.create({
        data: { conversationId, role, content, ...(metadata ? { metadata } : {}) },
      })
    },

    async getInsights() {
      return prisma.insight.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      })
    },

    async addInsight(data) {
      await ensureUser()
      return prisma.insight.create({
        data: { userId, ...data },
      })
    },

    async getCurriculumPlan() {
      const plan = await prisma.curriculumPlan.findUnique({
        where: { userId },
      })
      if (!plan) return null

      const tracks = await prisma.track.findMany({
        where: { userId },
        orderBy: { order: 'asc' },
        include: {
          modules: { orderBy: { order: 'asc' } },
          chapters: { orderBy: { order: 'asc' } },
        },
      })

      return { ...plan, tracks } as CurriculumPlan & { tracks: (Track & { modules: CurriculumModule[]; chapters: Chapter[] })[] }
    },

    async setCurriculumPlan(data) {
      await ensureUser()

      // Delete existing plan + tracks + modules if any
      const existing = await prisma.curriculumPlan.findUnique({ where: { userId } })
      if (existing) {
        // Delete old tracks (cascades to modules, chapters, etc.)
        await prisma.track.deleteMany({ where: { userId } })
        await prisma.curriculumPlan.delete({ where: { userId } })
      }

      // Create new plan
      const plan = await prisma.curriculumPlan.create({
        data: {
          userId,
          version: data.version ?? 1,
          profileSummary: data.profileSummary ?? null,
          primaryStrengths: data.primaryStrengths ? JSON.stringify(data.primaryStrengths) : null,
          primaryInterests: data.primaryInterests ? JSON.stringify(data.primaryInterests) : null,
          learningStyle: data.learningStyle ?? null,
          personalityTraits: data.personalityTraits ? JSON.stringify(data.personalityTraits) : null,
          lockedAt: data.lockedAt ? new Date(data.lockedAt) : null,
        },
      })

      // Create tracks with modules
      if (data.tracks) {
        for (let tIdx = 0; tIdx < data.tracks.length; tIdx++) {
          const t = data.tracks[tIdx]
          const track = await prisma.track.create({
            data: {
              id: t.id || undefined,
              userId,
              name: t.name,
              description: t.description ?? null,
              color: t.color ?? '#3B82F6',
              type: t.type ?? 'project',
              order: t.order ?? tIdx,
            },
          })

          if (t.modules) {
            for (let mIdx = 0; mIdx < t.modules.length; mIdx++) {
              const m = t.modules[mIdx]
              await prisma.curriculumModule.create({
                data: {
                  id: m.id || undefined,
                  trackId: track.id,
                  title: m.title,
                  description: m.description ?? null,
                  type: m.type ?? 'project',
                  subject: m.subject ?? null,
                  status: m.status ?? 'not-started',
                  progress: m.progress ?? 0,
                  estimatedHours: m.estimatedHours ?? 10,
                  prerequisites: m.prerequisites ? JSON.stringify(m.prerequisites) : null,
                  skills: m.skills ? JSON.stringify(m.skills) : null,
                  aiRationale: m.aiRationale ?? null,
                  order: m.order ?? mIdx,
                },
              })

              // Also create a Chapter from each module so the curriculum page can display it
              await prisma.chapter.create({
                data: {
                  trackId: track.id,
                  title: m.title,
                  description: m.description ?? null,
                  content: m.aiRationale ? `# ${m.title}\n\n${m.aiRationale}\n\nContent will be generated when you start this chapter with Bob.` : `# ${m.title}\n\nContent will be generated when you start this chapter with Bob.`,
                  keyTopics: Array.isArray(m.skills) ? JSON.stringify(m.skills) : (m.skills ?? '[]'),
                  estimatedMinutes: Math.round((m.estimatedHours ?? 10) * 60 / 3), // rough per-session estimate
                  status: m.status === 'completed' ? 'completed' : m.status === 'in-progress' ? 'in-progress' : 'not-started',
                  order: m.order ?? mIdx,
                },
              })
            }
          }

          // Create ONE capstone SubjectProject per interest-based (project-type) track.
          // Titles stay short artifact names; ALL detail lives in the description
          // (which also feeds Bob's context, so he remembers the full brief).
          if ((t.type ?? 'project') === 'project') {
            const rawIdea = t.projectIdea || `Creative ${t.name} Capstone`
            const { title: projectTitle, overflow } = condenseProjectTitle(rawIdea)
            const moduleTitles = (t.modules || []).map(m => m.title)
            const description = [
              // Prefer the generator's dedicated comprehensive brief; fall back
              // to whatever detail was condensed out of an over-long title.
              t.projectDescription || overflow,
              `Capstone project for ${t.name} — synthesize everything from ${moduleTitles.join(', ')} into one original creative work.`,
            ].filter(Boolean).join(' ')
            await prisma.subjectProject.create({
              data: {
                trackId: track.id,
                title: projectTitle,
                description,
                status: 'proposal',
                progress: 0,
              },
            })
          }
        }
      }

      return plan
    },

    async updateCurriculumModule(moduleId: string, updates) {
      try {
        await prisma.curriculumModule.update({
          where: { id: moduleId },
          data: updates,
        })
        return true
      } catch {
        return false
      }
    },

    async getMentorConfig() {
      return prisma.mentorConfig.findUnique({ where: { userId } })
    },

    async updateMentorConfig(updates) {
      await ensureUser()
      return prisma.mentorConfig.upsert({
        where: { userId },
        update: updates,
        create: { userId, ...updates },
      })
    },

    async getSyllabus(trackId: string) {
      const track = await prisma.track.findFirst({
        where: { id: trackId, userId },
        include: { chapters: { orderBy: { order: 'asc' } } },
      })
      if (!track) return null
      return { title: track.name, description: track.description ?? '', chapters: track.chapters }
    },

    async getHomework(trackId: string) {
      return prisma.homework.findMany({
        where: { trackId },
        orderBy: { createdAt: 'asc' },
      })
    },

    async getQuizzes(trackId: string) {
      return prisma.quiz.findMany({
        where: { trackId },
        include: { questions: { orderBy: { order: 'asc' } } },
        orderBy: { createdAt: 'asc' },
      })
    },

    async getProject(trackId: string) {
      return prisma.subjectProject.findFirst({
        where: { trackId },
        include: {
          tasks: { orderBy: { order: 'asc' } },
          milestones: { orderBy: { order: 'asc' } },
        },
        orderBy: { createdAt: 'desc' },
      })
    },

    async updateSyllabus(trackId, data) {
      const track = await prisma.track.findFirst({ where: { id: trackId, userId } })
      if (!track) return null

      const updateData: Record<string, unknown> = {}
      if (data.title) updateData.name = data.title
      if (data.description) updateData.description = data.description

      if (Object.keys(updateData).length > 0) {
        await prisma.track.update({ where: { id: trackId }, data: updateData })
      }

      if (data.chapters) {
        for (const ch of data.chapters) {
          if (ch.id) {
            const chData: Record<string, unknown> = {}
            if (ch.title) chData.title = ch.title
            if (ch.description) chData.description = ch.description
            if (ch.content) chData.content = ch.content
            if (ch.status) chData.status = ch.status
            if (ch.estimatedMinutes) chData.estimatedMinutes = ch.estimatedMinutes
            if (ch.keyTopics) chData.keyTopics = JSON.stringify(ch.keyTopics)
            if (ch.order !== undefined) chData.order = ch.order
            if (Object.keys(chData).length > 0) {
              await prisma.chapter.update({ where: { id: ch.id }, data: chData }).catch(() => {})
            }
          }
        }
      }

      return prisma.track.findFirst({
        where: { id: trackId },
        include: { chapters: { orderBy: { order: 'asc' } } },
      })
    },

    async addChapter(trackId, data) {
      const track = await prisma.track.findFirst({ where: { id: trackId, userId } })
      if (!track) return null

      const chapterCount = await prisma.chapter.count({ where: { trackId } })
      return prisma.chapter.create({
        data: {
          trackId,
          title: data.title ?? 'New Chapter',
          description: data.description ?? null,
          content: data.content ?? null,
          status: data.status ?? 'not-started',
          estimatedMinutes: data.estimatedMinutes ?? 30,
          keyTopics: data.keyTopics ? JSON.stringify(data.keyTopics) : null,
          order: data.order ?? chapterCount,
        },
      })
    },

    async updateChapter(trackId, chapterId, data) {
      const chapter = await prisma.chapter.findFirst({ where: { id: chapterId, trackId } })
      if (!chapter) return null

      const updateData: Record<string, unknown> = {}
      if (data.title) updateData.title = data.title
      if (data.description) updateData.description = data.description
      if (data.content) updateData.content = data.content
      if (data.status) updateData.status = data.status
      if (data.estimatedMinutes) updateData.estimatedMinutes = data.estimatedMinutes
      if (data.keyTopics) updateData.keyTopics = JSON.stringify(data.keyTopics)
      if (data.order !== undefined) updateData.order = data.order

      return prisma.chapter.update({ where: { id: chapterId }, data: updateData })
    },

    async addHomework(trackId, data) {
      return prisma.homework.create({
        data: {
          trackId,
          title: data.title ?? 'New Homework',
          description: data.description ?? null,
          instructions: data.instructions ?? null,
          status: data.status ?? 'not-started',
          competencies: data.competencies ? JSON.stringify(data.competencies) : null,
          estimatedMinutes: data.estimatedMinutes ?? 30,
          chapterId: data.chapterId ?? null,
        },
      })
    },

    async updateHomework(_trackId, homeworkId, data) {
      try {
        const updateData: Record<string, unknown> = {}
        if (data.title) updateData.title = data.title
        if (data.description) updateData.description = data.description
        if (data.instructions) updateData.instructions = data.instructions
        if (data.status) updateData.status = data.status
        if (data.studentResponse) updateData.studentResponse = data.studentResponse
        if (data.competencies) updateData.competencies = JSON.stringify(data.competencies)
        if (data.estimatedMinutes) updateData.estimatedMinutes = data.estimatedMinutes

        return await prisma.homework.update({ where: { id: homeworkId }, data: updateData })
      } catch {
        return null
      }
    },

    async addQuiz(trackId, data) {
      const quiz = await prisma.quiz.create({
        data: {
          trackId,
          title: data.title ?? 'New Quiz',
          description: data.description ?? null,
          status: data.status ?? 'not-started',
          totalPoints: data.totalPoints ?? 0,
          timeLimit: data.timeLimit ?? null,
        },
      })

      if (data.questions) {
        for (let i = 0; i < data.questions.length; i++) {
          const q = data.questions[i]
          await prisma.quizQuestion.create({
            data: {
              quizId: quiz.id,
              question: q.question,
              type: q.type ?? 'multiple-choice',
              options: q.options ? JSON.stringify(q.options) : null,
              correctAnswer: q.correctAnswer ?? null,
              explanation: q.explanation ?? null,
              points: q.points ?? 1,
              order: i,
            },
          })
        }
      }

      return prisma.quiz.findUniqueOrThrow({
        where: { id: quiz.id },
        include: { questions: { orderBy: { order: 'asc' } } },
      })
    },

    async updateProjectApproval(trackId, status, feedback?) {
      try {
        const project = await prisma.subjectProject.findFirst({
          where: { trackId },
          orderBy: { createdAt: 'desc' },
        }) as ({ id: string; startedAt?: Date | null; completedAt?: Date | null } | null)
        if (!project) return null
        // Stamp startedAt the first time the project becomes active, and
        // completedAt the first time it flips to completed. Idempotent.
        const now = new Date()
        const stamps: { startedAt?: Date; completedAt?: Date | null } = {}
        if ((status === 'in-progress' || status === 'approved' || status === 'completed') && !project.startedAt) {
          stamps.startedAt = now
        }
        if (status === 'completed' && !project.completedAt) {
          stamps.completedAt = now
        } else if (status !== 'completed' && project.completedAt) {
          stamps.completedAt = null
        }
        return await prisma.subjectProject.update({
          where: { id: project.id },
          data: {
            status,
            ...stamps,
            ...(feedback && { mentorFeedback: feedback }),
          } as { status: string; startedAt?: Date; completedAt?: Date | null; mentorFeedback?: string },
          include: {
            tasks: { orderBy: { order: 'asc' } },
            milestones: { orderBy: { order: 'asc' } },
          },
        })
      } catch {
        return null
      }
    },

    async getTracks() {
      return prisma.track.findMany({
        where: { userId },
        orderBy: { order: 'asc' },
      })
    },

    async getAllSyllabi() {
      const tracks = await prisma.track.findMany({
        where: { userId },
        include: { chapters: { orderBy: { order: 'asc' } } },
      })
      const result: Record<string, { trackId: string; title: string; description: string; chapters: Chapter[] }> = {}
      for (const t of tracks) {
        if (t.chapters.length > 0) {
          result[t.id] = { trackId: t.id, title: t.name, description: t.description ?? '', chapters: t.chapters }
        }
      }
      return result
    },

    async getAllHomework() {
      const tracks = await prisma.track.findMany({
        where: { userId },
        include: { homeworks: { orderBy: { createdAt: 'asc' } } },
      })
      const result: Record<string, Homework[]> = {}
      for (const t of tracks) {
        if (t.homeworks.length > 0) {
          result[t.id] = t.homeworks
        }
      }
      return result
    },

    async getAllQuizzes() {
      const tracks = await prisma.track.findMany({
        where: { userId },
        include: {
          quizzes: {
            include: { questions: { orderBy: { order: 'asc' } } },
            orderBy: { createdAt: 'asc' },
          },
        },
      })
      const result: Record<string, (Quiz & { questions: QuizQuestion[] })[]> = {}
      for (const t of tracks) {
        if (t.quizzes.length > 0) {
          result[t.id] = t.quizzes
        }
      }
      return result
    },

    async getAllProjects() {
      const tracks = await prisma.track.findMany({
        where: { userId },
        include: {
          projects: {
            include: {
              tasks: { orderBy: { order: 'asc' } },
              milestones: { orderBy: { order: 'asc' } },
            },
          },
        },
      })
      const result: Record<string, SubjectProject & { tasks: ProjectTask[]; milestones: ProjectMilestone[] }> = {}
      for (const t of tracks) {
        for (const p of t.projects) {
          result[p.id] = p
        }
      }
      return result
    },

    async getFiles(workId?: string) {
      return prisma.linkedFile.findMany({
        where: { userId, ...(workId && { workId }) },
        orderBy: { addedAt: 'desc' },
      })
    },

    async addFile(data) {
      await ensureUser()
      return prisma.linkedFile.create({
        data: { userId, ...data },
      })
    },

    async deleteFile(id: string) {
      try {
        await prisma.linkedFile.delete({ where: { id } })
        return true
      } catch {
        return false
      }
    },

    async deleteAllData() {
      // Cascade deletes handle most relations
      await prisma.user.delete({ where: { id: userId } }).catch(() => {})
    },

    async exportAllData() {
      const user = await prisma.user.findUnique({ where: { id: userId } })
      const profile = await prisma.studentProfile.findUnique({ where: { userId } })
      const conversations = await prisma.conversation.findMany({
        where: { userId },
        include: { messages: { orderBy: { createdAt: 'asc' } } },
      })
      const insights = await prisma.insight.findMany({ where: { userId } })
      const plan = await prisma.curriculumPlan.findUnique({ where: { userId } })
      const tracks = await prisma.track.findMany({
        where: { userId },
        include: {
          modules: true,
          chapters: true,
          homeworks: true,
          quizzes: { include: { questions: true } },
          projects: { include: { tasks: true, milestones: true } },
        },
      })
      const files = await prisma.linkedFile.findMany({ where: { userId } })

      return {
        user,
        profile,
        conversations,
        insights,
        curriculumPlan: plan,
        tracks,
        files,
        exportedAt: new Date().toISOString(),
      }
    },
  }
}

export const dbStore = {
  forUser(userId: string): DbScopedStore {
    return createDbScopedStore(userId)
  },
}
