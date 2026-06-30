/**
 * Student Context Engine
 * Aggregates all student data into a rich context object used to personalize AI responses.
 */

import { dbStore } from '@/lib/db-store'

export interface StudentContext {
  profile: {
    name: string
    age: number | null
    occupation: string | null
    education: string | null
    advancementLevel: string | null // beginner | intermediate | advanced | professional
    learningStage: number // 1-4
    stageName: string
    xp: number
    streak: number
    learningStyle: string | null
    pacePreference: string | null
  }
  progress: {
    overallCompletion: number
    subjectBreakdown: { subject: string; mastery: number }[]
    recentTopics: string[]
    strugglingTopics: string[]
    excellingTopics: string[]
  }
  roadmap: {
    currentNodes: string[]
    completedNodes: string[]
    availableNodes: string[]
    suggestedNext: string[]
  }
  projects: {
    active: { name: string; progress: number; description: string }[]
    completed: { name: string; competencies: string[] }[]
  }
  aspirations: string | null
  interests: string[]
  recentConversationSummary: string | null
  insights: { type: string; content: string; confidence: number; importance: number }[]
}

const STAGE_NAMES: Record<number, string> = {
  1: 'Motivation & Inspiration',
  2: 'Review & Adjustment',
  3: 'Self-Guided Learning',
  4: 'Expert Feedback',
}

function safeParseJSON<T>(str: string | null | undefined, fallback: T): T {
  if (!str) return fallback
  try {
    return JSON.parse(str) as T
  } catch {
    return fallback
  }
}

function computeOverallCompletion(roadmapState: {
  completed?: string[]
  inProgress?: string[]
  available?: string[]
}): number {
  const completed = roadmapState.completed?.length ?? 0
  const inProgress = roadmapState.inProgress?.length ?? 0
  const available = roadmapState.available?.length ?? 0
  const total = completed + inProgress + available
  if (total === 0) return 0
  return Math.round(((completed + inProgress * 0.5) / total) * 100)
}

function deriveSubjectBreakdown(completedNodes: string[]): { subject: string; mastery: number }[] {
  const subjects: Record<string, { completed: number; total: number }> = {
    CS: { completed: 0, total: 10 },
    Math: { completed: 0, total: 6 },
    Psychology: { completed: 0, total: 4 },
    Finance: { completed: 0, total: 4 },
  }

  for (const node of completedNodes) {
    if (node.startsWith('cs-')) subjects.CS.completed++
    else if (node.startsWith('math-')) subjects.Math.completed++
    else if (node.startsWith('psych-')) subjects.Psychology.completed++
    else if (node.startsWith('finance-')) subjects.Finance.completed++
  }

  return Object.entries(subjects).map(([subject, { completed, total }]) => ({
    subject,
    mastery: Math.min(100, Math.round((completed / total) * 100)),
  }))
}

function suggestNext(
  completedNodes: string[],
  availableNodes: string[],
  strengths: string[]
): string[] {
  const completedSet = new Set(completedNodes)
  const strengthStr = strengths.join(' ').toLowerCase()

  const scored = availableNodes.map(node => {
    let score = 0
    if (!completedSet.has(node)) score += 1
    if (node.toLowerCase().split('-').some(part => strengthStr.includes(part))) score += 2
    return { node, score }
  })

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(s => s.node)
}

/**
 * Build student context from database
 */
async function buildContextFromDB(userId: string): Promise<StudentContext> {
  const store = dbStore.forUser(userId)

  const profile = await store.getProfile()
  // Curated memory, not raw rows: active insights only, ranked by
  // importance × confidence × recency × reinforcement (see insight-memory.ts).
  const { getTopInsights } = await import('@/lib/insight-memory')
  const insights = await getTopInsights(userId, { limit: 20 })
  const conversations = await store.getConversations()

  const interests = safeParseJSON<string[]>(profile?.interests, [])
  const strengths = safeParseJSON<string[]>(profile?.strengths, [])
  const weaknesses = safeParseJSON<string[]>(profile?.weaknesses, [])
  const currentProjects = safeParseJSON<string[]>(profile?.currentProjects, [])

  // Pull age + occupation from _profileMeta
  const roadmapRaw = safeParseJSON<{ _profileMeta?: { birthdate?: string; occupation?: string; education?: string; advancementLevel?: string } }>(
    (profile as { roadmapState?: string | null } | null)?.roadmapState ?? null, {}
  )
  const profileMeta = roadmapRaw._profileMeta

  let age: number | null = null
  if (profileMeta?.birthdate) {
    const birth = new Date(profileMeta.birthdate)
    const today = new Date()
    age = today.getFullYear() - birth.getFullYear()
    if (today < new Date(today.getFullYear(), birth.getMonth(), birth.getDate())) age--
  }
  const occupation = profileMeta?.occupation ?? null
  const education = profileMeta?.education ?? null
  const advancementLevel = profileMeta?.advancementLevel ?? null

  const roadmapState = safeParseJSON<{
    completed?: string[]
    inProgress?: string[]
    available?: string[]
  }>(profile?.roadmapState, {})

  const completedNodes = roadmapState.completed ?? []
  const inProgressNodes = roadmapState.inProgress ?? []
  const availableNodes = roadmapState.available ?? []

  // Build recent learning context from actual conversation messages (not just titles)
  // Fetch the last substantive assistant message from the most recent completed/active conversation
  let recentConversationSummary: string | null = null
  try {
    const prismaClient = (await import('@/lib/prisma')).default
    const recentConv = await prismaClient.conversation.findFirst({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      select: {
        title: true,
        messages: {
          where: { role: 'assistant' },
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: { content: true },
        },
      },
    })
    if (recentConv?.messages?.length) {
      // Get last substantive assistant message (skip reflection blocks, skip short messages)
      const lastBobMsg = recentConv.messages.find(m =>
        m.content.length > 100 &&
        !m.content.includes('```reflection')
      )
      if (lastBobMsg) {
        const cleanContent = lastBobMsg.content
          .replace(/```reflection[\s\S]*?```/g, '')
          .replace(/📚 \*\*Syllabus covered:\*\*[\s\S]*$/m, '')
          .trim()
          .slice(0, 350)
        recentConversationSummary = `Most recent chapter: "${recentConv.title}"\nLast content covered: ${cleanContent}…`
      }
    }
  } catch { /* ignore */ }

  // Use StudentProfile.displayName (user-set) first, fall back to User.name (Google OAuth)
  let userName = 'Student'
  try {
    const prismaClient = (await import('@/lib/prisma')).default
    const [profile_, user_] = await Promise.all([
      prismaClient.studentProfile.findUnique({ where: { userId }, select: { displayName: true } }),
      prismaClient.user.findUnique({ where: { id: userId }, select: { name: true } }),
    ])
    userName = profile_?.displayName || user_?.name || 'Student'
  } catch { /* ignore */ }

  return {
    profile: {
      name: userName,
      age,
      occupation,
      education,
      advancementLevel,
      learningStage: profile?.learningStage ?? 1,
      stageName: STAGE_NAMES[profile?.learningStage ?? 1],
      xp: profile?.xp ?? 0,
      streak: profile?.streak ?? 0,
      learningStyle: profile?.learningStyle ?? null,
      pacePreference: profile?.pacePreference ?? null,
    },
    progress: {
      overallCompletion: computeOverallCompletion(roadmapState),
      subjectBreakdown: deriveSubjectBreakdown(completedNodes),
      recentTopics: inProgressNodes.slice(0, 5),
      strugglingTopics: weaknesses,
      excellingTopics: strengths,
    },
    roadmap: {
      currentNodes: inProgressNodes,
      completedNodes,
      availableNodes,
      suggestedNext: suggestNext(completedNodes, availableNodes, strengths),
    },
    projects: {
      active: currentProjects.map(name => ({
        name,
        progress: 50,
        description: '',
      })),
      completed: [],
    },
    aspirations: profile?.aspirations ?? null,
    interests,
    recentConversationSummary,
    insights: insights.map(i => ({ type: i.type, content: i.content, confidence: i.confidence, importance: i.importance })),
  }
}

/**
 * Get student context — always uses DB now
 */
export async function getStudentContext(
  userId: string | null,
  _isDemo: boolean,
  storeUserId?: string
): Promise<StudentContext> {
  const effectiveUserId = storeUserId || userId || 'demo'
  try {
    return await buildContextFromDB(effectiveUserId)
  } catch (err) {
    console.error('Failed to build context from DB:', err)
    // Return minimal empty context on failure
    return {
      profile: {
        name: 'Student',
        age: null,
        occupation: null,
        education: null,
        advancementLevel: null,
        learningStage: 1,
        stageName: STAGE_NAMES[1],
        xp: 0,
        streak: 0,
        learningStyle: null,
        pacePreference: null,
      },
      progress: {
        overallCompletion: 0,
        subjectBreakdown: [],
        recentTopics: [],
        strugglingTopics: [],
        excellingTopics: [],
      },
      roadmap: {
        currentNodes: [],
        completedNodes: [],
        availableNodes: [],
        suggestedNext: [],
      },
      projects: { active: [], completed: [] },
      aspirations: null,
      interests: [],
      recentConversationSummary: null,
      insights: [],
    }
  }
}
