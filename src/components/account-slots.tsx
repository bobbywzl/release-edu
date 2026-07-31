'use client'
/**
 * PER-TAB ACCOUNT BINDING (client half of src/lib/session-slots.ts).
 *
 * - A module-level fetch patch stamps every same-origin /api request with
 *   this tab's slot (`x-account-slot` from sessionStorage) — sessionStorage
 *   is per-tab by definition, so two tabs can act as two different accounts.
 * - <AccountSlotGate /> (wrapping the dashboard layout) binds the tab on
 *   arrival BEFORE any user-data fetch fires: it adopts the current NextAuth
 *   session into a slot cookie once, then renders the app. Rendering first
 *   and binding later let the first wave of fetches fall through to the
 *   MAIN session — briefly showing another tab's account (exactly the
 *   cross-tab bleed this system exists to prevent).
 * - slotSignOut() logs out ONLY this tab's account: its slot cookie dies
 *   (and the main cookie only when it holds the same account); other tabs
 *   bound to other slots stay signed in.
 */
import { useEffect, useState } from 'react'

const KEY = 'tree-account-slot'

export function slotBinding(): string | null {
  try { return sessionStorage.getItem(KEY) } catch { return null }
}
export function bindSlot(n: number) {
  try { sessionStorage.setItem(KEY, String(n)) } catch { /* private mode */ }
}
export function clearSlotBinding() {
  try { sessionStorage.removeItem(KEY) } catch { /* private mode */ }
}

// ── Fetch patch: stamp the tab's slot onto every same-origin /api call ──
// Module-level so it applies before ANY component effect fires. /api/auth/*
// is exempt (NextAuth + the slot endpoints read cookies directly).
declare global { interface Window { __slotFetchPatched?: boolean } }
if (typeof window !== 'undefined' && !window.__slotFetchPatched) {
  window.__slotFetchPatched = true
  const orig = window.fetch.bind(window)
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const path = url.startsWith('/') ? url : url.startsWith(window.location.origin) ? url.slice(window.location.origin.length) : null
      if (path && path.startsWith('/api/') && !path.startsWith('/api/auth/')) {
        const slot = slotBinding()
        if (slot !== null) {
          const h = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
          h.set('x-account-slot', slot)
          init = { ...init, headers: h }
        }
      }
    } catch { /* never break a fetch over the stamp */ }
    return orig(input as RequestInfo, init)
  }
}

/** Log out of THIS tab's account only. */
export async function slotSignOut() {
  const b = slotBinding()
  try {
    if (b !== null) {
      await fetch('/api/auth/slot', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slot: Number(b) }),
      })
    } else {
      // Unbound tab — classic sign-out of the main session.
      const m = await import('next-auth/react')
      await m.signOut({ redirect: false })
    }
  } catch { /* cookies may already be gone */ }
  clearSlotBinding()
  // ?switch=1 forces the login FORM. A bare /login auto-forwards whenever any
  // session survives (another tab's account) — which made logging out look
  // like being silently switched into the other account.
  window.location.href = '/login?switch=1'
}

/**
 * Wrap the dashboard layout: the tab is bound to its account slot BEFORE any
 * user-data fetch can fire, so every request from first paint onward carries
 * the right x-account-slot header. Shows a brief spinner on the very first
 * dashboard load in a fresh tab (one cookie round-trip); already-bound tabs
 * render instantly.
 */
export function AccountSlotGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (slotBinding() !== null) { if (!cancelled) setReady(true); return }
      try {
        const res = await fetch('/api/auth/slot', { method: 'POST' })
        if (res.ok) {
          const d = await res.json().catch(() => null)
          if (Number.isInteger(d?.slot)) bindSlot(d.slot)
          if (!cancelled) setReady(true)
          return
        }
        // No main session (a logout elsewhere cleared it) but other accounts
        // may still live in slot cookies — bind to the first and reload so
        // this fresh tab lands signed in as the remaining account.
        const list = await fetch('/api/auth/slot', { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).catch(() => null)
        const first = Array.isArray(list?.slots) ? list.slots[0] : null
        if (!cancelled && first && Number.isInteger(first.slot)) {
          bindSlot(first.slot)
          window.location.reload()
          return // keep the gate closed while the reload lands
        }
        // No sessions anywhere — render; middleware redirects the next nav.
        if (!cancelled) setReady(true)
      } catch {
        // Offline — never brick the app over the binding round-trip.
        if (!cancelled) setReady(true)
      }
    })()
    return () => { cancelled = true }
  }, [])
  if (!ready) {
    return (
      <div className="app-h w-full flex items-center justify-center bg-background">
        <div className="w-6 h-6 border-2 border-foreground/20 border-t-foreground rounded-full animate-spin" />
      </div>
    )
  }
  return <>{children}</>
}
