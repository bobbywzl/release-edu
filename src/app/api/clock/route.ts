export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getUserId } from '@/lib/get-user-id'
import prisma from '@/lib/prisma'

/**
 * Server-authoritative clock. Use this — never `new Date()` on the client —
 * for any decision that compares against stored timestamps (lock-period
 * expiry, restore-window expiry, deadline checks). Client clocks can be
 * skewed/manipulated; the server's clock is the truth.
 *
 * GET /api/clock
 *   →  {
 *        nowIso: string,        // ISO 8601 UTC timestamp from the server
 *        nowMs: number,         // Same instant as Unix milliseconds
 *        userTimezone: string,  // IANA zone (e.g. "America/Los_Angeles") from
 *                               // the user's profile, or browser-default if unset
 *        serverTimezone: string,// What the Next.js server itself runs in
 *      }
 */
export async function GET() {
  const userId = await getUserId().catch(() => null)
  const now = new Date()

  let userTimezone = 'UTC'
  if (userId) {
    const profile = await prisma.studentProfile.findUnique({
      where: { userId },
      select: { roadmapState: true },
    })
    if (profile?.roadmapState) {
      try {
        const parsed = JSON.parse(profile.roadmapState) as { _profileMeta?: { timezone?: string } }
        if (parsed?._profileMeta?.timezone) userTimezone = parsed._profileMeta.timezone
      } catch { /* ignore — fall through to UTC */ }
    }
  }

  return NextResponse.json({
    nowIso: now.toISOString(),
    nowMs: now.getTime(),
    userTimezone,
    serverTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  })
}
