export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getUserCompletionStats } from '@/lib/status-cascade'
import { getUserId } from '@/lib/get-user-id'
import { mockProjectModules, mockCoreModules, mockCurriculumTracks } from '@/lib/mock-data'

export async function GET() {
  const cookieStore = await cookies()
  const isDemo = cookieStore.get('demo-mode')?.value === 'true'

  if (isDemo) {
    const allModules = [...mockProjectModules, ...mockCoreModules]
    const completed = allModules.filter(m => m.status === 'completed').length
    const total = allModules.length
    const FOUNDATION_TYPES = ['core', 'core-content', 'foundation']

    const tracks = mockCurriculumTracks.map((t, i) => {
      const mods = allModules.filter(m => m.trackId === t.id)
      const tCompleted = mods.filter(m => m.status === 'completed').length
      const type = t.id === 'track-core' ? 'core' : 'project'
      return {
        trackId: t.id, trackName: t.name, trackType: type, trackColor: t.color,
        total: mods.length, completed: tCompleted, inProgress: mods.filter(m => m.status === 'in-progress').length,
        progress: mods.length ? Math.round(tCompleted / mods.length * 100) : 0,
        status: tCompleted === mods.length ? 'completed' : tCompleted > 0 ? 'in-progress' : 'not-started',
      }
    })

    return NextResponse.json({
      overall: { progress: Math.round(completed / total * 100), completed, total, completedProjects: 2, totalProjects: 8, curriculumComplete: false },
      tracks,
      interestTracks: tracks.filter(t => !FOUNDATION_TYPES.includes(t.trackType)),
      foundationTracks: tracks.filter(t => FOUNDATION_TYPES.includes(t.trackType)),
      pendingChapters: allModules.filter(m => m.status !== 'completed').map(m => ({ id: m.id, title: m.title, status: m.status, trackId: m.trackId ?? '', trackName: '' })),
      completedChapters: allModules.filter(m => m.status === 'completed').map(m => ({ id: m.id, title: m.title, status: m.status, trackId: m.trackId ?? '', trackName: '' })),
    })
  }

  const userId = await getUserId()
  const stats = await getUserCompletionStats(userId)
  return NextResponse.json(stats)
}
