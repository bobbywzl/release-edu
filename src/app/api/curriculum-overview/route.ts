export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getUserId } from '@/lib/get-user-id'
import prisma from '@/lib/prisma'
import { mockProjectModules, mockCoreModules, mockCurriculumTracks } from '@/lib/mock-data'

export async function GET() {
  const cookieStore = await cookies()
  const isDemo = cookieStore.get('demo-mode')?.value === 'true'

  if (isDemo) {
    const modulesByTrack: Record<string, typeof mockProjectModules> = {}
    for (const m of [...mockProjectModules, ...mockCoreModules]) {
      if (m.trackId) {
        if (!modulesByTrack[m.trackId]) modulesByTrack[m.trackId] = []
        modulesByTrack[m.trackId].push(m)
      }
    }
    const tracks = mockCurriculumTracks.map((t, i) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      color: t.color,
      type: t.id === 'track-core' ? 'core' : 'project',
      order: i,
      chapters: (modulesByTrack[t.id] ?? []).map(m => ({
        id: m.id,
        title: m.title,
        status: m.status,
        estimatedMinutes: m.estimatedHours * 60,
        sessionScore: null,
      })),
      homeworkCount: 0,
      completedHomeworkCount: 0,
      quizCount: 0,
      completedQuizCount: 0,
      projectStatus: null,
    }))
    return NextResponse.json({ tracks })
  }

  const userId = await getUserId()

  // Single query — fetch all tracks with chapters, homework, quizzes, projects
  const tracks = await prisma.track.findMany({
    where: { userId },
    orderBy: { order: 'asc' },
    include: {
      chapters: { orderBy: { order: 'asc' }, select: { id: true, title: true, status: true, estimatedMinutes: true, sessionScore: true } },
      homeworks: { select: { id: true, status: true } },
      quizzes: { select: { id: true, status: true } },
      projects: { select: { status: true } },
    },
  })

  const result = tracks.map(track => ({
    id: track.id,
    name: track.name,
    description: track.description,
    color: track.color,
    type: track.type,
    order: track.order,
    chapters: track.chapters,
    homeworkCount: track.homeworks.length,
    completedHomeworkCount: track.homeworks.filter(h => h.status === 'completed').length,
    quizCount: track.quizzes.length,
    completedQuizCount: track.quizzes.filter(q => q.status === 'completed').length,
    projectStatus: track.projects[0]?.status || null,
  }))

  return NextResponse.json({ tracks: result })
}
