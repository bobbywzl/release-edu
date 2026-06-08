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

    // Factor 2 — the authorized-EMAIL check is enforced LIVE (a DB read), so
    // allow-list changes take effect immediately. Middleware can't read the DB
    // (edge), so it happens downstream: PAGE routes enforce it in the admin
    // layout; API routes enforce it via adminApiGuard() in each handler. We
    // forward the pathname so the layout knows which page it's rendering (and
    // can skip the gate on /admin/login).
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
