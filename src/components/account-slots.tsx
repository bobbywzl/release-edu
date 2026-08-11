'use client'
/**
 * PER-TAB ACCOUNT BINDING (client half of src/lib/session-slots.ts).
 *
 * - A module-level fetch patch stamps every same-origin /api request with
 *   this tab's slot (`x-account-slot`) AND the account the tab believes that
 *   slot holds (`x-account-uid`) — both from sessionStorage, per-tab by
 *   definition. The uid pin is what makes tabs truly independent: slot
 *   numbers get re-occupied (sign out X, sign in Y → Y may adopt X's freed
 *   number), and without the pin a tab still stamping the old number
 *   silently BECAME the new account. With it, the server refuses the claim
 *   and the tab logs out truthfully instead of switching.
 * - <AccountSlotGate /> (wrapping the dashboard layout) binds the tab on
 *   arrival BEFORE any user-data fetch fires, and VERIFIES an existing
 *   binding still points at the same account (rebinding if not).
 * - slotSignOut() signs out ONLY this tab: the binding dies and the main
 *   cookie is cleared when it holds this tab's account — but the slot
 *   cookie itself survives, because sibling tabs of the SAME account share
 *   it and must stay signed in.
 */
import { useEffect, useState } from 'react'

const KEY = 'tree-account-slot'

interface TabBinding { slot: number; uid: string | null }

export function readBinding(): TabBinding | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (raw === null) return null
    // Legacy format (pre uid-pin): a bare slot number. Honored, and the
    // gate upgrades it to the pinned form on next verification.
    if (/^[0-4]$/.test(raw)) return { slot: Number(raw), uid: null }
    const p = JSON.parse(raw) as { s?: number; u?: string }
    if (Number.isInteger(p?.s)) return { slot: p.s as number, uid: typeof p.u === 'string' ? p.u : null }
    return null
  } catch { return null }
}
export function bindSlot(slot: number, uid: string | null) {
  try { sessionStorage.setItem(KEY, JSON.stringify({ s: slot, ...(uid ? { u: uid } : {}) })) } catch { /* private mode */ }
}
export function clearSlotBinding() {
  try { sessionStorage.removeItem(KEY) } catch { /* private mode */ }
}

// ── Fetch patch: stamp the tab's claim onto every same-origin /api call ──
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
        const b = readBinding()
        if (b !== null) {
          const h = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
          h.set('x-account-slot', String(b.slot))
          if (b.uid) h.set('x-account-uid', b.uid)
          init = { ...init, headers: h }
        }
      }
    } catch { /* never break a fetch over the stamp */ }
    return orig(input as RequestInfo, init)
  }
}

/** Log out of THIS tab only (scope 'tab': sibling tabs of the same account
 *  keep their shared slot cookie and stay signed in). */
export async function slotSignOut() {
  const b = readBinding()
  try {
    if (b !== null) {
      await fetch('/api/auth/slot', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slot: b.slot, scope: 'tab' }),
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
 * the right claim. An EXISTING binding is verified against the live slots
 * (the slot must still hold the same account) — a stale binding rebinds
 * instead of riding a number that now belongs to someone else.
 */
export function AccountSlotGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const adopt = async (): Promise<boolean> => {
        const res = await fetch('/api/auth/slot', { method: 'POST' })
        if (!res.ok) return false
        const d = await res.json().catch(() => null)
        if (Number.isInteger(d?.slot)) bindSlot(d.slot, typeof d?.user?.id === 'string' ? d.user.id : null)
        return true
      }
      try {
        const b = readBinding()
        if (b !== null) {
          // Verify the claim: the bound slot must still exist and hold the
          // SAME account (legacy uid-less bindings adopt the slot's current
          // account — the best truth available — and upgrade to pinned).
          const list = await fetch('/api/auth/slot', { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).catch(() => null)
          const live = Array.isArray(list?.slots) ? list.slots.find((s: { slot: number }) => s.slot === b.slot) : null
          if (live && (b.uid === null || live.id === b.uid)) {
            if (b.uid === null && typeof live.id === 'string') bindSlot(b.slot, live.id)
            if (!cancelled) setReady(true)
            return
          }
          // Stale claim — this tab's session ended (or the number was
          // re-occupied). Fall through to a fresh bind.
          clearSlotBinding()
        }
        if (await adopt()) { if (!cancelled) setReady(true); return }
        // No main session (a logout elsewhere cleared it) but other accounts
        // may still live in slot cookies — bind to the first and reload so
        // this fresh tab lands signed in as the remaining account.
        const list = await fetch('/api/auth/slot', { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).catch(() => null)
        const first = Array.isArray(list?.slots) ? list.slots[0] : null
        if (!cancelled && first && Number.isInteger(first.slot)) {
          bindSlot(first.slot, typeof first.id === 'string' ? first.id : null)
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
