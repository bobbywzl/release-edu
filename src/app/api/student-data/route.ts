export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { dbStore } from '@/lib/db-store'
import prisma from '@/lib/prisma'

// Prevent Next.js from caching this route — must always return fresh DB data
import { getUserId, getUserInfo } from '@/lib/get-user-id'
import {
  mockStudent, mockKnowledgeNodes, mockProjects, mockAssignments,
  mockCurriculumPlan, mockProjectModules, mockCoreModules, mockInsights,
  mockCurriculumTracks,
} from '@/lib/mock-data'
import { createDefaultCurriculum, defaultCoreModules, defaultTracks } from '@/lib/default-curriculum'

function safeParseJSON<T>(val: string | null | undefined, fallback: T): T {
  if (!val) return fallback
  try { return JSON.parse(val) as T } catch { return fallback }
}

export async function GET() {
  const cookieStore = await cookies()
  const isDemo = cookieStore.get('demo-mode')?.value === 'true'
  const session = await getServerSession(authOptions)

  const googleUser = session?.user ? {
    name: session.user.name || 'Student',
    email: session.user.email || '',
    image: (session.user as { image?: string }).image || undefined,
  } : null

  // Prefer StudentProfile.displayName (user-set) over Google OAuth User.name
  const userId_ = session?.user ? ((session.user as { id?: string }).id || session.user.email || 'unknown') : null
  let resolvedName = googleUser?.name || 'Student'
  if (userId_ && !isDemo) {
    const [sp_, u_] = await Promise.all([
      prisma.studentProfile.findUnique({ where: { userId: userId_ }, select: { displayName: true } }).catch(() => null),
      prisma.user.findUnique({ where: { id: userId_ }, select: { name: true } }).catch(() => null),
    ])
    resolvedName = sp_?.displayName || u_?.name || googleUser?.name || 'Student'
  }
  if (isDemo || (!isDemo && !googleUser)) {
    return NextResponse.json({
      student: { ...mockStudent, name: isDemo ? 'Jordan Rivera' : 'Student', xp: isDemo ? mockStudent.xp : 0, level: isDemo ? mockStudent.level : 1, streak: isDemo ? mockStudent.streak : 0, stage: isDemo ? mockStudent.stage : 'motivation' },
      knowledgeNodes: mockKnowledgeNodes,
      projects: mockProjects,
      assignments: mockAssignments,
      curriculumPlan: mockCurriculumPlan,
      projectModules: mockProjectModules,
      coreModules: mockCoreModules,
      tracks: mockCurriculumTracks,
      insights: mockInsights,
      isOnboarded: true,
      hasSetupProfile: true,
      hasCurriculum: true,
      manualRegenerationCount: 0,
      manualRegenerationLimit: 2,
    })
  }

  const userId = await getUserId()
  const store = dbStore.forUser(userId)

  // Ensure user record has real Google info
  if (googleUser) {
    await store.getOrCreateUser(googleUser.email, googleUser.name, googleUser.image)
  }

  const plan = await store.getCurriculumPlan()
  const profileForFlags = await store.getProfile()
  const hasCurriculum = !!(plan && plan.tracks.length > 0)
  const profileIsOnboarded = !!profileForFlags?.isOnboarded
  let setupMeta: { name?: string } = {}
  if (profileForFlags?.roadmapState) {
    try { setupMeta = (JSON.parse(profileForFlags.roadmapState as string)?._profileMeta) ?? {} } catch {}
  }
  const hasSetupProfile = !!(profileForFlags?.displayName || setupMeta.name)

  if (hasCurriculum) {
    const profile = profileForFlags
    const insights = await store.getInsights()

    // Parse profile metadata (mentor/parent info from setup)
    let profileMeta: { mentorName?: string; mentorEmail?: string; parentName?: string; parentEmail?: string; organization?: string } = {}
    if (profile?.roadmapState) {
      try { profileMeta = (JSON.parse(profile.roadmapState as string)?._profileMeta) ?? {} } catch {}
    }

    const student = {
      id: profile?.userId ?? userId,
      name: resolvedName,
      email: googleUser?.email || mockStudent.email,
      image: googleUser?.image,
      xp: profile?.xp ?? 0,
      level: Math.floor((profile?.xp ?? 0) / 300) + 1,
      streak: profile?.streak ?? 0,
      stage: (['motivation', 'review', 'self-guided', 'expert-feedback'] as const)[(profile?.learningStage ?? 1) - 1] || 'motivation',
      joinedAt: new Date().toISOString(),
      mentorName: profileMeta.mentorName || null,
      mentorEmail: profileMeta.mentorEmail || null,
      parentName: profileMeta.parentName || null,
      parentEmail: profileMeta.parentEmail || null,
      organization: profileMeta.organization || null,
    }

    // Flatten all modules from all tracks
    let allModules = plan.tracks.flatMap(t => t.modules)

    // If no CurriculumModule rows exist, derive synthetic modules from chapters
    if (allModules.length === 0) {
      allModules = plan.tracks.flatMap(t =>
        ((t as Record<string, unknown>).chapters as Array<{ id: string; title: string; description: string | null; status: string; estimatedMinutes: number | null; keyTopics: string | null; order: number }> || []).map((ch, idx) => ({
          id: ch.id,
          title: ch.title,
          description: ch.description || '',
          type: t.type === 'core' ? 'core-content' : 'project',
          subject: t.name,
          trackId: t.id,
          status: ch.status || 'not-started',
          progress: ch.status === 'completed' ? 100 : ch.status === 'in-progress' ? 30 : 0,
          estimatedHours: Math.ceil((ch.estimatedMinutes || 45) / 60),
          prerequisites: '[]',
          skills: ch.keyTopics || '[]',
          aiRationale: '',
          order: idx,
          // Fields required by CurriculumModule type
          planId: plan.id,
          createdAt: new Date(),
          updatedAt: new Date(),
        }))
      ) as typeof allModules
    }

    const projectModules = allModules.filter(m => m.type === 'project')
    const coreModules = allModules.filter(m => m.type === 'core-content')

    const knowledgeNodes = allModules.map(m => ({
      id: m.id,
      label: m.title,
      subject: m.subject || 'General',
      status: m.status === 'completed' ? 'completed'
        : m.status === 'in-progress' ? 'in-progress'
        : 'available',
      description: m.description,
      estimatedHours: m.estimatedHours,
      resources: [],
      prerequisites: safeParseJSON<string[]>(m.prerequisites, []),
    }))

    // Projects come from SubjectProject records (multiple per track possible)
    const allTrackProjects = await prisma.subjectProject.findMany({
      where: { track: { userId } },
      include: { track: { select: { id: true, name: true, color: true } } },
      orderBy: { createdAt: 'desc' },
    })
    const projects = allTrackProjects.map(sp => ({
      id: sp.id,
      title: sp.title,
      description: sp.description ?? '',
      subject: sp.track.name,
      trackId: sp.track.id,
      trackName: sp.track.name,
      trackColor: sp.track.color || '#3B82F6',
      dbStatus: sp.status,
      status: (sp.status === 'completed' ? 'completed'
        : sp.status === 'in-progress' ? 'active'
        : 'planning') as 'active' | 'planning' | 'completed' | 'paused',
      progress: sp.progress,
      tags: safeParseJSON<string[]>(sp.coverageMap, []).slice(0, 3),
    }))

    const assignments = coreModules.map(m => ({
      id: m.id,
      title: m.title,
      subject: m.subject || 'General',
      description: m.description,
      status: m.status === 'completed' ? 'completed'
        : m.status === 'in-progress' ? 'in-progress'
        : 'not-started',
      competencies: safeParseJSON<string[]>(m.skills, []),
    }))

    // Build curriculum plan shape matching client expectations
    const clientPlan = {
      id: plan.id,
      studentId: userId,
      generatedAt: plan.generatedAt.toISOString?.() ?? plan.generatedAt,
      lastUpdatedAt: plan.lastUpdatedAt.toISOString?.() ?? plan.lastUpdatedAt,
      lockedAt: plan.lockedAt ? (plan.lockedAt.toISOString?.() ?? plan.lockedAt) : null,
      version: plan.version,
      profileSummary: plan.profileSummary,
      primaryStrengths: safeParseJSON<string[]>(plan.primaryStrengths, []),
      primaryInterests: safeParseJSON<string[]>(plan.primaryInterests, []),
      learningStyle: plan.learningStyle,
      personalityTraits: safeParseJSON<string[]>(plan.personalityTraits, []),
      tracks: plan.tracks.map(t => ({
        id: t.id,
        name: t.name,
        description: t.description,
        color: t.color,
        type: t.type,
        modules: t.modules.map(m => m.id),
      })),
      projectModules: projectModules.map(m => ({
        id: m.id,
        title: m.title,
        description: m.description ?? '',
        type: m.type,
        subject: m.subject || 'General',
        trackId: m.trackId,
        status: m.status,
        progress: m.progress,
        estimatedHours: m.estimatedHours,
        prerequisites: safeParseJSON<string[]>(m.prerequisites, []),
        skills: safeParseJSON<string[]>(m.skills, []),
        aiRationale: m.aiRationale ?? '',
      })),
      coreModules: coreModules.map(m => ({
        id: m.id,
        title: m.title,
        description: m.description ?? '',
        type: m.type,
        subject: m.subject || 'General',
        trackId: m.trackId,
        status: m.status,
        progress: m.progress,
        estimatedHours: m.estimatedHours,
        prerequisites: safeParseJSON<string[]>(m.prerequisites, []),
        skills: safeParseJSON<string[]>(m.skills, []),
        aiRationale: m.aiRationale ?? '',
      })),
    }

    // Format insights for client
    const clientInsights = insights.map(i => ({
      id: i.id,
      studentId: i.userId,
      type: i.type,
      content: i.content,
      confidence: i.confidence,
      source: i.source,
      createdAt: i.createdAt.toISOString?.() ?? i.createdAt,
    }))

    return NextResponse.json({
      student,
      knowledgeNodes,
      projects,
      assignments,
      curriculumPlan: clientPlan,
      projectModules: clientPlan.projectModules,
      coreModules: clientPlan.coreModules,
      tracks: clientPlan.tracks,
      insights: clientInsights,
      isOnboarded: true,
      hasSetupProfile: true,
      hasCurriculum: true,
      manualRegenerationCount: profileForFlags?.manualRegenerationCount ?? 0,
      manualRegenerationLimit: 2,
    })
  }

  // No curriculum plan — return defaults
  const defaultPlan = createDefaultCurriculum('new-student')

  const defaultNodes = defaultCoreModules.map(m => ({
    id: m.id,
    label: m.title,
    subject: m.subject || 'General',
    status: 'available',
    description: m.description,
    estimatedHours: m.estimatedHours,
    resources: [],
    prerequisites: m.prerequisites,
  }))

  const defaultAssignments = defaultCoreModules.map(m => ({
    id: m.id,
    title: m.title,
    subject: m.subject || 'General',
    description: m.description,
    status: 'not-started',
    competencies: m.skills,
  }))

  return NextResponse.json({
    student: { ...mockStudent, name: resolvedName, email: googleUser?.email || '', image: googleUser?.image, xp: 0, level: 1, streak: 0, stage: 'motivation' },
    knowledgeNodes: defaultNodes,
    projects: [],
    assignments: defaultAssignments,
    curriculumPlan: defaultPlan,
    projectModules: [],
    coreModules: defaultCoreModules,
    tracks: defaultTracks,
    insights: [],
    isOnboarded: profileIsOnboarded,
    hasSetupProfile,
    hasCurriculum: false,
    manualRegenerationCount: profileForFlags?.manualRegenerationCount ?? 0,
    manualRegenerationLimit: 2,
  })
}
