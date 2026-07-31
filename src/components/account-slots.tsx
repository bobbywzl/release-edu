'use client'
/**
 * PER-TAB ACCOUNT BINDING (client half of src/lib/session-slots.ts).
 *
 * - A module-level fetch patch stamps every same-origin /api request with
 *   this tab's slot (`x-account-slot` from sessionStorage) — sessionStorage
 *   is per-tab by definition, so two tabs can act as two different accounts.
 * - <AccountSlotSync /> (mounted in the dashboard layout) binds the tab on
 *   arrival: it adopts the current NextAuth session into a slot cookie once,
 *   after which this tab is immune to logins/logouts in other tabs.
 * - slotSignOut() logs out ONLY this tab's account: its slot cookie dies
 *   (and the main cookie only when it holds the same account); other tabs
 *   bound to other slots stay signed in.
 */
import { useEffect } from 'react'

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
  window.location.href = '/login'
}

/** Mounted once in the dashboard layout: binds the tab to its account. */
export function AccountSlotSync() {
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (slotBinding() !== null) return
      try {
        const res = await fetch('/api/auth/slot', { method: 'POST' })
        if (res.ok) {
          const d = await res.json().catch(() => null)
          if (!cancelled && Number.isInteger(d?.slot)) bindSlot(d.slot)
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
        }
      } catch { /* offline — the next dashboard mount retries */ }
    })()
    return () => { cancelled = true }
  }, [])
  return null
}
