import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

/**
 * The signed-in user's id (Google `sub`). Login is REQUIRED product-wide —
 * demo mode is gone. Middleware already 401s unauthenticated calls to every
 * user-data API and redirects /dashboard to /login, so the 'anonymous'
 * return below is a defensive dead branch (a route outside the middleware
 * matcher, a race during sign-out), never a supported identity: no data may
 * be written for it by design.
 */
export async function getUserId(): Promise<string> {
  const session = await getServerSession(authOptions)
  if (session?.user) {
    return (session.user as { id?: string }).id || session.user.email || 'unknown'
  }
  return 'anonymous'
}

export async function getUserInfo(): Promise<{ id: string; email?: string; name?: string; image?: string }> {
  const session = await getServerSession(authOptions)
  if (session?.user) {
    return {
      id: (session.user as { id?: string }).id || session.user.email || 'unknown',
      email: session.user.email || undefined,
      name: session.user.name || undefined,
      image: (session.user as { image?: string }).image || undefined,
    }
  }
  return { id: 'anonymous' }
}
