/**
 * Streak XP accelerator — client-safe single source of truth.
 *
 * The show-up reward accelerates with the streak: day 1 pays the base,
 * day 2 pays more, and day 3 reaches MAXIMUM accumulation (every further
 * day holds that top rate). A broken streak drops back to day-1 pay, so
 * the ramp itself is what a lapse costs. On top of the daily ramp, every
 * FULL WEEK of continuous learning (day 7, 14, 21, …) pays a special
 * 500 XP boost.
 *
 * Shared by the server engine (xp-engine.ts awards) and the dashboard
 * panel (rate + countdown display) so the posted numbers can never drift
 * from the paid ones.
 */

/** Daily streak XP by streak day: index 0 = day 1. Day 3+ holds the max. */
export const STREAK_DAY_XP = [10, 25, 50] as const

/** The special boost paid on every 7th consecutive day. */
export const WEEK_STREAK_XP = 500

export const WEEK_LENGTH = 7

/** XP the daily streak pays on streak day `day` (1-based). */
export function streakDayXp(day: number): number {
  if (day <= 0) return 0
  return STREAK_DAY_XP[Math.min(day, STREAK_DAY_XP.length) - 1]
}

/**
 * Days from a current streak until the NEXT full-week boost lands
 * (always 1..7 — a streak sitting exactly on a boost day counts the
 * seven days to the following one).
 */
export function daysToWeekBoost(streak: number): number {
  const s = Math.max(0, streak)
  return WEEK_LENGTH - (s % WEEK_LENGTH)
}
