'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Award, RefreshCw, FileText, ChevronDown, ChevronUp,
  Sparkles, TrendingUp, Target, BarChart3, Star, Zap, BookOpen, Trophy, ShieldCheck } from 'lucide-react'
import { TreeLogo } from '@/components/tree-logo'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { useStudentData } from '@/lib/student-data'
import { useLanguage } from '@/lib/i18n'
import { useRegeneration } from '@/lib/regeneration'

// ── Achievements (XP badges) ─────────────────────────────────────────────────
// Earned badges double as competency evidence for universities/employers:
// each maps to verified learning progress (streaks, chapters mastered,
// projects shipped), not attendance. Featured badges (starred in the
// dashboard Badge Case) come first; falls back to the most recent earned.

interface XpBadgeInfo {
  id: string
  tier: 'bronze' | 'silver' | 'gold' | 'legendary'
  icon: string
  name: { en: string; zh: string }
  desc: { en: string; zh: string }
  earned: boolean
  earnedAt: string | null
  featured: boolean
}

const BADGE_TIER_STYLES: Record<XpBadgeInfo['tier'], string> = {
  bronze: 'border-amber-700/50 bg-amber-700/10',
  silver: 'border-slate-400/50 bg-slate-400/10',
  gold: 'border-yellow-400/50 bg-yellow-400/10 shadow-[0_0_18px_rgba(250,204,21,0.12)]',
  legendary: 'border-fuchsia-400/50 bg-fuchsia-400/10 shadow-[0_0_18px_rgba(232,121,249,0.15)]',
}
const BADGE_TIER_ORDER: Record<XpBadgeInfo['tier'], number> = { legendary: 0, gold: 1, silver: 2, bronze: 3 }

function AchievementsSection() {
  const { language, t } = useLanguage()
  const lang = language === 'zh' ? 'zh' : 'en'
  const [data, setData] = useState<{ badges: XpBadgeInfo[]; level: number; rank: { en: string; zh: string; emblem?: string; color?: string }; xp: number } | null>(null)

  useEffect(() => {
    fetch('/api/xp/summary?readonly=1', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (j) setData(j) })
      .catch(() => {})
  }, [])

  if (!data) return null
  // Exclude dormant Release EDU badge ladders (chapters/tracks/projects) from
  // the portfolio — this surface certifies Tree EDU mastery only and must
  // never surface pre-pivot "Mastered 25 chapters"-style evidence.
  const earned = data.badges.filter(b => b.earned && !/^(ch_|track_|proj_)/.test(b.id))
  if (earned.length === 0) return null
  // Featured medals lead; the rest follow by tier weight — up to 8 shine.
  const byTier = [...earned].sort((a, b) =>
    Number(b.featured) - Number(a.featured) || BADGE_TIER_ORDER[a.tier] - BADGE_TIER_ORDER[b.tier])
  const shown = byTier.slice(0, 8)

  return (
    <motion.section {...fadeUp} className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Award className="w-4 h-4 text-muted-foreground" />
          {t('xp.achievements')}
          <span className="text-[11px] font-normal text-muted-foreground">
            · {t('common.level')} {data.level} — <span style={{ color: data.rank.color }}>{data.rank.emblem} {data.rank[lang]}</span> · {data.xp.toLocaleString()} XP
          </span>
        </h2>
        <p className="text-[11px] text-muted-foreground mt-0.5">{t('xp.achievementsSub')}</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {shown.map(b => (
          <div key={b.id} className={`border rounded-lg p-3.5 flex items-start gap-3 ${BADGE_TIER_STYLES[b.tier]}`}>
            <span className="text-3xl leading-none mt-0.5 drop-shadow-[0_0_6px_rgba(255,255,255,0.15)]">{b.icon}</span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">{b.name[lang]}</p>
              <p className="text-[11px] text-muted-foreground leading-snug">{b.desc[lang]}</p>
              {b.earnedAt && (
                <p className="text-[10px] text-muted-foreground/70 mt-1">
                  {t('xp.earnedOn')} {new Date(b.earnedAt).toLocaleDateString()}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </motion.section>
  )
}

// ── The Forest — completed problem trees (mastered problems) ────────────────

function ForestSection() {
  const { t } = useLanguage()
  const [trees, setTrees] = useState<Array<{ id: string; title: string; status: string; nodeCount: number; understoodCount: number; updatedAt: string }> | null>(null)

  useEffect(() => {
    fetch('/api/tree', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d?.trees) setTrees(d.trees) })
      .catch(() => {})
  }, [])

  // The Forest certifies VERIFIED mastery, never attendance: a tree qualifies
  // only when every branch node was actually checkpoint-verified — the
  // self-declared "Mark as complete" (status only) is not enough. Mirrors
  // countMasteredTrees in badges.ts.
  const completed = (trees ?? []).filter(tr => tr.status === 'completed' && tr.nodeCount > 0 && tr.understoodCount === tr.nodeCount)
  if (completed.length === 0) return null

  return (
    <motion.section {...fadeUp} className="space-y-4">
      <div>
        <h2 className="text-base font-bold text-amber-300 flex items-center gap-2">
          <Trophy className="w-5 h-5 text-amber-400 drop-shadow-[0_0_8px_rgba(251,191,36,0.6)]" />
          {t('portfolio.forest')}
          <span className="text-[11px] font-semibold text-amber-400/80 px-1.5 py-0.5 rounded-full border border-amber-400/40 bg-amber-500/10">{completed.length}</span>
        </h2>
        <p className="text-[11px] text-muted-foreground mt-0.5">{t('portfolio.forestSub')}</p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {completed.map(tree => (
          <Link key={tree.id} href={`/dashboard/tree/${tree.id}`} className="block group">
            <div className="border border-amber-400/40 bg-gradient-to-b from-amber-500/[0.14] to-amber-500/[0.03] rounded-xl p-4 text-center hover:border-amber-400/70 hover:shadow-[0_0_24px_rgba(251,191,36,0.15)] transition-all">
              <div className="relative w-10 h-10 mx-auto">
                <TreeLogo className="w-10 h-10 text-amber-400 drop-shadow-[0_0_10px_rgba(251,191,36,0.5)]" />
                <Trophy className="absolute -bottom-1 -right-1.5 w-4 h-4 text-yellow-300" />
              </div>
              <p className="text-xs font-bold text-amber-100 mt-2 line-clamp-2 leading-snug group-hover:text-amber-300 transition-colors">{tree.title}</p>
              <p className="text-[10px] text-amber-200/60 mt-1">
                {tree.understoodCount}/{tree.nodeCount} {t('dashboard.nodes')} ✓ · {new Date(tree.updatedAt).toLocaleDateString()}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </motion.section>
  )
}

// ── Types ────────────────────────────────────────────────────────────────────

interface PortfolioSkill {
  name: string
  level: 'beginner' | 'intermediate' | 'advanced' | 'expert'
  evidence: string
}

interface PortfolioProject {
  title: string
  description: string
  skills: string[]
  impact: string
}

interface PortfolioStrength {
  trait: string
  description: string
  evidence: string
  conversationRef: string
}

interface PortfolioGrowthArea {
  area: string
  description: string
  progress: string
}

interface PortfolioMetrics {
  completionRate: number | string | Record<string, unknown>
  averagePace: string
  consistencyScore: number | string
  qualityIndicators: string[]
}

// Coerce metric value to a 0-100 number for progress display
function toNumber(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && !isNaN(v)) return Math.max(0, Math.min(100, Math.round(v)))
  if (typeof v === 'string') {
    const match = v.match(/(\d+(\.\d+)?)/)
    if (match) return Math.max(0, Math.min(100, Math.round(parseFloat(match[1]))))
  }
  return fallback
}

// Coerce averagePace or similar to a short display string
function toShortString(v: unknown, maxLen = 40): string {
  if (v == null) return '—'
  const s = typeof v === 'string' ? v : String(v)
  if (s.length <= maxLen) return s
  return s.slice(0, maxLen).trim() + '…'
}

interface Portfolio {
  headline: string
  summary: string
  skills: PortfolioSkill[]
  projects: PortfolioProject[]
  strengths: PortfolioStrength[]
  growthAreas: PortfolioGrowthArea[]
  metrics: PortfolioMetrics
  personalStatement: string
  insufficientData?: boolean
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const LEVEL_ORDER = { expert: 0, advanced: 1, intermediate: 2, beginner: 3 }
const LEVEL_COLORS: Record<string, string> = {
  expert: 'bg-emerald-500',
  advanced: 'bg-blue-500',
  intermediate: 'bg-amber-500',
  beginner: 'bg-zinc-500',
}
const LEVEL_WIDTHS: Record<string, number> = {
  expert: 100,
  advanced: 75,
  intermediate: 50,
  beginner: 25,
}
const LEVEL_TEXT_COLORS: Record<string, string> = {
  expert: 'text-emerald-400',
  advanced: 'text-blue-400',
  intermediate: 'text-amber-400',
  beginner: 'text-zinc-400',
}

// Normalize fuzzy level strings like "beginner-to-intermediate" to a canonical level
function normalizeLevel(level: string): 'beginner' | 'intermediate' | 'advanced' | 'expert' {
  const lc = (level || '').toLowerCase()
  if (lc.includes('expert')) return 'expert'
  if (lc.includes('advanced')) return 'advanced'
  if (lc.includes('intermediate')) return 'intermediate'
  return 'beginner'
}

const fadeUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.4 },
}

// ── Circular Progress ────────────────────────────────────────────────────────

function CircularProgress({ value, size = 80, label }: { value: number; size?: number; label: string }) {
  const radius = (size - 8) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (value / 100) * circumference

  return (
    <div className="flex flex-col items-center gap-2">
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeWidth="4" className="text-border" />
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeWidth="4"
          className="text-primary" strokeDasharray={circumference} strokeDashoffset={offset}
          strokeLinecap="round" style={{ transition: 'stroke-dashoffset 1s ease' }}
        />
      </svg>
      <div className="absolute flex flex-col items-center justify-center" style={{ width: size, height: size }}>
        <span className="text-lg font-bold text-foreground">{value}%</span>
      </div>
      <span className="text-[11px] text-muted-foreground text-center">{label}</span>
    </div>
  )
}

// ── Evidence Expander ────────────────────────────────────────────────────────

function EvidenceExpander({ evidence, conversationRef }: { evidence: string; conversationRef: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-2">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors">
        <span>📎</span>
        <span>Evidence</span>
        {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mt-2 p-3 bg-muted/50 rounded-lg border border-border/50">
              <p className="text-xs text-foreground/80 italic leading-relaxed">&ldquo;{evidence}&rdquo;</p>
              {conversationRef && (
                <p className="text-[10px] text-muted-foreground mt-1.5">From: {conversationRef}</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function PortfolioPage() {
  const { data } = useStudentData()
  const { t: tr } = useLanguage()
  const { student } = data
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null)
  // Start in "checking" mode — true until first status check completes,
  // so we never flash the empty state when a job is already running
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [personalStatement, setPersonalStatement] = useState<string>('')
  // The portfolio is a CACHED artifact people show to others — it must never
  // present itself as current when the learner has worked since. The status
  // route reports the real timestamp and whether it has drifted.
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const [editingStatement, setEditingStatement] = useState(false)
  // LIVE VERIFICATION NUMBERS — this is the one screen designed to be shown
  // to someone else, so the stat chips must never contradict the Forest in
  // the same viewport. Chips compute from the live tree list; only the prose
  // portrait stays cached.
  const [liveTrees, setLiveTrees] = useState<Array<{ nodeCount: number; understoodCount: number }> | null>(null)
  useEffect(() => {
    fetch('/api/tree', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (Array.isArray(d?.trees)) setLiveTrees(d.trees) })
      .catch(() => { /* chips fall back to the cached number */ })
  }, [])
  const liveStats = (() => {
    if (!liveTrees) return null
    const total = liveTrees.reduce((s, tr2) => s + (tr2.nodeCount || 0), 0)
    const verified = liveTrees.reduce((s, tr2) => s + (tr2.understoodCount || 0), 0)
    return { total, verified, problems: liveTrees.length, pct: total > 0 ? Math.round((verified / total) * 100) : 0 }
  })()

  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isPollingRef = useRef(false)

  // Poll /api/portfolio/status until generation completes
  const pollStatus = useCallback(async () => {
    if (isPollingRef.current) return // prevent double-polling
    isPollingRef.current = true
    try {
      const res = await fetch('/api/portfolio/status', { cache: 'no-store' })
      if (!res.ok) {
        pollTimer.current = setTimeout(() => { isPollingRef.current = false; pollStatus() }, 5000)
        return
      }
      const data = await res.json() as { status: string; portfolio?: Portfolio; error?: string; generatedAt?: string; stale?: boolean }

      if (data.status === 'ready' && data.portfolio) {
        setPortfolio(data.portfolio)
        setPersonalStatement(data.portfolio.personalStatement || '')
        setGeneratedAt(data.generatedAt ?? null)
        setStale(!!data.stale)
        setLoading(false)
        setError(null)
        if (pollTimer.current) clearTimeout(pollTimer.current)
      } else if (data.status === 'error') {
        setError(data.error || 'Generation failed')
        setLoading(false)
        if (pollTimer.current) clearTimeout(pollTimer.current)
      } else if (data.status === 'generating') {
        setLoading(true)
        // Poll faster (1.5s) so we catch completion immediately
        pollTimer.current = setTimeout(() => { isPollingRef.current = false; pollStatus() }, 1500)
      } else {
        // 'none' — no portfolio yet, hide loading so empty state shows
        setLoading(false)
      }
    } catch {
      pollTimer.current = setTimeout(() => { isPollingRef.current = false; pollStatus() }, 3000)
    } finally {
      // Only clear the lock if we're not waiting on a scheduled retry
      if (!pollTimer.current) isPollingRef.current = false
      else {
        // The lock will be cleared when the timeout fires
      }
    }
  }, [])

  // On mount: check status. Also re-check whenever the page becomes visible again.
  useEffect(() => {
    pollStatus()
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        if (pollTimer.current) clearTimeout(pollTimer.current)
        isPollingRef.current = false
        pollStatus()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [pollStatus])

  // Generation is owned by the module-scope manager so it keeps being
  // tracked (and completes) even when the user navigates away. The status
  // is DB-backed server-side; this page's pollStatus picks the result up on
  // return, and the manager's state drives the loading UI in between.
  const { portfolio: portfolioRegen, startPortfolio } = useRegeneration()
  const generate = useCallback(() => {
    setError(null)
    setLoading(true)
    startPortfolio()
    pollStatus()
  }, [startPortfolio, pollStatus])

  // Mirror the manager's lifecycle into this page's loading/error state —
  // covers the run finishing (or failing) while the user was on another page.
  useEffect(() => {
    if (portfolioRegen.running) {
      setLoading(true)
      return
    }
    if (portfolioRegen.error) {
      setError(portfolioRegen.error)
      setLoading(false)
    } else if (portfolioRegen.successAt) {
      // Fetch the finished portfolio data.
      pollStatus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portfolioRegen.running, portfolioRegen.error, portfolioRegen.successAt])

  // Sort skills by level (normalize level first since AI may return fuzzy strings)
  const sortedSkills = portfolio?.skills?.slice()
    .map(s => ({ ...s, level: normalizeLevel(s.level) }))
    .sort((a, b) => (LEVEL_ORDER[a.level] ?? 4) - (LEVEL_ORDER[b.level] ?? 4)) ?? []

  return (
    <div className="p-8 lg:p-12 max-w-4xl space-y-10 portfolio-print-root relative">
      {/* Tree EDU watermark — visible on screen AND print */}
      <div className="absolute top-4 right-4 flex items-center gap-1.5 opacity-30 print:opacity-40 pointer-events-none select-none print:top-6 print:right-6">
        <Zap className="w-3 h-3 text-primary" />
        <span className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">Tree EDU</span>
      </div>

      {/* Print-only styles & watermark */}
      <style jsx global>{`
        @media print {
          /* Release the height/overflow constraints from dashboard layout */
          html, body {
            background: white !important;
            color: black !important;
            height: auto !important;
            overflow: visible !important;
          }
          /* Dashboard layout uses flex h-screen overflow-hidden — undo for printing */
          body > div, body > div > * {
            height: auto !important;
            overflow: visible !important;
            display: block !important;
          }
          /* Hide all chrome */
          aside, nav, header[class*="header"],
          [class*="Sidebar"], [class*="sidebar"],
          [class*="BottomNav"], [class*="bottom-nav"] {
            display: none !important;
          }
          main {
            padding: 0 !important;
            overflow: visible !important;
            height: auto !important;
          }
          .portfolio-print-root {
            max-width: 100% !important;
            padding: 0 !important;
            overflow: visible !important;
            height: auto !important;
          }
          .portfolio-print-root button { display: none !important; }
          /* Avoid breaking sections across pages awkwardly */
          .portfolio-print-root section,
          .portfolio-print-root [class*="rounded-lg"],
          .portfolio-print-root [class*="rounded-xl"] {
            page-break-inside: avoid;
            break-inside: avoid;
          }
          /* Diagonal repeating watermark across every page */
          .portfolio-print-root {
            background-image: repeating-linear-gradient(
              -30deg,
              transparent,
              transparent 200px,
              rgba(0, 0, 0, 0.025) 200px,
              rgba(0, 0, 0, 0.025) 400px
            );
            position: relative;
          }
          /* Force colors for badges and progress bars */
          [class*="bg-emerald"] { background-color: #10b981 !important; }
          [class*="bg-blue"] { background-color: #3b82f6 !important; }
          [class*="bg-amber"] { background-color: #f59e0b !important; }
          [class*="bg-zinc"] { background-color: #71717a !important; }
          @page {
            margin: 0.5in;
            @bottom-center {
              content: "Verified by Tree EDU · Page " counter(page) " of " counter(pages);
              font-size: 9px;
              color: rgba(0, 0, 0, 0.5);
            }
            @top-right {
              content: "TREE EDU";
              font-size: 8px;
              letter-spacing: 0.15em;
              color: rgba(0, 0, 0, 0.4);
            }
          }
        }
      `}</style>
      {/* ── Empty / Generate State ──────────────────────────────────── */}
      {!portfolio && !loading && (
        <motion.div {...fadeUp} className="text-center py-20 space-y-6">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
            <Award className="w-8 h-8 text-primary" />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-bold text-foreground">{tr("portfolio.title")}</h1>
            <p className="text-muted-foreground max-w-md mx-auto">
              {tr('portfolio.generateDesc')}
            </p>
          </div>
          <button
            onClick={generate}
            className="inline-flex items-center gap-2 bg-primary text-primary-foreground rounded-lg px-6 py-3 text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <Sparkles className="w-4 h-4" />
            {tr('portfolio.generateBtn')}
          </button>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </motion.div>
      )}

      {/* ── Loading ─────────────────────────────────────────────────── */}
      {loading && !portfolio && (
        <div className="py-20 flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center animate-pulse">
            <Sparkles className="w-6 h-6 text-primary" />
          </div>
          <div className="space-y-1 text-center">
            <p className="text-sm font-medium text-foreground">{tr('portfolio.analyzing')}</p>
            <p className="text-xs text-muted-foreground">{tr('portfolio.analyzingSub')}</p>
          </div>
          {/* Indeterminate progress bar — animates back and forth, never stops */}
          <div className="w-64 h-1.5 bg-muted rounded-full overflow-hidden relative">
            <motion.div
              className="absolute inset-y-0 w-1/3 bg-primary rounded-full"
              animate={{ x: ['-100%', '300%'] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
            />
          </div>
        </div>
      )}

      {/* ── Insufficient Data State ──────────────────────────────── */}
      {portfolio && portfolio.insufficientData && !loading && (
        <motion.div {...fadeUp} className="space-y-6">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2">
              <h1 className="text-3xl font-bold text-foreground">{student.name}</h1>
              <p className="text-lg text-muted-foreground">{tr('portfolio.gettingStarted')}</p>
            </div>
            <button
              onClick={generate}
              className="flex items-center gap-2 text-xs border border-border rounded-lg px-3 py-2 hover:bg-accent transition-colors text-muted-foreground"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              {tr('portfolio.regenerate')}
            </button>
          </div>

          <div className="border-2 border-dashed border-border rounded-xl p-8 text-center space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-muted/50 flex items-center justify-center mx-auto">
              <BookOpen className="w-7 h-7 text-muted-foreground" />
            </div>
            <div className="space-y-2 max-w-lg mx-auto">
              <h2 className="text-lg font-semibold text-foreground">{tr('portfolio.notEnough')}</h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {portfolio.summary}
              </p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 max-w-md mx-auto pt-4">
              {[
                { label: tr('portfolio.statConversations'), value: '0', needed: tr('portfolio.statConversationsNeed') },
                { label: tr('portfolio.statVerified'), value: '0', needed: tr('portfolio.statVerifiedNeed') },
                { label: tr('portfolio.statInsights'), value: '0', needed: tr('portfolio.statInsightsNeed') },
                { label: tr('portfolio.statTrees'), value: '0', needed: tr('portfolio.statTreesNeed') },
              ].map(item => (
                <div key={item.label} className="p-3 rounded-lg bg-muted/30 border border-border/50 text-center">
                  <p className="text-lg font-bold text-muted-foreground">{item.value}</p>
                  <p className="text-[10px] text-muted-foreground">{item.label}</p>
                  <p className="text-[9px] text-primary mt-1">{item.needed}</p>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground pt-2">
              {tr('portfolio.evidenceNote')}
            </p>
          </div>
        </motion.div>
      )}

      {/* ── Portfolio Content ──────────────────────────────────────── */}
      {portfolio && !portfolio.insufficientData && !loading && (
        <div className="space-y-10">
          {/* Header */}
          <motion.div {...fadeUp} className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-2 min-w-0">
                <h1 className="text-3xl font-bold text-foreground">{student.name}</h1>
                <p className="text-lg text-muted-foreground leading-relaxed">{portfolio.headline}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={generate}
                  disabled={loading}
                  className="inline-flex items-center gap-1.5 border border-border rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  {tr('portfolio.regenerate')}
                </button>
                <button
                  onClick={() => window.open('/dashboard/portfolio/print', '_blank', 'noopener')}
                  className="inline-flex items-center gap-1.5 border border-border rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-colors"
                >
                  <FileText className="w-3.5 h-3.5" />
                  {tr('portfolio.exportPdf')}
                </button>
              </div>
            </div>

            {/* Freshness banner — this document is shown to other people, so a
                drifted cache must announce itself rather than quietly
                misrepresent the learner's record. */}
            {stale ? (
              <div className="flex flex-wrap items-center gap-2.5 rounded-xl border border-amber-400/40 bg-amber-500/10 px-3.5 py-2.5">
                <RefreshCw className="w-4 h-4 text-amber-400 flex-shrink-0" />
                <p className="text-xs text-amber-200/90 flex-1 min-w-[220px]">
                  {tr('portfolio.stale')}{generatedAt ? ` (${new Date(generatedAt).toLocaleString()})` : ''}
                </p>
                <button
                  onClick={generate}
                  disabled={loading}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500/20 border border-amber-400/40 px-3 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-500/30 transition-colors disabled:opacity-50"
                >
                  {tr('portfolio.refreshNow')}
                </button>
              </div>
            ) : generatedAt ? (
              <p className="text-[11px] text-muted-foreground">
                {tr('portfolio.lastGenerated')} {new Date(generatedAt).toLocaleString()}
              </p>
            ) : null}

            {/* Key metrics row */}
            <div className="flex flex-wrap gap-3">
              <Badge variant="outline" className="gap-1.5">
                <Zap className="w-3 h-3 text-amber-400" />
                {student.xp.toLocaleString()} XP
              </Badge>
              <Badge variant="outline" className="gap-1.5">
                <TrendingUp className="w-3 h-3 text-emerald-400" />
                {student.streak} {tr('portfolio.dayStreak')}
              </Badge>
              <Badge variant="outline" className="gap-1.5">
                <Target className="w-3 h-3 text-blue-400" />
                {liveStats ? liveStats.pct : toNumber(portfolio.metrics?.completionRate)}% {tr('portfolio.completion')}
              </Badge>
              {liveStats && (
                <Badge variant="outline" className="gap-1.5">
                  <ShieldCheck className="w-3 h-3 text-emerald-400" />
                  {tr('portfolio.verifiedBadge').replace('{v}', String(liveStats.verified)).replace('{t}', String(liveStats.total)).replace('{p}', String(liveStats.problems))}
                </Badge>
              )}
              <Badge variant="outline" className="gap-1.5">
                <Star className="w-3 h-3 text-purple-400" />
                {tr('portfolio.skillsCount').replace('{n}', String(sortedSkills.length))}
              </Badge>
            </div>
          </motion.div>

          {/* Divider */}
          <div className="border-t border-border/50" />

          {/* THE HEADLINE ACHIEVEMENTS — mastered trees + earned badges lead
              the portfolio: the most colorful, most verified evidence first. */}
          <ForestSection />
          <AchievementsSection />

          {/* Summary */}
          <motion.section {...fadeUp} className="space-y-3">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-muted-foreground" />
              {tr('portfolio.summaryHeading')}
            </h2>
            <div className="text-sm text-foreground/80 leading-relaxed whitespace-pre-line">
              {portfolio.summary}
            </div>
          </motion.section>

          {/* Personal Statement */}
          <motion.section {...fadeUp} className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <FileText className="w-4 h-4 text-muted-foreground" />
                {tr('portfolio.personalStatement')}
              </h2>
              <button
                onClick={() => setEditingStatement(!editingStatement)}
                className="text-[11px] text-primary hover:text-primary/80 transition-colors"
              >
                {editingStatement ? tr('portfolio.editDone') : tr('portfolio.edit')}
              </button>
            </div>
            {editingStatement ? (
              <textarea
                value={personalStatement}
                onChange={e => setPersonalStatement(e.target.value)}
                className="w-full min-h-[120px] bg-muted/50 border border-border rounded-lg p-4 text-sm text-foreground leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            ) : (
              <div className="p-4 bg-muted/30 border border-border/50 rounded-lg text-sm text-foreground/80 leading-relaxed whitespace-pre-line">
                {personalStatement}
              </div>
            )}
          </motion.section>

          {/* Skills */}
          <motion.section {...fadeUp} className="space-y-4">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-muted-foreground" />
              {tr('portfolio.skillsHeading')}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {sortedSkills.map((skill, i) => (
                <div key={i} className="border border-border/50 rounded-lg p-4 space-y-2.5 hover:border-border transition-colors">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-foreground">{skill.name}</span>
                    <span className={`text-[10px] font-semibold uppercase tracking-wider ${LEVEL_TEXT_COLORS[skill.level] ?? 'text-muted-foreground'}`}>
                      {skill.level}
                    </span>
                  </div>
                  <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                    <motion.div
                      className={`h-full rounded-full ${LEVEL_COLORS[skill.level] ?? 'bg-zinc-500'}`}
                      initial={{ width: 0 }}
                      animate={{ width: `${LEVEL_WIDTHS[skill.level] ?? 25}%` }}
                      transition={{ duration: 0.8, delay: i * 0.05 }}
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">{skill.evidence}</p>
                </div>
              ))}
            </div>
          </motion.section>

          {/* Projects */}
          {Array.isArray(portfolio.projects) && portfolio.projects.length > 0 && (
            <motion.section {...fadeUp} className="space-y-4">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Target className="w-4 h-4 text-muted-foreground" />
                {tr('portfolio.projectsHeading')}
              </h2>
              <div className="space-y-3">
                {portfolio.projects.map((project, i) => (
                  <div key={i} className="border border-border/50 rounded-lg p-5 space-y-3 hover:border-border transition-colors">
                    <h3 className="text-sm font-semibold text-foreground">{project.title}</h3>
                    <p className="text-xs text-foreground/70 leading-relaxed">{project.description}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {project.skills?.map((skill, j) => (
                        <Badge key={j} variant="secondary" className="text-[10px]">{skill}</Badge>
                      ))}
                    </div>
                    <div className="flex items-start gap-2 pt-1">
                      <TrendingUp className="w-3.5 h-3.5 text-emerald-400 mt-0.5 flex-shrink-0" />
                      <p className="text-[11px] text-emerald-400/80">{project.impact}</p>
                    </div>
                  </div>
                ))}
              </div>
            </motion.section>
          )}

          {/* Character & Strengths */}
          {Array.isArray(portfolio.strengths) && portfolio.strengths.length > 0 && (
            <motion.section {...fadeUp} className="space-y-4">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Star className="w-4 h-4 text-muted-foreground" />
                {tr('portfolio.strengthsHeading')}
              </h2>
              <p className="text-[11px] text-muted-foreground -mt-2">
                {tr('portfolio.strengthsSub')}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {portfolio.strengths.map((s, i) => (
                  <div key={i} className="border border-border/50 rounded-lg p-4 space-y-2 hover:border-border transition-colors">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-md bg-amber-500/10 flex items-center justify-center flex-shrink-0">
                        <Star className="w-3 h-3 text-amber-400" />
                      </div>
                      <h3 className="text-sm font-semibold text-foreground">{s.trait}</h3>
                    </div>
                    <p className="text-xs text-foreground/70 leading-relaxed">{s.description}</p>
                    <EvidenceExpander evidence={s.evidence} conversationRef={s.conversationRef} />
                  </div>
                ))}
              </div>
            </motion.section>
          )}

          {/* Growth Areas */}
          {Array.isArray(portfolio.growthAreas) && portfolio.growthAreas.length > 0 && (
            <motion.section {...fadeUp} className="space-y-4">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-muted-foreground" />
                {tr('portfolio.growthHeading')}
              </h2>
              <div className="space-y-3">
                {portfolio.growthAreas.map((area, i) => (
                  <div key={i} className="border border-border/50 rounded-lg p-4 space-y-2 hover:border-border transition-colors">
                    <h3 className="text-sm font-semibold text-foreground">{area.area}</h3>
                    <p className="text-xs text-foreground/70 leading-relaxed">{area.description}</p>
                    <div className="flex items-center gap-2 pt-1">
                      <div className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                      <p className="text-[11px] text-blue-400/80">{area.progress}</p>
                    </div>
                  </div>
                ))}
              </div>
            </motion.section>
          )}

          {/* Metrics Dashboard */}
          {portfolio.metrics && (
            <motion.section {...fadeUp} className="space-y-4">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-muted-foreground" />
                {tr('portfolio.metricsHeading')}
              </h2>
              <div className="border border-border/50 rounded-lg p-6">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
                  {/* Completion Rate */}
                  <div className="flex flex-col items-center relative">
                    <CircularProgress value={toNumber(portfolio.metrics.completionRate)} label={tr('portfolio.metricCompletion')} />
                  </div>

                  {/* Consistency */}
                  <div className="flex flex-col items-center relative">
                    <CircularProgress value={toNumber(portfolio.metrics.consistencyScore)} label={tr('portfolio.metricConsistency')} />
                  </div>

                  {/* Pace */}
                  <div className="flex flex-col items-center justify-center text-center gap-1">
                    <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                      <TrendingUp className="w-5 h-5 text-primary" />
                    </div>
                    <span
                      className="text-[11px] text-foreground/80 mt-1 line-clamp-2 max-w-[120px]"
                      title={typeof portfolio.metrics.averagePace === 'string' ? portfolio.metrics.averagePace : ''}
                    >
                      {toShortString(portfolio.metrics.averagePace, 50)}
                    </span>
                    <span className="text-[10px] text-muted-foreground">{tr('portfolio.metricPace')}</span>
                  </div>

                  {/* Quality */}
                  <div className="flex flex-col items-center justify-center text-center gap-1">
                    <div className="w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                      <Award className="w-5 h-5 text-emerald-400" />
                    </div>
                    <span className="text-lg font-bold text-foreground">{Array.isArray(portfolio.metrics.qualityIndicators) ? portfolio.metrics.qualityIndicators.length : 0}</span>
                    <span className="text-[10px] text-muted-foreground">{tr('portfolio.metricQuality')}</span>
                  </div>
                </div>

                {/* Quality indicators as badges */}
                {Array.isArray(portfolio.metrics.qualityIndicators) && portfolio.metrics.qualityIndicators.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-5 pt-5 border-t border-border/50">
                    {portfolio.metrics.qualityIndicators.map((q, i) => (
                      <Badge key={i} variant="success" className="text-[10px]">{typeof q === 'string' ? q : JSON.stringify(q)}</Badge>
                    ))}
                  </div>
                )}
              </div>
            </motion.section>
          )}

          {/* Disclaimer */}
          <div className="border-t border-border/50 pt-6">
            <div className="rounded-lg bg-muted/30 border border-border/50 px-4 py-3">
              <p className="text-[11px] text-muted-foreground leading-relaxed italic">
                {tr('portfolio.disclaimer')}
              </p>
            </div>
          </div>

          {/* Footer */}
          <div className="text-center pt-2">
            <p className="text-[11px] text-muted-foreground">
              {tr('portfolio.footer')} · {generatedAt ? new Date(generatedAt).toLocaleString() : '—'}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
