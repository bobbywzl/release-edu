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
    // Forward the pathname so the admin layout knows it's the login page and
    // renders it bare (no admin header, no email gate — it IS the gate).
    const headers = new Headers(request.headers)
    headers.set('x-admin-pathname', pathname)
    return NextResponse.next({ request: { headers } })
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

    // Factor 2 — must ALSO be an authorized admin EMAIL. For API routes we check
    // it here from the JWT (env owner is immediate; DB-allow-list admins resolve
    // on their next sign-in). For PAGE routes the email gate is enforced LIVE in
    // the admin layout (a DB read), so allow-list changes take effect instantly
    // and the layout can skip the check on /admin/login. We forward the pathname
    // so the layout knows which page it is rendering.
    if (isAdminApi) {
      const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET })
      const envAdmins = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
      const emailLower = (token?.email as string | undefined)?.toLowerCase()
      const isAdmin = token?.isAdmin === true || (!!emailLower && envAdmins.includes(emailLower))
      if (!isAdmin) {
        return NextResponse.json({ error: 'Forbidden — not an authorized admin email' }, { status: 403 })
      }
      return NextResponse.next()
    }

    const headers = new Headers(request.headers)
    headers.set('x-admin-pathname', pathname)
    return NextResponse.next({ request: { headers } })
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
