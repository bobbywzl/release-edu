/**
 * PER-TAB ACCOUNT SLOTS — independent logins across tabs.
 *
 * The browser default (one session cookie per profile) makes every tab
 * follow the latest login/logout. Tree EDU instead keeps up to MAX_SLOTS
 * parallel sessions, each in its OWN signed httpOnly cookie
 * (`tree-session-slot-N` — the raw NextAuth JWT), and each tab remembers
 * which slot it belongs to in sessionStorage (per-tab by definition).
 * Every /api fetch carries that slot in the `x-account-slot` header.
 *
 * SECURITY MODEL: the header grants nothing. It only SELECTS which signed
 * cookie to verify — possession of the signed JWT cookie remains the sole
 * credential, exactly as with NextAuth's own cookie. No new trust surface.
 *
 * Resolution order everywhere: tab-bound slot first, then the regular
 * NextAuth session (the latest login) — so unbound tabs behave exactly as
 * before this feature existed.
 */
import { cookies, headers } from 'next/headers'
import { decode, type JWT } from 'next-auth/jwt'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export const MAX_SLOTS = 5
export const SLOT_HEADER = 'x-account-slot'
export const slotCookieName = (n: number) => `tree-session-slot-${n}`
/** NextAuth's own cookie: secure-prefixed on https, plain on localhost. */
export const MAIN_COOKIE_CANDIDATES = ['__Secure-next-auth.session-token', 'next-auth.session-token']

/** Verify + decode a raw NextAuth JWT cookie value. Null on anything invalid. */
export async function decodeSessionCookie(raw: string | undefined | null): Promise<JWT | null> {
  if (!raw) return null
  try {
    const tok = await decode({ token: raw, secret: process.env.NEXTAUTH_SECRET ?? '' })
    return tok?.sub ? tok : null
  } catch {
    return null
  }
}

/** The tab-bound identity: a valid slot header AND its signed cookie. */
export async function slotToken(): Promise<JWT | null> {
  try {
    const h = headers().get(SLOT_HEADER)
    if (!h || !/^[0-4]$/.test(h)) return null
    return await decodeSessionCookie(cookies().get(slotCookieName(Number(h)))?.value)
  } catch {
    return null
  }
}

export interface SlotAwareSession {
  user: { id: string; email?: string | null; name?: string | null; image?: string | null; role?: string }
  accessToken?: string
}

/**
 * Drop-in replacement for getServerSession in user-data routes:
 * tab-bound slot identity first, then the regular NextAuth session.
 */
export async function getSlotAwareSession(): Promise<SlotAwareSession | null> {
  const tok = await slotToken()
  if (tok?.sub) {
    return {
      user: {
        id: tok.sub,
        email: (tok.email as string | undefined) ?? null,
        name: (tok.name as string | undefined) ?? null,
        image: (tok.picture as string | undefined) ?? null,
        role: tok.role as string | undefined,
      },
      accessToken: tok.accessToken as string | undefined,
    }
  }
  const session = await getServerSession(authOptions)
  if (!session?.user) return null
  return {
    user: {
      id: (session.user as { id?: string }).id || session.user.email || 'unknown',
      email: session.user.email ?? null,
      name: session.user.name ?? null,
      image: (session.user as { image?: string }).image ?? null,
      role: (session.user as { role?: string }).role,
    },
    accessToken: (session as { accessToken?: string }).accessToken,
  }
}
