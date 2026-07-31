export const dynamic = 'force-dynamic'

/**
 * GET /api/account/me — THIS TAB's identity.
 *
 * The one endpoint UI chrome may use to display "who am I signed in as":
 * it resolves through getSlotAwareSession (the x-account-slot header first,
 * then the main NextAuth session), so a tab bound to account A keeps
 * showing A even after account B logs in elsewhere in the browser.
 * NextAuth's own /api/auth/session always reflects the LATEST login and
 * must never be used for per-tab identity display.
 */
import { NextResponse } from 'next/server'
import { getSlotAwareSession } from '@/lib/session-slots'

export async function GET() {
  const session = await getSlotAwareSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return NextResponse.json({
    user: {
      id: session.user.id,
      email: session.user.email ?? null,
      name: session.user.name ?? null,
      image: session.user.image ?? null,
    },
  })
}
