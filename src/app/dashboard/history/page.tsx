'use client'
import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  History, Trash2, Eye, EyeOff, ChevronDown, ChevronUp,
  BookOpen, Trophy, Brain, Target, Calendar, Loader2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useLanguage } from '@/lib/i18n'

/* eslint-disable @typescript-eslint/no-explicit-any */

interface CurriculumBlock {
  id: string
  title: string
  profileSummary: string | null
  primaryInterests: string | null
  primaryStrengths: string | null
  learningStyle: string | null
  totalChapters: number
  completedChapters: number
  totalXp: number
  overallProgress: number
  tracksJson: string
  insightsJson: string | null
  sessionOutcomesJson: string | null
  highlightsJson: string | null
  startedAt: string
  lockedAt: string | null
  archivedAt: string
  includedInPortfolio: boolean
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function durationLabel(start: string, end: string) {
  const days = Math.round((new Date(end).getTime() - new Date(start).getTime()) / (1000 * 60 * 60 * 24))
  if (days < 1) return '< 1 day'
  if (days === 1) return '1 day'
  return `${days} days`
}

function BlockCard({ block, onTogglePortfolio, onDelete }: {
  block: CurriculumBlock
  onTogglePortfolio: (id: string, include: boolean) => void
  onDelete: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const tracks: any[] = JSON.parse(block.tracksJson || '[]')
  const insights: any[] = block.insightsJson ? JSON.parse(block.insightsJson) : []
  const outcomes: any[] = block.sessionOutcomesJson ? JSON.parse(block.sessionOutcomesJson) : []
  const highlights: any[] = block.highlightsJson ? JSON.parse(block.highlightsJson) : []

  const interestTracks = tracks.filter(t => t.type === 'project')
  const coreTracks = tracks.filter(t => t.type === 'core')
  const passedSessions = outcomes.filter(o => o.passed).length
  const avgScore = outcomes.length > 0 ? Math.round(outcomes.reduce((s: number, o: any) => s + o.endScore, 0) / outcomes.length) : 0

  function handleDelete() {
    if (!confirm('Permanently delete this curriculum block? This cannot be undone.')) return
    setDeleting(true)
    onDelete(block.id)
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-card border border-border rounded-xl overflow-hidden"
    >
      {/* Header */}
      <div className="p-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-foreground truncate">{block.title}</h3>
            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                {formatDate(block.startedAt)} — {formatDate(block.archivedAt)}
              </span>
              <span>({durationLabel(block.startedAt, block.archivedAt)})</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button
              onClick={() => onTogglePortfolio(block.id, !block.includedInPortfolio)}
              className={cn(
                'p-1.5 rounded-md transition-colors text-xs flex items-center gap-1',
                block.includedInPortfolio
                  ? 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                  : 'bg-muted/50 text-muted-foreground hover:bg-muted'
              )}
              title={block.includedInPortfolio ? 'Included in portfolio — click to exclude' : 'Excluded from portfolio — click to include'}
            >
              {block.includedInPortfolio ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="p-1.5 rounded-md text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-colors"
              title="Delete permanently"
            >
              {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* Progress bar */}
        <div className="flex items-center gap-3 mb-3">
          <div className="flex-1 h-2 bg-muted/30 rounded-full overflow-hidden">
            <div
              className={cn('h-full rounded-full transition-all', block.overallProgress >= 80 ? 'bg-emerald-500' : block.overallProgress >= 40 ? 'bg-primary' : 'bg-amber-500')}
              style={{ width: `${block.overallProgress}%` }}
            />
          </div>
          <span className="text-sm font-bold text-foreground tabular-nums">{block.overallProgress}%</span>
        </div>

        {/* Quick stats */}
        <div className="grid grid-cols-4 gap-3">
          {[
            { icon: BookOpen, label: 'Chapters', value: `${block.completedChapters}/${block.totalChapters}`, color: 'text-blue-400' },
            { icon: Trophy, label: 'XP Earned', value: block.totalXp.toLocaleString(), color: 'text-yellow-400' },
            { icon: Target, label: 'Avg Score', value: outcomes.length > 0 ? `${avgScore}%` : '—', color: 'text-green-400' },
            { icon: Brain, label: 'Insights', value: insights.length.toString(), color: 'text-purple-400' },
          ].map(stat => (
            <div key={stat.label} className="text-center">
              <stat.icon className={cn('w-4 h-4 mx-auto mb-1', stat.color)} />
              <div className="text-sm font-bold text-foreground">{stat.value}</div>
              <div className="text-[10px] text-muted-foreground">{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Expand button */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full mt-3 pt-3 border-t border-border/50 flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {expanded ? 'Hide details' : 'View details'}
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
      </div>

      {/* Expanded details */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5 space-y-4">
              {/* Profile summary */}
              {block.profileSummary && (
                <div>
                  <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">Profile</h4>
                  <p className="text-sm text-foreground/80 leading-relaxed">{block.profileSummary}</p>
                </div>
              )}

              {/* Tracks */}
              <div>
                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Tracks</h4>
                <div className="space-y-1.5">
                  {interestTracks.length > 0 && (
                    <div className="text-[10px] text-muted-foreground/60 uppercase tracking-wider mb-1">Interest-Based</div>
                  )}
                  {interestTracks.map((t: any, i: number) => (
                    <div key={i} className="flex items-center gap-2 text-sm">
                      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: t.color }} />
                      <span className="text-foreground/80 flex-1 truncate">{t.name}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">{t.progress}%</span>
                    </div>
                  ))}
                  {coreTracks.length > 0 && (
                    <div className="text-[10px] text-muted-foreground/60 uppercase tracking-wider mt-2 mb-1">Foundation</div>
                  )}
                  {coreTracks.map((t: any, i: number) => (
                    <div key={i} className="flex items-center gap-2 text-sm">
                      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: t.color }} />
                      <span className="text-foreground/80 flex-1 truncate">{t.name}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">{t.progress}%</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Key insights */}
              {insights.length > 0 && (
                <div>
                  <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Bob&apos;s Insights</h4>
                  <div className="space-y-1">
                    {insights.slice(0, 8).map((ins: any, i: number) => (
                      <div key={i} className="text-xs text-foreground/70 flex items-start gap-1.5">
                        <span className={cn(
                          'text-[9px] font-medium px-1 py-0.5 rounded flex-shrink-0 mt-0.5',
                          ins.type === 'strength' ? 'bg-emerald-500/10 text-emerald-400' :
                          ins.type === 'weakness' ? 'bg-amber-500/10 text-amber-400' :
                          ins.type === 'interest' ? 'bg-blue-500/10 text-blue-400' :
                          'bg-muted text-muted-foreground'
                        )}>
                          {ins.type}
                        </span>
                        <span>{ins.content}</span>
                      </div>
                    ))}
                    {insights.length > 8 && (
                      <p className="text-[10px] text-muted-foreground/50 mt-1">+{insights.length - 8} more insights</p>
                    )}
                  </div>
                </div>
              )}

              {/* Highlights */}
              {highlights.length > 0 && (
                <div>
                  <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Annotations ({highlights.length})</h4>
                  <div className="space-y-1">
                    {highlights.slice(0, 5).map((h: any, i: number) => (
                      <div key={i} className="text-xs text-foreground/60 border-l-2 border-amber-400/40 pl-2">
                        &ldquo;{h.selectedText.slice(0, 80)}{h.selectedText.length > 80 ? '…' : ''}&rdquo;
                        {h.comment && <span className="text-muted-foreground/50 ml-1">— {h.comment}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Session outcomes */}
              {outcomes.length > 0 && (
                <div>
                  <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                    Sessions: {passedSessions}/{outcomes.length} passed · Avg score {avgScore}%
                  </h4>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

export default function HistoryPage() {
  const { t: tr } = useLanguage()
  const [blocks, setBlocks] = useState<CurriculumBlock[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/history')
      .then(r => r.json())
      .then(data => { setBlocks(data.blocks || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  function handleTogglePortfolio(id: string, include: boolean) {
    setBlocks(prev => prev.map(b => b.id === id ? { ...b, includedInPortfolio: include } : b))
    fetch('/api/history', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blockId: id, includedInPortfolio: include }),
    }).catch(() => {})
  }

  function handleDelete(id: string) {
    setBlocks(prev => prev.filter(b => b.id !== id))
    fetch('/api/history', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blockId: id }),
    }).catch(() => {})
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <History className="w-7 h-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold text-foreground">{tr("history.title")}</h1>
          <p className="text-sm text-muted-foreground">
            Past curricula you&apos;ve pursued. Toggle the eye icon to include/exclude from your portfolio.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : blocks.length === 0 ? (
        <div className="text-center py-20">
          <History className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
          <h2 className="text-lg font-medium text-muted-foreground mb-1">No history yet</h2>
          <p className="text-sm text-muted-foreground/60">
            When you start over with a new curriculum, your previous progress will be archived here.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {blocks.map(block => (
            <BlockCard
              key={block.id}
              block={block}
              onTogglePortfolio={handleTogglePortfolio}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  )
}
