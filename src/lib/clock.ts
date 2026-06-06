/**
 * Time/clock primitives.
 *
 * Server-side: import `serverNow()` whenever you stamp completedAt /
 * startedAt / lockedAt / archivedAt — never `new Date()` directly. This
 * gives us one place to mock time in tests and one place to add audit
 * hooks ("X just completed at T").
 *
 * Client-side: import `useServerClock()` for any time-comparison decision
 * (lock window, restore window, deadline). The hook fetches /api/clock once,
 * stores the offset between server and client clocks, and returns a `now()`
 * function that produces server-correct timestamps even if the user's
 * machine clock is wrong.
 */

'use client'

import { useEffect, useState } from 'react'

// ── Server-side ──────────────────────────────────────────────────────────────
// Plain helper, no React. Safe to import in route.ts files.

export function serverNow(): Date {
  return new Date()
}

export function serverNowIso(): string {
  return new Date().toISOString()
}

// ── Client-side hook ─────────────────────────────────────────────────────────

let _serverOffsetMs: number | null = null  // serverTime - clientTime, ms
let _userTimezone: string | null = null

/** Fire-and-forget fetch of /api/clock, populates module-level cache. */
async function syncClock() {
  try {
    const t0 = Date.now()
    const res = await fetch('/api/clock', { cache: 'no-store' })
    const t1 = Date.now()
    if (!res.ok) return
    const { nowMs, userTimezone } = await res.json() as { nowMs: number; userTimezone: string }
    // Adjust for round-trip latency — assume server time was sampled
    // halfway through the request.
    const clientMidpoint = t0 + (t1 - t0) / 2
    _serverOffsetMs = nowMs - clientMidpoint
    _userTimezone = userTimezone
  } catch {
    // Leave previous offset in place; if none, fall back to client clock.
  }
}

/** Server-corrected current time. Falls back to client clock if not synced. */
export function now(): Date {
  if (_serverOffsetMs === null) return new Date()
  return new Date(Date.now() + _serverOffsetMs)
}

export function nowMs(): number {
  return _serverOffsetMs === null ? Date.now() : Date.now() + _serverOffsetMs
}

/** IANA timezone for the current user, populated by the clock sync. */
export function userTimezone(): string {
  return _userTimezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
}

/**
 * Hook to mount once near app root. Re-syncs every 5 min to stay accurate
 * across long sessions. Returns the server-corrected now() and timezone.
 */
export function useServerClock() {
  const [, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    void syncClock().then(() => { if (!cancelled) setTick(t => t + 1) })
    const interval = setInterval(syncClock, 5 * 60 * 1000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [])

  return { now, nowMs, userTimezone, synced: _serverOffsetMs !== null }
}

// ── Display helpers — apply user's timezone consistently ─────────────────────

export function formatDateInUserTz(d: Date | string, opts?: Intl.DateTimeFormatOptions): string {
  const date = typeof d === 'string' ? new Date(d) : d
  return date.toLocaleString('en-US', {
    timeZone: userTimezone(),
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...opts,
  })
}

export function formatDateTimeInUserTz(d: Date | string): string {
  return formatDateInUserTz(d, {
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  })
}

/** Human-friendly "2 hours ago" / "Tuesday at 3:00 PM" style output. */
export function relativeTime(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d
  const diffMs = nowMs() - date.getTime()
  const diffSec = Math.round(diffMs / 1000)
  if (diffSec < 60) return 'just now'
  const diffMin = Math.round(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.round(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.round(diffHr / 24)
  if (diffDay < 7) return `${diffDay}d ago`
  return formatDateInUserTz(date)
}

/** Returns ms remaining until a deadline; negative if past. */
export function timeUntil(deadline: Date | string): number {
  const target = typeof deadline === 'string' ? new Date(deadline) : deadline
  return target.getTime() - nowMs()
}
