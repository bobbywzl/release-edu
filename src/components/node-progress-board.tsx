'use client'
/**
 * NodeProgressBoard — the workspace's MASTERY BOARD: the per-node progress
 * display that fronts each node's work (the chat stays docked beside it —
 * checkpoints are still proven there). Inspired by the "Mastery Console"
 * design handoff, rebuilt in the app's own theme.
 *
 * One card per SYLLABUS OBJECTIVE (the node's verification-contract facets),
 * plus every progress/achievement signal the node's stored work can honestly
 * support: first-attempt vs after-feedback deltas, the judged-answer record
 * through time, comeback ("fixed") moments, misconceptions cleared, Bob's
 * narrated key moments (the background board digest), the diagrams Bob
 * sketched in chat, real-world build milestones, and the workbench
 * (explainer / notes / annotations / file evidence).
 *
 * Everything renders from SANITIZED data already shipped to the client
 * (quizState allowlist, boardDigest, progressLog, messages) — no answer-key
 * material, no new fetches. All strings i18n'd (EN + 中文); every section
 * tolerates empty/missing/malformed data (new-user rule).
 */
import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  ShieldCheck, Sparkles, Flame, Wrench, Zap, Hammer, BookOpen, FileText,
  StickyNote, Paperclip, Download, Maximize2, Loader2, Sprout, Target,
  ImageIcon, Compass, HelpCircle, Trophy,
} from 'lucide-react'
import { GeneratedVisual } from '@/components/generated-visual'
import { MarkdownRenderer } from '@/components/markdown-renderer'
import { MessageErrorBoundary } from '@/components/message-error-boundary'
import { useLanguage } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import {
  parseQuizState, masteryTarget, masteryFilled, MASTERY_MIN_SHORT,
  type QuizHistoryEntry, type SyllabusFacet,
} from '@/lib/mastery'
import { parseBoardDigest, type BoardMoment } from '@/lib/board-digest'
import type { Highlight } from '@/lib/highlights'

export interface BoardNode {
  id: string
  title: string
  summary: string
  status: string
  explainer: string | null
  notes: string | null
  quizState: string | null
  progressLog: string | null
  origin?: string | null
  boardDigest?: string | null
}

interface NodeProgressBoardProps {
  node: BoardNode
  messages: Array<{ id: string; role: string; content: string }>
  files: Array<{ id: string; name: string }>
  imageContext: string
  // Objectives actions (owned by the page — they touch chat / the tree)
  canJumpToFacet: (name: string) => boolean
  onJumpToFacet: (name: string) => void
  onGrowFacet: (name: string) => void
  facetGrowBusy: string | null
  // Workbench — explainer
  explainerLoading: boolean
  pdfBusy: boolean
  onEnsureExplainer: () => void
  onOpenExplainer: () => void
  onDownloadPdf: () => void
  explainerPreviewRef: React.RefObject<HTMLDivElement>
  // Workbench — notes (state lives in the page: autosave + node-switch flush)
  notesValue: string
  notesDirty: boolean
  notesSaving: boolean
  notesSaved: boolean
  notesError: boolean
  notesSavedAt: string | null
  onNotesChange: (v: string) => void
  onSaveNotes: () => void
  // Workbench — annotations
  highlights: Highlight[]
  onDeleteHighlight: (id: string) => void
  // Workbench — files
  onPickEvidence: () => void
  /** "Attach the capture later": opens the evidence picker for a facet
   *  whose artifact checkpoint was satisfied by reasoning (evidencePending);
   *  the workspace clears the flag once the upload lands. */
  onAttachFacetEvidence?: (facet: string) => void
}

const pct = (n: number, d: number): number | null => (d > 0 ? Math.round((n / d) * 100) : null)

/** Section label — the board's single uppercase-eyebrow voice. */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
      {children}
    </p>
  )
}

/** Thin progress bar with the accent glow on the filled variant. */
function Bar({ value, accent }: { value: number; accent?: boolean }) {
  return (
    <div className="h-1.5 rounded-full bg-border/70 overflow-hidden">
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        transition={{ duration: 0.7, ease: 'easeOut' }}
        className={cn(
          'h-full rounded-full',
          accent
            ? 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.45)]'
            : 'bg-muted-foreground/50',
        )}
      />
    </div>
  )
}

export function NodeProgressBoard(props: NodeProgressBoardProps) {
  const { node, messages, files } = props
  const { t, language } = useLanguage()
  const [workTab, setWorkTab] = useState<'notes' | 'annotations' | 'files'>('notes')

  const qs = useMemo(() => parseQuizState(node.quizState), [node.quizState])
  const digest = useMemo(() => parseBoardDigest(node.boardDigest), [node.boardDigest])
  const history: QuizHistoryEntry[] = qs.history ?? []
  const facets: SyllabusFacet[] = qs.facets ?? []
  const isVerified = node.status === 'understood'
  const locale = language === 'zh' ? 'zh-CN' : undefined
  const fmtDay = (iso: string) => {
    try { return new Date(iso).toLocaleDateString(locale) } catch { return '' }
  }

  // ── The build log (real-world execution progress) — newest first ──
  const buildLog = useMemo(() => {
    try {
      const parsed = JSON.parse(node.progressLog ?? '[]') as Array<{ text?: string; createdAt?: string }>
      return Array.isArray(parsed)
        ? parsed.filter(e => e && typeof e.text === 'string')
          .map(e => ({ text: e.text as string, createdAt: e.createdAt }))
          .reverse()
        : []
    } catch { return [] }
  }, [node.progressLog])

  // ── Diagrams Bob sketched in this node's chat (```image blocks) ──
  // Prompt-hash cached server-side: re-rendering here regenerates nothing.
  const sketches = useMemo(() => {
    const prompts: string[] = []
    const seen = new Set<string>()
    for (const m of messages) {
      if (m.role !== 'assistant') continue
      const re = /```image\s*\n([\s\S]*?)```/g
      let match: RegExpExecArray | null
      while ((match = re.exec(m.content)) !== null) {
        const p = match[1].trim()
        if (p && !seen.has(p)) { seen.add(p); prompts.push(p) }
      }
    }
    return prompts.slice(-4)
  }, [messages])

  // ── Performance derivations (all tolerate an empty record) ──
  const perf = useMemo(() => {
    const norm = (s: string) => s.trim().toLowerCase()
    const byFacet = new Map<string, QuizHistoryEntry[]>()
    for (const h of history) {
      if (!h.facet) continue
      const k = norm(h.facet)
      byFacet.set(k, [...(byFacet.get(k) ?? []), h])
    }
    // First-attempt rate: the FIRST judged answer on each probed syllabus
    // point (delayed, unhinted, first-attempt correctness is the honest
    // signal — research anchor in CLAUDE.md). Without a facet contract the
    // whole record is the denominator.
    let firstTry: number | null = null
    if (facets.length > 0) {
      const firsts = facets
        .map(f => (byFacet.get(norm(f.name)) ?? [])[0])
        .filter((h): h is QuizHistoryEntry => !!h)
      firstTry = pct(firsts.filter(h => h.ok).length, firsts.length)
    } else if (history.length > 0) {
      firstTry = pct(history.filter(h => h.ok).length, history.length)
    }
    // After feedback & retries: of the syllabus points that were probed at
    // all, how many the learner EVENTUALLY proved.
    let after: number | null = null
    if (facets.length > 0) {
      const probed = facets.filter(f => f.done || f.struggled || (byFacet.get(norm(f.name)) ?? []).length > 0)
      after = pct(probed.filter(f => f.done).length, probed.length)
    } else if (qs.attempts > 0) {
      after = pct(qs.correct, qs.attempts)
    }
    let bestStreak = qs.combo
    let run = 0
    for (const h of history) {
      run = h.ok ? run + 1 : 0
      if (run > bestStreak) bestStreak = run
    }
    const comebacks = Math.max(
      facets.filter(f => f.done && f.struggled).length,
      history.filter(h => h.fix).length,
    )
    const calibration = pct(qs.sureRight, qs.sureRight + qs.sureWrong)
    return { firstTry, after, bestStreak, comebacks, calibration, byFacet }
  }, [history, facets, qs])

  const target = masteryTarget(qs)
  const filled = Math.min(masteryFilled(qs), target)
  const ownWordsDone = qs.shortCorrect >= MASTERY_MIN_SHORT
  const hasActivity = qs.attempts > 0 || messages.length > 1 || buildLog.length > 0 || facets.length > 0

  // ── Misconceptions: Bob's digest when present, else synthesized honestly
  //    from the coverage map (a struggled facet IS a surfaced wrong belief).
  const misconceptions = useMemo(() => {
    if (digest && digest.misconceptions.length > 0) return digest.misconceptions
    return facets
      .filter(f => f.struggled)
      .map(f => ({ label: f.name, cleared: f.done, note: undefined as string | undefined }))
  }, [digest, facets])
  const misconCleared = misconceptions.filter(m => m.cleared).length

  // ── Achievements — every honest progress signal, earned bright, next
  //    goals dimmed (visible ladder > invisible ladder).
  const achievements = useMemo(() => {
    const list: Array<{ key: string; label: string; icon: React.ReactNode; earned: boolean }> = [
      { key: 'firstProof', label: t('board.achFirstProof'), icon: <Target className="w-3 h-3" />, earned: filled > 0 },
      { key: 'ownWords', label: t('board.achOwnWords'), icon: <Sparkles className="w-3 h-3" />, earned: ownWordsDone },
      { key: 'comeback', label: t('board.achComeback'), icon: <Wrench className="w-3 h-3" />, earned: perf.comebacks > 0 },
      { key: 'streak3', label: t('board.achStreak3'), icon: <Flame className="w-3 h-3" />, earned: perf.bestStreak >= 3 },
      { key: 'streak5', label: t('board.achStreak5'), icon: <Flame className="w-3 h-3" />, earned: perf.bestStreak >= 5 },
      { key: 'calibrated', label: t('board.achCalibrated'), icon: <Compass className="w-3 h-3" />, earned: qs.sureRight >= 3 && qs.sureRight > qs.sureWrong },
      { key: 'sketches', label: t('board.achSketches'), icon: <ImageIcon className="w-3 h-3" />, earned: sketches.length > 0 },
      { key: 'evidence', label: t('board.achEvidence'), icon: <Paperclip className="w-3 h-3" />, earned: files.length > 0 },
      { key: 'builder', label: t('board.achBuilder'), icon: <Hammer className="w-3 h-3" />, earned: buildLog.length > 0 },
      { key: 'verified', label: t('board.achVerified'), icon: <ShieldCheck className="w-3 h-3" />, earned: isVerified },
      { key: 'reviewed', label: t('board.achReviewed'), icon: <Trophy className="w-3 h-3" />, earned: !!qs.reviewedAt },
    ]
    if (node.origin === 'question') {
      list.unshift({ key: 'asked', label: t('board.achAsked'), icon: <Sprout className="w-3 h-3" />, earned: true })
    }
    return list
  }, [t, filled, ownWordsDone, perf, qs, sketches.length, files.length, buildLog.length, isVerified, node.origin])
  const earnedCount = achievements.filter(a => a.earned).length

  const momentIcon = (kind: BoardMoment['kind']) =>
    kind === 'fixed' ? <Wrench className="w-3.5 h-3.5 text-amber-300" />
      : kind === 'breakthrough' ? <Zap className="w-3.5 h-3.5 text-violet-300" />
        : kind === 'build' ? <Hammer className="w-3.5 h-3.5 text-sky-300" />
          : <BookOpen className="w-3.5 h-3.5 text-emerald-300" />
  const momentLabel = (kind: BoardMoment['kind']) =>
    kind === 'fixed' ? t('board.momentFixed')
      : kind === 'breakthrough' ? t('board.momentBreakthrough')
        : kind === 'build' ? t('board.momentBuild')
          : t('board.momentLearning')

  const originLine = node.origin === 'question' ? t('board.originQuestion')
    : node.origin === 'manual' ? t('board.originManual')
      : node.origin === 'copilot' ? t('board.originCopilot')
        : null

  const unprovenLeft = facets.filter(f => !f.done).length

  return (
    <div className="max-w-4xl mx-auto w-full px-4 py-5 lg:px-6 space-y-6">

      {/* ── Board header ── */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <SectionLabel>{t('board.title')}</SectionLabel>
          {originLine && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-emerald-400/30 bg-emerald-500/10 text-emerald-300 text-[10px]">
              <Sprout className="w-2.5 h-2.5" /> {originLine}
            </span>
          )}
        </div>
        {filled === 0 && !isVerified ? (
          /* Zero coverage = zero claimable capability (mastery is verified,
             never self-declared). Until a checkpoint is proven, the headline
             is the node's GOAL — guards stale digests written before the
             state-dependent headline rule too. */
          <p className="text-[15px] leading-relaxed text-foreground font-medium">🎯 {t('board.goalLead')}{node.summary}</p>
        ) : digest?.headline ? (
          <p className="text-[15px] leading-relaxed text-foreground font-medium">✨ {digest.headline}</p>
        ) : (
          <p className="text-[13px] text-muted-foreground">{t('board.subtitle')}</p>
        )}
      </div>

      {/* ── Verified banner / empty state ── */}
      {isVerified && (
        <motion.div
          initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-emerald-400/50 bg-emerald-500/10 px-4 py-3 space-y-2"
        >
          <div className="flex items-center gap-3">
            <ShieldCheck className="w-6 h-6 text-emerald-400 flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-bold text-emerald-300">{t('tree.verified')}</p>
              <p className="text-[11px] text-emerald-200/80">
                {t('workspace.verifiedBanner')}
                {qs.reviewedAt ? ` · ${t('board.reviewedAt').replace('{d}', fmtDay(qs.reviewedAt))}` : ''}
              </p>
            </div>
          </div>
          {/* The learner's own judged-correct explanation stands here
              permanently — their words, their trophy (satisfaction audit #4). */}
          {(qs.provenAnswers?.length ?? 0) > 0 && (
            <div className="border-t border-emerald-400/20 pt-2">
              <p className="text-[10px] font-bold text-emerald-300/90 uppercase tracking-wider">{t('workspace.inYourWords')}</p>
              <p className="text-[11px] text-foreground/85 leading-snug italic mt-0.5">
                “{qs.provenAnswers![qs.provenAnswers!.length - 1].answer.slice(0, 220)}{qs.provenAnswers![qs.provenAnswers!.length - 1].answer.length > 220 ? '…' : ''}”
              </p>
            </div>
          )}
        </motion.div>
      )}

      {!hasActivity && (
        <div className="rounded-2xl border border-border bg-card/60 px-5 py-8 text-center space-y-2">
          <Sparkles className="w-7 h-7 text-primary mx-auto" />
          <p className="text-sm font-bold text-foreground">{t('board.emptyTitle')}</p>
          <p className="text-[13px] text-muted-foreground max-w-md mx-auto leading-relaxed">{t('board.emptyBody')}</p>
          {/* Journey strip — the milestones ahead, first one already done */}
          <div className="flex items-center justify-center gap-1 text-[10px] flex-wrap pt-1">
            <span className="text-emerald-300">✓ {t('workspace.jOpened')}</span>
            <span className="text-muted-foreground/50">→</span>
            <span className="text-muted-foreground/60">{t('workspace.jSyllabus')}</span>
            <span className="text-muted-foreground/50">→</span>
            <span className="text-muted-foreground/60">{t('workspace.jProving')}</span>
            <span className="text-muted-foreground/50">→</span>
            <span className="text-muted-foreground/60">{t('tree.verified')}</span>
          </div>
        </div>
      )}

      {/* ── Progress on this node (the console's key-numbers card) ── */}
      {hasActivity && (
        <div className="rounded-2xl border border-border bg-card/60 p-4 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <SectionLabel>{t('board.progressTitle')}</SectionLabel>
            {filled > 0 && (
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {t('workspace.coverageCount').replace('{a}', String(filled)).replace('{b}', String(target))}
              </span>
            )}
          </div>

          {/* Coverage + the first-try → after-feedback delta (the signature) */}
          <div className="space-y-2.5">
            <div>
              <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1">
                <span>{t('workspace.coverageTitle')}</span>
                <span className="tabular-nums">{pct(filled, target) ?? 0}%</span>
              </div>
              <Bar value={pct(filled, target) ?? 0} accent />
            </div>
            {perf.firstTry !== null && (
              <div>
                <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1">
                  <span>{t('board.firstTry')}</span>
                  <span className="tabular-nums">{perf.firstTry}%</span>
                </div>
                <Bar value={perf.firstTry} />
              </div>
            )}
            {perf.after !== null && (
              <div>
                <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1">
                  <span>{t('board.afterFeedback')}</span>
                  <span className="tabular-nums text-emerald-300">
                    {perf.after}%
                    {perf.firstTry !== null && perf.after > perf.firstTry && (
                      <span className="ml-1.5">{t('board.pts').replace('{n}', String(perf.after - perf.firstTry))}</span>
                    )}
                  </span>
                </div>
                <Bar value={perf.after} accent />
              </div>
            )}
          </div>

          {/* Stat tiles — big numbers, small labels */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="rounded-xl border border-border/70 bg-background/50 px-3 py-2">
              <p className="text-lg font-black tabular-nums text-foreground">{qs.correct}<span className="text-muted-foreground text-xs font-medium">/{qs.attempts}</span></p>
              <p className="text-[10px] text-muted-foreground">{t('board.attempts')}</p>
            </div>
            <div className="rounded-xl border border-border/70 bg-background/50 px-3 py-2">
              <p className="text-lg font-black tabular-nums text-foreground">{perf.bestStreak > 0 ? `×${perf.bestStreak}` : '—'}</p>
              <p className="text-[10px] text-muted-foreground">🔥 {t('board.bestStreak')}</p>
            </div>
            <div className="rounded-xl border border-border/70 bg-background/50 px-3 py-2">
              <p className="text-lg font-black tabular-nums text-foreground">{perf.comebacks > 0 ? perf.comebacks : '—'}</p>
              <p className="text-[10px] text-muted-foreground">🔧 {t('board.comebacks')}</p>
            </div>
            <div className="rounded-xl border border-border/70 bg-background/50 px-3 py-2" title={t('board.calibrationHint')}>
              <p className="text-lg font-black tabular-nums text-foreground">{perf.calibration !== null ? `${perf.calibration}%` : '—'}</p>
              <p className="text-[10px] text-muted-foreground">🧭 {t('board.calibration')}</p>
            </div>
          </div>

          {/* Achievements — earned bright, next goals dimmed */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <SectionLabel>{t('board.achievements')}</SectionLabel>
              <span className="text-[10px] tabular-nums text-muted-foreground">{earnedCount}/{achievements.length}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {achievements.map(a => (
                <motion.span
                  key={a.key}
                  layout
                  initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-2 py-1 rounded-full border text-[10px] font-semibold',
                    a.earned
                      ? 'border-emerald-400/50 bg-emerald-500/15 text-emerald-300'
                      : 'border-dashed border-border text-muted-foreground/60',
                  )}
                >
                  {a.icon} {a.label}
                </motion.span>
              ))}
            </div>
          </div>

          {/* Bob's next-focus pointer */}
          {!isVerified && digest?.nextFocus && (
            <div className="rounded-xl border border-primary/40 bg-primary/[0.07] px-3 py-2 flex items-start gap-2">
              <Target className="w-3.5 h-3.5 text-primary flex-shrink-0 mt-0.5" />
              <p className="text-[12px] text-foreground leading-snug">
                <span className="font-bold text-primary">{t('board.nextFocus')}: </span>{digest.nextFocus}
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── Syllabus objectives — one card per promised point ── */}
      {/* Contract not landed yet: say so explicitly. The board must never
          imply a smaller contract than the lesson will actually hold the
          learner to (the facet map IS the promise). */}
      {facets.length === 0 && !isVerified && (
        <div className="space-y-2">
          <SectionLabel>{t('board.objectives')}</SectionLabel>
          <p className="text-[13px] text-muted-foreground rounded-xl border border-dashed border-border px-4 py-3">
            {t('board.contractPending')}
          </p>
        </div>
      )}
      {facets.length > 0 && (
        <div className="space-y-2">
          <SectionLabel>{t('board.objectives')}</SectionLabel>
          <div className="space-y-2">
            {facets.map((f, i) => {
              const key = f.name.trim().toLowerCase()
              const attempts = perf.byFacet.get(key) ?? []
              const state = f.done
                ? (f.struggled ? 'fixed' : 'proven')
                : (f.struggled ? 'open' : attempts.length > 0 ? 'progress' : 'next')
              const stateLabel = state === 'proven' ? t('board.objProven')
                : state === 'fixed' ? t('board.objFixed')
                  : state === 'open' ? t('board.objOpen')
                    : state === 'progress' ? t('board.objInProgress')
                      : t('board.objUpNext')
              const facetMoments = (digest?.moments ?? []).filter(m => m.facet && m.facet.trim().toLowerCase() === key)
              return (
                <motion.div
                  key={`${f.name}-${i}`}
                  initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
                  className={cn(
                    'rounded-2xl border p-3.5',
                    f.done ? 'border-emerald-400/40 bg-emerald-500/[0.06]'
                      : f.struggled ? 'border-amber-400/40 bg-amber-500/[0.05]'
                        : 'border-border bg-card/60',
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div className={cn(
                      'w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-black flex-shrink-0 border',
                      f.done ? 'border-emerald-400/60 bg-emerald-500/15 text-emerald-300'
                        : f.struggled ? 'border-amber-400/50 bg-amber-500/10 text-amber-300'
                          : 'border-border bg-background/60 text-muted-foreground',
                    )}>
                      {f.done ? '✓' : String(i + 1).padStart(2, '0')}
                    </div>
                    <div className="flex-1 min-w-0 space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className={cn('text-[13px] font-semibold leading-snug', f.done ? 'text-foreground/90' : 'text-foreground')}>{f.name}</p>
                        <span className={cn(
                          'px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wide border flex-shrink-0',
                          state === 'proven' && 'border-emerald-400/50 bg-emerald-500/10 text-emerald-300',
                          state === 'fixed' && 'border-emerald-400/50 bg-emerald-500/10 text-emerald-300',
                          state === 'open' && 'border-amber-400/50 bg-amber-500/10 text-amber-300',
                          state === 'progress' && 'border-primary/50 bg-primary/10 text-primary',
                          state === 'next' && 'border-border text-muted-foreground',
                        )}>
                          {stateLabel}
                        </span>
                      </div>
                      {/* Judged-attempt dots on this point, oldest → newest */}
                      {attempts.length > 0 ? (
                        <div className="flex items-center gap-1 flex-wrap" title={t('board.attemptsOn').replace('{n}', String(attempts.length))}>
                          {attempts.map((h, hi) => (
                            <span
                              key={hi}
                              title={`${h.ok ? '✔' : '✘'} ${fmtDay(h.t)}${h.fix ? ` · ${t('board.legendFix')}` : ''}`}
                              className={cn(
                                'w-2.5 h-2.5 rounded-full flex-shrink-0',
                                h.ok ? 'bg-emerald-400' : 'bg-red-400/70',
                                h.fix && 'ring-2 ring-amber-300/80',
                              )}
                            />
                          ))}
                          <span className="text-[10px] text-muted-foreground ml-1 tabular-nums">
                            {attempts.filter(h => h.ok).length}/{attempts.length}
                          </span>
                        </div>
                      ) : (
                        !f.done && <p className="text-[11px] text-muted-foreground">{t('board.noAttemptsYet')}</p>
                      )}
                      {/* EVIDENCE PENDING — this facet's artifact checkpoint
                          was satisfied by reasoning instead; the permanent
                          record says so, and the deferred capture is a
                          first-class task, not a negotiation. */}
                      {f.done && f.evidencePending && (
                        <div className="flex items-center gap-2 flex-wrap rounded-lg border border-sky-400/40 bg-sky-500/[0.08] px-2.5 py-1.5">
                          <span className="text-[10px] font-bold text-sky-300 uppercase tracking-wide">📎 {t('board.evidencePending')}</span>
                          {props.onAttachFacetEvidence && (
                            <button
                              onClick={() => props.onAttachFacetEvidence!(f.name)}
                              className="ml-auto inline-flex items-center gap-1 rounded-md border border-sky-400/50 text-sky-200 text-[10px] font-semibold px-2 py-0.5 hover:bg-sky-500/20 transition-colors"
                            >
                              {t('board.evidenceAttachCta')}
                            </button>
                          )}
                        </div>
                      )}
                      {/* Digest moments that belong to this objective */}
                      {facetMoments.map((m, mi) => (
                        <div key={mi} className="flex items-start gap-1.5 text-[11px] text-foreground/85 leading-snug border-l-2 border-emerald-400/50 pl-2">
                          {momentIcon(m.kind)}
                          <span className="flex-1">{m.text}</span>
                        </div>
                      ))}
                      <div className="flex items-center gap-2 pt-0.5">
                        {props.canJumpToFacet(f.name) && (
                          <button
                            onClick={() => props.onJumpToFacet(f.name)}
                            className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline transition-colors"
                            title={t('workspace.railJumpHint')}
                          >
                            <HelpCircle className="w-3 h-3" /> {t('workspace.railJumpHint')}
                          </button>
                        )}
                        {!f.done && unprovenLeft >= 2 && (
                          <button
                            onClick={() => props.onGrowFacet(f.name)}
                            disabled={props.facetGrowBusy !== null}
                            title={t('workspace.facetGrow')}
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-emerald-400/40 text-emerald-300 text-[10px] hover:bg-emerald-500/15 transition-colors disabled:opacity-40"
                          >
                            {props.facetGrowBusy === f.name ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sprout className="w-3 h-3" />}
                            {t('workspace.facetGrowBtn')}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </motion.div>
              )
            })}
            {/* Own-words requirement — the final objective, always shown */}
            <div className={cn(
              'rounded-2xl border p-3.5',
              ownWordsDone ? 'border-emerald-400/40 bg-emerald-500/[0.06]' : 'border-border bg-card/60',
            )}>
              <div className="flex items-center gap-3">
                <div className={cn(
                  'w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-black flex-shrink-0 border',
                  ownWordsDone ? 'border-emerald-400/60 bg-emerald-500/15 text-emerald-300' : 'border-border bg-background/60 text-muted-foreground',
                )}>
                  {ownWordsDone ? '✓' : '💬'}
                </div>
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-foreground">{t('board.ownWordsObj')}</p>
                  <p className="text-[11px] text-muted-foreground">{ownWordsDone ? t('board.ownWordsDone') : t('board.ownWordsOpen')}</p>
                </div>
              </div>
              {/* The proven words themselves — quoted back, permanently */}
              {(qs.provenAnswers ?? []).length > 0 && (
                <div className="mt-2 pt-2 border-t border-border/60 space-y-1.5">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{t('workspace.inYourWords')}</p>
                  {(qs.provenAnswers ?? []).slice(-3).reverse().map((a, ai) => (
                    <p key={ai} className="text-[11px] text-foreground/85 leading-snug italic border-l-2 border-emerald-400/40 pl-2">
                      “{a.answer.slice(0, 220)}{a.answer.length > 220 ? '…' : ''}”
                      {a.facet && <span className="not-italic text-[9px] text-muted-foreground ml-1.5">· {a.facet}</span>}
                    </p>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Key moments + misconceptions (two-up on wide screens) ── */}
      {hasActivity && (
        <div className="grid lg:grid-cols-2 gap-4 items-start">
          {/* Key moments — Bob's narrated timeline */}
          <div className="rounded-2xl border border-border bg-card/60 p-4 space-y-3">
            <div>
              <SectionLabel>{t('board.momentsTitle')}</SectionLabel>
              <p className="text-[10px] text-muted-foreground mt-0.5">{t('board.momentsHint')}</p>
            </div>
            {digest && digest.moments.length > 0 ? (
              <div className="space-y-2.5">
                {digest.moments.map((m, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}
                    className="flex items-start gap-2.5"
                  >
                    <div className="w-6 h-6 rounded-full border border-border bg-background/60 flex items-center justify-center flex-shrink-0 mt-0.5">
                      {momentIcon(m.kind)}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground">{momentLabel(m.kind)}{m.facet ? ` · ${m.facet}` : ''}</p>
                      <p className="text-[12px] text-foreground/90 leading-snug">{m.text}</p>
                    </div>
                  </motion.div>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                {qs.attempts > 0 || messages.length > 2 ? t('board.digestPending') : t('board.noMoments')}
              </p>
            )}
          </div>

          {/* Misconceptions ticked off */}
          <div className="rounded-2xl border border-border bg-card/60 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <SectionLabel>{t('board.misconTitle')}</SectionLabel>
              {misconceptions.length > 0 && (
                <span className="text-[10px] tabular-nums text-muted-foreground">
                  {t('board.misconProgress').replace('{a}', String(misconCleared)).replace('{b}', String(misconceptions.length))}
                </span>
              )}
            </div>
            {misconceptions.length > 0 ? (
              <div className="space-y-2">
                {misconceptions.map((m, i) => (
                  <div key={i} className="flex items-start gap-2.5">
                    <span className={cn(
                      'w-4 h-4 rounded-full flex items-center justify-center text-[10px] flex-shrink-0 mt-0.5 border',
                      m.cleared
                        ? 'border-emerald-400/70 bg-emerald-500/15 text-emerald-300'
                        : 'border-dashed border-muted-foreground/50 text-transparent',
                    )}>
                      {m.cleared ? '✓' : '·'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className={cn('text-[12px] leading-snug', m.cleared ? 'text-foreground/80' : 'text-foreground')}>
                        {m.label}
                        <span className={cn(
                          'ml-2 text-[9px] font-bold uppercase tracking-wide',
                          m.cleared ? 'text-emerald-300' : 'text-amber-300',
                        )}>
                          {m.cleared ? t('board.misconCleared') : t('board.misconOpen')}
                        </span>
                      </p>
                      {m.note && <p className="text-[10px] text-muted-foreground leading-snug mt-0.5">{m.note}</p>}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground leading-relaxed">{t('board.misconNone')}</p>
            )}
          </div>
        </div>
      )}

      {/* ── Checkpoint record through time + Bob's read ── */}
      {hasActivity && (
        <div className="rounded-2xl border border-border bg-card/60 p-4 space-y-3">
          <div>
            <SectionLabel>{t('board.performanceTitle')}</SectionLabel>
            <p className="text-[10px] text-muted-foreground mt-0.5">{t('board.performanceHint')}</p>
          </div>
          {history.length > 0 ? (
            <>
              <div className="flex items-end gap-1 flex-wrap">
                {history.map((h, i) => (
                  <motion.span
                    key={i}
                    initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} transition={{ delay: i * 0.02 }}
                    title={`${h.ok ? '✔' : '✘'} ${h.kind}${h.facet ? ` · ${h.facet}` : ''}${h.conf ? ` · ${h.conf === 'sure' ? t('workspace.confSure') : t('workspace.confUnsure')}` : ''} · ${fmtDay(h.t)}`}
                    className={cn(
                      'w-2.5 rounded-sm origin-bottom flex-shrink-0',
                      h.ok ? 'h-6 bg-emerald-400/90' : 'h-3.5 bg-red-400/70',
                      h.fix && 'ring-2 ring-amber-300/80',
                      h.review && 'outline outline-1 outline-violet-400/70',
                    )}
                  />
                ))}
              </div>
              <div className="flex items-center gap-3 text-[10px] text-muted-foreground flex-wrap">
                <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-400/90" /> {t('board.legendCorrect')}</span>
                <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-400/70" /> {t('board.legendWrong')}</span>
                <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-400/90 ring-2 ring-amber-300/80" /> {t('board.legendFix')}</span>
              </div>
            </>
          ) : (
            <p className="text-[11px] text-muted-foreground">{t('board.noPerformance')}</p>
          )}
          {digest?.quizRead && (
            <div className="border-l-2 border-primary/60 pl-3 py-0.5">
              <p className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground mb-0.5">{t('board.quizReadTitle')}</p>
              <p className="text-[12px] text-foreground/90 leading-relaxed">{digest.quizRead}</p>
            </div>
          )}
        </div>
      )}

      {/* ── Sketched with Bob — the diagrams drawn while teaching ── */}
      {sketches.length > 0 && (
        <div className="rounded-2xl border border-border bg-card/60 p-4 space-y-3">
          <div>
            <SectionLabel>{t('board.sketchesTitle')}</SectionLabel>
            <p className="text-[10px] text-muted-foreground mt-0.5">{t('board.sketchesHint')}</p>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            {sketches.map((p, i) => (
              <div key={i} className="rounded-xl border border-border/70 bg-background/50 p-2">
                <GeneratedVisual prompt={p} context={props.imageContext} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Build milestones — the real-world achievement flow ── */}
      {buildLog.length > 0 && (
        <div className="rounded-2xl border border-border bg-card/60 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <SectionLabel>{t('board.buildTitle')}</SectionLabel>
              <p className="text-[10px] text-muted-foreground mt-0.5">{t('board.buildHint')}</p>
            </div>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-sky-400/40 bg-sky-500/10 text-sky-300 text-[10px] font-bold flex-shrink-0">
              <Hammer className="w-3 h-3" /> {t('board.buildCount').replace('{n}', String(buildLog.length))}
            </span>
          </div>
          <div className="space-y-1.5">
            {buildLog.map((entry, li) => (
              <motion.div
                key={li}
                initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: li * 0.03 }}
                className="flex items-start gap-2.5 text-xs border-l-2 border-sky-400/60 rounded-r-md px-2.5 py-1.5 bg-background/60"
              >
                <span className="text-[10px] font-black tabular-nums text-sky-300 flex-shrink-0 mt-0.5">#{buildLog.length - li}</span>
                <div className="min-w-0">
                  <p className="text-foreground/90 leading-snug">{entry.text}</p>
                  {entry.createdAt && <span className="text-[10px] text-muted-foreground/60">{fmtDay(entry.createdAt)}</span>}
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {/* ── Workbench: retained knowledge + notes / annotations / files ── */}
      <div className="rounded-2xl border border-border bg-card/60 p-4 space-y-4">
        <SectionLabel>{t('board.workbench')}</SectionLabel>

        {/* Explainer (retained knowledge) */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-bold text-foreground uppercase tracking-wider flex items-center gap-1.5">
              <StickyNote className="w-3.5 h-3.5 text-primary" /> {t('workspace.retainedKnowledge')}
            </h3>
            {node.explainer && (
              <div className="flex items-center gap-1">
                <button
                  onClick={props.onDownloadPdf}
                  disabled={props.pdfBusy}
                  title={t('workspace.downloadPdf')}
                  className="w-6 h-6 rounded-md hover:bg-accent flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                >
                  {props.pdfBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                </button>
                <button
                  onClick={props.onOpenExplainer}
                  title={t('workspace.explainerExpand')}
                  className="w-6 h-6 rounded-md hover:bg-accent flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
          {node.explainer ? (
            <div
              role="button"
              tabIndex={0}
              onClick={props.onOpenExplainer}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); props.onOpenExplainer() } }}
              className="relative w-full text-left text-[13px] leading-relaxed border border-border rounded-xl p-3 bg-background/50 max-h-40 overflow-hidden cursor-pointer hover:border-primary/40 transition-colors"
              title={t('workspace.explainerOpenFull')}
            >
              <div ref={props.explainerPreviewRef} className="pointer-events-none">
                <MessageErrorBoundary fallbackText={node.explainer} degradedNote={t('workspace.renderDegraded')}>
                  <MarkdownRenderer content={node.explainer} imageContext={props.imageContext} />
                </MessageErrorBoundary>
              </div>
              <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-card to-transparent rounded-b-xl pointer-events-none" />
            </div>
          ) : (
            <button
              onClick={props.onEnsureExplainer}
              disabled={props.explainerLoading}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-primary/40 bg-primary/10 text-primary text-xs font-medium py-2.5 hover:bg-primary/20 transition-colors disabled:opacity-50"
            >
              {props.explainerLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
              {props.explainerLoading ? t('workspace.explainerLoading') : t('workspace.generateExplainer')}
            </button>
          )}
        </div>

        {/* Notes / Annotations / Files tabs (build log graduated to its own section) */}
        <div>
          <div className="flex gap-1 border-b border-border">
            {(['notes', 'annotations', 'files'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setWorkTab(tab)}
                className={cn(
                  'px-3 py-1.5 text-xs font-medium rounded-t-lg transition-colors -mb-px border-b-2',
                  workTab === tab
                    ? 'text-primary border-primary'
                    : 'text-muted-foreground border-transparent hover:text-foreground',
                )}
              >
                {tab === 'notes' ? t('workspace.tabNotes') : tab === 'annotations' ? t('workspace.annotations') : t('workspace.files')}
                {tab === 'files' && files.length > 0 ? ` (${files.length})` : ''}
                {tab === 'annotations' && props.highlights.length > 0 ? ` (${props.highlights.length})` : ''}
              </button>
            ))}
          </div>

          {workTab === 'notes' && (
            <div className="space-y-2 pt-3">
              <textarea
                value={props.notesValue}
                onChange={e => props.onNotesChange(e.target.value)}
                placeholder={t('workspace.notesPlaceholder')}
                rows={8}
                className="w-full text-xs leading-relaxed bg-background border border-border rounded-xl px-3 py-2.5 text-foreground placeholder:text-muted-foreground resize-y focus:outline-none focus:ring-1 focus:ring-primary/40"
              />
              <div className="flex items-center gap-2">
                <span className={cn('text-[11px] flex-1', props.notesError ? 'text-red-400' : 'text-muted-foreground')}>
                  {props.notesError
                    ? t('workspace.notesSaveFailed')
                    : props.notesSaving
                      ? t('workspace.notesSaving')
                      : props.notesSavedAt
                        ? `${t('workspace.notesAutosaved')} ${props.notesSavedAt}`
                        : t('workspace.notesAutosaveHint')}
                </span>
                <button
                  onClick={props.onSaveNotes}
                  disabled={!props.notesDirty || props.notesSaving}
                  className={cn(
                    'rounded-lg text-xs font-medium px-3 py-1.5 transition-colors disabled:opacity-40',
                    props.notesError
                      ? 'bg-red-500/10 border border-red-500/40 text-red-400 hover:bg-red-500/20'
                      : 'bg-primary/10 border border-primary/40 text-primary hover:bg-primary/20',
                  )}
                >
                  {props.notesSaved ? t('workspace.notesSaved') : t('workspace.notesSave')}
                </button>
              </div>
            </div>
          )}

          {workTab === 'annotations' && (
            <div className="pt-3">
              <p className="text-[11px] text-muted-foreground leading-snug mb-2">{t('workspace.annotationsHint')}</p>
              <div className="space-y-1.5">
                {props.highlights.length === 0 && <p className="text-[11px] text-muted-foreground">{t('workspace.noAnnotations')}</p>}
                {props.highlights.map(h => (
                  <div
                    key={h.id}
                    className="text-xs border-l-2 rounded-r-md px-2.5 py-1.5 bg-background/60 group/hl"
                    style={{ borderColor: { amber: '#FBBF24', blue: '#60A5FA', green: '#34D399', purple: '#A78BFA' }[h.color] ?? '#FBBF24' }}
                  >
                    <p className="text-foreground/90 italic">&ldquo;{h.selectedText.slice(0, 140)}{h.selectedText.length > 140 ? '…' : ''}&rdquo;</p>
                    {h.comment && <p className="text-foreground mt-1 font-medium">💬 {h.comment}</p>}
                    <div className="flex items-center justify-between mt-0.5">
                      <span className="text-[10px] text-muted-foreground/60">{fmtDay(h.createdAt)}</span>
                      <button
                        onClick={() => props.onDeleteHighlight(h.id)}
                        className="opacity-0 group-hover/hl:opacity-100 text-[10px] text-muted-foreground hover:text-red-400 transition-opacity"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {workTab === 'files' && (
            <div className="pt-3">
              <div className="space-y-1.5 mb-2">
                {files.length === 0 && <p className="text-[11px] text-muted-foreground">{t('workspace.noFiles')}</p>}
                {files.map(f => (
                  <div key={f.id} className="flex items-center gap-2 text-xs text-foreground border border-border rounded-lg px-2.5 py-2">
                    <FileText className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                    <span className="truncate">{f.name}</span>
                  </div>
                ))}
              </div>
              <button
                onClick={props.onPickEvidence}
                className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-accent text-xs py-2 transition-colors"
              >
                <Paperclip className="w-3.5 h-3.5" /> {t('workspace.uploadEvidence')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
