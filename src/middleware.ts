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

  // User-data / AI API routes that must NEVER run for an unauthenticated
  // caller — otherwise getUserId() falls back to the shared "anonymous"
  // bucket (data leaks between strangers + unmetered AI spend). Login is
  // REQUIRED product-wide (demo mode is gone): only a NextAuth token passes.
  // Excluded: /api/auth/* (NextAuth itself), /api/admin/* (its own stronger
  // gate below), /api/cron/* (secret-gated jobs), /api/image/* (public
  // generated-visual cache).
  const isUserApi = /^\/api\/(tree|xp|insights|files|conversations|portfolio|chat|student-profile|student-data|highlights|feedback|teacher|account|user|drive)(\/|$)/.test(pathname)

  // Everything below only guards the app's own gated areas. /m is the mobile
  // app — same login requirement as /dashboard.
  const isDashboard = pathname.startsWith('/dashboard')
  const isMobileApp = pathname === '/m' || pathname.startsWith('/m/')
  const isAdminArea = pathname.startsWith('/admin') || pathname.startsWith('/api/admin')
  if (!isDashboard && !isMobileApp && !isAdminArea && !isUserApi) return NextResponse.next()

  // Authenticated-caller gate for the user-data APIs (a 401, never a redirect
  // — these are fetch() targets). /api/teacher/* additionally enforces admin
  // in its handlers; here we only require a signed-in caller.
  // PER-TAB ACCOUNTS: a tab bound to an account slot sends x-account-slot;
  // the header only SELECTS which signed slot cookie to verify — the cookie
  // signature stays the sole credential. Unbound tabs use the main session.
  if (isUserApi) {
    const secret = process.env.NEXTAUTH_SECRET
    const slotHeader = request.headers.get('x-account-slot')
    let authed = false
    if (slotHeader && /^[0-4]$/.test(slotHeader)) {
      authed = !!(await getToken({ req: request, secret, cookieName: `tree-session-slot-${slotHeader}` }))
    }
    if (!authed) authed = !!(await getToken({ req: request, secret }))
    if (!authed) {
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

  // Student dashboard — a signed-in session is required, no exceptions
  // (demo mode is gone; the web app is unusable without logging in).
  // Page navigations can't carry the slot header, so ANY live session —
  // the main cookie or any account slot — passes the gate; the page's own
  // fetches then resolve the tab's bound identity.
  const secret = process.env.NEXTAUTH_SECRET
  let anySession = !!(await getToken({ req: request, secret }))
  for (let i = 0; i < 5 && !anySession; i++) {
    anySession = !!(await getToken({ req: request, secret, cookieName: `tree-session-slot-${i}` }))
  }
  if (!anySession) {
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
