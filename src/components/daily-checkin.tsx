'use client'
/**
 * DailyCheckin — fires the show-up reward on app entry.
 *
 * Mounted once in the dashboard layout. POSTs /api/xp/checkin; on the first
 * visit of the day the server returns the daily-streak + first-session
 * awards, which land as XP toasts (ding included) the moment the user
 * arrives — the day's loop opens with a win. Subsequent mounts and extra
 * tabs are server-side no-ops.
 */
import { useEffect, useRef } from 'react'
import { emitXpAwards } from '@/components/xp-toast'

export function DailyCheckin() {
  const fired = useRef(false)
  useEffect(() => {
    if (fired.current) return
    fired.current = true
    fetch('/api/xp/checkin', { method: 'POST' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (Array.isArray(d?.awards) && d.awards.length > 0) {
          // Small delay so the toast lands after first paint, not during it.
          setTimeout(() => emitXpAwards(d.awards), 900)
        }
      })
      .catch(() => { /* non-critical */ })
  }, [])
  return null
}
