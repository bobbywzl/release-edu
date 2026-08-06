export const dynamic = 'force-dynamic'

/**
 * GET /api/xp/summary — everything the XP panel + portfolio achievements need
 * in one call: level/rank, progress into the level, today's XP vs the daily
 * goal, streak state (incl. whether today is still "at risk"), and badges.
 *
 * Also runs the lazy badge evaluator, so badges earned since the last visit
 * are awarded here and returned as `newBadges` for the client to celebrate
 * (unlock overlay + chime).
 */
import { NextResponse } from 'next/server'
import { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { getUserId } from '@/lib/get-user-id'
import { DAILY_GOAL_XP, getRank, getLevelForXp, userDayKey } from '@/lib/xp-engine'
import { BADGES, evaluateAndAwardBadges, getBadgeStats } from '@/lib/badges'

export async function GET(req: NextRequest) {
  const userId = await getUserId()

  const profile = await prisma.studentProfile.findUnique({ where: { userId } }).catch(() => null)
  const xp = profile?.xp ?? 0
  const streak = profile?.streak ?? 0
  const level = getLevelForXp(xp)
  const rank = getRank(level)

  // Level progress: XP into the current level vs. the level's width.
  const levelFloor = Math.pow(level - 1, 2) * 100
  const levelCeil = Math.pow(level, 2) * 100
  const levelProgress = Math.min(1, (xp - levelFloor) / Math.max(1, levelCeil - levelFloor))

  // Daily goal ring (schema-lag safe: fields may not exist yet → 0).
  // "Today" is the USER's calendar day (their stored timezone) — the same
  // boundary the streak and bumpDailyXp use — so the ring never resets at
  // the server's midnight while the flame still says "checked in".
  const p = profile as {
    dailyXp?: number; dailyXpDate?: Date | null; dailyXpDay?: string | null
    longestStreak?: number; lastCheckinDay?: string | null; timeZone?: string | null
  } | null
  const today = userDayKey(new Date(), p?.timeZone ?? undefined)
  const xpToday = p?.dailyXpDay
    ? (p.dailyXpDay === today ? (p.dailyXp ?? 0) : 0)
    // Rollout fallback: rows bumped before dailyXpDay existed.
    : (p?.dailyXpDate && userDayKey(new Date(p.dailyXpDate), p?.timeZone ?? undefined) === today ? (p?.dailyXp ?? 0) : 0)
  // "Active today" drives streak-at-risk messaging (loss aversion à la Duolingo).
  const activeToday = xpToday > 0 || p?.lastCheckinDay === today
    || (profile?.updatedAt && userDayKey(new Date(profile.updatedAt), p?.timeZone ?? undefined) === today) === true

  // Badges: award anything newly crossed, then return the full board.
  // READ-ONLY MODE (?readonly=1): display surfaces that can't celebrate
  // (portfolio, print) must never CONSUME an unseen unlock — each badge
  // returns as "new" exactly once, so awarding it on a surface that discards
  // newBadges would swallow the celebration forever (satisfaction audit #2).
  const readonly = req.nextUrl.searchParams.get('readonly') === '1'
  const newBadges = readonly ? [] : await evaluateAndAwardBadges(userId)
  let earnedRows: Array<{ badgeId: string; earnedAt: Date; featured: boolean }> = []
  try {
    earnedRows = await prisma.userBadge.findMany({
      where: { userId },
      select: { badgeId: true, earnedAt: true, featured: true },
      orderBy: { earnedAt: 'desc' },
    })
  } catch { /* schema lag */ }
  const earnedById = new Map(earnedRows.map(r => [r.badgeId, r]))
  const stats = await getBadgeStats(userId)

  // Legacy Release EDU ladders (chapters/courses/projects) are unearnable in
  // the Tree product — hide them unless the user actually carries legacy
  // progress or already earned the badge (earned trophies are never hidden).
  const legacyMetrics = new Set<keyof typeof stats>(['chaptersCompleted', 'tracksCompleted', 'projectsCompleted'])
  const visibleBadges = BADGES.filter(b =>
    earnedById.has(b.id) || !legacyMetrics.has(b.metric) || stats[b.metric] > 0)

  const badges = visibleBadges.map(b => {
    const row = earnedById.get(b.id)
    return {
      id: b.id,
      tier: b.tier,
      icon: b.icon,
      name: b.name,
      desc: b.desc,
      target: b.target,
      current: Math.min(stats[b.metric], b.target),
      earned: !!row,
      earnedAt: row?.earnedAt ?? null,
      featured: row?.featured ?? false,
    }
  })

  return NextResponse.json({
    xp,
    level,
    rank,
    levelProgress,
    xpToday,
    dailyGoal: DAILY_GOAL_XP,
    streak,
    longestStreak: Math.max(p?.longestStreak ?? 0, streak),
    activeToday,
    badges,
    newBadges: newBadges.map(b => ({ id: b.id, tier: b.tier, icon: b.icon, name: b.name, desc: b.desc })),
  })
}
