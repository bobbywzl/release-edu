import prisma from '@/lib/prisma'
import { awardXp, type XpSource } from '@/lib/xp-engine'

export type ChapterStatus = 'not-started' | 'in-progress' | 'completed'
export type TrackStatus = 'not-started' | 'in-progress' | 'completed'

/**
 * The ONLY way to update chapter status. Cascades automatically.
 * No AI. Pure if-then logic.
 */
/** XP awards pending from the last status change — read by the client via headers */
let lastXpAwards: Array<{ awarded: number; source: XpSource; label: string; levelUp: boolean; newLevel: number }> = []
export function consumeLastXpAwards() {
  const awards = lastXpAwards
  lastXpAwards = []
  return awards
}

export async function setChapterStatus(
  chapterId: string,
  status: ChapterStatus,
): Promise<void> {
  // 1. Update the chapter — stamp startedAt/completedAt as the status crosses
  //    each threshold for the first time. Idempotent: re-completing won't
  //    overwrite the original timestamp (kept as the historical "first done").
  const existing = await prisma.chapter.findUnique({
    where: { id: chapterId },
    select: { startedAt: true, completedAt: true },
  })
  const now = new Date()
  const data: { status: ChapterStatus; startedAt?: Date; completedAt?: Date | null } = { status }
  if ((status === 'in-progress' || status === 'completed') && !existing?.startedAt) {
    data.startedAt = now
  }
  if (status === 'completed' && !existing?.completedAt) {
    data.completedAt = now
  }
  // Reverting to not-started clears completedAt so the next completion stamps fresh.
  if (status === 'not-started' && existing?.completedAt) {
    data.completedAt = null
  }
  const chapter = await prisma.chapter.update({
    where: { id: chapterId },
    data,
    include: { track: true },
  })

  // 2. Award XP for chapter completion
  if (status === 'completed' && chapter.track) {
    const xpResult = await awardXp(chapter.track.userId, 'chapter_completed', {
      sessionScore: chapter.sessionScore ?? 70,
    })
    if (xpResult) lastXpAwards.push(xpResult)
  }

  // 3. Recalculate track status based on ALL chapters in this track
  await recalculateTrackStatus(chapter.trackId)
}

export async function recalculateTrackStatus(trackId: string): Promise<void> {
  const chapters = await prisma.chapter.findMany({
    where: { trackId },
    select: { status: true, sessionScore: true },
  })

  if (chapters.length === 0) return

  const completedCount = chapters.filter(c => c.status === 'completed').length
  const inProgressCount = chapters.filter(c => c.status === 'in-progress').length
  // Weighted progress: completed chapters count as 100, in-progress use sessionScore
  const totalScore = chapters.reduce((sum, c) => {
    if (c.status === 'completed') return sum + 100
    return sum + (c.sessionScore ?? 0)
  }, 0)
  const progress = Math.round(totalScore / chapters.length)

  // Pure if-then — no AI
  let trackStatus: TrackStatus
  if (completedCount === chapters.length) {
    trackStatus = 'completed'
  } else if (inProgressCount > 0 || completedCount > 0) {
    trackStatus = 'in-progress'
  } else {
    trackStatus = 'not-started'
  }

  const oldTrack = await prisma.track.findUnique({
    where: { id: trackId },
    select: { trackStatus: true, userId: true, completedAt: true },
  })

  // Stamp completedAt the first time the track flips to completed.
  const trackData: { progress: number; trackStatus: TrackStatus; completedAt?: Date | null } = { progress, trackStatus }
  if (trackStatus === 'completed' && !oldTrack?.completedAt) {
    trackData.completedAt = new Date()
  } else if (trackStatus !== 'completed' && oldTrack?.completedAt) {
    trackData.completedAt = null  // un-complete clears the stamp
  }
  await prisma.track.update({ where: { id: trackId }, data: trackData })

  // Award XP for track completion (only on transition TO completed)
  if (trackStatus === 'completed' && oldTrack?.trackStatus !== 'completed' && oldTrack?.userId) {
    const xpResult = await awardXp(oldTrack.userId, 'track_completed')
    if (xpResult) lastXpAwards.push(xpResult)
  }

  // If every track for this user is completed, stamp the curriculum plan too.
  const userId = oldTrack?.userId
  if (userId) {
    await prisma.curriculumPlan.updateMany({
      where: { userId },
      data: { lastUpdatedAt: new Date() },
    })
    if (trackStatus === 'completed') {
      const userTracks = await prisma.track.findMany({
        where: { userId },
        select: { trackStatus: true },
      })
      if (userTracks.length > 0 && userTracks.every(t => t.trackStatus === 'completed')) {
        await prisma.curriculumPlan.updateMany({
          where: { userId, completedAt: null },
          data: { completedAt: new Date() },
        })
      }
    }
  }
}

/**
 * Get completion stats for a user — pure computation from chapter statuses.
 * Used by Progress, Portfolio, Assignments pages.
 */
export async function getUserCompletionStats(userId: string) {
  const tracks = await prisma.track.findMany({
    where: { userId },
    include: {
      chapters: {
        select: { id: true, title: true, status: true, sessionScore: true },
        orderBy: { order: 'asc' },
      },
      projects: {
        select: { id: true, title: true, status: true, progress: true },
      },
    },
  })

  const trackStats = tracks.map(track => {
    const chapters = track.chapters
    const projects = track.projects

    const totalChaps = chapters.length
    const completedChaps = chapters.filter(c => c.status === 'completed').length
    const inProgress = chapters.filter(c => c.status === 'in-progress').length

    // Chapter score (weighted by sessionScore for in-progress)
    const chapScore = chapters.reduce((sum, c) => {
      if (c.status === 'completed') return sum + 100
      return sum + (c.sessionScore ?? 0)
    }, 0)

    // Projects count as extra "units" per track
    const completedProjectCount = projects.filter(p => p.status === 'completed').length
    const projectScore = projects.reduce((sum, p) => {
      return sum + (p.status === 'completed' ? 100 : (p.progress ?? 0))
    }, 0)

    const totalUnits = totalChaps + projects.length
    const totalScore = chapScore + projectScore
    const progress = totalUnits > 0 ? Math.round(totalScore / totalUnits) : 0

    const chapsDone = completedChaps === totalChaps && totalChaps > 0
    const projectsDone = projects.length === 0 || completedProjectCount === projects.length
    const isComplete = chapsDone && projectsDone
    const anyProjectProgress = projects.some(p => (p.progress ?? 0) > 0)

    return {
      trackId: track.id,
      trackName: track.name,
      trackType: track.type,
      trackColor: track.color,
      total: totalChaps,
      completed: completedChaps,
      inProgress,
      progress,
      hasProject: projects.length > 0,
      projectCompleted: projects.length > 0 && completedProjectCount === projects.length,
      status: (isComplete
        ? 'completed'
        : inProgress > 0 || completedChaps > 0 || anyProjectProgress
          ? 'in-progress'
          : 'not-started') as TrackStatus,
    }
  })

  const allChapters = tracks.flatMap(t =>
    t.chapters.map(c => ({ ...c, trackId: t.id, trackName: t.name })),
  )
  const totalChapters = allChapters.length
  const completedChapters = allChapters.filter(c => c.status === 'completed').length

  // Overall progress includes chapters + projects
  const allProjects = tracks.flatMap(t => t.projects)
  const completedProjects = allProjects.filter(p => p.status === 'completed').length
  const totalUnits = totalChapters + allProjects.length

  const chapScore = allChapters.reduce((sum, c) => {
    if (c.status === 'completed') return sum + 100
    return sum + (c.sessionScore ?? 0)
  }, 0)
  const projScore = allProjects.reduce((sum, p) => {
    if (p.status === 'completed') return sum + 100
    return sum + (p.progress ?? 0)
  }, 0)
  const overallProgress = totalUnits > 0 ? Math.round((chapScore + projScore) / totalUnits) : 0

  const FOUNDATION_TYPES = ['core', 'core-content', 'foundation']
  const interestStats = trackStats.filter(t => !FOUNDATION_TYPES.includes(t.trackType))
  const foundationStats = trackStats.filter(t => FOUNDATION_TYPES.includes(t.trackType))

  return {
    overall: {
      progress: overallProgress,
      completed: completedChapters,
      total: totalChapters,
      completedProjects,
      totalProjects: allProjects.length,
      // Curriculum is truly complete when all chapters done AND at least one project completed
      curriculumComplete: completedChapters === totalChapters && totalChapters > 0 && completedProjects > 0,
    },
    tracks: trackStats,
    interestTracks: interestStats,
    foundationTracks: foundationStats,
    pendingChapters: allChapters.filter(c => c.status !== 'completed'),
    completedChapters: allChapters.filter(c => c.status === 'completed'),
  }
}
