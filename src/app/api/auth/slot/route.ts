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
 *
 * All cookie IO is CHUNK-AWARE (session-slots.ts): real Google JWTs with
 * Drive tokens regularly exceed the 4KB cookie cap, arriving as `name.0`,
 * `name.1`, … — and must be stored back the same way (an oversized single
 * Set-Cookie is silently dropped by the browser).
 */
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import {
  decodeSessionCookie, slotCookieName, MAX_SLOTS,
  readMainSessionCookie, readSlotCookieValue,
  COOKIE_CHUNK_SIZE, MAX_COOKIE_CHUNKS, MAIN_COOKIE_CANDIDATES,
} from '@/lib/session-slots'

const isSecure = () => (process.env.NEXTAUTH_URL ?? '').startsWith('https') || process.env.VERCEL === '1'

const COOKIE_OPTS = () => ({
  httpOnly: true, sameSite: 'lax' as const, secure: isSecure(), path: '/',
})

/** Write a value under `name`, chunking NextAuth-style when it exceeds the
 *  per-cookie cap; always clears the representation NOT in use so stale
 *  chunks/base can never shadow a fresh write. */
function setChunkedCookie(res: NextResponse, name: string, value: string) {
  const opts = { ...COOKIE_OPTS(), maxAge: 30 * 24 * 60 * 60 }
  if (value.length <= COOKIE_CHUNK_SIZE) {
    res.cookies.set(name, value, opts)
    for (let i = 0; i < MAX_COOKIE_CHUNKS; i++) res.cookies.set(`${name}.${i}`, '', { ...COOKIE_OPTS(), maxAge: 0 })
  } else {
    res.cookies.set(name, '', { ...COOKIE_OPTS(), maxAge: 0 })
    const parts = Math.ceil(value.length / COOKIE_CHUNK_SIZE)
    for (let i = 0; i < MAX_COOKIE_CHUNKS; i++) {
      if (i < parts) res.cookies.set(`${name}.${i}`, value.slice(i * COOKIE_CHUNK_SIZE, (i + 1) * COOKIE_CHUNK_SIZE), opts)
      else res.cookies.set(`${name}.${i}`, '', { ...COOKIE_OPTS(), maxAge: 0 })
    }
  }
}

/** Clear a cookie in both base and chunked representations. */
function clearChunkedCookie(res: NextResponse, name: string) {
  res.cookies.set(name, '', { ...COOKIE_OPTS(), maxAge: 0 })
  for (let i = 0; i < MAX_COOKIE_CHUNKS; i++) res.cookies.set(`${name}.${i}`, '', { ...COOKIE_OPTS(), maxAge: 0 })
}

export async function POST() {
  const store = cookies()
  const main = readMainSessionCookie(store)
  const tok = await decodeSessionCookie(main?.value)
  if (!main || !tok?.sub) {
    return NextResponse.json({ error: 'No active session to adopt' }, { status: 401 })
  }
  // Reuse this account's existing slot (refreshes its token), else first free.
  let chosen = -1
  for (let i = 0; i < MAX_SLOTS; i++) {
    const existing = await decodeSessionCookie(readSlotCookieValue(store, i))
    if (existing?.sub === tok.sub) { chosen = i; break }
  }
  if (chosen < 0) {
    for (let i = 0; i < MAX_SLOTS; i++) {
      const existing = await decodeSessionCookie(readSlotCookieValue(store, i))
      if (!existing) { chosen = i; break }
    }
  }
  if (chosen < 0) chosen = 0 // browser full of live sessions — recycle slot 0
  const res = NextResponse.json({
    slot: chosen,
    user: { id: tok.sub, email: tok.email ?? null, name: tok.name ?? null },
  })
  setChunkedCookie(res, slotCookieName(chosen), main.value)
  return res
}

export async function GET() {
  const store = cookies()
  const slots: Array<{ slot: number; id: string; email: string | null; name: string | null }> = []
  for (let i = 0; i < MAX_SLOTS; i++) {
    const tok = await decodeSessionCookie(readSlotCookieValue(store, i))
    if (tok?.sub) {
      slots.push({ slot: i, id: tok.sub, email: (tok.email as string | undefined) ?? null, name: (tok.name as string | undefined) ?? null })
    }
  }
  return NextResponse.json({ slots })
}

export async function DELETE(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { slot?: number; scope?: string }
  const n = Number(body.slot)
  if (!Number.isInteger(n) || n < 0 || n >= MAX_SLOTS) {
    return NextResponse.json({ error: 'Invalid slot' }, { status: 400 })
  }
  const store = cookies()
  const slotTok = await decodeSessionCookie(readSlotCookieValue(store, n))
  const res = NextResponse.json({ ok: true })
  // scope 'tab' (slotSignOut): sign out THIS TAB only. Same-account tabs
  // share one slot cookie, so the cookie must SURVIVE — killing it signed
  // out every tab of the account (and freed the number for the next login
  // to adopt, silently switching stale tabs; the uid claim now also guards
  // that). scope 'account' (default, and all older clients): remove the
  // account from the browser entirely — slot cookie included.
  if (body.scope !== 'tab') {
    clearChunkedCookie(res, slotCookieName(n))
  }
  // The main cookie is "the latest login" — if it holds the account being
  // logged out, clear it so a bare /login (or a fresh tab) can't silently
  // resurrect it. A DIFFERENT account's main cookie survives.
  const main = readMainSessionCookie(store)
  const mainTok = await decodeSessionCookie(main?.value)
  if (main && mainTok?.sub && slotTok?.sub && mainTok.sub === slotTok.sub) {
    for (const name of MAIN_COOKIE_CANDIDATES) clearChunkedCookie(res, name)
  }
  return res
}
