'use client'
/**
 * Dashboard — per the Tree EDU sketch: XP status + rank (the XpPanel),
 * per-tree/per-node progress, and basic user info. Minimal.
 */
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { ChevronRight, Sprout, CheckCircle2, Brain, ChevronDown, Telescope } from 'lucide-react'
import { useStudentData } from '@/lib/student-data'
import { useLanguage } from '@/lib/i18n'
import { XpPanel } from '@/components/xp-panel'
import { TreeLogo } from '@/components/tree-logo'

const fadeUp = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.18, ease: 'easeOut' as const } },
}
const stagger = { visible: { transition: { staggerChildren: 0.04 } } }

interface TreeSummary {
  id: string
  title: string
  displayTitle: string | null
  status: string
  nodeCount: number
  understoodCount: number
}

export default function DashboardPage() {
  const { data, loading } = useStudentData()
  const { t } = useLanguage()
  const [trees, setTrees] = useState<TreeSummary[] | null>(null)
  const [insights, setInsights] = useState<Array<{ id: string; type: string; content: string; timesObserved: number; lastConfirmedAt?: string }>>([])
  const [showInsights, setShowInsights] = useState(false)
  // The star counter shows the TRUE constellation size from the API (the
  // visible list is ranked and capped at 24 — counting it made the number
  // wander 3 → 13 → 24 → 20 across loads). Shown directly, no count-up
  // animation: a stat that settles on a different number each visit reads
  // as broken, not earned.
  const [starCount, setStarCount] = useState<number | null>(null)

  useEffect(() => {
    fetch('/api/tree', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d?.trees) setTrees(d.trees) })
      .catch(() => {})
    fetch('/api/insights', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (d?.insights) setInsights(d.insights)
        if (typeof d?.total === 'number') setStarCount(d.total)
        else if (d?.insights) setStarCount(d.insights.length)
      })
      .catch(() => {})
  }, [])

  const hour = typeof window !== 'undefined' ? new Date().getHours() : 12
  const greeting = hour < 12 ? t('dashboard.goodMorning') : hour < 18 ? t('dashboard.goodAfternoon') : t('dashboard.goodEvening')
  const firstName = data.student.name?.split(' ')[0] || ''
  const showSkeletonHeader = loading && !firstName

  // RECIPROCITY: the weekly digest — what Bob figured out about this learner
  // in the trailing 7 days (new or reinforced insights). Bob gives first.
  const weekAgo = Date.now() - 7 * 86_400_000
  const weeklyInsights = insights
    .filter(i => i.lastConfirmedAt && new Date(i.lastConfirmedAt).getTime() >= weekAgo)
    .slice(0, 3)

  // ONE counting convention (the counters used to disagree across
  // surfaces): "active" means status 'active' only — a mastered tree is
  // counted once, under problems mastered, never also as active. Node
  // counts everywhere exclude the root and pending ghosts (the API's
  // convention), same as the canvas header.
  const activeTrees = trees?.filter(tr => tr.status === 'active') ?? []
  const completedTrees = trees?.filter(tr => tr.status === 'completed') ?? []
  const totalNodes = activeTrees.reduce((s, tr) => s + tr.nodeCount, 0)
  const understoodNodes = activeTrees.reduce((s, tr) => s + tr.understoodCount, 0)

  return (
    <motion.div
      className="px-6 py-10 lg:px-10 lg:py-14 max-w-4xl mx-auto w-full space-y-8"
      initial="hidden"
      animate="visible"
      variants={stagger}
    >
      {/* Welcome — basic user info */}
      <motion.div variants={fadeUp} className="space-y-1.5">
        {showSkeletonHeader ? (
          <>
            <div className="h-10 w-72 skeleton" />
            <div className="h-4 w-96 max-w-full skeleton mt-2" />
          </>
        ) : (
          <>
            <h1 className="font-display text-4xl lg:text-[2.6rem] font-semibold text-foreground tracking-tight">
              {firstName ? `${greeting}, ${firstName}` : greeting}
            </h1>
            <p className="text-muted-foreground">{t('dashboard.treeSub')}</p>
          </>
        )}
      </motion.div>

      {/* XP status, rank, daily goal, streak, badges */}
      <motion.div variants={fadeUp}>
        <XpPanel />
      </motion.div>

      {/* Bob's week with you — the digest of fresh learner insights */}
      {weeklyInsights.length > 0 && (
        <motion.div variants={fadeUp}>
          <div className="border border-primary/25 bg-primary/[0.05] rounded-xl p-4 space-y-2">
            <p className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Telescope className="w-4 h-4 text-primary" />
              {t('dashboard.weeklyDigest')}
            </p>
            <div className="space-y-1.5">
              {weeklyInsights.map(i => (
                <div key={i.id} className="flex items-start gap-2 text-xs">
                  <span className="flex-shrink-0 px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[10px] font-medium uppercase tracking-wide">{t(`insight.type.${i.type}`, i.type)}</span>
                  <span className="text-foreground/85 leading-snug">{i.content}</span>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground">{t('dashboard.weeklyDigestSub')}</p>
          </div>
        </motion.div>
      )}

      {/* Stats row */}
      <motion.div variants={fadeUp} className="grid grid-cols-3 gap-3.5">
        {[
          { href: '/dashboard/tree', icon: Sprout, value: trees === null ? null : String(activeTrees.length), label: t('dashboard.activeTrees'), tone: 'text-foreground' },
          { href: '/dashboard/tree', icon: CheckCircle2, value: trees === null ? null : `${understoodNodes}/${totalNodes}`, label: t('dashboard.nodesUnderstood'), tone: 'text-foreground' },
          { href: '/dashboard/portfolio', icon: TreeLogo, value: trees === null ? null : String(completedTrees.length), label: t('dashboard.problemsMastered'), tone: 'text-primary' },
        ].map((s, i) => (
          <Link key={i} href={s.href} className="block group">
            <div className="surface surface-hover p-4 sm:p-5">
              <s.icon className="w-4 h-4 text-primary/70 mb-2.5" />
              {s.value === null
                ? <div className="h-7 w-12 skeleton" />
                : <div className={`text-2xl font-bold leading-none tabular-nums ${s.tone}`}>{s.value}</div>}
              <div className="text-xs text-muted-foreground mt-2">{s.label}</div>
            </div>
          </Link>
        ))}
      </motion.div>

      {/* Per-tree progress (per-node granularity) */}
      <motion.div variants={fadeUp} className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Sprout className="w-4 h-4 text-emerald-400" />
            {t('dashboard.yourTrees')}
          </h2>
          <Link href="/dashboard/tree" className="text-xs text-primary hover:text-primary/80 flex items-center gap-0.5">
            {t('dashboard.viewAll')} <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        </div>
        {trees === null && <div className="h-20 skeleton" />}
        {trees !== null && activeTrees.length === 0 && (
          <Link href="/dashboard/tree" className="block">
            <div className="border border-dashed border-primary/30 bg-primary/[0.03] rounded-2xl p-10 text-center hover:border-primary/50 hover:bg-primary/[0.06] transition-all">
              <TreeLogo className="w-9 h-9 text-primary mx-auto mb-2.5" />
              <p className="text-sm font-semibold text-foreground">{t('dashboard.plantFirst')}</p>
              <p className="text-xs text-muted-foreground mt-1">{t('dashboard.plantFirstSub')}</p>
            </div>
          </Link>
        )}
        {activeTrees.slice(0, 4).map(tree => {
          const pct = tree.nodeCount > 0 ? Math.round((tree.understoodCount / tree.nodeCount) * 100) : 0
          return (
            <Link key={tree.id} href={`/dashboard/tree/${tree.id}`} className="block group">
              <div className="surface surface-hover p-4">
                <div className="flex items-center gap-2">
                  <p title={tree.title} className="text-sm font-semibold text-foreground truncate flex-1 group-hover:text-primary transition-colors">
                    {tree.displayTitle || tree.title}
                    {tree.status === 'completed' && <CheckCircle2 className="inline w-3.5 h-3.5 text-emerald-400 ml-1.5 -mt-0.5" />}
                  </p>
                  <span className="text-[11px] text-muted-foreground tabular-nums flex-shrink-0">
                    {tree.understoodCount > 0 ? `${tree.understoodCount}/${tree.nodeCount}` : tree.nodeCount} {t('dashboard.nodes')}
                  </span>
                  <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50 group-hover:text-primary group-hover:translate-x-0.5 transition-all flex-shrink-0" />
                </div>
                {/* Goal gradient: no zero bars — the meter appears with the
                    first verified node. */}
                {tree.understoodCount > 0 && (
                  <div className="mt-2.5 h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${pct === 100 ? 'bg-emerald-400' : 'bg-gradient-to-r from-primary/70 to-primary'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                )}
              </div>
            </Link>
          )
        })}
      </motion.div>

      {/* Open learner model — transparency into Bob's memory (research:
          legible learner models improve learning, Long & Aleven 2017). */}
      {insights.length > 0 && (
        <motion.div variants={fadeUp}>
          <button
            onClick={() => setShowInsights(s => !s)}
            className="w-full surface surface-hover p-4 flex items-center gap-2 text-left"
          >
            <Brain className="w-4 h-4 text-primary flex-shrink-0" />
            <span className="text-sm font-semibold text-foreground flex-1">{t('dashboard.constellation')}</span>
            {/* Plain count — the star/constellation metaphor is gone from
                this panel (user directive); the badge ladder keeps its
                themed names, but here it's simply what it is: insights. */}
            <span className="text-[11px] text-muted-foreground tabular-nums">{starCount ?? insights.length} {t('dashboard.starsEarned')}</span>
            <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${showInsights ? 'rotate-180' : ''}`} />
          </button>
          {showInsights && (
            <div className="rounded-b-2xl border border-t-0 border-white/[0.06] bg-white/[0.02] px-4 py-3 space-y-1.5 -mt-2 pt-3.5">
              <p className="text-[11px] text-muted-foreground mb-2">{t('dashboard.bobKnowsSub')}</p>
              {insights.map(i => (
                <div key={i.id} className="flex items-start gap-2 text-xs">
                  <span className="flex-shrink-0 px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[10px] font-medium uppercase tracking-wide">{t(`insight.type.${i.type}`, i.type)}</span>
                  <span className="text-foreground/85 leading-snug">{i.content}{i.timesObserved > 1 ? <span className="text-muted-foreground/60"> ·×{i.timesObserved}</span> : null}</span>
                </div>
              ))}
            </div>
          )}
        </motion.div>
      )}
    </motion.div>
  )
}
