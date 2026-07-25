'use client'
/**
 * XP Panel — the retention heart of the dashboard.
 *
 * Mechanics borrowed from apps with proven daily-return loops:
 * - Daily goal ring (Apple Watch / Duolingo): an *incomplete* ring is
 *   visually unfinished — the Zeigarnik-effect itch to close it.
 * - Streak flame with at-risk state (Duolingo/Snapchat): the flame greys
 *   out until you do something today — loss aversion beats reward seeking.
 * - Level + named rank (RPGs/Khan): status identity that only goes up.
 * - Badge case with visible locked badges + progress (Xbox/PSN): the next
 *   trophy is always in sight.
 *
 * Data: GET /api/xp/summary (also lazily awards new badges → celebration).
 */
import { useState, useEffect, useCallback } from 'react'
import { Flame, ChevronRight, X, Star, Volume2, VolumeX, Zap, Gift } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useLanguage } from '@/lib/i18n'
import { streakDayXp, daysToWeekBoost, WEEK_STREAK_XP } from '@/lib/streak-accel'
import { emitBadgeEvents, subscribeXpChange, type BadgeEvent } from '@/components/xp-toast'
import { sfxEnabled, setSfxEnabled } from '@/lib/sfx'

interface BadgeInfo {
  id: string
  tier: 'bronze' | 'silver' | 'gold' | 'legendary'
  icon: string
  name: { en: string; zh: string }
  desc: { en: string; zh: string }
  target: number
  current: number
  earned: boolean
  earnedAt: string | null
  featured: boolean
}

interface RankInfo {
  key: string
  tier: number
  division: number
  en: string
  zh: string
  color: string
  glow: string
  emblem: string
  vfx: number
}

interface XpSummary {
  xp: number
  level: number
  rank: RankInfo
  levelProgress: number
  xpToday: number
  dailyGoal: number
  streak: number
  longestStreak: number
  activeToday: boolean
  badges: BadgeInfo[]
  newBadges: BadgeEvent[]
}

const TIER_COLORS: Record<BadgeInfo['tier'], string> = {
  bronze: 'border-amber-700/50 bg-amber-700/10',
  silver: 'border-slate-400/50 bg-slate-400/10',
  gold: 'border-yellow-400/50 bg-yellow-400/10',
  legendary: 'border-fuchsia-400/50 bg-fuchsia-400/10',
}

function Ring({ progress, size, stroke, color, track, children }: {
  progress: number; size: number; stroke: number; color: string; track: string; children?: React.ReactNode
}) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const clamped = Math.max(0, Math.min(1, progress))
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - clamped)}
          style={{ transition: 'stroke-dashoffset 0.8s cubic-bezier(0.16,1,0.3,1)' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  )
}

export function XpPanel() {
  const { language, t } = useLanguage()
  const lang = language === 'zh' ? 'zh' : 'en'
  const [data, setData] = useState<XpSummary | null>(null)
  const [showBadges, setShowBadges] = useState(false)
  const [sfxOn, setSfxOn] = useState(true)

  useEffect(() => { setSfxOn(sfxEnabled()) }, [])

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/xp/summary', { cache: 'no-store' })
      if (!res.ok) return
      const j = await res.json() as XpSummary
      setData(j)
      if (j.newBadges?.length) emitBadgeEvents(j.newBadges)
    } catch { /* transient */ }
  }, [])
  useEffect(() => { load() }, [load])
  // Refresh when any XP award lands (daily check-in, quiz answer) so the
  // streak-at-risk flame and daily-goal ring never sit stale — the check-in
  // fires on the same mount as this panel, and a once-on-mount fetch would
  // otherwise show a false "streak at risk" for the whole visit. Debounced so
  // a burst of staggered awards triggers a single refetch.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const unsub = subscribeXpChange(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => { void load() }, 1200)
    })
    return () => { if (timer) clearTimeout(timer); unsub() }
  }, [load])

  async function toggleFeature(badge: BadgeInfo) {
    if (!badge.earned || !data) return
    const next = !badge.featured
    // Optimistic flip; revert on failure (e.g. featured cap reached).
    setData(d => d ? { ...d, badges: d.badges.map(b => b.id === badge.id ? { ...b, featured: next } : b) } : d)
    try {
      const res = await fetch('/api/xp/feature', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ badgeId: badge.id, featured: next }),
      })
      if (!res.ok) throw new Error()
    } catch {
      setData(d => d ? { ...d, badges: d.badges.map(b => b.id === badge.id ? { ...b, featured: badge.featured } : b) } : d)
    }
  }

  if (!data) {
    return <div className="h-32 rounded-xl border border-border bg-card/50 animate-pulse" />
  }

  const goalPct = Math.min(1, data.xpToday / data.dailyGoal)
  const goalMet = data.xpToday >= data.dailyGoal
  const earned = data.badges.filter(b => b.earned)
  const streakAtRisk = !data.activeToday && data.streak > 0
  // Accelerator display: the streak day the rate applies to — today's if the
  // day is already saved, otherwise the day the next check-in will reach.
  const accelDay = Math.max(1, data.activeToday ? data.streak : data.streak + 1)
  const accelRate = streakDayXp(accelDay)
  // Goal-gradient spotlight: the single unearned badge the student is
  // CLOSEST to finishing (only ones already in motion — never a zero bar).
  const nextBadge = data.badges
    .filter(b => !b.earned && b.current > 0)
    .sort((a, b) => b.current / b.target - a.current / a.target)[0] ?? null

  return (
    <>
      <div className="rounded-xl border border-border bg-card p-4 lg:p-5">
        <div className="flex items-center gap-4 lg:gap-6 flex-wrap">
          {/* Level ring + rank — ring and name themed to the current rank */}
          <div className="flex items-center gap-3">
            <Ring progress={data.levelProgress} size={72} stroke={6} color={data.rank.color ?? 'hsl(var(--primary))'} track="hsl(var(--muted))">
              <span className="text-lg font-black text-foreground leading-none">{data.level}</span>
              <span className="text-[9px] text-muted-foreground uppercase tracking-wide">{t('xp.levelShort')}</span>
            </Ring>
            <div>
              <p
                className="text-sm font-black flex items-center gap-1.5"
                style={{ color: data.rank.color, textShadow: `0 0 12px ${data.rank.glow ?? 'transparent'}` }}
              >
                <span className="text-base leading-none">{data.rank.emblem}</span>{data.rank[lang]}
              </p>
              <p className="text-xs text-muted-foreground">{data.xp.toLocaleString()} XP</p>
            </div>
          </div>

          {/* Daily goal ring — the loop-closer */}
          <div className="flex items-center gap-3">
            <Ring
              progress={goalPct} size={72} stroke={6}
              color={goalMet ? '#34D399' : '#F59E0B'}
              track="hsl(var(--muted))"
            >
              <span className={cn('text-sm font-black leading-none', goalMet ? 'text-emerald-400' : 'text-amber-400')}>
                {data.xpToday}
              </span>
              <span className="text-[9px] text-muted-foreground">/{data.dailyGoal}</span>
            </Ring>
            <div className="max-w-[150px]">
              <p className="text-sm font-bold text-foreground">{t('xp.todayGoal')}</p>
              {goalMet ? (
                <p className="text-xs text-emerald-400">{t('xp.goalMet')}</p>
              ) : (
                <p className="text-xs text-amber-400 animate-pulse">
                  {t('xp.goalRemaining').replace('{n}', String(data.dailyGoal - data.xpToday))}
                </p>
              )}
            </div>
          </div>

          {/* Streak flame — greyed until today is saved (loss aversion) */}
          <div className="flex items-center gap-2.5">
            <Flame className={cn('w-9 h-9', data.activeToday ? 'text-orange-400' : 'text-muted-foreground/40', streakAtRisk && 'animate-pulse')} />
            <div className="max-w-[150px]">
              <p className="text-sm font-bold text-foreground">
                {data.streak} <span className="font-medium text-muted-foreground">{t('xp.streakDays')}</span>
              </p>
              {streakAtRisk ? (
                // Loss aversion, honestly: name the REAL stakes — the
                // accelerator rate that resets and the week boost in reach.
                <p className="text-xs text-orange-400">
                  {t('xp.streakLossWarn')
                    .replace('{days}', String(data.streak))
                    .replace('{rate}', String(streakDayXp(Math.max(1, data.streak))))
                    .replace('{base}', String(streakDayXp(1)))}
                  {daysToWeekBoost(data.streak) <= 2 && (
                    <> {t('xp.streakLossWeek')
                      .replace('{n}', String(daysToWeekBoost(data.streak)))
                      .replace('{xp}', String(WEEK_STREAK_XP))}</>
                  )}
                </p>
              ) : data.activeToday ? (
                <p className="text-xs text-muted-foreground">{t('xp.streakSafe')}</p>
              ) : (
                <p className="text-xs text-muted-foreground">{t('xp.streakStart')}</p>
              )}
              {/* XP accelerator: current (or next) daily rate — day 3+ is the
                  max — and the countdown to the 500 XP full-week boost. */}
              {data.streak > 0 && (
                <p className="text-[11px] text-yellow-400 flex items-center gap-1 mt-0.5">
                  <Zap className="w-3 h-3 flex-shrink-0" />
                  <span>
                    {t('xp.accelRate').replace('{n}', String(accelRate))}
                    {accelDay >= 3 && <span className="text-yellow-400/70"> · {t('xp.accelMax')}</span>}
                  </span>
                </p>
              )}
              {data.streak > 0 && data.activeToday && (
                <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <Gift className="w-3 h-3 flex-shrink-0" />
                  <span>{t('xp.weekBoostIn').replace('{xp}', String(WEEK_STREAK_XP)).replace('{n}', String(daysToWeekBoost(data.streak)))}</span>
                </p>
              )}
            </div>
          </div>

          {/* Sound toggle */}
          <button
            type="button"
            onClick={() => { const next = !sfxOn; setSfxOn(next); setSfxEnabled(next) }}
            title={t('xp.sfxToggle')}
            className="ml-auto p-2 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            {sfxOn ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>
        </div>

        {/* Next-badge spotlight — the nearest finish line, always in sight */}
        {nextBadge && (
          <button
            type="button"
            onClick={() => setShowBadges(true)}
            className="mt-4 w-full flex items-center gap-2.5 rounded-lg border border-border/60 bg-background/40 px-3 py-2 hover:bg-accent/50 transition-colors text-left"
          >
            <span className={cn('w-8 h-8 rounded-full border flex items-center justify-center text-base flex-shrink-0', TIER_COLORS[nextBadge.tier])}>
              {nextBadge.icon}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-foreground truncate">
                {t('xp.nextBadge')}: {nextBadge.name[lang]}
                <span className="font-medium text-muted-foreground"> · {nextBadge.current}/{nextBadge.target}</span>
              </p>
              <div className="mt-1 h-1.5 rounded-full bg-muted overflow-hidden">
                <div className="h-full rounded-full bg-primary/70" style={{ width: `${Math.round((nextBadge.current / nextBadge.target) * 100)}%` }} />
              </div>
            </div>
          </button>
        )}

        {/* Badge strip */}
        <button
          type="button"
          onClick={() => setShowBadges(true)}
          className="mt-4 w-full flex items-center gap-2 rounded-lg border border-border/60 bg-background/40 px-3 py-2 hover:bg-accent/50 transition-colors group"
        >
          <div className="flex items-center gap-1.5">
            {earned.slice(0, 6).map(b => (
              <span key={b.id} className={cn('w-8 h-8 rounded-full border flex items-center justify-center text-base', TIER_COLORS[b.tier])} title={b.name[lang]}>
                {b.icon}
              </span>
            ))}
            {earned.length === 0 && (
              <span className="text-xs text-muted-foreground">{t('xp.noBadgesYet')}</span>
            )}
          </div>
          <span className="ml-auto text-xs text-muted-foreground group-hover:text-foreground flex items-center gap-1">
            {earned.length}/{data.badges.length} {t('xp.badges')}
            <ChevronRight className="w-3.5 h-3.5" />
          </span>
        </button>
      </div>

      {/* All-badges modal */}
      {showBadges && (
        <div className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-overlay-in" onClick={() => setShowBadges(false)}>
          <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto bg-card border border-border rounded-2xl p-5 animate-modal-in" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-lg font-bold text-foreground">{t('xp.badgeCase')}</h3>
              <button onClick={() => setShowBadges(false)} className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-muted-foreground mb-4">{t('xp.featureHint')}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {data.badges.map(b => (
                <div
                  key={b.id}
                  className={cn(
                    'rounded-xl border p-3 flex items-start gap-3',
                    b.earned ? TIER_COLORS[b.tier] : 'border-border/50 bg-muted/20 opacity-70',
                  )}
                >
                  <span className={cn('text-2xl leading-none mt-0.5', !b.earned && 'grayscale opacity-50')}>{b.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-foreground">{b.name[lang]}</p>
                    <p className="text-[11px] text-muted-foreground leading-snug">{b.desc[lang]}</p>
                    {b.earned ? (
                      <p className="text-[10px] text-muted-foreground/70 mt-1">
                        {t('xp.earnedOn')} {b.earnedAt ? new Date(b.earnedAt).toLocaleDateString() : ''}
                      </p>
                    ) : (
                      <div className="mt-1.5">
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div className="h-full rounded-full bg-primary/60" style={{ width: `${Math.round((b.current / b.target) * 100)}%` }} />
                        </div>
                        <p className="text-[10px] text-muted-foreground/70 mt-0.5">{b.current}/{b.target}</p>
                      </div>
                    )}
                  </div>
                  {b.earned && (
                    <button
                      type="button"
                      onClick={() => toggleFeature(b)}
                      title={t('xp.featureOnResume')}
                      className={cn(
                        'p-1.5 rounded-md transition-colors flex-shrink-0',
                        b.featured ? 'text-yellow-400 bg-yellow-400/10' : 'text-muted-foreground/50 hover:text-yellow-400 hover:bg-yellow-400/10',
                      )}
                    >
                      <Star className={cn('w-4 h-4', b.featured && 'fill-yellow-400')} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
