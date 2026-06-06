'use client'
import { useState, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Sparkles, Brain, Target, Clock, ChevronRight, ChevronDown,
  CheckCircle, Circle, Loader2, BookOpen, Play, RotateCcw,
  Lightbulb, MessageSquare, TrendingUp, Lock, AlertTriangle, Shield,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'
import { TransitionScreen } from '@/components/transition-screen'
import { useStudentData, refreshStudentData } from '@/lib/student-data'
import { useCurriculumOverview, refreshCurriculumOverview, type TrackOverview } from '@/lib/curriculum-overview'
import { useLanguage } from '@/lib/i18n'
import { useCompletionStats } from '@/lib/completion-stats'
import { triggerCurriculumRefresh } from '@/lib/refresh-bus'
import { refreshCompletionStats } from '@/lib/completion-stats'
import type { CurriculumModule, StudentInsight } from '@/types'
import Link from 'next/link'

// ── Status icons ──

const STATUS_ICON: Record<string, { icon: typeof CheckCircle; class: string }> = {
  completed: { icon: CheckCircle, class: 'text-emerald-400' },
  'in-progress': { icon: Loader2, class: 'text-blue-400 animate-spin' },
  'not-started': { icon: Circle, class: 'text-slate-500' },
}

function ChapterStatusIcon({ status }: { status: string }) {
  const cfg = STATUS_ICON[status] || STATUS_ICON['not-started']
  const Icon = cfg.icon
  return <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${cfg.class}`} />
}

// ── Chapter Action Button ──

function ChapterActionButton({
  chapterId,
  trackId,
  status,
}: {
  chapterId: string
  trackId: string
  status: string
  onStatusChange?: () => void
}) {
  const router = useRouter()
  const { t: tr } = useLanguage()
  const [loading, setLoading] = useState(false)

  async function startChapter() {
    setLoading(true)
    try {
      if (status === 'not-started') {
        await fetch(`/api/chapter/${chapterId}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'in-progress' }),
        })
      }
      router.push(`/dashboard/chat?chapterId=${chapterId}&trackId=${trackId}&mode=tutoring`)
    } catch {
      setLoading(false)
    }
  }

  if (loading) {
    return <Loader2 className="w-3 h-3 animate-spin text-muted-foreground flex-shrink-0" />
  }

  if (status === 'completed') {
    return (
      <button
        onClick={(e) => { e.stopPropagation(); startChapter() }}
        className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors flex-shrink-0"
      >
        <RotateCcw className="w-2.5 h-2.5" />
        {tr('curriculum.review')}
      </button>
    )
  }

  if (status === 'in-progress') {
    return (
      <button
        onClick={(e) => { e.stopPropagation(); startChapter() }}
        className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors flex-shrink-0"
      >
        <Play className="w-2.5 h-2.5" />
        {tr('curriculum.continue')}
      </button>
    )
  }

  // not-started
  return (
    <button
      onClick={(e) => { e.stopPropagation(); startChapter() }}
      className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary hover:bg-primary/20 transition-colors flex-shrink-0"
    >
      <Play className="w-2.5 h-2.5" />
      {tr('curriculum.start')}
    </button>
  )
}

// ── Interest-Based Track Row ──

function InterestTrackRow({ track }: { track: TrackOverview }) {
  const { t: tr } = useLanguage()
  const [expanded, setExpanded] = useState(false)
  const totalChapters = track.chapters.length
  const completedChapters = track.chapters.filter(c => c.status === 'completed').length
  const allDone = totalChapters > 0 && completedChapters === totalChapters

  return (
    <div className="group">
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {/* Color bar */}
        <div className="w-1 h-8 rounded-full flex-shrink-0" style={{ backgroundColor: track.color }} />

        {/* Track info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Link
              href={`/dashboard/curriculum/${track.id}`}
              className="text-sm font-medium text-foreground hover:text-primary transition-colors truncate"
              onClick={e => e.stopPropagation()}
            >
              {track.name}
            </Link>
            {allDone && <CheckCircle className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />}
          </div>
          {/* Badge row */}
          <div className="flex items-center gap-2 mt-1">
            {track.homeworkCount > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400">
                {track.completedHomeworkCount}/{track.homeworkCount} {tr('curriculum.homework')}
              </span>
            )}
            {track.quizCount > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400">
                {track.completedQuizCount}/{track.quizCount} {tr('curriculum.quizzes')}
              </span>
            )}
            {track.projectStatus && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400">
                {tr('curriculum.project')}: {track.projectStatus}
              </span>
            )}
            {totalChapters > 0 && (
              <span className="text-[10px] text-muted-foreground">
                {completedChapters}/{totalChapters} {tr('curriculum.chapters')}
              </span>
            )}
          </div>
        </div>

        {/* Expand arrow */}
        <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform flex-shrink-0 ${expanded ? 'rotate-180' : ''}`} />
      </div>

      {/* Expanded chapter list */}
      <AnimatePresence>
        {expanded && track.chapters.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="pl-10 pr-4 pb-3 space-y-1">
              {track.chapters.map(ch => (
                <div key={ch.id} className="flex items-center gap-2 py-1 text-xs">
                  <ChapterStatusIcon status={ch.status} />
                  <Link
                    href={`/dashboard/curriculum/${track.id}/content/${ch.id}`}
                    className={`flex-1 truncate hover:text-primary transition-colors ${ch.status === 'completed' ? 'text-muted-foreground line-through' : 'text-foreground'}`}
                  >
                    {ch.title}
                  </Link>
                  {ch.status !== 'completed' && (ch.sessionScore ?? 0) > 0 && (
                    <div className="w-12 flex-shrink-0">
                      <Progress value={ch.sessionScore ?? 0} className="h-1" />
                    </div>
                  )}
                  <ChapterActionButton
                    chapterId={ch.id}
                    trackId={track.id}
                    status={ch.status}
                  />
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Foundation Subject Card ──

function FoundationSubjectCard({ track }: { track: TrackOverview }) {
  const { t: tr } = useLanguage()
  const [expanded, setExpanded] = useState(false)
  const totalChapters = track.chapters.length
  const completedChapters = track.chapters.filter(c => c.status === 'completed').length
  const progress = totalChapters > 0 ? Math.round((completedChapters / totalChapters) * 100) : 0
  const allDone = totalChapters > 0 && completedChapters === totalChapters

  return (
    <div className="border border-border/50 rounded-lg overflow-hidden">
      {/* Subject header — click to expand */}
      <div
        className="px-4 py-3 bg-muted/20 flex items-center gap-2 cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: track.color }} />
        <span className="text-sm font-semibold text-foreground hover:text-primary transition-colors flex-1">
          {track.name}
        </span>
        <span className="text-[10px] text-muted-foreground mr-2">{completedChapters}/{totalChapters}</span>
        {allDone
          ? <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0" />
          : <ChevronDown className={`w-4 h-4 text-muted-foreground flex-shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        }
      </div>

      {/* Collapsed: show summary badges only */}
      {!expanded && (track.homeworkCount > 0 || track.quizCount > 0) && (
        <div className="px-4 py-1.5 border-t border-border/30 flex items-center gap-2">
          {track.homeworkCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400">
              {track.completedHomeworkCount}/{track.homeworkCount} {tr("curriculum.hw")}
            </span>
          )}
          {track.quizCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400">
              {track.completedQuizCount}/{track.quizCount} {tr("curriculum.quiz")}
            </span>
          )}
        </div>
      )}

      {/* Expanded: chapters list */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            {(track.homeworkCount > 0 || track.quizCount > 0) && (
              <div className="px-4 py-1.5 border-t border-border/30 flex items-center gap-2">
                {track.homeworkCount > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400">
                    {track.completedHomeworkCount}/{track.homeworkCount} {tr("curriculum.hw")}
                  </span>
                )}
                {track.quizCount > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400">
                    {track.completedQuizCount}/{track.quizCount} {tr("curriculum.quiz")}
                  </span>
                )}
              </div>
            )}
            {track.chapters.length > 0 ? (
              <div className="divide-y divide-border/30">
                {track.chapters.map(ch => (
                  <div key={ch.id} className="flex items-center gap-2.5 px-4 py-2 hover:bg-muted/20 transition-colors">
                    <ChapterStatusIcon status={ch.status} />
                    <span className={`text-xs flex-1 truncate ${ch.status === 'completed' ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                      {ch.title}
                    </span>
                    {ch.status !== 'completed' && (ch.sessionScore ?? 0) > 0 && (
                      <div className="w-16 flex-shrink-0 flex items-center gap-1">
                        <Progress value={ch.sessionScore ?? 0} className="h-1 flex-1" />
                        <span className="text-[9px] text-muted-foreground">{ch.sessionScore}%</span>
                      </div>
                    )}
                    <ChapterActionButton chapterId={ch.id} trackId={track.id} status={ch.status} />
                    <Link
                      href={`/dashboard/curriculum/${track.id}/content/${ch.id}`}
                      className="text-[10px] text-primary hover:text-primary/80 flex items-center gap-0.5 flex-shrink-0"
                    >
                      Open <ChevronRight className="w-3 h-3" />
                    </Link>
                  </div>
                ))}
              </div>
            ) : (
              <div className="px-4 py-3 text-xs text-muted-foreground italic">{tr("curriculum.noAssignments")}</div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Insight Card ──

function InsightCard({ insight }: { insight: StudentInsight }) {
  const typeColors: Record<string, string> = {
    personality: 'bg-purple-500/10 text-purple-400',
    interest: 'bg-blue-500/10 text-blue-400',
    strength: 'bg-emerald-500/10 text-emerald-400',
    weakness: 'bg-amber-500/10 text-amber-400',
    preference: 'bg-cyan-500/10 text-cyan-400',
    aspiration: 'bg-pink-500/10 text-pink-400',
    breakthrough: 'bg-yellow-500/10 text-yellow-400',
    struggle: 'bg-red-500/10 text-red-400',
    style: 'bg-indigo-500/10 text-indigo-400',
  }

  return (
    <div className="flex items-start gap-2 py-1.5">
      <Badge className={`text-[10px] capitalize flex-shrink-0 ${typeColors[insight.type] || ''}`}>
        {insight.type}
      </Badge>
      <p className="text-xs text-muted-foreground leading-relaxed">{insight.content}</p>
    </div>
  )
}

// ── Curriculum Status Card (Browse → Lock-in → Locked → Complete) ──

type CurriculumPhase = 'browsing' | 'confirming' | 'locked' | 'complete'

function CurriculumStatusCard({
  plan,
  allModules,
}: {
  plan: { generatedAt: string; lastUpdatedAt: string; version: number; lockedAt?: string | null }
  allModules: CurriculumModule[]
}) {
  const { t: tr } = useLanguage()
  const [phase, setPhase] = useState<CurriculumPhase>('browsing')
  const [countdown, setCountdown] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 })
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const allComplete = allModules.length > 0 && allModules.every(m => m.status === 'completed')
  const inProgressCount = allModules.filter(m => m.status === 'in-progress').length
  const notStartedCount = allModules.filter(m => m.status === 'not-started').length
  const completedCount = allModules.filter(m => m.status === 'completed').length

  const createdAt = new Date(plan.generatedAt)
  const browseEnd = new Date(createdAt)
  browseEnd.setDate(browseEnd.getDate() + 3)

  const lockedAt = plan.lockedAt ? new Date(plan.lockedAt) : null
  const lockDate = lockedAt ?? browseEnd
  const cooldownEnd = new Date(lockDate)
  cooldownEnd.setDate(cooldownEnd.getDate() + 30)

  const computePhase = useCallback((): CurriculumPhase => {
    if (allComplete) return 'complete'
    const now = new Date()
    if (lockedAt || now >= browseEnd) return 'locked'
    return 'browsing'
  }, [allComplete, lockedAt, browseEnd])

  useEffect(() => {
    const initialPhase = computePhase()
    setPhase(prev => prev === 'confirming' ? prev : initialPhase)

    const timer = setInterval(() => {
      const now = new Date()
      setPhase(prev => {
        if (prev === 'confirming') return prev
        if (allComplete) return 'complete'
        if (lockedAt || now >= browseEnd) return 'locked'
        return 'browsing'
      })

      const currentPhase = (() => {
        if (allComplete) return 'complete'
        if (lockedAt || now >= browseEnd) return 'locked'
        return 'browsing'
      })()

      const target = currentPhase === 'locked' ? cooldownEnd : browseEnd
      const diff = Math.max(0, target.getTime() - now.getTime())

      setCountdown({
        days: Math.floor(diff / (1000 * 60 * 60 * 24)),
        hours: Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
        minutes: Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60)),
        seconds: Math.floor((diff % (1000 * 60)) / 1000),
      })
    }, 1000)

    return () => clearInterval(timer)
  }, [computePhase, allComplete, lockedAt, browseEnd, cooldownEnd])

  const handleLockIn = async () => {
    try {
      const res = await fetch('/api/curriculum/apply-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'lock_in' }),
      })
      if (res.ok) {
        // Refresh all data so lockedAt propagates and phase stays locked on reload
        triggerCurriculumRefresh()
        refreshStudentData()
        refreshCurriculumOverview()
      }
    } catch { /* non-critical */ }
    setPhase('locked')
  }

  const daysSinceChange = Math.floor((Date.now() - new Date(plan.lastUpdatedAt).getTime()) / (1000 * 60 * 60 * 24))
  const canChange = phase === 'locked' && countdown.days === 0 && countdown.hours === 0 && countdown.minutes === 0 && countdown.seconds === 0

  if (phase === 'complete') {
    return (
      <Card className="border-2 border-emerald-500/30 bg-emerald-500/5">
        <CardContent className="p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-emerald-500/20 flex items-center justify-center">
                <span className="text-sm">🎉</span>
              </div>
              <span className="text-sm font-semibold text-foreground">{tr('curriculum.complete')}</span>
            </div>
            <Badge variant="outline" className="text-[10px]">v{plan.version}</Badge>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {tr('curriculum.completeBody')}
          </p>
          <Button size="sm" className="w-full text-xs">
            <Sparkles className="w-3 h-3 mr-1" />
            {tr('curriculum.generateNext')}
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (phase === 'confirming') {
    return (
      <Card className="border-2 border-amber-500/50 bg-amber-500/5">
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-amber-500/20 flex items-center justify-center">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
            </div>
            <span className="text-sm font-semibold text-foreground">{tr('curriculum.confirmLockIn')}</span>
          </div>
          <div className="p-3 rounded-lg bg-card border border-border/50 space-y-2">
            <p className="text-xs text-foreground font-medium">{tr('curriculum.confirmLockInQ')}</p>
            <ul className="text-[11px] text-muted-foreground space-y-1.5 leading-relaxed">
              <li className="flex items-start gap-2"><Lock className="w-3 h-3 mt-0.5 text-amber-400 flex-shrink-0" />{tr('curriculum.willBeLocked')} <span className="text-foreground font-medium">{tr('curriculum.lockedFor30')}</span></li>
              <li className="flex items-start gap-2"><Shield className="w-3 h-3 mt-0.5 text-amber-400 flex-shrink-0" />{tr('curriculum.noChangesUnless')} <span className="text-foreground font-medium">{tr('curriculum.forcedRelease')}</span> {tr('curriculum.approvedByMentor')}</li>
              <li className="flex items-start gap-2"><Clock className="w-3 h-3 mt-0.5 text-amber-400 flex-shrink-0" />{tr('curriculum.stillHave')} <span className="text-foreground font-medium">{countdown.days}d {countdown.hours}h</span> {tr('curriculum.browseRemaining')}</li>
            </ul>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="text-xs flex-1" onClick={() => setPhase('browsing')}>
              {tr('curriculum.keepBrowsing')}
            </Button>
            <Button size="sm" className="text-xs flex-1 bg-amber-500 text-black hover:bg-amber-400 font-medium" onClick={handleLockIn}>
              <Lock className="w-3 h-3 mr-1" />
              {tr('curriculum.yesLockIn')}
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (phase === 'browsing') {
    return (
      <Card className="border-2 border-amber-500/30 bg-amber-500/5">
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-amber-500/20 flex items-center justify-center">
                <span className="text-sm">🛒</span>
              </div>
              <span className="text-sm font-semibold text-foreground">{tr('curriculum.shopBrowse')}</span>
            </div>
            {mounted ? (
              <Badge variant="outline" className="text-[10px] border-amber-500/30 text-amber-400 font-mono tabular-nums">
                {countdown.days}d {countdown.hours}h {countdown.minutes}m {countdown.seconds}s
              </Badge>
            ) : <div className="h-5 w-24" />}
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {tr('curriculum.youHave')} <span className="text-foreground font-medium">{countdown.days} {countdown.days !== 1 ? tr('curriculum.days') : tr('curriculum.day')}</span> {tr('curriculum.browseFreely')} <span className="text-foreground">{tr('curriculum.parentsMentorsBob')}</span> {tr('curriculum.feelsRight')}
          </p>
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            <span>{tr('curriculum.addRemoveChapters')}</span>
            <span>{tr('curriculum.swapCourses')}</span>
            <span>{tr('curriculum.adjustScope')}</span>
          </div>
          <div className="p-2.5 rounded-md bg-card border border-border/50">
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              <span className="font-medium text-amber-400">{tr('curriculum.afterBrowseEnds')}</span>{tr('curriculum.locksInWarning')}
              <span className="text-foreground"> {tr('curriculum.forcedReleaseMentor')}</span> {tr('curriculum.approvedByMentor2')}
            </p>
          </div>
          <div className="flex gap-2">
            <Link href="/dashboard/chat?mode=logistics&new=true" className="flex-1">
              <Button size="sm" variant="outline" className="text-xs w-full">
                <MessageSquare className="w-3 h-3 mr-1" />
                {tr('curriculum.discussWithBob')}
              </Button>
            </Link>
            <Button
              size="sm"
              className="text-xs flex-1 bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 border border-amber-500/30"
              onClick={() => setPhase('confirming')}
            >
              {tr('curriculum.lockInEarly')}
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  // Locked state — rich post-lock-in UI
  const lockedOnDate = lockedAt ? lockedAt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '—'
  const unlocksDate = cooldownEnd.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  const totalChapters = allComplete ? 0 : (inProgressCount + notStartedCount + completedCount)
  const completedPct = totalChapters > 0 ? Math.round((completedCount / totalChapters) * 100) : 0

  return (
    <div className="space-y-3">
      {/* Header banner */}
      <div className="relative overflow-hidden rounded-xl border border-emerald-500/20 bg-gradient-to-br from-emerald-950/40 via-card to-card p-5">
        {/* Decorative lock icon bg */}
        <div className="absolute right-4 top-1/2 -translate-y-1/2 opacity-5">
          <Lock className="w-24 h-24 text-emerald-400" />
        </div>
        <div className="relative space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
                <Lock className="w-3.5 h-3.5 text-emerald-400" />
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-semibold text-foreground">{tr('curriculum.lockedIn')}</p>
                  <span
                    className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-muted/60 text-muted-foreground text-[9px] font-bold cursor-help select-none"
                    title={tr('curriculum.lockedTooltip')}
                  >
                    ?
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground">{tr('curriculum.lockedOn')} {lockedOnDate} {tr('curriculum.focusWindow')}</p>
              </div>
            </div>
            <Badge className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              v{plan.version} {tr('curriculum.protected')}
            </Badge>
          </div>

          {/* Progress bar */}
          <div className="space-y-1">
            <div className="flex justify-between text-[11px]">
              <span className="text-muted-foreground">{completedCount} {tr('curriculum.of')} {totalChapters > 0 ? totalChapters : '—'} {tr('curriculum.chaptersComplete')}</span>
              <span className="text-emerald-400 font-medium">{completedPct}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden">
              <div
                className="h-full rounded-full bg-emerald-500/70 transition-all duration-700"
                style={{ width: `${completedPct}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Countdown to unlock */}
      {!canChange && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Clock className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{tr('curriculum.changeWindowOpens')}</span>
          </div>
          {mounted ? (
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: tr('curriculum.unitDays'), value: countdown.days },
                { label: tr('curriculum.unitHours'), value: countdown.hours },
                { label: tr('curriculum.unitMin'), value: countdown.minutes },
                { label: tr('curriculum.unitSec'), value: countdown.seconds },
              ].map(({ label, value }) => (
                <div key={label} className="text-center py-2.5 px-1 rounded-lg bg-muted/20 border border-border/40">
                  <p className="text-xl font-bold font-mono tabular-nums text-foreground leading-none">{String(value).padStart(2, '0')}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">{label}</p>
                </div>
              ))}
            </div>
          ) : <div className="h-16" />}
          <p className="text-[11px] text-muted-foreground text-center">
            {tr('curriculum.unlocks')} <span className="text-foreground font-medium">{unlocksDate}</span> {tr('curriculum.noChangesUntil')}
          </p>
        </div>
      )}

      {/* Policy note */}
      <div className="rounded-lg border border-border/50 bg-muted/10 px-3.5 py-2.5 flex items-start gap-2.5">
        <Shield className="w-3.5 h-3.5 text-muted-foreground/60 mt-0.5 flex-shrink-0" />
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          {tr('curriculum.protected30')}{' '}
          <span className="text-foreground font-medium">{tr('curriculum.mentorAgreement')}</span>。{' '}
          {canChange ? <span className="text-emerald-400 font-medium">{tr('curriculum.windowOpen')}</span> : tr('curriculum.stayLockedIn')}
        </p>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        {canChange ? (
          <Button size="sm" className="text-xs w-full bg-emerald-600 hover:bg-emerald-500 text-white">
            <Sparkles className="w-3 h-3 mr-1" />
            {tr('curriculum.requestChange')}
          </Button>
        ) : (
          <>
            <Link href="/dashboard/chat" className="flex-1">
              <Button size="sm" className="w-full text-xs bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20">
                {tr('dashboard.continueLearning')}
              </Button>
            </Link>
            <Button size="sm" variant="ghost" className="text-xs text-muted-foreground/60 hover:text-muted-foreground">
              {tr('curriculum.requestRelease')}
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

// ── Main Page ──

export default function CurriculumPage() {
  const { data } = useStudentData()
  const { t: tr } = useLanguage()
  const { tracks: overviewTracks, loading: overviewLoading } = useCurriculumOverview()
  const { stats: completionStats } = useCompletionStats()
  const { curriculumPlan: plan, projectModules, coreModules, insights: studentInsights } = data

  // Stuck-state auto-recovery lives in dashboard/layout.tsx so it fires on
  // any dashboard page right after onboarding completes.
  const allModules = [...projectModules, ...coreModules]
  const totalHours = allModules.reduce((sum, m) => sum + m.estimatedHours, 0)
  const completedHours = allModules.filter(m => m.status === 'completed').reduce((sum, m) => sum + m.estimatedHours, 0)
  // Use same progress calculation as dashboard (includes projects)
  const totalProgress = completionStats?.overall.progress ?? 0
  const completedChaptersCount = completionStats?.overall.completed ?? 0
  const totalChaptersCount = completionStats?.overall.total ?? 0
  const completedProjectsCount = completionStats?.overall.completedProjects ?? 0
  const totalProjectsCount = completionStats?.overall.totalProjects ?? 0

  // Split overview tracks into two groups
  const FOUNDATION_TYPES = ['core', 'core-content', 'foundation']
  const interestTracks = overviewTracks.filter(t => !FOUNDATION_TYPES.includes(t.type))
  const foundationTracks = overviewTracks.filter(t => FOUNDATION_TYPES.includes(t.type))

  const [showInsights, setShowInsights] = useState(false)
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [resetStep, setResetStep] = useState<1 | 2>(1)
  const [resetting, setResetting] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const router = useRouter()

  // Detect a fallback curriculum so we can prompt the user to regenerate
  // with Claude. We match both the OLD phase-label titles (still in some
  // users' DBs from before the prompt rewrite) and the NEW "Building Blocks
  // of X / Working Methods in X / Applied Problems in X" fallback patterns.
  const FALLBACK_TITLE_EXACT = [
    'Key Concepts and Historical Development',
    'Foundational Theories and Methods',
    'Contemporary Applications and Open Questions',
    'Key Concepts and Foundations',
    'Core Techniques and Methods',
    'Applied Practice',
  ]
  const FALLBACK_TITLE_PATTERNS = [
    /^Building Blocks of /,
    /^Working Methods in /,
    /^Applied Problems in /,
  ]
  const hasFallbackTitles = overviewTracks.some(t =>
    t.chapters.some(ch => {
      const stripped = ch.title.replace(/^[^:]+:\s*/, '')
      if (FALLBACK_TITLE_EXACT.includes(stripped)) return true
      return FALLBACK_TITLE_PATTERNS.some(p => p.test(ch.title))
    })
  )

  // Manual-regeneration budget: each curriculum gets 2 user-initiated
  // regenerations before requiring a full Start Over. Server enforces the
  // cap; client mirrors the count for display.
  const regenerationsUsed = data.manualRegenerationCount ?? 0
  const regenerationsLimit = data.manualRegenerationLimit ?? 2
  const regenerationsLeft = Math.max(0, regenerationsLimit - regenerationsUsed)
  const canRegenerate = regenerationsLeft > 0 && !regenerating

  async function handleRegenerate() {
    setRegenerating(true)
    // 160s timeout matches the server's 150s overall budget + buffer.
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 160_000)
    try {
      const res = await fetch('/api/curriculum/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manual: true }), // route rebuilds profile from DB; manual flag counts toward the limit
        signal: controller.signal,
      })
      clearTimeout(timeoutId)
      if (res.status === 429) {
        const body = await res.json().catch(() => ({}))
        alert(body.error || `You've reached the ${regenerationsLimit}-regeneration limit. Use Start Over to reset.`)
        return
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new Error(`Generation failed (HTTP ${res.status}): ${body.slice(0, 200)}`)
      }
      const [sd, cs, co] = await Promise.all([
        import('@/lib/student-data'),
        import('@/lib/completion-stats'),
        import('@/lib/curriculum-overview'),
      ])
      sd.refreshStudentData()
      cs.refreshCompletionStats()
      co.refreshCurriculumOverview()
      setTimeout(() => router.refresh(), 800)
    } catch (err) {
      clearTimeout(timeoutId)
      console.error('Regenerate failed:', err)
      alert(`Regeneration failed: ${err instanceof Error ? err.message : 'Unknown error'}. Try again in a moment.`)
    } finally {
      setRegenerating(false)
    }
  }

  async function handleReset() {
    setResetting(true)
    setShowResetConfirm(false)
    // Set a session flag so every redirect guard (dashboard layout, onboarding
    // page, setup page, dashboard root) knows we're mid-transition and skips
    // its redirect — otherwise stale cache vs. fresh server state cause a
    // multi-redirect bounce visible to the user.
    try { sessionStorage.setItem('curriculum-resetting', '1') } catch { /* SSR safe */ }
    try {
      const res = await fetch('/api/curriculum/reset', { method: 'POST' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        alert(data.error || 'Failed to reset. Try again.')
        try { sessionStorage.removeItem('curriculum-resetting') } catch { /* SSR safe */ }
        setResetting(false)
        setResetStep(1)
        return
      }
      // Wait for the client cache to actually reflect the reset before
      // navigating. This avoids landing on /dashboard/onboarding while
      // useStudentData still says isOnboarded=true (which would trigger
      // the onboarding page's redirect-back-to-curriculum guard).
      const [sdMod, csMod, coMod] = await Promise.all([
        import('@/lib/student-data'),
        import('@/lib/completion-stats'),
        import('@/lib/curriculum-overview'),
      ])
      await Promise.all([
        sdMod.refreshStudentData(),
        csMod.refreshCompletionStats(),
        coMod.refreshCurriculumOverview(),
      ]).catch(() => {})
      // Navigate. The transition screen (rendered while resetting=true)
      // covers the curriculum page until we land on onboarding.
      router.replace('/dashboard/onboarding')
      router.refresh()
      // Clear the flag after navigation has had a beat to take effect.
      setTimeout(() => {
        try { sessionStorage.removeItem('curriculum-resetting') } catch { /* SSR safe */ }
      }, 1000)
    } catch {
      try { sessionStorage.removeItem('curriculum-resetting') } catch { /* SSR safe */ }
      setResetting(false)
      setResetStep(1)
    }
  }

  // While reset is in flight, the entire page becomes a transition screen.
  // This prevents flicker of stale curriculum data, the "English Journey"
  // default-fallback render, AND the URL-bouncing redirect war.
  if (resetting) {
    return <TransitionScreen variant="reset" />
  }

  // If the user isn't onboarded (e.g. just-reset state, or a fresh visitor
  // who hit this route directly), render nothing while the layout's redirect
  // takes them to /dashboard/onboarding. Stops the "English Journey" default
  // template from briefly flashing.
  if (!data.isOnboarded) {
    return <TransitionScreen variant="default" />
  }

  // Empty state — onboarded but no real DB curriculum (recovery already attempted
  // and failed, or user reset+returned). The `data.curriculumPlan` may still be the
  // default fallback template here, so trust `hasCurriculum` and `overviewTracks`.
  if (!overviewLoading && overviewTracks.length === 0 && !data.hasCurriculum) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="flex flex-col items-center justify-center py-20 space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Sparkles className="w-8 h-8 text-primary" />
          </div>
          <h2 className="text-lg font-semibold text-foreground">{tr("curriculum.noCurriculum")}</h2>
          <p className="text-sm text-muted-foreground text-center max-w-md">
            {tr('curriculum.noCurriculumBody')}
          </p>
          <Link href="/dashboard/chat">
            <Button size="sm" className="text-xs">
              <MessageSquare className="w-3.5 h-3.5 mr-1.5" />
              Talk to Bob
            </Button>
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-primary mb-1">
            <Sparkles className="w-4 h-4" />
            <span className="text-xs font-medium uppercase tracking-wider">{tr("curriculum.personalizedPath")}</span>
          </div>
          <h1 className="text-2xl font-bold text-foreground">
            {plan.tracks[0]?.name?.split('&')[0]?.trim() || 'My'} {tr('curriculum.journey')}
          </h1>
          {plan.profileSummary && (
            <p className="text-sm text-muted-foreground mt-1 max-w-2xl">{plan.profileSummary.slice(0, 150)}…</p>
          )}
        </div>

        {/* (The Regenerate-with-AI control is now a permanent panel above
            the tracks list — see below. No header duplicate needed.) */}

        {/* Reset button */}
        {!showResetConfirm ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setShowResetConfirm(true); setResetStep(1) }}
            className="text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 flex-shrink-0"
          >
            <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
            {tr('curriculum.startOver')}
          </Button>
        ) : (
          <AnimatePresence>
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="flex-shrink-0 border border-destructive/30 bg-destructive/5 rounded-lg p-4 space-y-3 max-w-sm"
            >
              {resetStep === 1 ? (
                <>
                  <p className="text-xs text-foreground font-semibold">{tr('curriculum.resetQ')}</p>
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    {tr('curriculum.resetBody')}
                  </p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="text-xs flex-1 h-7" onClick={() => setShowResetConfirm(false)}>
                      {tr('curriculum.cancel')}
                    </Button>
                    <Button size="sm" className="text-xs flex-1 h-7 bg-destructive hover:bg-destructive/90 text-destructive-foreground" onClick={() => setResetStep(2)}>
                      {tr('curriculum.continue2')}
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-xs text-foreground font-semibold text-destructive">{tr('curriculum.absolutelySure')}</p>
                  <div className="text-[10px] text-muted-foreground leading-relaxed space-y-1">
                    <p className="font-medium text-foreground/80">{tr('curriculum.followingDeleted')}</p>
                    <ul className="list-disc list-inside space-y-0.5 ml-1">
                      <li>{tr('curriculum.del1')}</li>
                      <li>{tr('curriculum.del2')}</li>
                      <li>{tr('curriculum.del3')}</li>
                      <li>{tr('curriculum.del4')}</li>
                      <li>{tr('curriculum.del5')}</li>
                      <li>{tr('curriculum.del6')}</li>
                    </ul>
                    <p className="pt-1 text-destructive/80 font-medium">{tr('curriculum.cannotUndo')}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="text-xs flex-1 h-7" onClick={() => { setShowResetConfirm(false); setResetStep(1) }} disabled={resetting}>
                      {tr('curriculum.cancel')}
                    </Button>
                    <Button size="sm" className="text-xs flex-1 h-7 bg-destructive hover:bg-destructive/90 text-destructive-foreground" onClick={handleReset} disabled={resetting}>
                      {resetting ? <Loader2 className="w-3 h-3 animate-spin" /> : tr('curriculum.yesDeleteAll')}
                    </Button>
                  </div>
                </>
              )}
            </motion.div>
          </AnimatePresence>
        )}
      </div>

      {/* Curriculum Status */}
      <CurriculumStatusCard plan={plan} allModules={allModules} />

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-3">
        <Card className="bg-card border-border">
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold text-foreground">{totalProgress}%</p>
            <p className="text-xs text-muted-foreground">{tr("curriculum.overall")}</p>
            <p className="text-[10px] text-muted-foreground/60 mt-0.5">
              {completedChaptersCount}/{totalChaptersCount} ch
              {totalProjectsCount > 0 && ` · ${completedProjectsCount}/${totalProjectsCount} proj`}
            </p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold text-foreground">{completedHours}<span className="text-sm text-muted-foreground">/{totalHours}h</span></p>
            <p className="text-xs text-muted-foreground">{tr("curriculum.hours")}</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold text-primary">{interestTracks.length}</p>
            <p className="text-xs text-muted-foreground">{tr("curriculum.interestCourses")}</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold text-emerald-400">{foundationTracks.length}</p>
            <p className="text-xs text-muted-foreground">{tr("curriculum.foundationCourses")}</p>
          </CardContent>
        </Card>
      </div>

      {/* ── Regenerate-with-AI panel — always visible, capped at 2 uses ── */}
      <div className={`border rounded-xl p-4 flex items-start gap-3 ${hasFallbackTitles ? 'border-amber-500/40 bg-amber-500/10' : 'border-primary/30 bg-primary/[0.04]'}`}>
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${hasFallbackTitles ? 'bg-amber-500/20' : 'bg-primary/15'}`}>
          <Sparkles className={`w-4.5 h-4.5 ${hasFallbackTitles ? 'text-amber-400' : 'text-primary'}`} />
        </div>
        <div className="flex-1 min-w-0 space-y-1">
          <p className="text-sm font-semibold text-foreground">
            {hasFallbackTitles ? tr('curriculum.regenGeneric') : tr('curriculum.regenFresh')}
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {hasFallbackTitles ? tr('curriculum.regenGenericBody') : tr('curriculum.regenFreshBody')}
          </p>
          <p className={`text-[11px] mt-1.5 ${regenerationsLeft === 0 ? 'text-destructive' : 'text-muted-foreground/80'}`}>
            {regenerationsLeft === 0
              ? `${tr('curriculum.regenLimitReached')} (${regenerationsUsed}/${regenerationsLimit})。${tr('curriculum.useStartOver')}`
              : `${tr('curriculum.regenRemainingPrefix')}${regenerationsLeft}/${regenerationsLimit} ${tr('curriculum.regenRemaining')}`}
          </p>
          {regenerating && (
            <p className="text-[11px] text-primary mt-1">{tr('curriculum.regenInProgress')}</p>
          )}
        </div>
        <Button
          size="sm"
          onClick={handleRegenerate}
          disabled={!canRegenerate}
          className={`flex-shrink-0 font-medium ${
            regenerationsLeft === 0
              ? 'bg-muted text-muted-foreground cursor-not-allowed'
              : hasFallbackTitles
                ? 'bg-amber-500 hover:bg-amber-500/90 text-black'
                : 'bg-primary hover:bg-primary/90 text-primary-foreground'
          }`}
        >
          {regenerating ? (
            <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Generating…</>
          ) : (
            <><Sparkles className="w-3.5 h-3.5 mr-1.5" /> {tr("curriculum.regenerate")}</>
          )}
        </Button>
      </div>

      {/* ── Interest-Based Section ── */}
      {interestTracks.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            {tr('curriculum.interestBased')}
          </h2>
          <div className="border border-border/50 rounded-xl bg-primary/[0.02] divide-y divide-border/50">
            {interestTracks.map(track => (
              <InterestTrackRow key={track.id} track={track} />
            ))}
          </div>
        </div>
      )}

      {/* ── Foundation Section ── */}
      {foundationTracks.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-emerald-400" />
            {tr('curriculum.foundation')}
          </h2>
          <div className="space-y-3">
            {foundationTracks.map(track => (
              <FoundationSubjectCard key={track.id} track={track} />
            ))}
          </div>
        </div>
      )}

      {/* Fallback: overview still loading or no typed tracks */}
      {overviewLoading && overviewTracks.length === 0 && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">{tr('curriculum.loadingCurriculum')}</span>
        </div>
      )}

      {/* What Bob Knows About You */}
      <Card className="bg-card border-border">
        <CardContent className="p-4">
          <button
            onClick={() => setShowInsights(!showInsights)}
            className="flex items-center gap-2 w-full text-left"
          >
            <Brain className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium text-foreground flex-1">{tr('curriculum.whatBobKnows')}</span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{studentInsights.length} {tr('curriculum.insights')}</span>
              <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${showInsights ? 'rotate-180' : ''}`} />
            </div>
          </button>

          <AnimatePresence>
            {showInsights && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="mt-3 pt-3 border-t border-border/50 space-y-3">
                  <div className="flex flex-wrap gap-1.5">
                    {plan.personalityTraits.map(t => (
                      <Badge key={t} variant="outline" className="text-xs">{t}</Badge>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <p className="text-muted-foreground font-medium mb-1">{tr('curriculum.strengths')}</p>
                      {plan.primaryStrengths.map(s => (
                        <p key={s} className="text-foreground flex items-center gap-1.5 py-0.5">
                          <TrendingUp className="w-3 h-3 text-emerald-400" />{s}
                        </p>
                      ))}
                    </div>
                    <div>
                      <p className="text-muted-foreground font-medium mb-1">{tr('curriculum.interests')}</p>
                      {plan.primaryInterests.map(s => (
                        <p key={s} className="text-foreground flex items-center gap-1.5 py-0.5">
                          <Sparkles className="w-3 h-3 text-primary" />{s}
                        </p>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground font-medium mb-1.5">{tr('curriculum.recentInsights')}</p>
                    <div className="space-y-1">
                      {studentInsights.slice(-5).map(ins => (
                        <InsightCard key={ins.id} insight={ins} />
                      ))}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </CardContent>
      </Card>

      {/* Talk to Bob CTA */}
      <div className="flex items-center justify-center pt-4">
        <Link href="/dashboard/chat">
          <Button variant="outline" size="sm" className="text-xs">
            <MessageSquare className="w-3.5 h-3.5 mr-1.5" />
            {tr('curriculum.talkAboutAdjusting')}
          </Button>
        </Link>
      </div>
    </div>
  )
}
