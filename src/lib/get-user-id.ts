import { getSlotAwareSession } from '@/lib/session-slots'

/**
 * The signed-in user's id (Google `sub`). Login is REQUIRED product-wide —
 * demo mode is gone. Middleware already 401s unauthenticated calls to every
 * user-data API and redirects /dashboard to /login, so the 'anonymous'
 * return below is a defensive dead branch (a route outside the middleware
 * matcher, a race during sign-out), never a supported identity: no data may
 * be written for it by design.
 *
 * PER-TAB ACCOUNTS: identity resolves through getSlotAwareSession — the
 * tab-bound slot cookie (selected by the x-account-slot header, verified by
 * signature) first, then the regular NextAuth session. Two tabs bound to
 * two slots act as two fully independent logins.
 */
export async function getUserId(): Promise<string> {
  const session = await getSlotAwareSession()
  return session?.user.id || 'anonymous'
}

export async function getUserInfo(): Promise<{ id: string; email?: string; name?: string; image?: string }> {
  const session = await getSlotAwareSession()
  if (session?.user) {
    return {
      id: session.user.id,
      email: session.user.email || undefined,
      name: session.user.name || undefined,
      image: session.user.image || undefined,
    }
  }
  return { id: 'anonymous' }
}
