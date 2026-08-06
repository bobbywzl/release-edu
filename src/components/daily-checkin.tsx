'use client'
/**
 * DailyCheckin — fires the show-up reward on app entry.
 *
 * Mounted once in the dashboard layout. POSTs /api/xp/checkin; on the first
 * visit of the day the server returns the daily-streak + first-session
 * awards, which land as XP toasts (ding included) the moment the user
 * arrives — the day's loop opens with a win. Subsequent mounts and extra
 * tabs are server-side no-ops.
 *
 * THE HONEST STREAK MOMENTS (satisfaction audit #3): the same response can
 * carry streak-transition events, rendered as a center card instead of being
 * swallowed behind cheery toasts:
 *   streakEnded  — "your N-day run ended" (+ "your longest ever" when true)
 *   shieldUsed   — a banked shield auto-bridged one missed day (always told)
 *   shieldEarned — a completed week banked a new shield
 */
import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Flame, Shield, X } from 'lucide-react'
import { emitXpAwards, emitBadgeEvents } from '@/components/xp-toast'
import { useLanguage } from '@/lib/i18n'

interface StreakEvent {
  kind: 'ended' | 'shieldUsed' | 'shieldEarned'
  previous?: number
  wasRecord?: boolean
  streak?: number
}

export function DailyCheckin() {
  const { t } = useLanguage()
  const fired = useRef(false)
  const [event, setEvent] = useState<StreakEvent | null>(null)

  useEffect(() => {
    if (fired.current) return
    fired.current = true
    // Send the browser's IANA timezone so the streak's "new day" boundary
    // is the learner's midnight, not the server's.
    let timeZone: string | undefined
    try { timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone } catch { /* fallback: server tz */ }
    fetch('/api/xp/checkin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timeZone }),
    })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (!d) return
        // The transition card leads; the XP toasts follow it so the honest
        // acknowledgment is never buried under the payout.
        if (d.streakEnded?.previous) {
          setEvent({ kind: 'ended', previous: d.streakEnded.previous, wasRecord: !!d.streakEnded.wasRecord })
        } else if (d.shieldUsed) {
          setEvent({ kind: 'shieldUsed', streak: d.streak })
        } else if (d.shieldEarned) {
          setEvent({ kind: 'shieldEarned', streak: d.streak })
        }
        if (Array.isArray(d?.awards) && d.awards.length > 0) {
          // Small delay so the toast lands after first paint, not during it.
          setTimeout(() => emitXpAwards(d.awards), 900)
        }
        // Streak-rung badge unlocks celebrate on arrival, after the toasts.
        if (Array.isArray(d?.newBadges) && d.newBadges.length > 0) {
          setTimeout(() => emitBadgeEvents(d.newBadges), 1800)
        }
      })
      .catch(() => { /* non-critical */ })
  }, [])

  // The card self-dismisses after a beat; a tap dismisses immediately.
  useEffect(() => {
    if (!event) return
    const timer = setTimeout(() => setEvent(null), 9000)
    return () => clearTimeout(timer)
  }, [event])

  return (
    <AnimatePresence>
      {event && (
        <motion.div
          initial={{ opacity: 0, y: -14, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className="fixed top-16 inset-x-0 z-[70] flex justify-center px-4 pointer-events-none"
        >
          <div
            className={
              event.kind === 'ended'
                ? 'pointer-events-auto max-w-md w-full rounded-2xl border border-amber-400/40 bg-card/95 backdrop-blur-xl shadow-2xl p-4 flex items-start gap-3'
                : 'pointer-events-auto max-w-md w-full rounded-2xl border border-sky-400/40 bg-card/95 backdrop-blur-xl shadow-2xl p-4 flex items-start gap-3'
            }
          >
            {event.kind === 'ended'
              ? <Flame className="w-6 h-6 text-amber-400 flex-shrink-0 mt-0.5" />
              : <Shield className="w-6 h-6 text-sky-300 flex-shrink-0 mt-0.5" />}
            <div className="flex-1 min-w-0">
              {event.kind === 'ended' && (
                <>
                  <p className="text-sm font-bold text-foreground">
                    {t('streak.endedTitle').replace('{n}', String(event.previous))}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
                    {event.wasRecord ? t('streak.endedRecord') : t('streak.endedBody')} {t('streak.endedRestart')}
                  </p>
                </>
              )}
              {event.kind === 'shieldUsed' && (
                <>
                  <p className="text-sm font-bold text-foreground">{t('streak.shieldUsedTitle')}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
                    {t('streak.shieldUsedBody').replace('{n}', String(event.streak ?? 0))}
                  </p>
                </>
              )}
              {event.kind === 'shieldEarned' && (
                <>
                  <p className="text-sm font-bold text-foreground">{t('streak.shieldEarnedTitle')}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{t('streak.shieldEarnedBody')}</p>
                </>
              )}
            </div>
            <button
              onClick={() => setEvent(null)}
              aria-label={t('common.dismiss')}
              className="p-1 rounded-md text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
