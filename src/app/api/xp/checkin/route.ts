export const dynamic = 'force-dynamic'

/**
 * POST /api/xp/checkin { timeZone? } — the show-up reward.
 *
 * Called once per app entry (DailyCheckin in the dashboard layout). On the
 * first visit of a new day — the USER's day, computed in their IANA
 * timezone — it advances the daily streak and pays the daily-streak XP
 * (scales with streak length) + the first-session bonus; every later call
 * today is a cheap no-op. Idempotence lives in updateStreak's
 * compare-and-set on the day stamp, so parallel tabs can't double-award.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '@/lib/get-user-id'
import { updateStreak } from '@/lib/xp-engine'

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserId()
    const { timeZone } = (await req.json().catch(() => ({}))) as { timeZone?: string }
    const result = await updateStreak(userId, typeof timeZone === 'string' ? timeZone : undefined)
    // Streak-rung badges unlock at THIS moment (the day's check-in advanced
    // longestStreak) — evaluate here so the celebration fires now, not on a
    // later dashboard visit. Only when the day actually advanced (awards
    // non-empty), so no-op repeat calls stay cheap.
    let newBadges: Array<{ id: string; tier: string; icon: string; name: unknown; desc: unknown }> = []
    if (result.awards.length > 0) {
      try {
        const { evaluateAndAwardBadges } = await import('@/lib/badges')
        const nb = await evaluateAndAwardBadges(userId)
        newBadges = nb.map(b => ({ id: b.id, tier: b.tier, icon: b.icon, name: b.name, desc: b.desc }))
      } catch { /* non-critical */ }
    }
    // Full payload: awards + the honest streak-transition events (streakEnded /
    // shieldUsed / shieldEarned) so the client can name what happened.
    return NextResponse.json({ ...result, newBadges })
  } catch {
    // Never let the retention layer break app entry (e.g. brand-new user
    // with no profile yet).
    return NextResponse.json({ streak: 0, awards: [] })
  }
}
