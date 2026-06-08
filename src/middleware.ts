import { NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import type { NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Admin login page AND the password-auth endpoint are always reachable with
  // no auth — they ARE the gate (password-based, independent of Google login).
  // Without exempting /api/admin/auth here it falls through to the student-auth
  // check below, which redirects unauthenticated POSTs to /login — making it
  // impossible to log into admin unless you happen to already be signed into
  // Google in the same browser.
  if (pathname === '/admin/login' || pathname.startsWith('/api/admin/auth')) {
    return NextResponse.next()
  }

  // Admin pages & API — require admin-auth cookie + authorized Gmail
  const isAdminPage = pathname.startsWith('/admin') || pathname.startsWith('/dashboard/admin')
  const isAdminApi = pathname.startsWith('/api/admin') && !pathname.startsWith('/api/admin/auth')

  if (isAdminPage || isAdminApi) {
    // Factor 1 — the shared admin PASSWORD (admin-auth cookie).
    const adminAuth = request.cookies.get('admin-auth')?.value
    if (adminAuth !== 'true') {
      if (isAdminApi) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      return NextResponse.redirect(new URL('/admin/login', request.url))
    }

    // Factor 2 — must ALSO be signed in with an authorized admin EMAIL. Admin =
    // email in ADMIN_EMAILS env (owner safeguard) OR token.isAdmin (resolved from
    // role / the editable AdminEmail allow-list at sign-in). Unauthorized callers
    // go back to the admin login with a clear message — NEVER to the user flow.
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET })
    const envAdmins = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
    const emailLower = (token?.email as string | undefined)?.toLowerCase()
    const isAdmin = token?.isAdmin === true || (!!emailLower && envAdmins.includes(emailLower))
    if (!isAdmin) {
      if (isAdminApi) {
        return NextResponse.json({ error: 'Forbidden — not an authorized admin email' }, { status: 403 })
      }
      return NextResponse.redirect(new URL('/admin/login?error=email', request.url))
    }

    return NextResponse.next()
  }

  // Student dashboard — require auth or demo mode
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET })
  const demoMode = request.cookies.get('demo-mode')?.value === 'true'

  if (!token && !demoMode) {
    return NextResponse.redirect(new URL('/login', request.url))
  }
  return NextResponse.next()
}

export const config = { matcher: ['/dashboard/:path*', '/admin/:path*', '/api/admin/:path*'] }
