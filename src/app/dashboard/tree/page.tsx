'use client'
/**
 * Tree home — your problem trees. State a problem, grow a tree.
 * Problem-first: this page IS the front door of learning in the Tree model.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Sprout, Plus, Trash2, CheckCircle2, Loader2, RefreshCw, Sparkles, ClipboardList, Copy, X, Bot, Hammer } from 'lucide-react'
import { useLanguage } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { MarkdownRenderer } from '@/components/markdown-renderer'

interface TreeSummary {
  id: string
  title: string
  displayTitle: string | null
  framing: string | null
  status: string
  updatedAt: string
  nodeCount: number
  understoodCount: number
  hasPurpose?: boolean
  accentColor?: string | null
  // Completed trees only: true when real build evidence backs the mastery
  // (Deployed), false when it was proven through checkpoints alone (Explained).
  deployed?: boolean
}

export default function TreePage() {
  const { t, language } = useLanguage()
  const router = useRouter()
  const [trees, setTrees] = useState<TreeSummary[] | null>(null)
  const [problem, setProblem] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Session onboarding — 5 questions, never more: language → the problem →
  // the PURPOSE behind it (what "relevant" means for this session) → the
  // student's background → target depth (explainable ↔ deployable). All of
  // it calibrates every AI output before the first branch grows.
  const [step, setStep] = useState(0)
  const STEPS = 5
  // The session onboarding lives in a FULL-SCREEN conversational overlay,
  // opened by the New Session button — never an always-on inline form.
  const [showOnboard, setShowOnboard] = useState(false)
  const [sessLang, setSessLang] = useState<'en' | 'zh'>(language === 'zh' ? 'zh' : 'en')
  // The provider's language resolves async (localStorage → DB) — the initial
  // useState capture can be a stale 'en' for a 中文 account. Track whether the
  // user explicitly picked a session language; until they do, follow the app
  // language so the stepper default always matches Settings.
  const sessLangTouched = useRef(false)
  useEffect(() => {
    if (!sessLangTouched.current) setSessLang(language === 'zh' ? 'zh' : 'en')
  }, [language])
  const [purpose, setPurpose] = useState('')
  const [background, setBackground] = useState('')
  const [difficulty, setDifficulty] = useState<string>('intermediate')
  // SMART DEFAULTS: the previous session's settings pre-fill the stepper
  // (scan-and-adjust beats fill-from-scratch); a small hint marks them.
  const [bgPrefilled, setBgPrefilled] = useState(false)
  const defaultsLoaded = useRef(false)
  // Purpose chips: canned localized candidates render instantly; a background
  // Haiku call (fired when the problem is submitted) swaps in problem-specific
  // ones if they arrive before the student types their own.
  const [purposeIdeas, setPurposeIdeas] = useState<string[] | null>(null)
  // Reciprocity theater, honestly framed: each answered question gets Bob's
  // "under construction" confirmation (the real build runs at the end).
  const [confirms, setConfirms] = useState<string[]>([])
  // End-of-onboarding construction indicator (the Release-EDU-style build
  // screen): staged progress while the seed request runs.
  const [buildStage, setBuildStage] = useState(0)
  // RECIPROCITY gift: Bob's 2-3 sentence read on the problem, fetched the
  // moment it's typed — value delivered before setup even finishes.
  const [firstRead, setFirstRead] = useState<string | null>(null)
  // ENDOWMENT: the "make it yours" moment after construction — editable
  // title (Haiku headline as the smart default) + accent swatch.
  const ACCENTS = ['#34D399', '#38BDF8', '#A78BFA', '#FBBF24', '#FB7185', '#2DD4BF']
  const [readyTree, setReadyTree] = useState<{ id: string; title: string } | null>(null)
  const [titleDraft, setTitleDraft] = useState('')
  const [accentPick, setAccentPick] = useState<string | null>(null)
  const [opening, setOpening] = useState(false)

  async function openReadyTree() {
    if (!readyTree || opening) return
    setOpening(true)
    const finalTitle = titleDraft.trim().slice(0, 80)
    // Persist the personalization only when they actually changed something.
    if ((finalTitle && finalTitle !== readyTree.title) || accentPick) {
      await fetch(`/api/tree/${readyTree.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_meta', displayTitle: finalTitle || undefined, accentColor: accentPick || undefined }),
      }).catch(() => { /* cosmetic — never blocks entry */ })
    }
    router.push(`/dashboard/tree/${readyTree.id}`)
  }

  async function openOnboard() {
    setShowOnboard(true); setStep(0); setError(null); setConfirms([]); setBuildStage(0); setFirstRead(null); setReadyTree(null); setAccentPick(null); setOpening(false)
    if (defaultsLoaded.current) return
    defaultsLoaded.current = true
    try {
      const res = await fetch('/api/tree/defaults', { cache: 'no-store' })
      const d = res.ok ? await res.json() : null
      if (d?.language && !sessLangTouched.current && (d.language === 'en' || d.language === 'zh')) setSessLang(d.language)
      if (d?.difficulty && typeof d.difficulty === 'string') setDifficulty(d.difficulty)
      if (d?.background && typeof d.background === 'string') {
        setBackground(prev => {
          if (prev.trim()) return prev
          setBgPrefilled(true)
          return d.background
        })
      }
    } catch { /* first-time user — built-in defaults stand */ }
  }

  // Advance a step, recording Bob's construction confirmation for the answer
  // just given (echo clamped so the bubble stays one line-ish).
  function advanceFrom(s: number) {
    const echo = (x: string) => (x.trim().length > 90 ? `${x.trim().slice(0, 90)}…` : x.trim())
    if (s === 0) setConfirms(c => [...c, t('tree.confirmLang').replace('{lang}', sessLang === 'zh' ? '中文' : 'English')])
    if (s === 1) {
      setConfirms(c => [...c, t('tree.confirmProblem').replace('{echo}', echo(problem))])
      // Fire the purpose-chip draft in the background — never blocks the flow.
      fetch('/api/tree/purpose-ideas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ problem: problem.trim(), lang: sessLang }),
      })
        .then(r => (r.ok ? r.json() : null))
        .then(d => { if (Array.isArray(d?.ideas) && d.ideas.length === 3) setPurposeIdeas(d.ideas) })
        .catch(() => { /* canned chips stand */ })
      // Reciprocity: Bob's first read on the problem — a real gift of insight
      // that lands as a bubble while the remaining questions are answered.
      fetch('/api/tree/first-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ problem: problem.trim(), lang: sessLang }),
      })
        .then(r => (r.ok ? r.json() : null))
        .then(d => { if (typeof d?.read === 'string' && d.read.trim()) setFirstRead(d.read.trim()) })
        .catch(() => { /* gift is optional */ })
    }
    if (s === 2) {
      setConfirms(c => [...c, purpose.trim()
        ? t('tree.confirmPurpose').replace('{echo}', echo(purpose))
        : t('tree.confirmPurposeSkip')])
    }
    if (s === 3) {
      setConfirms(c => [...c, background.trim()
        ? t('tree.confirmBackground')
        : t('tree.confirmBackgroundSkip')])
    }
    setStep(s + 1)
  }

  // Staged construction progress while the seed request runs. Stages advance
  // on honest wall-clock pacing and hold at the last until the server returns.
  useEffect(() => {
    if (!creating) { setBuildStage(0); return }
    const timers = [
      setTimeout(() => setBuildStage(1), 3200),
      setTimeout(() => setBuildStage(2), 8200),
      setTimeout(() => setBuildStage(3), 14500),
    ]
    return () => timers.forEach(clearTimeout)
  }, [creating])

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/tree', { cache: 'no-store' })
      if (res.ok) setTrees((await res.json()).trees)
    } catch { /* transient */ }
  }, [])
  useEffect(() => { load() }, [load])

  async function createTree() {
    const p = problem.trim()
    if (!p || creating) return
    setCreating(true)
    setError(null)
    try {
      const res = await fetch('/api/tree', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ problem: p, lang: sessLang, difficulty, personalContext: background.trim() || undefined, purpose: purpose.trim() || undefined }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'failed')
      // ENDOWMENT: before opening, one optional beat of ownership — name it,
      // mark it. The Haiku headline is the editable smart default.
      const headline = typeof body.displayTitle === 'string' && body.displayTitle.trim()
        ? body.displayTitle.trim()
        : p.length > 60 ? `${p.slice(0, 60)}…` : p
      setReadyTree({ id: body.id, title: headline })
      setTitleDraft(headline)
      setCreating(false)
    } catch {
      setError(t('tree.createFailed'))
      setCreating(false)
    }
  }

  async function deleteTree(id: string) {
    if (!confirm(t('tree.deleteConfirm'))) return
    await fetch(`/api/tree/${id}`, { method: 'DELETE' }).catch(() => {})
    setTrees(prev => prev?.filter(tr => tr.id !== id) ?? prev)
  }

  // Manual "Mark as complete" is GONE (user decision, Jul 2026): mastery is
  // AI-verified only — a tree completes when its ROOT verifies, which the
  // engine grants at verification time (markNodeVerified). No self-marking.

  // ── Tree Digest: the session's status report, built from tree state ──
  // Key numbers (strictly from real evidence), findings, progress made,
  // blockages, next actions — readable in place or copied to your team.
  const [digestFor, setDigestFor] = useState<{ id: string; title: string } | null>(null)
  const [digestText, setDigestText] = useState<string | null>(null)
  const [digestAt, setDigestAt] = useState<string | null>(null)
  const [digestBusy, setDigestBusy] = useState(false)
  const [digestCopied, setDigestCopied] = useState(false)
  // Staleness guard: generation takes seconds — a slow response for one tree
  // must never land in a modal that has since switched to another tree.
  const digestReqRef = useRef<string | null>(null)
  async function loadDigest(id: string, refresh: boolean) {
    digestReqRef.current = id
    setDigestBusy(true)
    setDigestCopied(false)
    try {
      const res = await fetch(`/api/tree/${id}/digest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh, lang: language }),
      })
      const body = await res.json().catch(() => null)
      if (digestReqRef.current !== id) return
      setDigestText(res.ok && body?.digest ? body.digest : t('tree.digestFailed'))
      setDigestAt(res.ok && body?.digestAt ? String(body.digestAt) : null)
    } catch {
      if (digestReqRef.current !== id) return
      setDigestText(t('tree.digestFailed'))
      setDigestAt(null)
    }
    setDigestBusy(false)
  }
  function openDigest(tr: TreeSummary) {
    setDigestFor({ id: tr.id, title: tr.displayTitle || tr.title })
    setDigestText(null)
    setDigestAt(null)
    void loadDigest(tr.id, false)
  }
  async function copyDigest() {
    if (!digestText) return
    try {
      await navigator.clipboard.writeText(digestText)
      setDigestCopied(true)
      setTimeout(() => setDigestCopied(false), 1600)
    } catch { /* clipboard unavailable */ }
  }

  // ── Review: retention practice on a completed tree ──
  // The server picks the stalest verified node; the workspace opens in
  // review mode where Bob reactivates the idea and asks a fresh checkpoint.
  const [reviewBusy, setReviewBusy] = useState<string | null>(null)
  async function startReview(id: string) {
    if (reviewBusy) return
    setReviewBusy(id)
    try {
      const res = await fetch(`/api/tree/${id}/review`, { method: 'POST' })
      const body = await res.json().catch(() => null)
      if (res.ok && body?.nodeId) {
        router.push(`/dashboard/workspace?tree=${id}&node=${body.nodeId}&review=1`)
        return
      }
      alert(t('tree.reviewNone'))
    } catch { /* transient */ }
    setReviewBusy(null)
  }

  return (
    <div className="p-6 lg:p-10 max-w-3xl mx-auto space-y-8">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Sprout className="w-6 h-6 text-emerald-400" />
          {t('tree.title')}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">{t('tree.subtitle')}</p>
      </motion.div>

      {/* New Session — one prominent button; the 5-question session
          onboarding opens as a FULL-SCREEN conversation with Bob. */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
        <button
          onClick={() => { void openOnboard() }}
          className="w-full flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary/40 bg-primary/5 hover:bg-primary/10 hover:border-primary/60 px-5 py-4 text-sm font-semibold text-primary transition-colors"
        >
          <Plus className="w-4 h-4" /> {t('tree.newSession')}
        </button>
      </motion.div>

      {/* Full-screen session-onboarding conversation — Bob asks one question
          per screen (5 max, per FOUNDATION); same state + create logic as the
          old inline stepper, now immersive. ✕ closes without losing drafts. */}
      {showOnboard && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[200] bg-background flex flex-col">
          <div className="h-14 flex-shrink-0 border-b border-border flex items-center gap-3 px-4">
            <Sprout className="w-5 h-5 text-emerald-400 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-foreground truncate">{t('tree.newSession')}</p>
              <p className="text-[11px] text-muted-foreground truncate">{t('tree.sessionSetup')}</p>
            </div>
            {!creating && !readyTree && (
              <div className="flex items-center gap-1.5 mr-2">
                {Array.from({ length: STEPS }, (_, i) => (
                  <span key={i} className={`h-1.5 rounded-full transition-all ${i === step ? 'w-6 bg-primary' : i < step ? 'w-3 bg-primary/50' : 'w-3 bg-muted'}`} />
                ))}
              </div>
            )}
            <button
              onClick={() => { if (!creating) setShowOnboard(false) }}
              aria-label={t('common.dismiss')}
              className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${creating ? 'text-muted-foreground/30 cursor-default' : 'hover:bg-accent text-muted-foreground hover:text-foreground'}`}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            <div className="max-w-2xl mx-auto px-5 py-10 space-y-6">
              {readyTree ? (
                /* MAKE IT YOURS — the endowment beat: name the tree, pick its
                   accent. Everything optional; Open works untouched. */
                <div className="py-10 flex flex-col items-center text-center space-y-6">
                  <div className="w-14 h-14 rounded-2xl bg-emerald-500/15 border border-emerald-400/30 flex items-center justify-center">
                    <CheckCircle2 className="w-7 h-7 text-emerald-400" />
                  </div>
                  <div>
                    <p className="text-lg font-bold text-foreground">{t('tree.readyTitle')}</p>
                    <p className="text-xs text-muted-foreground mt-1">{t('tree.readySub')}</p>
                  </div>
                  <div className="w-full max-w-md space-y-4 text-left">
                    <input
                      value={titleDraft}
                      onChange={e => setTitleDraft(e.target.value)}
                      maxLength={80}
                      className="w-full bg-background border border-border rounded-xl px-4 py-3 text-base font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                    />
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground">{t('tree.pickAccent')}</span>
                      <div className="flex items-center gap-2">
                        {ACCENTS.map(c => (
                          <button
                            key={c}
                            onClick={() => setAccentPick(a => (a === c ? null : c))}
                            aria-label={c}
                            className={`w-7 h-7 rounded-full border-2 transition-transform ${accentPick === c ? 'border-foreground scale-110' : 'border-transparent hover:scale-105'}`}
                            style={{ background: c }}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={openReadyTree}
                    disabled={opening}
                    className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
                  >
                    {opening ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sprout className="w-4 h-4" />}
                    {t('tree.openMyTree')}
                  </button>
                </div>
              ) : creating ? (
                /* CONSTRUCTION — the tree is being built from the whole
                   conversation (the Release-EDU curriculum-builder moment). */
                <div className="py-14 flex flex-col items-center text-center space-y-6">
                  <motion.div
                    animate={{ scale: [1, 1.08, 1] }}
                    transition={{ repeat: Infinity, duration: 1.6, ease: 'easeInOut' }}
                    className="w-16 h-16 rounded-2xl bg-emerald-500/15 border border-emerald-400/30 flex items-center justify-center"
                  >
                    <Sprout className="w-8 h-8 text-emerald-400" />
                  </motion.div>
                  <div>
                    <p className="text-lg font-bold text-foreground">{t('tree.buildTitle')}</p>
                    <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">{t('tree.buildSub')}</p>
                  </div>
                  <div className="w-full max-w-sm space-y-2.5 text-left">
                    {[t('tree.build0'), t('tree.build1'), t('tree.build2'), t('tree.build3')].map((label, i) => (
                      <div key={i} className={cn('flex items-center gap-2.5 text-sm', i > buildStage && 'opacity-40')}>
                        {i < buildStage
                          ? <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                          : i === buildStage
                            ? <Loader2 className="w-4 h-4 animate-spin text-primary flex-shrink-0" />
                            : <span className="w-4 h-4 rounded-full border border-border flex-shrink-0" />}
                        <span className={i <= buildStage ? 'text-foreground' : 'text-muted-foreground'}>{label}</span>
                      </div>
                    ))}
                  </div>
                  <div className="w-full max-w-sm h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full bg-primary transition-all duration-700" style={{ width: `${[18, 45, 72, 90][Math.min(buildStage, 3)]}%` }} />
                  </div>
                </div>
              ) : (
                <>
              {/* Bob's construction confirmations — every answered question
                  is visibly "already in the build" (goal gradient + trust). */}
              {confirms.length > 0 && (
                <div className="space-y-2">
                  {confirms.map((c, i) => (
                    <div key={i} className="flex items-start gap-3 opacity-80">
                      <div className="w-9 flex-shrink-0" />
                      <p className="text-[13px] text-emerald-300/90 leading-snug flex items-start gap-1.5">
                        <Hammer className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                        <span>{c}</span>
                      </p>
                    </div>
                  ))}
                </div>
              )}
              {firstRead && step > 1 && (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-xl bg-emerald-500/15 flex items-center justify-center flex-shrink-0">
                    <Bot className="w-5 h-5 text-emerald-400" />
                  </div>
                  <div className="rounded-2xl rounded-tl-sm border border-emerald-400/30 bg-emerald-500/[0.06] px-4 py-3">
                    <p className="text-[11px] font-bold text-emerald-300 uppercase tracking-wide mb-1">{t('tree.firstReadTitle')}</p>
                    <p className="text-[13px] text-foreground/90 leading-relaxed">{firstRead}</p>
                  </div>
                </motion.div>
              )}
              <motion.div
                key={step}
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                className="flex items-start gap-3"
              >
                <div className="w-9 h-9 rounded-xl bg-primary/15 flex items-center justify-center flex-shrink-0">
                  <Bot className="w-5 h-5 text-primary" />
                </div>
                <div className="rounded-2xl rounded-tl-sm border border-border bg-card px-4 py-3">
                  <p className="text-base font-semibold text-foreground leading-snug">
                    {step === 0 ? t('tree.stepLanguage') : step === 1 ? t('tree.problemPrompt') : step === 2 ? t('tree.stepPurpose') : step === 3 ? t('tree.stepBackground') : t('tree.stepDifficulty')}
                  </p>
                  {step === 2 && <p className="text-xs text-muted-foreground mt-1 leading-snug">{t('tree.purposeHint')}</p>}
                  {step === 4 && <p className="text-xs text-muted-foreground mt-1 leading-snug">{t('tree.difficultyHint')}</p>}
                </div>
              </motion.div>

              <div className="sm:pl-12 space-y-5">
                {step === 0 && (
                  <div className="flex gap-2">
                    {([['en', 'English'], ['zh', '中文']] as const).map(([code, label]) => (
                      <button
                        key={code}
                        onClick={() => { sessLangTouched.current = true; setSessLang(code) }}
                        className={`px-6 py-3 rounded-xl border text-base font-medium transition-colors ${
                          sessLang === code ? 'border-primary bg-primary/15 text-primary' : 'border-border text-muted-foreground hover:text-foreground hover:bg-accent'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}

                {step === 1 && (
                  <textarea
                    value={problem}
                    onChange={e => setProblem(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (problem.trim()) advanceFrom(1) } }}
                    placeholder={t('tree.problemPlaceholder')}
                    rows={3}
                    autoFocus
                    className="w-full bg-background border border-border rounded-xl px-4 py-3.5 text-base text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                )}

                {step === 2 && (
                  <div className="space-y-3">
                    {/* Smart defaults: tap a likely purpose instead of writing
                        from scratch (AI-drafted from the problem; canned until
                        those arrive). Always editable in the box below. */}
                    <div className="flex flex-wrap gap-2">
                      {(purposeIdeas ?? [t('tree.purposeIdea1'), t('tree.purposeIdea2'), t('tree.purposeIdea3')]).map((idea, i) => (
                        <button
                          key={`${i}-${idea.slice(0, 16)}`}
                          onClick={() => setPurpose(idea)}
                          className={`px-3 py-2 rounded-xl border text-[13px] text-left transition-colors max-w-full ${
                            purpose === idea ? 'border-primary bg-primary/15 text-primary' : 'border-border text-muted-foreground hover:text-foreground hover:bg-accent'
                          }`}
                        >
                          {idea}
                        </button>
                      ))}
                    </div>
                    <textarea
                      value={purpose}
                      onChange={e => setPurpose(e.target.value)}
                      placeholder={t('tree.purposePlaceholder')}
                      rows={4}
                      autoFocus
                      className="w-full bg-background border border-border rounded-xl px-4 py-3.5 text-base text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary/40"
                    />
                  </div>
                )}

                {step === 3 && (
                  <div className="space-y-2">
                    {bgPrefilled && background.trim() !== '' && (
                      <p className="text-[11px] text-primary/80 flex items-center gap-1.5">
                        <Sparkles className="w-3 h-3 flex-shrink-0" /> {t('tree.prefilledHint')}
                      </p>
                    )}
                  <textarea
                    value={background}
                    onChange={e => setBackground(e.target.value)}
                    placeholder={t('tree.backgroundPlaceholder')}
                    rows={4}
                    autoFocus
                    className="w-full bg-background border border-border rounded-xl px-4 py-3.5 text-base text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                  </div>
                )}

                {step === 4 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {(['beginner', 'intermediate', 'advanced', 'professional'] as const).map(level => (
                      <button
                        key={level}
                        onClick={() => setDifficulty(level)}
                        disabled={creating}
                        className={`text-left rounded-xl border p-3.5 transition-colors disabled:opacity-60 ${
                          difficulty === level ? 'border-primary bg-primary/10' : 'border-border hover:bg-accent'
                        }`}
                      >
                        <p className={`text-sm font-bold ${difficulty === level ? 'text-primary' : 'text-foreground'}`}>{t(`tree.diff.${level}`)}</p>
                        <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">{t(`tree.diff.${level}Desc`)}</p>
                      </button>
                    ))}
                  </div>
                )}

                <div className="flex items-center gap-3">
                  {step > 0 && !creating && (
                    <button
                      onClick={() => { setConfirms(c => c.slice(0, -1)); setStep(s => s - 1) }}
                      className="px-5 py-2.5 rounded-xl border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                    >
                      {t('tree.back')}
                    </button>
                  )}
                  {step < STEPS - 1 ? (
                    <button
                      onClick={() => advanceFrom(step)}
                      disabled={step === 1 && !problem.trim()}
                      className="px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-40"
                    >
                      {t('tree.next')}
                    </button>
                  ) : (
                    <button
                      onClick={createTree}
                      disabled={!problem.trim() || creating}
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-40"
                    >
                      {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                      {creating ? t('tree.growing') : t('tree.grow')}
                    </button>
                  )}
                  {error && <span className="text-xs text-destructive">{error}</span>}
                </div>
              </div>
                </>
              )}
            </div>
          </div>
        </div>
      , document.body)}

      {/* Existing trees */}
      <div className="space-y-3">
        {trees === null && <div className="h-24 rounded-xl border border-border bg-card/50 animate-pulse" />}
        {trees?.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">{t('tree.empty')}</p>
        )}
        {trees?.map(tree => {
          const pct = tree.nodeCount > 0 ? Math.round((tree.understoodCount / tree.nodeCount) * 100) : 0
          const consolidated = tree.status === 'completed'
          return (
            <Link key={tree.id} href={`/dashboard/tree/${tree.id}`} className="block group">
              <motion.div
                className={cn(
                  'border rounded-xl p-4 transition-colors',
                  // Completed (root-verified) trees settle into a golden
                  // panel — done, sealed, and worth coming back to review.
                  consolidated
                    ? 'border-amber-400/45 bg-amber-500/[0.07] hover:border-amber-400/70'
                    : 'border-border bg-card hover:border-primary/40',
                )}
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <p title={tree.title} className={cn('text-sm font-bold text-foreground transition-colors', consolidated ? 'group-hover:text-amber-400' : 'group-hover:text-primary')}>
                      {tree.accentColor && (
                        <span className="inline-block w-2.5 h-2.5 rounded-full mr-1.5 align-middle" style={{ background: tree.accentColor, boxShadow: `0 0 8px ${tree.accentColor}66` }} />
                      )}
                      {tree.displayTitle || tree.title}
                      {consolidated && (
                        <span className="inline-flex items-center gap-1 ml-2 px-1.5 py-0.5 rounded-full bg-amber-500/15 border border-amber-400/40 text-amber-400 text-[10px] font-bold align-middle">
                          <Sparkles className="w-3 h-3" /> {t('tree.consolidated')}
                        </span>
                      )}
                      {consolidated && (
                        <span className={cn(
                          'inline-flex items-center gap-1 ml-1.5 px-1.5 py-0.5 rounded-full border text-[10px] font-bold align-middle',
                          tree.deployed
                            ? 'bg-emerald-500/15 border-emerald-400/40 text-emerald-400'
                            : 'bg-sky-500/10 border-sky-400/30 text-sky-300',
                        )}>
                          {tree.deployed ? t('tree.outcomeDeployed') : t('tree.outcomeExplained')}
                        </span>
                      )}
                    </p>
                    {tree.framing && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{tree.framing}</p>}
                  </div>
                  <button
                    onClick={e => { e.preventDefault(); openDigest(tree) }}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-muted-foreground text-[11px] font-medium hover:text-primary hover:border-primary/40 hover:bg-primary/10 transition-colors flex-shrink-0"
                    title={t('tree.digestHint')}
                  >
                    <ClipboardList className="w-3.5 h-3.5" />
                    {t('tree.digest')}
                  </button>
                  {consolidated ? (
                    <button
                      onClick={e => { e.preventDefault(); startReview(tree.id) }}
                      disabled={reviewBusy === tree.id}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-amber-400/40 bg-amber-500/10 text-amber-300 text-[11px] font-medium hover:bg-amber-500/20 transition-colors flex-shrink-0 disabled:opacity-50"
                      title={t('tree.reviewHintDecay').replace('{n}', String(tree.understoodCount))}
                    >
                      {reviewBusy === tree.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                      {t('tree.review')}
                    </button>
                  ) : null}
                  <button
                    onClick={e => { e.preventDefault(); deleteTree(tree.id) }}
                    className="p-1.5 rounded-md text-muted-foreground/40 hover:text-red-400 hover:bg-red-500/10 transition-colors flex-shrink-0"
                    title={t('tree.delete')}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="mt-3 flex items-center gap-3">
                  {/* Goal gradient: a bar sitting at 0% reads as "standing
                      still" — show it only once something is actually done. */}
                  {tree.understoodCount > 0 ? (
                    <>
                      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className={cn('h-full rounded-full transition-all', consolidated ? 'bg-amber-400' : pct === 100 ? 'bg-emerald-400' : 'bg-primary')}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-[11px] text-muted-foreground tabular-nums">
                        {tree.understoodCount}/{tree.nodeCount} · {pct}%
                      </span>
                    </>
                  ) : (
                    /* Head start: what they've ALREADY done counts visibly —
                       never a bare zero. */
                    <span className="text-[11px] text-muted-foreground">
                      🌱 {t('tree.headPlanted')}{tree.hasPurpose ? ` · ${t('tree.headPurpose')}` : ''} · {t('tree.nodesReady').replace('{n}', String(tree.nodeCount))}
                    </span>
                  )}
                </div>
                {/* Loss aversion (honest): a nearly-finished tree going quiet
                    names what's at stake — how little is left vs. banked work. */}
                {(() => {
                  const remaining = tree.nodeCount - tree.understoodCount
                  const stale = Date.now() - new Date(tree.updatedAt).getTime() > 5 * 86_400_000
                  return tree.status === 'active' && tree.understoodCount > 0 && remaining >= 1 && remaining <= 2 && stale ? (
                    <p className="mt-2 text-[11px] text-amber-400">
                      {t('tree.almostDone').replace('{k}', String(remaining)).replace('{pct}', String(pct))}
                    </p>
                  ) : null
                })()}
              </motion.div>
            </Link>
          )
        })}
      </div>

      {/* Tree Digest modal — the session's status report, copy-ready */}
      {digestFor && (
        <div className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setDigestFor(null)}>
          <div
            className="w-full max-w-2xl max-h-[85vh] flex flex-col bg-card border border-border rounded-2xl p-5 space-y-3"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-base font-bold text-foreground flex items-center gap-2 min-w-0">
                <ClipboardList className="w-4 h-4 text-primary flex-shrink-0" />
                <span className="truncate">{t('tree.digestTitle')} — {digestFor.title}</span>
              </h3>
              <button onClick={() => setDigestFor(null)} className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex-shrink-0">
                <X className="w-4 h-4" />
              </button>
            </div>
            {/* A cached report must never masquerade as live state — show
                its age so "Refresh" is an informed choice. */}
            {digestAt && !digestBusy && (
              <p className="text-[10px] text-muted-foreground -mt-1">
                {t('tree.digestGenerated')} {new Date(digestAt).toLocaleString()}
              </p>
            )}
            <div className="flex-1 overflow-y-auto border border-border rounded-xl bg-background/60 px-4 py-3 text-sm leading-relaxed">
              {digestBusy || digestText === null ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
                  <Loader2 className="w-4 h-4 animate-spin" /> {t('tree.digestLoading')}
                </div>
              ) : (
                <MarkdownRenderer content={digestText} />
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={copyDigest}
                disabled={digestBusy || !digestText}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium py-2.5 hover:bg-primary/90 transition-colors disabled:opacity-40"
              >
                <Copy className="w-4 h-4" /> {digestCopied ? t('tree.digestCopied') : t('tree.digestCopy')}
              </button>
              <button
                onClick={() => digestFor && loadDigest(digestFor.id, true)}
                disabled={digestBusy}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-40"
              >
                <RefreshCw className={cn('w-4 h-4', digestBusy && 'animate-spin')} /> {t('tree.digestRefresh')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
