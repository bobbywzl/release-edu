/**
 * XP Engine — The authoritative scoring system for Release EDU.
 *
 * Design principles:
 * - XP is EARNED, never given freely. Every point is traceable to a real action.
 * - Quality matters: higher session scores = more XP. Rushing through = less.
 * - Consistency is rewarded: streaks multiply earnings.
 * - Difficulty is rewarded: harder chapters and higher-level content = more XP.
 * - Time investment matters: but only productive time, not idle time.
 *
 * XP Sources & Weights:
 * ┌──────────────────────────┬───────────┬─────────────────────────────────┐
 * │ Source                   │ Base XP   │ Scaling                         │
 * ├──────────────────────────┼───────────┼─────────────────────────────────┤
 * │ Chapter completed        │ 100       │ × score multiplier (0.5–1.5)   │
 * │ Quiz correct answer      │ 15        │ × difficulty (short=1, mcq=0.8)│
 * │ Capstone problem passed  │ 200       │ × score/100                    │
 * │ Track completed          │ 500       │ flat bonus                     │
 * │ Daily login streak       │ 10–50     │ scales with streak length      │
 * │ First session of the day │ 25        │ flat                           │
 * │ Quality conversation     │ 5         │ per meaningful exchange (cap 50)│
 * │ Highlight/annotation     │ 3         │ per highlight (cap 30/day)     │
 * │ Project milestone        │ 75        │ per milestone completed        │
 * │ Project completed        │ 400       │ flat bonus                     │
 * └──────────────────────────┴───────────┴─────────────────────────────────┘
 *
 * Score multiplier = sessionScore / 80, clamped [0.5, 1.5]
 * At 80% score you get 1× (base). Below = less. Above = bonus.
 *
 * Streak multiplier: 1.0 + min(streak / 100, 0.5)
 * At 0 streak: 1.0×. At 50 streak: 1.25×. At 100+: 1.5× (capped).
 *
 * Level curve: level = floor(sqrt(xp / 100)) + 1
 * Level 1:  0 XP      Level 10: 8,100 XP
 * Level 20: 36,100 XP Level 50: 240,100 XP
 */

import prisma from '@/lib/prisma'

// ── XP Award Types ──

export type XpSource =
  | 'chapter_completed'
  | 'quiz_correct'
  | 'capstone_passed'
  | 'track_completed'
  | 'daily_streak'
  | 'first_session'
  | 'conversation'
  | 'highlight'
  | 'project_milestone'
  | 'project_completed'
  | 'perseverance'

interface XpAwardResult {
  awarded: number
  source: XpSource
  label: string
  newTotal: number
  levelUp: boolean
  newLevel: number
}

// ── Core Calculation ──

function getStreakMultiplier(streak: number): number {
  return 1.0 + Math.min(streak / 100, 0.5)
}

function getScoreMultiplier(sessionScore: number): number {
  return Math.max(0.5, Math.min(1.5, sessionScore / 80))
}

function getLevel(xp: number): number {
  return Math.floor(Math.sqrt(xp / 100)) + 1
}

// ── XP Calculation per Source ──

const XP_TABLE: Record<XpSource, { base: number; label: string }> = {
  chapter_completed:   { base: 100, label: 'Chapter Completed' },
  quiz_correct:        { base: 15,  label: 'Quiz Correct' },
  capstone_passed:     { base: 200, label: 'Capstone Passed' },
  track_completed:     { base: 500, label: 'Track Completed' },
  daily_streak:        { base: 10,  label: 'Daily Streak' },
  first_session:       { base: 25,  label: 'First Session Today' },
  conversation:        { base: 5,   label: 'Learning Exchange' },
  highlight:           { base: 3,   label: 'Annotation' },
  project_milestone:   { base: 75,  label: 'Project Milestone' },
  project_completed:   { base: 400, label: 'Project Completed' },
  // Perseverance: awarded when the student keeps engaging after wrong answers.
  // The point is to make struggle visibly rewarded — getting things wrong is
  // part of learning, and the system should reinforce continued effort, not
  // just correct answers. Tier scaled by streakWrong: see calculateXp.
  perseverance:        { base: 10,  label: 'Perseverance' },
}

export function calculateXp(
  source: XpSource,
  opts: {
    sessionScore?: number  // 0-100
    streak?: number
    streakDays?: number    // for daily_streak scaling
    difficulty?: number    // 0-1 multiplier
    streakWrong?: number   // for perseverance: how many wrongs in a row
  } = {}
): number {
  const entry = XP_TABLE[source]
  let xp = entry.base
  const streak = opts.streak ?? 0

  switch (source) {
    case 'chapter_completed':
      xp *= getScoreMultiplier(opts.sessionScore ?? 70)
      break
    case 'quiz_correct':
      xp *= (opts.difficulty ?? 1)
      break
    case 'capstone_passed':
      xp *= (opts.sessionScore ?? 70) / 100
      break
    case 'daily_streak': {
      // Scales: 10 at day 1, up to 50 at day 30+
      const days = opts.streakDays ?? streak
      xp = Math.min(50, 10 + Math.floor(days / 3) * 5)
      break
    }
    case 'conversation':
    case 'highlight':
    case 'first_session':
    case 'project_milestone':
    case 'project_completed':
    case 'track_completed':
      // Base value, no special scaling
      break
    case 'perseverance': {
      // Scales with streakWrong: more grit = more reward.
      //   2 wrongs in a row → 10 XP  (base)
      //   3 wrongs          → 15 XP
      //   4+ wrongs         → 20 XP (capped)
      // Awarded ONCE per streak-wrong tier crossing (not every turn).
      const sw = opts.streakWrong ?? 0
      if (sw < 2) { xp = 0; break }
      if (sw === 2) xp = 10
      else if (sw === 3) xp = 15
      else xp = 20
      break
    }
  }

  // Apply streak multiplier to all sources
  xp *= getStreakMultiplier(streak)

  return Math.round(xp)
}

// ── Award XP (writes to DB) ──

export async function awardXp(
  userId: string,
  source: XpSource,
  opts: {
    sessionScore?: number
    streak?: number
    streakDays?: number
    difficulty?: number
    streakWrong?: number
  } = {}
): Promise<XpAwardResult | null> {
  const profile = await prisma.studentProfile.findUnique({
    where: { userId },
    select: { xp: true, streak: true },
  })
  if (!profile) return null

  const currentStreak = opts.streak ?? profile.streak
  const awarded = calculateXp(source, { ...opts, streak: currentStreak })
  if (awarded <= 0) return null

  const oldLevel = getLevel(profile.xp)
  const newTotal = profile.xp + awarded
  const newLevel = getLevel(newTotal)

  await prisma.studentProfile.update({
    where: { userId },
    data: { xp: newTotal },
  })

  return {
    awarded,
    source,
    label: XP_TABLE[source].label,
    newTotal,
    levelUp: newLevel > oldLevel,
    newLevel,
  }
}

// ── Batch award (for multiple XP events at once) ──

export async function awardXpBatch(
  userId: string,
  awards: Array<{ source: XpSource; opts?: Parameters<typeof calculateXp>[1] }>
): Promise<XpAwardResult[]> {
  const profile = await prisma.studentProfile.findUnique({
    where: { userId },
    select: { xp: true, streak: true },
  })
  if (!profile) return []

  let runningTotal = profile.xp
  const results: XpAwardResult[] = []

  for (const { source, opts } of awards) {
    const awarded = calculateXp(source, { ...opts, streak: profile.streak })
    if (awarded <= 0) continue

    const oldLevel = getLevel(runningTotal)
    runningTotal += awarded
    const newLevel = getLevel(runningTotal)

    results.push({
      awarded,
      source,
      label: XP_TABLE[source].label,
      newTotal: runningTotal,
      levelUp: newLevel > oldLevel,
      newLevel,
    })
  }

  if (results.length > 0) {
    await prisma.studentProfile.update({
      where: { userId },
      data: { xp: runningTotal },
    })
  }

  return results
}

// ── Daily streak update ──

export async function updateStreak(userId: string): Promise<{ streak: number; xpAwarded: XpAwardResult | null }> {
  const profile = await prisma.studentProfile.findUnique({
    where: { userId },
    select: { streak: true, updatedAt: true, xp: true },
  })
  if (!profile) return { streak: 0, xpAwarded: null }

  const lastActive = profile.updatedAt
  const now = new Date()
  const lastDate = lastActive.toDateString()
  const todayDate = now.toDateString()

  if (lastDate === todayDate) {
    // Already active today — no streak update
    return { streak: profile.streak, xpAwarded: null }
  }

  // Check if yesterday
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  const isConsecutive = lastDate === yesterday.toDateString()

  const newStreak = isConsecutive ? profile.streak + 1 : 1

  await prisma.studentProfile.update({
    where: { userId },
    data: { streak: newStreak },
  })

  // Award streak XP
  const xpAwarded = await awardXp(userId, 'daily_streak', { streakDays: newStreak, streak: newStreak })

  return { streak: newStreak, xpAwarded }
}
