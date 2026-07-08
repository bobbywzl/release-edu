'use client'
import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Zap, Trophy, Star, TrendingUp, Heart } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useT, useLanguage } from '@/lib/i18n'
import { playXpDing, playLevelUp, playBadgeUnlock } from '@/lib/sfx'

interface XpEvent {
  id: string
  awarded: number
  label: string
  levelUp: boolean
  newLevel: number
  source?: string
}

export interface BadgeEvent {
  id: string
  tier: 'bronze' | 'silver' | 'gold' | 'legendary'
  icon: string
  name: { en: string; zh: string }
  desc: { en: string; zh: string }
}

// ── Global XP Event Bus ──
type XpListener = (event: XpEvent) => void
const listeners = new Set<XpListener>()

// Lightweight "XP totals changed" bus — the XP panel/ring subscribes to
// re-fetch its summary whenever any award lands (daily check-in, quiz answer),
// so the streak/goal display never sits stale until a manual reload.
type ChangeListener = () => void
const changeListeners = new Set<ChangeListener>()
export function subscribeXpChange(fn: ChangeListener): () => void {
  changeListeners.add(fn)
  return () => { changeListeners.delete(fn) }
}

export function emitXpEvent(event: Omit<XpEvent, 'id'>) {
  const full: XpEvent = { ...event, id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}` }
  listeners.forEach(fn => fn(full))
  changeListeners.forEach(fn => { try { fn() } catch { /* non-critical */ } })
}

// Convenience: emit from API response xpAwards array
export function emitXpAwards(awards: Array<{ awarded: number; label: string; levelUp: boolean; newLevel: number; source?: string }>) {
  // Stagger so multiple awards animate sequentially
  awards.forEach((a, i) => {
    setTimeout(() => emitXpEvent(a), i * 600)
  })
}

// ── Badge unlock bus — same pattern, separate celebration ──
type BadgeListener = (badge: BadgeEvent) => void
const badgeListeners = new Set<BadgeListener>()

export function emitBadgeEvents(badges: BadgeEvent[]) {
  badges.forEach((b, i) => {
    setTimeout(() => badgeListeners.forEach(fn => fn(b)), i * 2600)
  })
}

// ── Floating +XP Number ──
function FloatingXp({ amount, x, y, onDone }: { amount: number; x: number; y: number; onDone: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDone, 1200)
    return () => clearTimeout(timer)
  }, [onDone])

  return (
    <motion.div
      initial={{ opacity: 1, y: 0, scale: 0.5 }}
      animate={{ opacity: 0, y: -60, scale: 1.2 }}
      transition={{ duration: 1.2, ease: 'easeOut' }}
      className="fixed z-[200] pointer-events-none select-none"
      style={{ left: x, top: y }}
    >
      <span className="text-lg font-black text-yellow-400 drop-shadow-[0_0_8px_rgba(250,204,21,0.6)]">
        +{amount} XP
      </span>
    </motion.div>
  )
}

// ── Level Up Overlay ──
function LevelUpOverlay({ level, onDone }: { level: number; onDone: () => void }) {
  const t = useT()
  useEffect(() => {
    const timer = setTimeout(onDone, 3000)
    return () => clearTimeout(timer)
  }, [onDone])

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[300] flex items-center justify-center pointer-events-none"
    >
      {/* Background flash */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 0.15, 0] }}
        transition={{ duration: 1.5 }}
        className="absolute inset-0 bg-yellow-400"
      />

      {/* Level badge */}
      <motion.div
        initial={{ scale: 0, rotate: -20 }}
        animate={{ scale: [0, 1.3, 1], rotate: [-20, 5, 0] }}
        transition={{ duration: 0.6, ease: 'backOut' }}
        className="flex flex-col items-center gap-3"
      >
        <motion.div
          animate={{ rotate: [0, 360] }}
          transition={{ duration: 2, ease: 'linear' }}
          className="relative"
        >
          <div className="w-24 h-24 rounded-full bg-gradient-to-br from-yellow-400 via-amber-500 to-orange-500 flex items-center justify-center shadow-[0_0_40px_rgba(250,204,21,0.5)]">
            <Star className="w-10 h-10 text-white" />
          </div>
          {/* Particle ring */}
          {Array.from({ length: 8 }).map((_, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, scale: 0 }}
              animate={{
                opacity: [0, 1, 0],
                scale: [0, 1, 0.5],
                x: Math.cos((i * Math.PI * 2) / 8) * 60,
                y: Math.sin((i * Math.PI * 2) / 8) * 60,
              }}
              transition={{ duration: 1.2, delay: 0.3 + i * 0.05 }}
              className="absolute top-1/2 left-1/2 w-2 h-2 -ml-1 -mt-1 rounded-full bg-yellow-300"
            />
          ))}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="text-center"
        >
          <div className="text-xs font-bold text-yellow-400 uppercase tracking-[0.2em] mb-1">{t('xp.levelUp')}</div>
          <div className="text-4xl font-black text-white drop-shadow-[0_0_20px_rgba(250,204,21,0.4)]">
            {t('common.level')} {level}
          </div>
        </motion.div>
      </motion.div>
    </motion.div>
  )
}

// ── Badge Unlock Overlay ──
const TIER_STYLES: Record<BadgeEvent['tier'], { ring: string; glow: string; label: string }> = {
  bronze:    { ring: 'from-amber-700 via-amber-600 to-amber-800',    glow: 'shadow-[0_0_40px_rgba(180,83,9,0.5)]',    label: 'text-amber-500' },
  silver:    { ring: 'from-slate-300 via-slate-400 to-slate-500',    glow: 'shadow-[0_0_40px_rgba(148,163,184,0.5)]', label: 'text-slate-300' },
  gold:      { ring: 'from-yellow-300 via-amber-400 to-orange-500',  glow: 'shadow-[0_0_50px_rgba(250,204,21,0.6)]',  label: 'text-yellow-400' },
  legendary: { ring: 'from-fuchsia-400 via-purple-500 to-indigo-500', glow: 'shadow-[0_0_60px_rgba(192,38,211,0.6)]', label: 'text-fuchsia-400' },
}

function BadgeUnlockOverlay({ badge, onDone }: { badge: BadgeEvent; onDone: () => void }) {
  const t = useT()
  const { language } = useLanguage()
  const lang = language === 'zh' ? 'zh' : 'en'
  const tier = TIER_STYLES[badge.tier]
  useEffect(() => {
    const timer = setTimeout(onDone, 3200)
    return () => clearTimeout(timer)
  }, [onDone])

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[300] flex items-center justify-center pointer-events-none"
    >
      <motion.div
        initial={{ scale: 0, rotate: -15 }}
        animate={{ scale: [0, 1.25, 1], rotate: [-15, 6, 0] }}
        transition={{ duration: 0.55, ease: 'backOut' }}
        className="flex flex-col items-center gap-3"
      >
        <div className={cn('relative w-28 h-28 rounded-full bg-gradient-to-br flex items-center justify-center', tier.ring, tier.glow)}>
          <span className="text-5xl select-none">{badge.icon}</span>
          {/* Sparkle burst */}
          {Array.from({ length: 10 }).map((_, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, scale: 0 }}
              animate={{
                opacity: [0, 1, 0],
                scale: [0, 1, 0.4],
                x: Math.cos((i * Math.PI * 2) / 10) * 76,
                y: Math.sin((i * Math.PI * 2) / 10) * 76,
              }}
              transition={{ duration: 1.1, delay: 0.25 + i * 0.04 }}
              className="absolute top-1/2 left-1/2 w-2 h-2 -ml-1 -mt-1 rounded-full bg-white"
            />
          ))}
        </div>
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
          className="text-center"
        >
          <div className={cn('text-xs font-bold uppercase tracking-[0.2em] mb-1', tier.label)}>
            {t('xp.badgeUnlocked')}
          </div>
          <div className="text-3xl font-black text-white drop-shadow-[0_0_16px_rgba(255,255,255,0.25)]">
            {badge.name[lang]}
          </div>
          <div className="text-sm text-white/70 mt-1">{badge.desc[lang]}</div>
        </motion.div>
      </motion.div>
    </motion.div>
  )
}

// ── XP Toast Banner ──
function XpToastBanner({ event, onDone }: { event: XpEvent; onDone: () => void }) {
  const t = useT()
  useEffect(() => {
    const timer = setTimeout(onDone, 2500)
    return () => clearTimeout(timer)
  }, [onDone])

  const isPerseverance = event.source === 'perseverance' || event.label.includes('Perseverance')
  const icon = event.source === 'track_completed' || event.label.includes('Track') ? Trophy :
               event.source === 'chapter_completed' || event.label.includes('Chapter') ? Star :
               event.source === 'daily_streak' || event.label.includes('Streak') ? TrendingUp :
               isPerseverance ? Heart : Zap

  const Icon = icon
  // Localize the award name from its source key; XP_TABLE labels are English
  // only, so a 中文 session must not surface them raw. Fall back to the raw
  // label if the source is unknown or its key is missing.
  const key = event.source ? `xp.award.${event.source}` : ''
  const translated = key ? t(key as Parameters<typeof t>[0]) : ''
  const displayLabel = translated && translated !== key ? translated : event.label

  // Perseverance gets a distinct rose/pink palette so the student feels it's
  // a different, supportive kind of reward — not the same yellow "you won".
  const palette = isPerseverance
    ? {
        gradient: 'bg-gradient-to-r from-rose-500/25 via-pink-500/10 to-transparent',
        border: 'border-rose-400/40',
        iconBg: 'bg-rose-500/20',
        iconFg: 'text-rose-300',
        text: 'text-rose-300',
      }
    : {
        gradient: 'bg-gradient-to-r from-yellow-500/20 via-amber-500/10 to-transparent',
        border: 'border-yellow-500/30',
        iconBg: 'bg-yellow-500/20',
        iconFg: 'text-yellow-400',
        text: 'text-yellow-400',
      }

  return (
    <motion.div
      initial={{ x: 100, opacity: 0, scale: 0.8 }}
      animate={{ x: 0, opacity: 1, scale: 1 }}
      exit={{ x: 100, opacity: 0, scale: 0.8 }}
      transition={{ type: 'spring', stiffness: 300, damping: 25 }}
      className={cn(
        'flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg border backdrop-blur-sm',
        palette.gradient,
        palette.border,
      )}
    >
      <motion.div
        animate={{ rotate: [0, 15, -15, 0], scale: [1, 1.2, 1] }}
        transition={{ duration: 0.5, delay: 0.2 }}
      >
        <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center', palette.iconBg)}>
          <Icon className={cn('w-5 h-5', palette.iconFg)} />
        </div>
      </motion.div>
      <div>
        <div className="text-sm font-bold text-foreground flex items-center gap-1.5">
          <motion.span
            initial={{ scale: 0 }}
            animate={{ scale: [0, 1.3, 1] }}
            transition={{ delay: 0.1, duration: 0.4 }}
            className={palette.text}
          >
            +{event.awarded}
          </motion.span>
          <span className={palette.text}>XP</span>
        </div>
        <div className="text-xs text-muted-foreground">
          {displayLabel}
          {isPerseverance && (
            <span className="block text-[10px] text-rose-300/80 mt-0.5">
              {t('xp.perseveranceHint')}
            </span>
          )}
        </div>
      </div>
    </motion.div>
  )
}

// ── Main XP Toast Provider ──
// Mount this ONCE at the app layout level

export function XpToastProvider() {
  const [toasts, setToasts] = useState<XpEvent[]>([])
  const [levelUp, setLevelUp] = useState<{ level: number } | null>(null)
  const [badgeUnlock, setBadgeUnlock] = useState<BadgeEvent | null>(null)
  const [floaters, setFloaters] = useState<Array<{ id: string; amount: number; x: number; y: number }>>([])

  useEffect(() => {
    const handler: XpListener = (event) => {
      // Add toast + the reward ding (the sound IS the habit loop)
      setToasts(prev => [...prev, event])
      playXpDing()

      // Floating number near the XP display in sidebar
      setFloaters(prev => [
        ...prev,
        {
          id: event.id,
          amount: event.awarded,
          x: 40 + Math.random() * 30,
          y: window.innerHeight - 80 + Math.random() * 20,
        },
      ])

      // Level up overlay + fanfare
      if (event.levelUp) {
        setTimeout(() => { setLevelUp({ level: event.newLevel }); playLevelUp() }, 400)
      }
    }

    const badgeHandler: BadgeListener = (badge) => {
      setBadgeUnlock(badge)
      playBadgeUnlock()
    }

    listeners.add(handler)
    badgeListeners.add(badgeHandler)
    return () => { listeners.delete(handler); badgeListeners.delete(badgeHandler) }
  }, [])

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const removeFloater = useCallback((id: string) => {
    setFloaters(prev => prev.filter(f => f.id !== id))
  }, [])

  return (
    <>
      {/* Toast stack — bottom-right */}
      <div className="fixed bottom-4 right-4 z-[150] flex flex-col gap-2 items-end">
        <AnimatePresence mode="popLayout">
          {toasts.slice(-3).map(event => (
            <XpToastBanner key={event.id} event={event} onDone={() => removeToast(event.id)} />
          ))}
        </AnimatePresence>
      </div>

      {/* Floating +XP numbers */}
      {floaters.map(f => (
        <FloatingXp key={f.id} amount={f.amount} x={f.x} y={f.y} onDone={() => removeFloater(f.id)} />
      ))}

      {/* Level up overlay */}
      <AnimatePresence>
        {levelUp && (
          <LevelUpOverlay level={levelUp.level} onDone={() => setLevelUp(null)} />
        )}
      </AnimatePresence>

      {/* Badge unlock overlay */}
      <AnimatePresence>
        {badgeUnlock && (
          <BadgeUnlockOverlay badge={badgeUnlock} onDone={() => setBadgeUnlock(null)} />
        )}
      </AnimatePresence>
    </>
  )
}
