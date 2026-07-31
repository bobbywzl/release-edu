export const dynamic = 'force-dynamic'

/**
 * PER-TAB ACCOUNT SLOTS (see src/lib/session-slots.ts for the model).
 *
 * POST   — adopt: copy the CURRENT NextAuth session into a slot cookie
 *          (reusing the user's existing slot, else the first free one) and
 *          return the slot number for the tab to bind in sessionStorage.
 * GET    — list the live slots in this browser (id/email/name per slot),
 *          so a fresh tab can rebind after the main session was cleared.
 * DELETE — log out of ONE slot: clears that slot cookie, and clears the
 *          main NextAuth cookie only when it holds the SAME account — other
 *          tabs bound to other slots stay signed in untouched.
 */
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { decodeSessionCookie, slotCookieName, MAX_SLOTS, MAIN_COOKIE_CANDIDATES } from '@/lib/session-slots'

function mainCookie(): { name: string; value: string } | null {
  for (const name of MAIN_COOKIE_CANDIDATES) {
    const v = cookies().get(name)?.value
    if (v) return { name, value: v }
  }
  return null
}

const isSecure = () => (process.env.NEXTAUTH_URL ?? '').startsWith('https') || process.env.VERCEL === '1'

function setSlotCookie(res: NextResponse, n: number, value: string) {
  res.cookies.set(slotCookieName(n), value, {
    httpOnly: true, sameSite: 'lax', secure: isSecure(), path: '/', maxAge: 30 * 24 * 60 * 60,
  })
}

function clearCookie(res: NextResponse, name: string) {
  res.cookies.set(name, '', { httpOnly: true, sameSite: 'lax', secure: isSecure(), path: '/', maxAge: 0 })
}

export async function POST() {
  const main = mainCookie()
  const tok = await decodeSessionCookie(main?.value)
  if (!main || !tok?.sub) {
    return NextResponse.json({ error: 'No active session to adopt' }, { status: 401 })
  }
  // Reuse this account's existing slot (refreshes its token), else first free.
  let chosen = -1
  for (let i = 0; i < MAX_SLOTS; i++) {
    const existing = await decodeSessionCookie(cookies().get(slotCookieName(i))?.value)
    if (existing?.sub === tok.sub) { chosen = i; break }
  }
  if (chosen < 0) {
    for (let i = 0; i < MAX_SLOTS; i++) {
      const existing = await decodeSessionCookie(cookies().get(slotCookieName(i))?.value)
      if (!existing) { chosen = i; break }
    }
  }
  if (chosen < 0) chosen = 0 // browser full of live sessions — recycle slot 0
  const res = NextResponse.json({
    slot: chosen,
    user: { id: tok.sub, email: tok.email ?? null, name: tok.name ?? null },
  })
  setSlotCookie(res, chosen, main.value)
  return res
}

export async function GET() {
  const slots: Array<{ slot: number; id: string; email: string | null; name: string | null }> = []
  for (let i = 0; i < MAX_SLOTS; i++) {
    const tok = await decodeSessionCookie(cookies().get(slotCookieName(i))?.value)
    if (tok?.sub) {
      slots.push({ slot: i, id: tok.sub, email: (tok.email as string | undefined) ?? null, name: (tok.name as string | undefined) ?? null })
    }
  }
  return NextResponse.json({ slots })
}

export async function DELETE(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { slot?: number }
  const n = Number(body.slot)
  if (!Number.isInteger(n) || n < 0 || n >= MAX_SLOTS) {
    return NextResponse.json({ error: 'Invalid slot' }, { status: 400 })
  }
  const slotTok = await decodeSessionCookie(cookies().get(slotCookieName(n))?.value)
  const res = NextResponse.json({ ok: true })
  clearCookie(res, slotCookieName(n))
  // The main cookie is "the latest login" — if it holds the account being
  // logged out, clear it too so new tabs can't resurrect it. A DIFFERENT
  // account's main cookie (someone logged in after this tab bound) survives.
  const main = mainCookie()
  const mainTok = await decodeSessionCookie(main?.value)
  if (main && mainTok?.sub && slotTok?.sub && mainTok.sub === slotTok.sub) {
    clearCookie(res, main.name)
  }
  return res
}
