// Run: start 'npx next dev -p 3111' with NEXTAUTH_SECRET, NEXTAUTH_URL=http://localhost:3111,
// TEST_LOGIN_TOKEN (16+ chars), and any DATABASE_URL; then: node scripts/auth-e2e.mjs
// Requires playwright-core (npm i -D --no-save playwright-core) + the preinstalled Chromium.
// E2E: per-tab multi-account — two tabs, two accounts, one browser.
// Uses the env-gated agent-test credentials provider (no Google round-trip)
// and asserts the exact user-reported failure: logging into account B in a
// second tab must NOT take over the first tab's account A.
// Also verifies the CHUNKED main-cookie path (the real-world root cause).
import { chromium, request } from 'playwright-core'

const BASE = 'http://localhost:3111'
const results = []
const check = (pass, name, detail = '') => { results.push([pass, name, detail]); console.log(`${pass ? 'PASS' : 'FAIL'} — ${name}${detail ? ` (${detail})` : ''}`) }

async function signIn(context, persona) {
  const csrfRes = await context.request.get(`${BASE}/api/auth/csrf`)
  const { csrfToken } = await csrfRes.json()
  const res = await context.request.post(`${BASE}/api/auth/callback/agent-test`, {
    form: { csrfToken, token: 'qa-token-16chars-minimum-ok', persona, json: 'true' },
  })
  if (res.status() >= 400) throw new Error(`signIn ${persona} failed: ${res.status()}`)
}

// The x-account-slot header is stamped by a module-level fetch patch that
// installs at hydration — the app's own data fetches all run after it, so
// the probe must too (evaluating before hydration would fake a failure).
const meOf = async page => {
  await page.waitForFunction(() => window.__slotFetchPatched === true, { timeout: 15000 }).catch(() => {})
  return page.evaluate(() =>
    fetch('/api/account/me', { cache: 'no-store' }).then(r => (r.ok ? r.json() : { status: r.status })))
}
const bindingOf = page => page.evaluate(() => sessionStorage.getItem('tree-account-slot')).catch(() => null)
const waitBound = async page => {
  for (let i = 0; i < 40; i++) {
    if ((await bindingOf(page)) !== null) return true
    await page.waitForTimeout(250).catch(() => {})
  }
  return false
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
try {
  const context = await browser.newContext()

  // ── Tab 1: sign in as maya, land on the dashboard, bind a slot ──
  await signIn(context, 'maya')
  const page1 = await context.newPage()
  await page1.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' })
  check(await waitBound(page1), 'tab1 binds an account slot on arrival', `slot=${await bindingOf(page1)}`)
  const me1 = await meOf(page1)
  check(me1?.user?.email === 'maya@qa.tree-edu.internal', 'tab1 identity is maya', JSON.stringify(me1?.user?.email))

  // ── Tab 2: switch-account flow → sign in as david ──
  const page2 = await context.newPage()
  await page2.goto(`${BASE}/login?switch=1`, { waitUntil: 'domcontentloaded' })
  await signIn(context, 'david') // replaces the MAIN session cookie browser-wide
  await page2.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' })
  check(await waitBound(page2), 'tab2 binds its own slot', `slot=${await bindingOf(page2)}`)
  const me2 = await meOf(page2)
  check(me2?.user?.email === 'david@qa.tree-edu.internal', 'tab2 identity is david', JSON.stringify(me2?.user?.email))
  check((await bindingOf(page1)) !== (await bindingOf(page2)), 'tabs hold different slots', `${await bindingOf(page1)} vs ${await bindingOf(page2)}`)

  // ── THE reported bug: tab1 must still be maya after david's login ──
  const me1After = await meOf(page1)
  check(me1After?.user?.email === 'maya@qa.tree-edu.internal', 'tab1 STILL maya after david logs in elsewhere', JSON.stringify(me1After?.user?.email))
  await page1.reload({ waitUntil: 'domcontentloaded' })
  const me1Reload = await meOf(page1)
  check(me1Reload?.user?.email === 'maya@qa.tree-edu.internal', 'tab1 still maya after a full reload', JSON.stringify(me1Reload?.user?.email))

  // ── Chunked main cookie: split the session token exactly like NextAuth
  //    does for >4KB JWTs (the real-Google-login case) and confirm the slot
  //    endpoints still read it — the code path that used to 401 and leave
  //    every tab following the newest login. Sent as an explicit Cookie
  //    header: Chromium refuses to attach CDP-injected httpOnly cookies to
  //    page requests (a Playwright artifact, not an app behavior), but the
  //    server-side read path — the thing this fix changed — is identical.
  const jar = await context.cookies(BASE)
  const main = jar.find(c => c.name === 'next-auth.session-token')
  check(!!main, 'main session cookie present for chunk test')
  if (main) {
    const cut = Math.ceil(main.value.length / 2)
    const chunkHeader = `next-auth.session-token.0=${main.value.slice(0, cut)}; next-auth.session-token.1=${main.value.slice(cut)}`
    // Isolated request context: the explicit Cookie header would otherwise
    // shadow the browser jar's slot cookies for this one request, letting
    // the response's Set-Cookie recycle a slot the live tabs depend on.
    const rc = await request.newContext()
    const adopt = await rc.post(`${BASE}/api/auth/slot`, { headers: { cookie: chunkHeader } })
    const adoptBody = adopt.ok() ? await adopt.json() : null
    check(adopt.ok() && adoptBody?.user?.email === 'david@qa.tree-edu.internal', 'slot adoption reads a CHUNKED main cookie', `status=${adopt.status()} email=${JSON.stringify(adoptBody?.user?.email)}`)
    await rc.dispose()
  }

  // ── Per-tab logout: david's tab signs out; maya's tab survives ──
  await page2.evaluate(() => {
    const b = sessionStorage.getItem('tree-account-slot')
    return fetch('/api/auth/slot', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slot: Number(b) }),
    }).then(r => r.ok)
  })
  const me2Out = await meOf(page2)
  check(me2Out?.user?.email !== 'david@qa.tree-edu.internal', 'tab2 signed out (david slot cleared)', JSON.stringify(me2Out))
  const me1Final = await meOf(page1)
  check(me1Final?.user?.email === 'maya@qa.tree-edu.internal', 'tab1 STILL maya after tab2 logout', JSON.stringify(me1Final?.user?.email))
} finally {
  await browser.close()
}

const failed = results.filter(([p]) => !p)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
