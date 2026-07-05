export const dynamic = 'force-dynamic'

/**
 * POST /api/xp/checkin — the show-up reward.
 *
 * Called once per app entry (DailyCheckin in the dashboard layout). On the
 * first visit of a new day it advances the daily streak and pays the
 * daily-streak XP (scales with streak length) + the first-session bonus;
 * every later call today is a cheap no-op. Idempotence lives in
 * updateStreak's same-day check, so multiple tabs can't double-award.
 */
import { NextResponse } from 'next/server'
import { getUserId } from '@/lib/get-user-id'
import { updateStreak } from '@/lib/xp-engine'

export async function POST() {
  try {
    const userId = await getUserId()
    const { streak, awards } = await updateStreak(userId)
    return NextResponse.json({ streak, awards })
  } catch {
    // Never let the retention layer break app entry (e.g. brand-new user
    // with no profile yet).
    return NextResponse.json({ streak: 0, awards: [] })
  }
}
