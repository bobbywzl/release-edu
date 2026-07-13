'use client'
/**
 * Dashboard — per the Tree EDU sketch: XP status + rank (the XpPanel),
 * per-tree/per-node progress, and basic user info. Minimal.
 */
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { ChevronRight, Sprout, CheckCircle2, Brain, ChevronDown } from 'lucide-react'
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
  status: string
  nodeCount: number
  understoodCount: number
}

export default function DashboardPage() {
  const { data, loading } = useStudentData()
  const { t } = useLanguage()
  const [trees, setTrees] = useState<TreeSummary[] | null>(null)
  const [insights, setInsights] = useState<Array<{ id: string; type: string; content: string; timesObserved: number }>>([])
  const [showInsights, setShowInsights] = useState(false)

  useEffect(() => {
    fetch('/api/tree', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d?.trees) setTrees(d.trees) })
      .catch(() => {})
    fetch('/api/insights', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d?.insights) setInsights(d.insights) })
      .catch(() => {})
  }, [])

  const hour = typeof window !== 'undefined' ? new Date().getHours() : 12
  const greeting = hour < 12 ? t('dashboard.goodMorning') : hour < 18 ? t('dashboard.goodAfternoon') : t('dashboard.goodEvening')
  const firstName = data.student.name?.split(' ')[0] || ''
  const showSkeletonHeader = loading && !firstName

  const activeTrees = trees?.filter(tr => tr.status !== 'archived') ?? []
  const completedTrees = trees?.filter(tr => tr.status === 'completed') ?? []
  const totalNodes = activeTrees.reduce((s, tr) => s + tr.nodeCount, 0)
  const understoodNodes = activeTrees.reduce((s, tr) => s + tr.understoodCount, 0)

  return (
    <motion.div
      className="p-8 lg:p-12 max-w-3xl space-y-8"
      initial="hidden"
      animate="visible"
      variants={stagger}
    >
      {/* Welcome — basic user info */}
      <motion.div variants={fadeUp} className="space-y-1">
        {showSkeletonHeader ? (
          <>
            <div className="h-9 w-72 bg-muted/40 rounded animate-pulse" />
            <div className="h-4 w-96 max-w-full bg-muted/30 rounded mt-2 animate-pulse" />
          </>
        ) : (
          <>
            <h1 className="text-3xl font-bold text-foreground">
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

      {/* Stats row */}
      <motion.div variants={fadeUp} className="grid grid-cols-3 gap-4">
        <Link href="/dashboard/tree" className="block">
          <div className="border border-border/50 rounded-lg p-5 hover:border-border transition-colors">
            <div className="text-2xl font-bold text-foreground leading-none">{trees === null ? '—' : activeTrees.length}</div>
            <div className="text-xs text-muted-foreground mt-2">{t('dashboard.activeTrees')}</div>
          </div>
        </Link>
        <Link href="/dashboard/tree" className="block">
          <div className="border border-border/50 rounded-lg p-5 hover:border-border transition-colors">
            <div className="text-2xl font-bold text-foreground leading-none">{trees === null ? '—' : `${understoodNodes}/${totalNodes}`}</div>
            <div className="text-xs text-muted-foreground mt-2">{t('dashboard.nodesUnderstood')}</div>
          </div>
        </Link>
        <Link href="/dashboard/portfolio" className="block">
          <div className="border border-border/50 rounded-lg p-5 hover:border-border transition-colors">
            <div className="text-2xl font-bold text-emerald-400 leading-none">{trees === null ? '—' : completedTrees.length}</div>
            <div className="text-xs text-muted-foreground mt-2">{t('dashboard.problemsMastered')}</div>
          </div>
        </Link>
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
        {trees === null && <div className="h-20 rounded-lg border border-border/50 bg-card/50 animate-pulse" />}
        {trees !== null && activeTrees.length === 0 && (
          <Link href="/dashboard/tree" className="block">
            <div className="border border-dashed border-border rounded-xl p-8 text-center hover:border-primary/40 transition-colors">
              <TreeLogo className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
              <p className="text-sm font-medium text-foreground">{t('dashboard.plantFirst')}</p>
              <p className="text-xs text-muted-foreground mt-1">{t('dashboard.plantFirstSub')}</p>
            </div>
          </Link>
        )}
        {activeTrees.slice(0, 4).map(tree => {
          const pct = tree.nodeCount > 0 ? Math.round((tree.understoodCount / tree.nodeCount) * 100) : 0
          return (
            <Link key={tree.id} href={`/dashboard/tree/${tree.id}`} className="block">
              <div className="border border-border/50 rounded-lg p-4 hover:border-border transition-colors">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-foreground truncate flex-1">
                    {tree.title}
                    {tree.status === 'completed' && <CheckCircle2 className="inline w-3.5 h-3.5 text-emerald-400 ml-1.5 -mt-0.5" />}
                  </p>
                  <span className="text-[11px] text-muted-foreground tabular-nums flex-shrink-0">
                    {tree.understoodCount}/{tree.nodeCount} {t('dashboard.nodes')}
                  </span>
                </div>
                <div className="mt-2.5 h-1.5 rounded-full bg-muted overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${pct === 100 ? 'bg-emerald-400' : 'bg-primary'}`} style={{ width: `${pct}%` }} />
                </div>
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
            className="w-full border border-border/50 rounded-lg p-4 hover:border-border transition-colors flex items-center gap-2 text-left"
          >
            <Brain className="w-4 h-4 text-primary flex-shrink-0" />
            <span className="text-sm font-semibold text-foreground flex-1">{t('dashboard.bobKnows')}</span>
            <span className="text-[11px] text-muted-foreground">{insights.length} {t('dashboard.insightsCount')}</span>
            <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${showInsights ? 'rotate-180' : ''}`} />
          </button>
          {showInsights && (
            <div className="border border-t-0 border-border/50 rounded-b-lg px-4 py-3 space-y-1.5 -mt-1.5">
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
