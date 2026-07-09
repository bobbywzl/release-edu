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
  | 'objective_mastered'
  | 'quiz_attempt'
  | 'combo_bonus'

interface XpAwardResult {
  awarded: number
  source: XpSource
  label: string
  newTotal: number
  levelUp: boolean
  newLevel: number
  // Rank progression: rankUp = crossed a division or tier boundary; tierUp =
  // reached a whole new tier (the epic celebration). rank carries the new
  // rank so the client can theme the overlay + escalate the sound.
  rankUp: boolean
  tierUp: boolean
  rank: RankInfo
}

/** Compute the rank-progression fields for a level transition. */
function rankTransition(oldLevel: number, newLevel: number): { rankUp: boolean; tierUp: boolean; rank: RankInfo } {
  const from = getRank(oldLevel)
  const to = getRank(newLevel)
  return {
    rankUp: from.key !== to.key || from.division !== to.division,
    tierUp: from.tier !== to.tier,
    rank: to,
  }
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
  // Objective mastered: the smallest visible unit of syllabus progress — the
  // deterministic progress bar advancing IS this event. Rewarding it makes
  // every step of a lesson land with a ding, not just chapter completion.
  objective_mastered:  { base: 20,  label: 'Objective Mastered' },
  // Quiz attempt: a WRONG checkpoint answer still earns a little — trying is
  // participation, and a zero-reward wrong answer teaches quitting, not grit.
  quiz_attempt:        { base: 5,   label: 'Attempt Made' },
  // Combo bonus: consecutive correct checkpoint answers pay escalating
  // surprise bonuses at 3 / 5 / 10 — the variable-reward spike that makes
  // "one more question" irresistible. Tiers in calculateXp.
  combo_bonus:         { base: 10,  label: 'Combo' },
}

// ── Daily goal + ranks (retention layer) ──

// Duolingo-style daily target: reachable in one honest lesson session
// (~2 quiz answers + 1 objective), so "goal met" is a daily habit, not a chore.
export const DAILY_GOAL_XP = 60

// FPS-style competitive rank ladder (Valorant/CS grammar): 8 escalating
// TIERS, each split into 3 divisions (III→II→I) so a promotion — the dopamine
// hit — is always within a level or two. The top tier (Radiant) is
// undivided. Every tier carries its own color + emblem + a `vfx` intensity
// (0..1) that drives how grand the rank-up sound and animation get: climbing
// the ladder should *feel* louder and shinier. Ranks derive purely from level
// (no schema), and appear on the dashboard and the portfolio.
export interface RankTier {
  key: string
  minLevel: number
  en: string
  zh: string
  color: string   // emblem/name color (hex)
  glow: string    // rgba glow for auras/shadows
  emblem: string  // emoji emblem (self-contained, no assets)
  vfx: number     // 0..1 grandeur scalar for sound + animation
}

// The journey of a mind, not a metal shelf: eight learning-themed titles that
// climb from a first sprout of curiosity to transcendence, on an ascending
// color spectrum (green → cyan → blue → indigo → violet → gold → fuchsia →
// radiant). Each is a distinct, exciting rank to reach.
const TIERS: RankTier[] = [
  { key: 'rookie',       minLevel: 1,  en: 'Rookie',       zh: '新秀',   color: '#6EE7B7', glow: 'rgba(110,231,183,0.5)',  emblem: '🌱', vfx: 0.0 },
  { key: 'seeker',       minLevel: 4,  en: 'Seeker',       zh: '探索者', color: '#22D3EE', glow: 'rgba(34,211,238,0.55)',  emblem: '🧭', vfx: 0.14 },
  { key: 'scholar',      minLevel: 8,  en: 'Scholar',      zh: '学者',   color: '#60A5FA', glow: 'rgba(96,165,250,0.55)',  emblem: '📖', vfx: 0.28 },
  { key: 'prodigy',      minLevel: 13, en: 'Prodigy',      zh: '奇才',   color: '#818CF8', glow: 'rgba(129,140,248,0.6)',  emblem: '⚡', vfx: 0.42 },
  { key: 'virtuoso',     minLevel: 19, en: 'Virtuoso',     zh: '大匠',   color: '#A78BFA', glow: 'rgba(167,139,250,0.6)',  emblem: '🎯', vfx: 0.58 },
  { key: 'luminary',     minLevel: 27, en: 'Luminary',     zh: '泰斗',   color: '#FBBF24', glow: 'rgba(251,191,36,0.65)',  emblem: '🌟', vfx: 0.72 },
  { key: 'guru',         minLevel: 37, en: 'Guru',         zh: '宗师',   color: '#E879F9', glow: 'rgba(232,121,249,0.7)',  emblem: '🔮', vfx: 0.86 },
  { key: 'transcendent', minLevel: 50, en: 'Transcendent', zh: '超凡',   color: '#FDE68A', glow: 'rgba(253,230,138,0.9)',  emblem: '🌌', vfx: 1.0 },
]

export interface RankInfo {
  key: string
  tier: number       // index in TIERS (0..7)
  division: number   // 3→1 within a tier; 0 for the undivided top tier
  en: string         // composed label incl. numeral, e.g. "Gold II"
  zh: string         // e.g. "黄金 II"
  color: string
  glow: string
  emblem: string
  vfx: number
}

const ROMAN = ['', 'I', 'II', 'III']

/**
 * The rank for a level: its tier + division (III at the bottom of the tier,
 * I at the top, just below the next promotion). The top tier is undivided.
 */
export function getRank(level: number): RankInfo {
  let idx = 0
  for (let i = TIERS.length - 1; i >= 0; i--) {
    if (level >= TIERS[i].minLevel) { idx = i; break }
  }
  const tier = TIERS[idx]
  const next = TIERS[idx + 1]
  let division = 0
  if (next) {
    const span = Math.max(1, next.minLevel - tier.minLevel)
    const pos = Math.min(span - 1, Math.max(0, level - tier.minLevel))
    division = 3 - Math.floor((pos / span) * 3) // 3 (bottom) → 1 (top)
  }
  const suffix = division ? ` ${ROMAN[division]}` : ''
  return {
    key: tier.key,
    tier: idx,
    division,
    en: `${tier.en}${suffix}`,
    zh: `${tier.zh}${suffix}`,
    color: tier.color,
    glow: tier.glow,
    emblem: tier.emblem,
    vfx: tier.vfx,
  }
}

export { getLevel as getLevelForXp }

export function calculateXp(
  source: XpSource,
  opts: {
    sessionScore?: number  // 0-100
    streak?: number
    streakDays?: number    // for daily_streak scaling
    difficulty?: number    // 0-1 multiplier
    streakWrong?: number   // for perseverance: how many wrongs in a row
    combo?: number         // for combo_bonus: consecutive correct answers
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
    case 'combo_bonus': {
      // Escalating tiers, awarded exactly when the combo HITS the tier:
      //   3 in a row → 10 XP · 5 in a row → 20 XP · 10 in a row → 40 XP
      const combo = opts.combo ?? 0
      if (combo >= 10) xp = 40
      else if (combo >= 5) xp = 20
      else if (combo >= 3) xp = 10
      else xp = 0
      break
    }
  }

  // Apply streak multiplier to all sources
  xp *= getStreakMultiplier(streak)

  return Math.round(xp)
}

// ── Profile bootstrap ──
// The simulation audit's biggest reward finding: a fresh user has NO
// StudentProfile row, and every award path silently no-op'd on that —
// day-1 check-in paid nothing, all checkpoint XP was [], badges never
// evaluated true. XP must never depend on some other feature having
// happened to create the profile first.
async function ensureProfile(userId: string): Promise<{ xp: number; streak: number } | null> {
  try {
    const existing = await prisma.studentProfile.findUnique({
      where: { userId },
      select: { xp: true, streak: true },
    })
    if (existing) return existing
    const { ensureUserRow } = await import('@/lib/ensure-user')
    await ensureUserRow(userId)
    const created = await prisma.studentProfile.upsert({
      where: { userId },
      update: {},
      create: { userId },
    })
    return { xp: created.xp, streak: created.streak }
  } catch {
    return null
  }
}

// ── Daily XP accounting ──
// Powers the daily-goal ring. Rolls over automatically when the stored date
// is not today. Same-day bumps use an atomic increment so concurrent awards
// can't overwrite each other. Best-effort: never breaks an award.
async function bumpDailyXp(userId: string, amount: number): Promise<void> {
  if (amount <= 0) return
  try {
    const row = await prisma.studentProfile.findUnique({
      where: { userId },
      select: { dailyXpDate: true },
    })
    if (!row) return
    const today = new Date().toDateString()
    const sameDay = row.dailyXpDate && new Date(row.dailyXpDate).toDateString() === today
    await prisma.studentProfile.update({
      where: { userId },
      data: sameDay
        ? { dailyXp: { increment: amount }, dailyXpDate: new Date() }
        : { dailyXp: amount, dailyXpDate: new Date() },
    })
  } catch { /* schema lag — non-critical */ }
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
    combo?: number
  } = {}
): Promise<XpAwardResult | null> {
  const profile = await ensureProfile(userId)
  if (!profile) return null

  const currentStreak = opts.streak ?? profile.streak
  const awarded = calculateXp(source, { ...opts, streak: currentStreak })
  if (awarded <= 0) return null

  // Atomic increment: concurrent awards (quiz answer + daily check-in in
  // another tab) can never overwrite each other. Levels derive from the
  // returned total, so they stay accurate under races too.
  const updated = await prisma.studentProfile.update({
    where: { userId },
    data: { xp: { increment: awarded } },
    select: { xp: true },
  })
  await bumpDailyXp(userId, awarded)

  const newTotal = updated.xp
  const oldLevel = getLevel(newTotal - awarded)
  const newLevel = getLevel(newTotal)

  return {
    awarded,
    source,
    label: XP_TABLE[source].label,
    newTotal,
    levelUp: newLevel > oldLevel,
    newLevel,
    ...rankTransition(oldLevel, newLevel),
  }
}

// ── Batch award (for multiple XP events at once) ──

export async function awardXpBatch(
  userId: string,
  awards: Array<{ source: XpSource; opts?: Parameters<typeof calculateXp>[1] }>
): Promise<XpAwardResult[]> {
  const profile = await ensureProfile(userId)
  if (!profile) return []

  const amounts = awards
    .map(({ source, opts }) => ({ source, awarded: calculateXp(source, { ...opts, streak: profile.streak }) }))
    .filter(a => a.awarded > 0)
  if (amounts.length === 0) return []
  const total = amounts.reduce((sum, a) => sum + a.awarded, 0)

  // One atomic increment for the whole batch; per-award levels replay from
  // the returned total so they're correct even under concurrent awards.
  const updated = await prisma.studentProfile.update({
    where: { userId },
    data: { xp: { increment: total } },
    select: { xp: true },
  })
  await bumpDailyXp(userId, total)

  let running = updated.xp - total
  return amounts.map(({ source, awarded }) => {
    const oldLevel = getLevel(running)
    running += awarded
    const newLevel = getLevel(running)
    return {
      awarded,
      source,
      label: XP_TABLE[source].label,
      newTotal: running,
      levelUp: newLevel > oldLevel,
      newLevel,
      ...rankTransition(oldLevel, newLevel),
    }
  })
}

// ── Daily streak update ──

/**
 * Calendar day (YYYY-MM-DD) in the USER's timezone. Day boundaries must be
 * the learner's midnight, not the server's — a Shanghai student studying at
 * 23:30 must not lose a streak to a UTC server clock. Invalid/missing
 * timezone falls back to the server's zone.
 */
function dayKey(d: Date, timeZone?: string): string {
  try {
    return d.toLocaleDateString('en-CA', timeZone ? { timeZone } : undefined)
  } catch {
    return d.toLocaleDateString('en-CA')
  }
}

export async function updateStreak(userId: string, timeZone?: string): Promise<{ streak: number; awards: XpAwardResult[] }> {
  await ensureProfile(userId)
  let profile: { streak: number; updatedAt: Date; longestStreak: number | null; lastCheckinDay: string | null } | null = null
  try {
    profile = await prisma.studentProfile.findUnique({
      where: { userId },
      select: { streak: true, updatedAt: true, longestStreak: true, lastCheckinDay: true },
    })
  } catch {
    // Schema lag (lastCheckinDay not pushed yet) — legacy columns only.
    const legacy = await prisma.studentProfile.findUnique({
      where: { userId },
      select: { streak: true, updatedAt: true },
    })
    profile = legacy ? { ...legacy, longestStreak: null, lastCheckinDay: null } : null
  }
  if (!profile) return { streak: 0, awards: [] }

  const now = new Date()
  const today = dayKey(now, timeZone)
  const yesterday = dayKey(new Date(now.getTime() - 24 * 60 * 60 * 1000), timeZone)
  // Migration fallback: before the first stamped check-in, approximate the
  // last active day from updatedAt so existing streaks survive the rollout.
  const lastDay = profile.lastCheckinDay ?? dayKey(profile.updatedAt, timeZone)

  // streak === 0 means this user has NEVER started a streak — day one must
  // pay (a freshly bootstrapped profile has updatedAt = now, which the
  // updatedAt fallback would read as "already here today", muting the most
  // retention-critical moment of the product). A stamped lastCheckinDay
  // always wins over that heuristic.
  if (lastDay === today && (profile.lastCheckinDay !== null || profile.streak > 0)) {
    // Already checked in today — no streak update.
    return { streak: profile.streak, awards: [] }
  }

  const newStreak = lastDay === yesterday ? profile.streak + 1 : 1

  // Compare-and-set on the day stamp: of N concurrent check-ins (multiple
  // tabs at the same instant), exactly one wins and pays the day's awards.
  // longestStreak is tracked so a later broken streak never revokes badges.
  try {
    const won = await prisma.studentProfile.updateMany({
      where: { userId, OR: [{ lastCheckinDay: null }, { lastCheckinDay: { not: today } }] },
      data: { lastCheckinDay: today, streak: newStreak, longestStreak: Math.max(newStreak, profile.longestStreak ?? 0) },
    })
    if (won.count === 0) return { streak: newStreak, awards: [] }
  } catch {
    // Schema lag — legacy non-guarded write (same-day check above still holds
    // for sequential calls).
    await prisma.studentProfile.update({ where: { userId }, data: { streak: newStreak } }).catch(() => null)
  }

  // Award streak XP + the first-session-of-the-day bonus (a new day reaching
  // this point IS the first session — the cheap dopamine hit for showing up).
  // Both are returned so the client can celebrate the day's arrival rewards.
  const awards: XpAwardResult[] = []
  const streakAward = await awardXp(userId, 'daily_streak', { streakDays: newStreak, streak: newStreak })
  if (streakAward) awards.push(streakAward)
  const firstSession = await awardXp(userId, 'first_session', { streak: newStreak }).catch(() => null)
  if (firstSession) awards.push(firstSession)

  return { streak: newStreak, awards }
}
