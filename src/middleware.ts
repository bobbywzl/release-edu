import { NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import type { NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  const { pathname, hostname } = request.nextUrl

  // ── Preview host canonicalization ──
  // Every preview build also answers on a per-deployment hash URL; OAuth is
  // pinned to the STABLE branch alias (see src/lib/auth.ts), and the state
  // cookie Google's callback must find lives on whichever host started the
  // sign-in. Converge ALL preview traffic onto the branch alias so cookies
  // and the callback always share one domain. No-op outside previews.
  const branchHost = process.env.VERCEL_BRANCH_URL
  if (
    process.env.VERCEL_ENV === 'preview' &&
    branchHost &&
    hostname !== branchHost &&
    hostname.endsWith('.vercel.app')
  ) {
    const url = request.nextUrl.clone()
    url.hostname = branchHost
    url.protocol = 'https:'
    url.port = ''
    return NextResponse.redirect(url, 308)
  }

  // User-data / AI API routes that must NEVER run for an unidentified caller
  // — otherwise getUserId() falls back to the shared "anonymous" bucket
  // (data leaks between strangers + unmetered Opus/Sonnet spend). These carry
  // the SAME gate as /dashboard (a NextAuth token OR the demo cookie pair);
  // excluded: /api/auth/* (NextAuth itself), /api/demo* (sets the demo
  // cookie), /api/admin/* (its own stronger gate below), /api/cron/* (secret-
  // gated jobs), /api/image/* (public generated-visual cache).
  const isUserApi = /^\/api\/(tree|xp|insights|files|conversations|portfolio|chat|student-profile|student-data|highlights|feedback|teacher|account|user|drive)(\/|$)/.test(pathname)

  // Everything below only guards the app's own gated areas.
  const isDashboard = pathname.startsWith('/dashboard')
  const isAdminArea = pathname.startsWith('/admin') || pathname.startsWith('/api/admin')
  if (!isDashboard && !isAdminArea && !isUserApi) return NextResponse.next()

  // Identified-caller gate for the user-data APIs (a 401, never a redirect —
  // these are fetch() targets). /api/teacher/* additionally enforces admin in
  // its handlers; here we only require an identified caller.
  if (isUserApi) {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET })
    const demo = request.cookies.get('demo-mode')?.value === 'true'
      && !!request.cookies.get('demo-session-id')?.value
    if (!token && !demo) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.next()
  }

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

    // Factor 2 — the authorized-EMAIL check is enforced LIVE (a DB read), so
    // allow-list changes take effect immediately. Middleware can't read the DB
    // (edge), so it happens downstream: PAGE routes enforce it in the (panel)
    // admin layout; API routes enforce it via adminApiGuard() in each handler.
    // NOTE: we must NOT rewrite request headers here (e.g. NextResponse.next({
    // request: { headers } })) — doing so strips the session cookie from the
    // downstream handler, so getServerSession() returns null and the email gate
    // rejects everyone. The (panel)/login route-group split removes any need to
    // forward the pathname, so a plain pass-through is correct.
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

// Matcher covers everything except Next internals/static assets so the
// preview-host redirect applies to /login and /api/auth/* too; the auth
// guards above still gate only /dashboard, /admin and /api/admin.
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico).*)'],
}
