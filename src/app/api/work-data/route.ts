import { NextRequest, NextResponse } from 'next/server'
import { dbStore } from '@/lib/db-store'
import { getUserId } from '@/lib/get-user-id'

function safeParseJSON<T>(val: string | null | undefined, fallback: T): T {
  if (!val) return fallback
  try { return JSON.parse(val) as T } catch { return fallback }
}

// Transform DB chapter to client shape
function transformChapter(ch: { id: string; trackId: string; title: string; description: string | null; content: string | null; status: string; estimatedMinutes: number; keyTopics: string | null; order: number; sessionConvId?: string | null }) {
  return {
    id: ch.id,
    trackId: ch.trackId,
    title: ch.title,
    description: ch.description ?? '',
    order: ch.order,
    status: ch.status,
    content: ch.content ?? '',
    estimatedMinutes: ch.estimatedMinutes,
    keyTopics: safeParseJSON<string[]>(ch.keyTopics, []),
    sessionConvId: ch.sessionConvId ?? null,
  }
}

// Transform DB homework to client shape
function transformHomework(hw: { id: string; trackId: string; chapterId: string | null; title: string; description: string | null; instructions: string | null; status: string; competencies: string | null; estimatedMinutes: number }) {
  return {
    id: hw.id,
    trackId: hw.trackId,
    chapterId: hw.chapterId ?? undefined,
    title: hw.title,
    description: hw.description ?? '',
    instructions: hw.instructions ?? '',
    status: hw.status,
    competencies: safeParseJSON<string[]>(hw.competencies, []),
    estimatedMinutes: hw.estimatedMinutes,
  }
}

// Transform DB quiz to client shape
function transformQuiz(q: { id: string; trackId: string; chapterId: string | null; title: string; description: string | null; status: string; score: number | null; totalPoints: number; timeLimit: number | null; completedAt: Date | null; questions: Array<{ id: string; question: string; type: string; options: string | null; correctAnswer: string | null; explanation: string | null; points: number }> }) {
  return {
    id: q.id,
    trackId: q.trackId,
    chapterId: q.chapterId ?? undefined,
    title: q.title,
    description: q.description ?? '',
    status: q.status,
    score: q.score ?? undefined,
    totalPoints: q.totalPoints,
    completedAt: q.completedAt?.toISOString() ?? undefined,
    timeLimit: q.timeLimit ?? undefined,
    questions: q.questions.map(qq => ({
      id: qq.id,
      question: qq.question,
      type: qq.type,
      options: safeParseJSON<string[]>(qq.options, []),
      correctAnswer: qq.correctAnswer ?? undefined,
      explanation: qq.explanation ?? '',
      points: qq.points,
    })),
  }
}

// Transform DB project to client shape
function transformProject(p: { id: string; trackId: string; title: string; description: string | null; proposal: string | null; status: string; progress: number; coverageMap: string | null; mentorFeedback: string | null; tasks: Array<{ id: string; title: string; completed: boolean; order: number }>; milestones: Array<{ id: string; title: string; date: Date | null; completed: boolean }> }) {
  return {
    id: p.id,
    trackId: p.trackId,
    title: p.title,
    description: p.description ?? '',
    proposal: p.proposal ?? '',
    status: p.status,
    progress: p.progress,
    tasks: p.tasks,
    milestones: p.milestones.map(m => ({
      ...m,
      date: m.date ?? new Date(),
    })),
    coverageMap: safeParseJSON<string[]>(p.coverageMap, []),
    mentorFeedback: p.mentorFeedback ?? undefined,
  }
}

export async function GET(req: NextRequest) {
  const userId = await getUserId()
  const store = dbStore.forUser(userId)

  const trackId = req.nextUrl.searchParams.get('trackId')

  if (trackId) {
    const [syllabus, homework, quizzes, project] = await Promise.all([
      store.getSyllabus(trackId),
      store.getHomework(trackId),
      store.getQuizzes(trackId),
      store.getProject(trackId),
    ])

    return NextResponse.json({
      syllabus: syllabus ? {
        trackId,
        title: syllabus.title,
        description: syllabus.description,
        chapters: syllabus.chapters.map(transformChapter),
      } : null,
      homework: homework.map(transformHomework),
      quizzes: quizzes.map(transformQuiz),
      project: project ? transformProject(project) : null,
    })
  }

  const [syllabi, homework, quizzes, projects] = await Promise.all([
    store.getAllSyllabi(),
    store.getAllHomework(),
    store.getAllQuizzes(),
    store.getAllProjects(),
  ])

  // Transform to client shapes
  const clientSyllabi: Record<string, unknown> = {}
  for (const [id, s] of Object.entries(syllabi)) {
    clientSyllabi[id] = {
      trackId: s.trackId,
      title: s.title,
      description: s.description,
      chapters: s.chapters.map(transformChapter),
    }
  }

  const clientHomework: Record<string, unknown[]> = {}
  for (const [id, hws] of Object.entries(homework)) {
    clientHomework[id] = hws.map(transformHomework)
  }

  const clientQuizzes: Record<string, unknown[]> = {}
  for (const [id, qs] of Object.entries(quizzes)) {
    clientQuizzes[id] = qs.map(transformQuiz)
  }

  const clientProjects: Record<string, unknown> = {}
  for (const [id, p] of Object.entries(projects)) {
    clientProjects[id] = transformProject(p)
  }

  return NextResponse.json({
    syllabi: clientSyllabi,
    homework: clientHomework,
    quizzes: clientQuizzes,
    projects: clientProjects,
  })
}
