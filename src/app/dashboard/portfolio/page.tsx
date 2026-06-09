'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Award, RefreshCw, FileText, ChevronDown, ChevronUp,
  Sparkles, TrendingUp, Target, BarChart3, Star, Zap, BookOpen,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { useStudentData } from '@/lib/student-data'
import { useLanguage } from '@/lib/i18n'
import { useRegeneration } from '@/lib/regeneration'

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
  const [editingStatement, setEditingStatement] = useState(false)

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
      const data = await res.json() as { status: string; portfolio?: Portfolio; error?: string }

      if (data.status === 'ready' && data.portfolio) {
        setPortfolio(data.portfolio)
        setPersonalStatement(data.portfolio.personalStatement || '')
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
      {/* Release EDU Watermark — visible on screen AND print */}
      <div className="absolute top-4 right-4 flex items-center gap-1.5 opacity-30 print:opacity-40 pointer-events-none select-none print:top-6 print:right-6">
        <Zap className="w-3 h-3 text-primary" />
        <span className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">Release EDU</span>
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
              content: "Verified by Release EDU · releaseedu.com · Page " counter(page) " of " counter(pages);
              font-size: 9px;
              color: rgba(0, 0, 0, 0.5);
            }
            @top-right {
              content: "RELEASE EDU";
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
              Generate a professional portfolio based on your projects, skills, and learning journey.
              Perfect for university applications and employer reviews.
            </p>
          </div>
          <button
            onClick={generate}
            className="inline-flex items-center gap-2 bg-primary text-primary-foreground rounded-lg px-6 py-3 text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <Sparkles className="w-4 h-4" />
            Generate My Portfolio
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
            <p className="text-sm font-medium text-foreground">Analyzing your learning journey…</p>
            <p className="text-xs text-muted-foreground">Bob is reviewing your projects, conversations, and progress. Safe to leave — we&apos;ll keep working in the background.</p>
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
              <p className="text-lg text-muted-foreground">Portfolio — Getting Started</p>
            </div>
            <button
              onClick={generate}
              className="flex items-center gap-2 text-xs border border-border rounded-lg px-3 py-2 hover:bg-accent transition-colors text-muted-foreground"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Regenerate
            </button>
          </div>

          <div className="border-2 border-dashed border-border rounded-xl p-8 text-center space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-muted/50 flex items-center justify-center mx-auto">
              <BookOpen className="w-7 h-7 text-muted-foreground" />
            </div>
            <div className="space-y-2 max-w-lg mx-auto">
              <h2 className="text-lg font-semibold text-foreground">Not enough data yet</h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {portfolio.summary}
              </p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 max-w-md mx-auto pt-4">
              {[
                { label: 'Conversations', value: '0', needed: 'Chat with Bob' },
                { label: 'Completed work', value: '0%', needed: 'Do assignments' },
                { label: 'Insights', value: '0', needed: 'Keep learning' },
                { label: 'Projects', value: '0', needed: 'Start a project' },
              ].map(item => (
                <div key={item.label} className="p-3 rounded-lg bg-muted/30 border border-border/50 text-center">
                  <p className="text-lg font-bold text-muted-foreground">{item.value}</p>
                  <p className="text-[10px] text-muted-foreground">{item.label}</p>
                  <p className="text-[9px] text-primary mt-1">{item.needed}</p>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground pt-2">
              Every claim in your portfolio will be backed by real evidence from your work and conversations with Bob. No fabrication, ever.
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
                  Regenerate
                </button>
                <button
                  onClick={() => window.open('/dashboard/portfolio/print', '_blank', 'noopener')}
                  className="inline-flex items-center gap-1.5 border border-border rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-colors"
                  title="Open print-ready view (select 'Save as PDF' in the dialog)"
                >
                  <FileText className="w-3.5 h-3.5" />
                  Export PDF
                </button>
              </div>
            </div>

            {/* Key metrics row */}
            <div className="flex flex-wrap gap-3">
              <Badge variant="outline" className="gap-1.5">
                <Zap className="w-3 h-3 text-amber-400" />
                {student.xp.toLocaleString()} XP
              </Badge>
              <Badge variant="outline" className="gap-1.5">
                <TrendingUp className="w-3 h-3 text-emerald-400" />
                {student.streak} day streak
              </Badge>
              <Badge variant="outline" className="gap-1.5">
                <Target className="w-3 h-3 text-blue-400" />
                {toNumber(portfolio.metrics?.completionRate)}% completion
              </Badge>
              <Badge variant="outline" className="gap-1.5">
                <Star className="w-3 h-3 text-purple-400" />
                {sortedSkills.length} skills
              </Badge>
            </div>
          </motion.div>

          {/* Divider */}
          <div className="border-t border-border/50" />

          {/* Summary */}
          <motion.section {...fadeUp} className="space-y-3">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-muted-foreground" />
              Professional Summary
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
                Personal Statement
              </h2>
              <button
                onClick={() => setEditingStatement(!editingStatement)}
                className="text-[11px] text-primary hover:text-primary/80 transition-colors"
              >
                {editingStatement ? 'Done editing' : 'Edit'}
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
              Skills & Competencies
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
                Projects
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
                Character & Strengths
              </h2>
              <p className="text-[11px] text-muted-foreground -mt-2">
                Identified through AI analysis of learning conversations — each strength is backed by evidence.
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
                Growth Areas
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
                Metrics
              </h2>
              <div className="border border-border/50 rounded-lg p-6">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
                  {/* Completion Rate */}
                  <div className="flex flex-col items-center relative">
                    <CircularProgress value={toNumber(portfolio.metrics.completionRate)} label="Completion" />
                  </div>

                  {/* Consistency */}
                  <div className="flex flex-col items-center relative">
                    <CircularProgress value={toNumber(portfolio.metrics.consistencyScore)} label="Consistency" />
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
                    <span className="text-[10px] text-muted-foreground">Pace</span>
                  </div>

                  {/* Quality */}
                  <div className="flex flex-col items-center justify-center text-center gap-1">
                    <div className="w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                      <Award className="w-5 h-5 text-emerald-400" />
                    </div>
                    <span className="text-lg font-bold text-foreground">{Array.isArray(portfolio.metrics.qualityIndicators) ? portfolio.metrics.qualityIndicators.length : 0}</span>
                    <span className="text-[10px] text-muted-foreground">Quality Signals</span>
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
                This is an AI-generated user portfolio made by Release EDU. It seeks to be objective, transparent, and accurate, but please note that AI may make mistakes.
              </p>
            </div>
          </div>

          {/* Footer */}
          <div className="text-center pt-2">
            <p className="text-[11px] text-muted-foreground">
              Generated by Release EDU · AI-powered learning portfolio · {new Date().toLocaleDateString()}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
