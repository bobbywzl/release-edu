import { NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import type { NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Admin login page — always accessible, no auth required
  if (pathname === '/admin/login') {
    return NextResponse.next()
  }

  // Admin pages & API — require admin-auth cookie + authorized Gmail
  const isAdminPage = pathname.startsWith('/admin') || pathname.startsWith('/dashboard/admin')
  const isAdminApi = pathname.startsWith('/api/admin') && !pathname.startsWith('/api/admin/auth')

  if (isAdminPage || isAdminApi) {
    const adminAuth = request.cookies.get('admin-auth')?.value
    if (adminAuth !== 'true') {
      if (isAdminApi) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      return NextResponse.redirect(new URL('/admin/login', request.url))
    }

    // Verify the caller is authorized: either their email is in the
    // ADMIN_EMAILS bootstrap list, OR their DB role is "admin" (granted via the
    // admin dashboard). The email list is the always-on owner safeguard.
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET })
    const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
    if (adminEmails.length > 0 && token?.email) {
      const userEmail = (token.email as string).toLowerCase()
      const isRoleAdmin = (token.role as string | undefined) === 'admin'
      if (!adminEmails.includes(userEmail) && !isRoleAdmin) {
        if (isAdminApi) {
          return NextResponse.json({ error: 'Forbidden — not an admin' }, { status: 403 })
        }
        return NextResponse.redirect(new URL('/dashboard', request.url))
      }
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
