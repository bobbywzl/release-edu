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
 * │ Daily login streak       │ 10/25/50  │ ACCELERATOR: ramps day 1→2→3;  │
 * │                          │           │ day 3+ holds the maximum rate  │
 * │ Full-week streak boost   │ 500       │ every 7th consecutive day      │
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
import { streakDayXp, WEEK_STREAK_XP, WEEK_LENGTH } from '@/lib/streak-accel'

// ── XP Award Types ──

export type XpSource =
  | 'chapter_completed'
  | 'quiz_correct'
  | 'capstone_passed'
  | 'track_completed'
  | 'daily_streak'
  | 'week_streak'
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
  // Rank progression: rankUp = the level-up brought a NEW TITLE (every level
  // has its own, so every level-up celebrates); tierUp = reached a whole new
  // tier family (the epic ceremony). rank carries the new rank so the client
  // can theme the overlay + escalate the sound.
  rankUp: boolean
  tierUp: boolean
  rank: RankInfo
}

/** Compute the rank-progression fields for a level transition. Every level
 *  carries its OWN title, so any level-up is a rank-up (fresh name + fanfare);
 *  tier-ups (new color/emblem family) get the bigger ceremony. */
function rankTransition(oldLevel: number, newLevel: number): { rankUp: boolean; tierUp: boolean; rank: RankInfo } {
  const from = getRank(oldLevel)
  const to = getRank(newLevel)
  return {
    rankUp: from.en !== to.en,
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
  // Full-week boost: the special 500 XP crescendo of the streak accelerator,
  // paid on every 7th consecutive day of learning (7, 14, 21, …).
  week_streak:         { base: WEEK_STREAK_XP, label: 'Full Week Streak' },
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

// Rank ladder: 10 escalating TIER FAMILIES. There are NO numbered divisions
// (no "Seeker II" — user directive, Aug 2026): every LEVEL wears its own
// unique title from LEVEL_TITLES below, and the tier supplies the color +
// emblem + a `vfx` intensity (0..1) that drives how grand the rank-up sound
// and animation get: climbing the ladder should *feel* louder and shinier.
// Ranks derive purely from level (no schema), and appear on the dashboard
// and the portfolio.
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

// The journey of a mind, not a metal shelf: ten learning-themed titles that
// climb from a first sprout of curiosity through mastery to transcendence —
// and then, the ultimate flex, loop back to "Rookie II": the enlightened
// beginner's mind, come full circle (its color is the original Rookie green
// again, but radiant). Ascending color spectrum, escalating grandeur.
const TIERS: RankTier[] = [
  { key: 'rookie',       minLevel: 1,  en: 'Rookie',       zh: '新秀',    color: '#6EE7B7', glow: 'rgba(110,231,183,0.5)',  emblem: '🌱', vfx: 0.0 },
  { key: 'seeker',       minLevel: 4,  en: 'Seeker',       zh: '探索者',  color: '#22D3EE', glow: 'rgba(34,211,238,0.55)',  emblem: '🧭', vfx: 0.11 },
  { key: 'scholar',      minLevel: 8,  en: 'Scholar',      zh: '学者',    color: '#60A5FA', glow: 'rgba(96,165,250,0.55)',  emblem: '📖', vfx: 0.22 },
  { key: 'prodigy',      minLevel: 13, en: 'Prodigy',      zh: '奇才',    color: '#818CF8', glow: 'rgba(129,140,248,0.6)',  emblem: '⚡', vfx: 0.33 },
  { key: 'virtuoso',     minLevel: 19, en: 'Virtuoso',     zh: '大匠',    color: '#A78BFA', glow: 'rgba(167,139,250,0.6)',  emblem: '🎯', vfx: 0.44 },
  { key: 'luminary',     minLevel: 27, en: 'Luminary',     zh: '泰斗',    color: '#FBBF24', glow: 'rgba(251,191,36,0.65)',  emblem: '🌟', vfx: 0.55 },
  { key: 'guru',         minLevel: 37, en: 'Guru',         zh: '宗师',    color: '#E879F9', glow: 'rgba(232,121,249,0.7)',  emblem: '🔮', vfx: 0.66 },
  { key: 'grandmaster',  minLevel: 47, en: 'Grandmaster',  zh: '大宗师',  color: '#F43F5E', glow: 'rgba(244,63,94,0.75)',   emblem: '🏆', vfx: 0.80 },
  { key: 'transcendent',   minLevel: 60, en: 'Transcendent',    zh: '超凡',      color: '#FDE68A', glow: 'rgba(253,230,138,0.9)',  emblem: '🌌', vfx: 0.92 },
  // The pinnacle is the anti-flex: the enlightened master who has come full
  // circle and knows they are, at last, "A Real Beginner" (Zen beginner's
  // mind). Its color is the original Rookie green again — full circle.
  { key: 'real_beginner',  minLevel: 75, en: 'A Real Beginner', zh: '真·初学者', color: '#6EE7B7', glow: 'rgba(110,231,183,1)',    emblem: '🧘', vfx: 1.0 },
]

export interface RankInfo {
  key: string
  tier: number       // index in TIERS (0..9)
  division: number   // always 0 — numbered divisions are gone (kept for wire compat)
  en: string         // the level's own unique title, e.g. "Pathfinder"
  zh: string         // e.g. "寻路者"
  color: string
  glow: string
  emblem: string
  vfx: number
}

// EVERY LEVEL HAS ITS OWN TITLE — a fresh name is the reward for every
// level-up (per-level names, not per-tier). Titles flow through the 10 tier
// families (which keep the color/emblem/vfx escalation): index 0 = level 1.
// Level 75+ is the pinnacle "A Real Beginner", the enlightened full circle.
const LEVEL_TITLES: Array<{ en: string; zh: string }> = [
  // Rookie family (1-3) 🌱
  { en: 'Rookie', zh: '新秀' }, { en: 'Sprout', zh: '新芽' }, { en: 'Sapling', zh: '幼苗' },
  // Seeker family (4-7) 🧭
  { en: 'Seeker', zh: '探索者' }, { en: 'Pathfinder', zh: '寻路者' }, { en: 'Trailblazer', zh: '开路者' }, { en: 'Voyager', zh: '远行者' },
  // Scholar family (8-12) 📖
  { en: 'Scholar', zh: '学者' }, { en: 'Analyst', zh: '析理者' }, { en: 'Thinker', zh: '思想者' }, { en: 'Synthesist', zh: '融会者' }, { en: 'Theorist', zh: '理论家' },
  // Prodigy family (13-18) ⚡
  { en: 'Prodigy', zh: '奇才' }, { en: 'Quicksilver', zh: '敏思者' }, { en: 'Pattern Hunter', zh: '规律猎手' }, { en: 'Connector', zh: '触类旁通' }, { en: 'Rising Star', zh: '新星' }, { en: 'Phenom', zh: '惊才' },
  // Virtuoso family (19-26) 🎯
  { en: 'Virtuoso', zh: '大匠' }, { en: 'Artisan', zh: '巧匠' }, { en: 'Specialist', zh: '专精者' }, { en: 'Adept', zh: '娴熟者' }, { en: 'Expert', zh: '行家' }, { en: 'Precisionist', zh: '至精者' }, { en: 'Master Hand', zh: '妙手' }, { en: 'Perfectionist', zh: '至臻者' },
  // Luminary family (27-36) 🌟
  { en: 'Luminary', zh: '泰斗' }, { en: 'Beacon', zh: '灯塔' }, { en: 'Mentor', zh: '导师' }, { en: 'Illuminator', zh: '启明者' }, { en: 'Torchbearer', zh: '执炬者' }, { en: 'Polymath', zh: '博学者' }, { en: 'Visionary', zh: '远见者' }, { en: 'Luminous Mind', zh: '明澈之心' }, { en: 'North Star', zh: '北辰' }, { en: 'Radiant', zh: '光辉者' },
  // Guru family (37-46) 🔮
  { en: 'Guru', zh: '宗师' }, { en: 'Oracle', zh: '先知' }, { en: 'Sage', zh: '贤者' }, { en: 'Mystic', zh: '玄悟者' }, { en: 'Enlightener', zh: '开悟者' }, { en: 'Philosopher', zh: '哲人' }, { en: 'Archsage', zh: '大贤' }, { en: 'Keeper of Depths', zh: '渊守者' }, { en: 'Wisdom Incarnate', zh: '智慧化身' }, { en: 'Living Library', zh: '活典籍' },
  // Grandmaster family (47-59) 🏆
  { en: 'Grandmaster', zh: '大宗师' }, { en: 'Champion', zh: '冠军' }, { en: 'Titan', zh: '巨擘' }, { en: 'Paragon', zh: '典范' }, { en: 'Sovereign', zh: '王者' }, { en: 'Legend', zh: '传奇' }, { en: 'Immortal Hand', zh: '不朽妙手' }, { en: 'Apex', zh: '绝巅' }, { en: 'Colossus', zh: '擎天者' }, { en: 'Peerless', zh: '无双' }, { en: 'Monarch of Mind', zh: '心智之王' }, { en: 'World-Class', zh: '世界级' }, { en: 'Pinnacle', zh: '绝顶' },
  // Transcendent family (60-74) 🌌
  { en: 'Transcendent', zh: '超凡' }, { en: 'Ascendant', zh: '飞升者' }, { en: 'Ethereal', zh: '缥缈者' }, { en: 'Boundless', zh: '无界' }, { en: 'Celestial', zh: '天穹者' }, { en: 'Starforger', zh: '铸星者' }, { en: 'Voidwalker', zh: '踏虚者' }, { en: 'Cosmic Mind', zh: '宇宙心智' }, { en: 'Infinite', zh: '无限' }, { en: 'Eternal', zh: '永恒' }, { en: 'All-Seeing', zh: '洞悉万象' }, { en: 'Beyond', zh: '彼岸' }, { en: 'Singularity', zh: '奇点' }, { en: 'Apotheosis', zh: '臻于化境' }, { en: 'Event Horizon', zh: '事件视界' },
]

/**
 * The rank for a level: a UNIQUE per-level title inside its tier family
 * (tier supplies color/emblem/vfx and the promotion ceremony scale). The
 * pinnacle (level 75+) is "A Real Beginner" — beginner's mind, full circle.
 */
export function getRank(level: number): RankInfo {
  let idx = 0
  for (let i = TIERS.length - 1; i >= 0; i--) {
    if (level >= TIERS[i].minLevel) { idx = i; break }
  }
  const tier = TIERS[idx]
  const title = level >= 75
    ? { en: tier.en, zh: tier.zh } // "A Real Beginner" holds from 75 on
    : LEVEL_TITLES[Math.max(1, Math.min(level, LEVEL_TITLES.length)) - 1] ?? { en: tier.en, zh: tier.zh }
  return {
    key: tier.key,
    tier: idx,
    division: 0, // per-level titles replaced divisions; field kept for compat
    en: title.en,
    zh: title.zh,
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
      // XP ACCELERATOR: the show-up reward ramps day 1 → day 2 → day 3
      // (10 / 25 / 50) and holds the day-3 MAXIMUM from then on — coming
      // back tomorrow is always visibly worth more than restarting at day 1.
      const days = opts.streakDays ?? streak
      xp = streakDayXp(Math.max(1, days))
      break
    }
    case 'week_streak':
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

  // Apply streak multiplier to all sources EXCEPT the streak payouts
  // themselves: the accelerator's posted amounts (10/25/50 and the 500
  // week boost) are paid EXACTLY — legibility beats a hidden multiplier.
  if (source !== 'daily_streak' && source !== 'week_streak') {
    xp *= getStreakMultiplier(streak)
  }

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
// Powers the daily-goal ring. The day boundary is the USER's midnight (same
// dayKey as the streak, via the profile's stored timeZone) so the ring and
// the flame always agree on "today". Same-day bumps are atomic increments;
// the midnight rollover is a compare-and-set on the day stamp so two awards
// straddling midnight can't both take the reset branch and clobber each
// other. Best-effort: never breaks an award.
async function bumpDailyXp(userId: string, amount: number): Promise<void> {
  if (amount <= 0) return
  try {
    const row = await prisma.studentProfile.findUnique({
      where: { userId },
      select: { timeZone: true },
    })
    if (!row) return
    const today = dayKey(new Date(), row.timeZone ?? undefined)
    const bumped = await prisma.studentProfile.updateMany({
      where: { userId, dailyXpDay: today },
      data: { dailyXp: { increment: amount }, dailyXpDate: new Date() },
    })
    if (bumped.count > 0) return
    const rolled = await prisma.studentProfile.updateMany({
      where: { userId, OR: [{ dailyXpDay: null }, { dailyXpDay: { not: today } }] },
      data: { dailyXp: amount, dailyXpDay: today, dailyXpDate: new Date() },
    })
    if (rolled.count === 0) {
      // Lost the rollover race — the winner already stamped today; add on top.
      await prisma.studentProfile.updateMany({
        where: { userId, dailyXpDay: today },
        data: { dailyXp: { increment: amount }, dailyXpDate: new Date() },
      })
    }
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

// The single source of day-boundary truth, for routes that must agree with
// the streak/ring day (e.g. /api/xp/summary).
export { dayKey as userDayKey }

// The calendar day before a YYYY-MM-DD key. Computed by calendar arithmetic,
// NOT by subtracting 24h of wall-clock time — on the day after a DST spring-
// forward, now−24h lands two calendar days back and would break live streaks.
function prevDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  if (!y || !m || !d) return day
  return new Date(Date.UTC(y, m - 1, d) - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

export interface StreakCheckinResult {
  streak: number
  awards: XpAwardResult[]
  /** The honest goodbye (satisfaction audit #3): a run just ended — its
   *  length, and whether it was this learner's longest ever. */
  streakEnded?: { previous: number; wasRecord: boolean }
  /** A banked shield auto-bridged a single missed day — always announced. */
  shieldUsed?: boolean
  /** A completed week just banked a new shield. */
  shieldEarned?: boolean
  /** Current banked shields (for the panel). */
  shields?: number
}

export async function updateStreak(userId: string, timeZone?: string): Promise<StreakCheckinResult> {
  await ensureProfile(userId)
  let profile: { streak: number; updatedAt: Date; longestStreak: number | null; lastCheckinDay: string | null; streakShields: number | null } | null = null
  try {
    profile = await prisma.studentProfile.findUnique({
      where: { userId },
      select: { streak: true, updatedAt: true, longestStreak: true, lastCheckinDay: true, streakShields: true },
    })
  } catch {
    // Schema lag (lastCheckinDay/streakShields not pushed yet) — legacy columns only.
    const legacy = await prisma.studentProfile.findUnique({
      where: { userId },
      select: { streak: true, updatedAt: true },
    })
    profile = legacy ? { ...legacy, longestStreak: null, lastCheckinDay: null, streakShields: null } : null
  }
  if (!profile) return { streak: 0, awards: [] }

  const now = new Date()
  const today = dayKey(now, timeZone)
  const yesterday = prevDay(today)
  // Migration fallback: before the first stamped check-in, approximate the
  // last active day from updatedAt so existing streaks survive the rollout.
  const lastDay = profile.lastCheckinDay ?? dayKey(profile.updatedAt, timeZone)

  // streak === 0 means this user has NEVER started a streak — day one must
  // pay (a freshly bootstrapped profile has updatedAt = now, which the
  // updatedAt fallback would read as "already here today", muting the most
  // retention-critical moment of the product). A stamped lastCheckinDay
  // always wins over that heuristic.
  // Already checked in for today OR a day AFTER today (a westward timezone
  // shift — travel, a mis-set second device — makes a stamp from an eastward
  // zone lexically > today). A YYYY-MM-DD string compare treats both as
  // "already here", so a live streak is never reset to 1 and show-up XP is
  // never double-paid for the same absolute day.
  if (lastDay >= today && (profile.lastCheckinDay !== null || profile.streak > 0)) {
    return { streak: profile.streak, awards: [], shields: profile.streakShields ?? 0 }
  }

  // ── STREAK SHIELDS + THE HONEST GOODBYE (satisfaction audit #3) ──
  // Continuation: yesterday checked in → +1. ONE missed day with a banked
  // shield → the shield auto-bridges it (+1, announced — never silent fake
  // continuity). Anything else → honest reset, and the RESULT names the run
  // that ended and whether it was the learner's longest ever.
  const dayBeforeYesterday = prevDay(yesterday)
  const shieldsHeld = profile.streakShields ?? 0
  const continued = lastDay === yesterday
  const shieldBridges = !continued && lastDay === dayBeforeYesterday && shieldsHeld > 0 && profile.streak > 0
  const broke = !continued && !shieldBridges && profile.streak > 1 && profile.lastCheckinDay !== null
  const newStreak = continued || shieldBridges ? profile.streak + 1 : 1
  // A completed week banks one shield (cap 2) — earned, visible, spendable.
  const shieldEarned = newStreak > 0 && newStreak % WEEK_LENGTH === 0 && (shieldsHeld - (shieldBridges ? 1 : 0)) < 2
  const newShields = Math.max(0, Math.min(2, shieldsHeld - (shieldBridges ? 1 : 0) + (shieldEarned ? 1 : 0)))
  const streakEnded = broke
    ? { previous: profile.streak, wasRecord: profile.streak >= (profile.longestStreak ?? 0) }
    : undefined

  // Compare-and-set on the day stamp: of N concurrent check-ins (multiple
  // tabs at the same instant), exactly one wins and pays the day's awards.
  // longestStreak is tracked so a later broken streak never revokes badges.
  try {
    const won = await prisma.studentProfile.updateMany({
      where: { userId, OR: [{ lastCheckinDay: null }, { lastCheckinDay: { not: today } }] },
      data: {
        lastCheckinDay: today,
        streak: newStreak,
        longestStreak: Math.max(newStreak, profile.longestStreak ?? 0),
        streakShields: newShields,
        // Remember the client's zone so server-only award paths (bumpDailyXp)
        // can compute the user's "today" without a browser in the loop.
        ...(timeZone ? { timeZone } : {}),
      },
    })
    if (won.count === 0) return { streak: newStreak, awards: [], shields: newShields }
  } catch {
    // Schema lag — legacy non-guarded write (same-day check above still holds
    // for sequential calls).
    await prisma.studentProfile.update({ where: { userId }, data: { streak: newStreak } }).catch(() => null)
  }

  // Award streak XP + the first-session-of-the-day bonus (a new day reaching
  // this point IS the first session — the cheap dopamine hit for showing up).
  // Both are returned so the client can celebrate the day's arrival rewards.
  // The day stamp is already set, so a transient failure here would silently
  // forfeit the day's show-up XP — retry each award once before giving up.
  const tryAward = async (source: XpSource, opts: Parameters<typeof awardXp>[2]) => {
    try { return await awardXp(userId, source, opts) } catch {
      try { return await awardXp(userId, source, opts) } catch { return null }
    }
  }
  const awards: XpAwardResult[] = []
  const streakAward = await tryAward('daily_streak', { streakDays: newStreak, streak: newStreak })
  if (streakAward) awards.push(streakAward)
  const firstSession = await tryAward('first_session', { streak: newStreak })
  if (firstSession) awards.push(firstSession)
  // FULL-WEEK BOOST: every 7th consecutive day pays the special 500 XP —
  // pushed last so the toast sequence ends on the crescendo. newStreak only
  // ever advances by 1, so a multiple of 7 can never be skipped over.
  if (newStreak > 0 && newStreak % WEEK_LENGTH === 0) {
    const weekly = await tryAward('week_streak', { streak: newStreak })
    if (weekly) awards.push(weekly)
  }

  return {
    streak: newStreak,
    awards,
    ...(streakEnded ? { streakEnded } : {}),
    ...(shieldBridges ? { shieldUsed: true } : {}),
    ...(shieldEarned ? { shieldEarned: true } : {}),
    shields: newShields,
  }
}
