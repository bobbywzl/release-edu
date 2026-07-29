'use client'
/**
 * TREE COPILOT — the tree page's single conversation combining every
 * tree-level function: teach about the whole problem, grow branches under
 * ANY node (pending ghosts — permission-based), re-aim the session purpose
 * (approval chip), and RESHAPE the tree map and node contents (edit / move /
 * delete chips — nothing applies until tapped), with SOTA-chatbot multimodal
 * input (file / camera photo / video / voice note via the shared capture
 * row) and generated visuals (Bob's ```image blocks).
 *
 * Shell (two modes):
 * - AMBIENT (default): a Spotlight-style pill floating bottom-center with the
 *   dim invitation "Ask me here to customise this tree for you"; the last few
 *   exchanges float above it as translucent cloud bubbles, so the student
 *   converses WHILE watching ghost nodes form and chips land on the canvas.
 *   Reshape/purpose chips render in the cloud too (ghost approve/reject lives
 *   on the canvas nodes themselves).
 * - FULL: the expand button opens the complete fullscreen conversation
 *   (multimodal input, full history); Esc or ✕ returns to ambient.
 */
import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import * as Dialog from '@radix-ui/react-dialog'
import {
  Bot, X, Check, Send, Loader2, Sprout, Pencil, MoveRight, Trash2, Maximize2, Scissors,
} from 'lucide-react'
import { MarkdownRenderer } from '@/components/markdown-renderer'
import { useAttachments, CaptureControls, AttachmentTray, attachmentLabel } from '@/components/multimodal-input'
import { useLanguage } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import type { CopilotAction } from '@/lib/tree-engine'

interface CopilotTree { id: string; title: string; framing: string | null }
interface GhostChip { id: string; title: string; summary: string }

export function TreeCopilot({ tree, onChanged, fit, stats }: {
  tree: CopilotTree
  onChanged: () => Promise<void> | void
  /** Re-fit the canvas; occludeTopPx = viewport pixels (from the canvas top)
   *  covered by the ambient cloud, so the tree re-centers BELOW it. */
  fit: (occludeTopPx?: number) => void
  /** Verified/total branch counts — picks which suggestion chips fit now. */
  stats?: { verified: number; total: number }
}) {
  const { t, language } = useLanguage()
  const [open, setOpen] = useState(false)
  const [thread, setThread] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([])
  const [loaded, setLoaded] = useState(false)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  // This dialog's unapproved ghosts — chips here AND dashed nodes on the
  // canvas; the next turn's proposals replace exactly this set.
  const [ghosts, setGhosts] = useState<GhostChip[]>([])
  const [ghostBusy, setGhostBusy] = useState<string | null>(null)
  // Reshape chips from the latest turn (edit / move / delete) — each applies
  // via the node PATCH route only when tapped.
  const [actions, setActions] = useState<CopilotAction[]>([])
  const [actionBusy, setActionBusy] = useState<number | null>(null)
  const [purposeProposal, setPurposeProposal] = useState<string | null>(null)
  const [purposeBusy, setPurposeBusy] = useState(false)
  // tone matters: a failure note must never wear success colors.
  const [note, setNote] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null)
  const {
    attachments, note: attachNote, recording,
    addFiles, toggleRecord, removeAt, clear: clearAttachments,
  } = useAttachments()
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  // REACTIVE VIEW ADJUSTER (law): the copilot must never block the tree or a
  // freshly-popped ghost. After every ambient turn/chip the canvas re-fits
  // into the band BELOW the cloud — measured live, so a tall reply pushes the
  // tree further down and a cleared cloud gives the space back.
  const ambientRef = useRef<HTMLDivElement>(null)
  const fitAvoidingCloud = () => {
    try {
      const canvasTop = (document.querySelector('.react-flow') as HTMLElement | null)?.getBoundingClientRect().top ?? 0
      const bottom = ambientRef.current?.getBoundingClientRect().bottom ?? 0
      fit(Math.max(0, bottom - canvasTop + 10))
    } catch {
      fit(0)
    }
  }

  // SMART DEFAULTS for the empty copilot: three curated one-tap asks picked
  // by tree state — a blank input is a decision, a chip is a scan-and-tap.
  const verified = stats?.verified ?? 0
  const chipList = Array.from(new Set([
    t('tree.chipGaps'),
    verified >= 2 ? t('tree.chipSummarize') : t('tree.chipFirst'),
    verified > 0 && verified < (stats?.total ?? 0) ? t('tree.chipNext') : t('tree.chipShape'),
  ])).slice(0, 3)

  useEffect(() => { if (open) endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [thread, busy, open])
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 250) }, [open])

  // Rehydrate the persisted thread on MOUNT — the ambient cloud shows the
  // most recent exchanges immediately, not only after the full view opens.
  useEffect(() => {
    if (loaded) return
    setLoaded(true)
    fetch(`/api/tree/${tree.id}/copilot`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (Array.isArray(d?.messages) && d.messages.length) {
          setThread(d.messages.map((m: { role: string; content: string }) => ({
            role: m.role === 'assistant' ? 'assistant' as const : 'user' as const, content: m.content,
          })))
        }
      })
      .catch(() => { /* fresh thread */ })
  }, [loaded, tree.id])

  async function send(preset?: string) {
    const msg = (preset ?? input).trim()
    if ((!msg && attachments.length === 0) || busy) return
    setBusy(true); setNote(null)
    const payload = attachments
    setThread(t2 => [...t2, { role: 'user', content: attachmentLabel(msg, payload) }])
    setInput(''); clearAttachments()
    try {
      const res = await fetch(`/api/tree/${tree.id}/copilot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, lang: language, replaceIds: ghosts.map(g => g.id), attachments: payload }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setThread(t2 => [...t2, { role: 'assistant', content: t('tree.proposeFailed') }])
        return
      }
      const reply = typeof body.reply === 'string' && body.reply.trim() ? body.reply.trim() : t('tree.proposeFailed')
      setThread(t2 => [...t2, { role: 'assistant', content: reply }])
      const proposals = Array.isArray(body.proposals) ? body.proposals : []
      if (proposals.length > 0) {
        setGhosts(proposals
          .filter((p: { id?: string }) => p?.id)
          .map((p: { id: string; title?: string; summary?: string }) => ({ id: p.id, title: p.title ?? '', summary: p.summary ?? '' })))
        // Effort anchor: n proposals ≈ n×15 min of new ground — a concrete,
        // small-feeling add next to the work already banked in the tree.
        setNote({
          text: `${t('tree.proposedN').replace('{n}', String(proposals.length))} · ${t('tree.estAdd').replace('{m}', String(proposals.length * 15))}`,
          tone: 'ok',
        })
      }
      // Transparency: when Bob pulled stored work (conversations/notes/files…)
      // to ground this answer, say so — a dim line, never a surprise.
      const recalledRefs = Array.isArray(body.recalled) ? (body.recalled as Array<{ node?: string }>) : []
      if (recalledRefs.length > 0 && proposals.length === 0) {
        const names = recalledRefs.map(r => r.node).filter(Boolean).slice(0, 4).join(', ')
        if (names) setNote({ text: t('tree.recalledNote').replace('{list}', names), tone: 'ok' })
      }
      // Reshape chips are per-turn: the latest turn's set is the live one.
      setActions(Array.isArray(body.actions) ? (body.actions as CopilotAction[]) : [])
      if (typeof body.purposeUpdate === 'string' && body.purposeUpdate.trim()) {
        setPurposeProposal(body.purposeUpdate.trim())
      }
      await onChanged()
      // Reactive adjust on EVERY turn (not only proposals): the cloud just
      // grew by a reply, so the visible band changed. Skipped in full view
      // (the canvas is behind the dialog there).
      if (!open) setTimeout(fitAvoidingCloud, 200)
      else if (proposals.length > 0) setTimeout(() => fit(0), 150)
    } catch {
      setThread(t2 => [...t2, { role: 'assistant', content: t('tree.proposeFailed') }])
    } finally {
      setBusy(false)
    }
  }

  // Approve/dismiss a proposed ghost right here (no canvas trip — the map is
  // behind the fullscreen). 4xx is terminal (handled elsewhere): retire the chip.
  async function actGhost(ghostId: string, action: 'approve' | 'reject') {
    if (ghostBusy) return
    setGhostBusy(ghostId)
    try {
      const res = await fetch(`/api/tree/${tree.id}/node/${ghostId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (res.ok || (res.status >= 400 && res.status < 500)) {
        setGhosts(g => g.filter(x => x.id !== ghostId))
        await onChanged()
        if (action === 'approve') setTimeout(open ? () => fit(0) : fitAvoidingCloud, 150)
      } else {
        setNote({ text: t('tree.actionFailed'), tone: 'warn' })
      }
    } catch {
      setNote({ text: t('tree.actionFailed'), tone: 'warn' })
    } finally {
      setGhostBusy(null)
    }
  }

  // Apply ONE approved reshape chip (edit / move / delete) — the tap IS the
  // permission. Deletes take a native confirm too: a whole subtree goes.
  async function applyAction(a: CopilotAction, idx: number) {
    if (actionBusy !== null) return
    if (a.type === 'delete' && !confirm(t('tree.deleteNodeConfirm'))) return
    setActionBusy(idx)
    try {
      const payload = a.type === 'edit'
        ? { action: 'edit', title: a.newTitle, summary: a.newSummary }
        : a.type === 'move'
          ? { action: 'move', newParentId: a.newParentId }
          : a.type === 'split'
            ? { action: 'split', title: a.newTitle, summary: a.newSummary, moveTail: a.moveTail }
            : { action: 'delete' }
      const res = await fetch(`/api/tree/${tree.id}/node/${a.nodeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (res.ok) {
        setActions(list => list.filter((_, i) => i !== idx))
        setNote({ text: t('tree.copilotApplied'), tone: 'ok' })
        await onChanged()
        setTimeout(open ? () => fit(0) : fitAvoidingCloud, 150)
      } else if (res.status >= 400 && res.status < 500) {
        // Terminal: the chip's snapshot no longer matches the live tree
        // (target deleted by an earlier chip, cycle, root guard) — retire it
        // instead of leaving an immortal Apply button, and resync the map.
        setActions(list => list.filter((_, i) => i !== idx))
        setNote({ text: t('tree.actionFailed'), tone: 'warn' })
        await onChanged()
      } else {
        setNote({ text: t('tree.actionFailed'), tone: 'warn' })
      }
    } catch {
      setNote({ text: t('tree.actionFailed'), tone: 'warn' })
    } finally {
      setActionBusy(null)
    }
  }

  async function applyPurpose() {
    if (!purposeProposal || purposeBusy) return
    setPurposeBusy(true)
    try {
      const res = await fetch(`/api/tree/${tree.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_purpose', purpose: purposeProposal }),
      })
      if (res.ok) {
        setThread(t2 => [...t2, { role: 'assistant', content: `${t('tree.copilotPurposeApplied')} — ${purposeProposal}` }])
        setPurposeProposal(null)
        await onChanged()
      } else {
        setNote({ text: t('tree.actionFailed'), tone: 'warn' })
      }
    } catch {
      setNote({ text: t('tree.actionFailed'), tone: 'warn' })
    } finally {
      setPurposeBusy(false)
    }
  }

  const actionDesc = (a: CopilotAction): string => {
    if (a.type === 'edit') return t('tree.actEditDesc').replace('{a}', a.title)
    if (a.type === 'move') return t('tree.actMoveDesc').replace('{a}', a.title).replace('{b}', a.newParentTitle ?? '')
    if (a.type === 'split') return t('tree.actSplitDesc').replace('{a}', a.title).replace('{b}', a.newTitle ?? '').replace('{n}', String(a.moveTail ?? 8))
    return t('tree.actDeleteDesc').replace('{a}', a.title)
  }
  const ActionIcon = ({ type }: { type: CopilotAction['type'] }) =>
    type === 'edit' ? <Pencil className="w-3.5 h-3.5 text-sky-300 flex-shrink-0" />
      : type === 'move' ? <MoveRight className="w-3.5 h-3.5 text-violet-300 flex-shrink-0" />
        : type === 'split' ? <Scissors className="w-3.5 h-3.5 text-emerald-300 flex-shrink-0" />
          : <Trash2 className="w-3.5 h-3.5 text-red-300 flex-shrink-0" />

  return (
    <>
      {/* AMBIENT MODE — the Spotlight pill + cloud of recent bubbles.
          pointer-events pass through the empty column; only the bubbles and
          the pill catch clicks, so the canvas stays fully interactive. */}
      <AnimatePresence>
        {!open && (
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 14 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            ref={ambientRef}
            // Positioning law: anchor with insets/margins ONLY — never a
            // Tailwind translate on a motion element (framer owns `transform`
            // inline while animating y, so a CSS translate gets clobbered and
            // restored, visibly jumping the overlay). Anchored TOP-LEFT of the
            // canvas: left-20 clears the collapsed nav rail on desktop.
            className="fixed top-16 left-4 lg:left-20 right-4 z-40 max-w-xl flex flex-col gap-2 pointer-events-none"
          >
            {/* The pill — Spotlight for the tree. Dim invitation until used. */}
            <div className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-border/50 bg-card/60 backdrop-blur-xl shadow-2xl shadow-black/20 pl-4 pr-1.5 py-1.5">
              <Bot className="w-5 h-5 text-primary flex-shrink-0" />
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); send() }
                }}
                placeholder={t('tree.copilotAsk')}
                className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none py-1.5"
              />
              {recording && <span className="w-3 h-3 rounded-full bg-red-500 animate-pulse flex-shrink-0" />}
              <button
                onClick={() => send()}
                disabled={busy || !input.trim()}
                className="w-9 h-9 flex-shrink-0 rounded-full bg-primary flex items-center justify-center text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40"
                aria-label={t('tree.copilotTitle')}
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
              <button
                onClick={() => setOpen(true)}
                className="w-9 h-9 flex-shrink-0 rounded-full border border-border/70 bg-background/60 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                title={t('tree.copilotExpand')}
                aria-label={t('tree.copilotExpand')}
              >
                <Maximize2 className="w-4 h-4" />
              </button>
            </div>

            {/* The cloud — only the latest exchanges, translucent, so ghost
                nodes forming on the canvas stay in view behind them. */}
            {/* Empty-state suggestion chips — tap to ask, no typing needed. */}
            {thread.length === 0 && !busy && (
              <div className="flex flex-wrap gap-1.5 pointer-events-auto">
                {chipList.map(c => (
                  <button
                    key={c}
                    onClick={() => send(c)}
                    className="px-3 py-1.5 rounded-full border border-border/50 bg-card/60 backdrop-blur-md text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent/70 shadow-lg transition-colors"
                  >
                    {c}
                  </button>
                ))}
              </div>
            )}

            {/* Scrollbar HIDDEN, not gutter-reserved: a bar popping in and
                out as bubbles stream shifts the right-aligned user bubbles
                sideways. The 3-bubble peek needs no visible bar — trackpad
                scrolling still works, and the full view has a real one. */}
            {(thread.length > 0 || busy) && (
              <div className="space-y-1.5 max-h-[30vh] overflow-y-auto pointer-events-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {thread.slice(-3).map((m, i) => (
                  <div key={thread.length - Math.min(3, thread.length) + i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                    <div className={cn(
                      'rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed shadow-lg backdrop-blur-md',
                      m.role === 'user'
                        ? 'max-w-[75%] bg-primary/70 text-primary-foreground rounded-br-sm whitespace-pre-wrap'
                        : 'max-w-[88%] bg-card/60 border border-border/40 text-foreground/95 rounded-bl-sm [&_p]:my-0.5 max-h-28 overflow-hidden',
                    )}>
                      {m.role === 'user' ? m.content : <MarkdownRenderer content={m.content} imageContext={`${tree.title}${tree.framing ? ` — ${tree.framing}` : ''}`} />}
                    </div>
                  </div>
                ))}
                {busy && (
                  <div className="flex items-center gap-2 text-muted-foreground text-xs px-1">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Bob…
                  </div>
                )}
                {/* Ghosts land as dashed nodes ON the canvas (approve there);
                    a one-line note keeps the cloud aware without duplicating. */}
                {ghosts.length > 0 && !busy && (
                  <p className="text-[11px] text-emerald-300/90 flex items-center gap-1.5 px-1">
                    <Sprout className="w-3 h-3" /> {t('tree.proposedN').replace('{n}', String(ghosts.length))} — {t('tree.awaitingApproval')}
                  </p>
                )}
                {/* Reshape chips — these exist ONLY here, so they must be
                    actionable from the ambient cloud. */}
                {actions.length > 0 && !busy && actions.map((a, i) => (
                  <div key={`amb-${a.nodeId}-${i}`} className="rounded-xl border border-primary/40 bg-card/90 backdrop-blur-md px-3 py-2 shadow-lg">
                    <div className="flex items-start gap-2">
                      <span className="mt-0.5"><ActionIcon type={a.type} /></span>
                      <p className="flex-1 text-[11px] font-bold text-foreground leading-snug">{actionDesc(a)}{a.type === 'edit' && a.newTitle ? ` → ${a.newTitle}` : ''}</p>
                    </div>
                    <div className="flex gap-1.5 mt-1.5">
                      <button
                        onClick={() => applyAction(a, i)}
                        disabled={actionBusy !== null}
                        className={cn(
                          'inline-flex items-center gap-1 rounded-full border text-[11px] font-medium px-2.5 py-1 transition-colors disabled:opacity-50',
                          a.type === 'delete'
                            ? 'bg-red-500/15 border-red-400/40 text-red-300 hover:bg-red-500/25'
                            : 'bg-primary/15 border-primary/40 text-primary hover:bg-primary/25',
                        )}
                      >
                        {actionBusy === i ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} {t('tree.copilotApply')}
                      </button>
                      <button
                        onClick={() => setActions(list => list.filter((_, j) => j !== i))}
                        disabled={actionBusy !== null}
                        className="inline-flex items-center justify-center rounded-full border border-border text-muted-foreground text-[11px] px-2.5 py-1 hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
                {/* Purpose refinement chip — ambient too. */}
                {purposeProposal && !busy && (
                  <div className="rounded-xl border border-emerald-400/40 bg-card/90 backdrop-blur-md px-3 py-2 shadow-lg">
                    <p className="text-[10px] font-bold text-emerald-300 uppercase tracking-wider">{t('tree.copilotPurposeTitle')}</p>
                    <p className="text-[12px] text-foreground leading-snug mt-0.5">{purposeProposal}</p>
                    <div className="flex gap-1.5 mt-1.5">
                      <button
                        onClick={applyPurpose}
                        disabled={purposeBusy}
                        className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 text-[11px] font-medium px-2.5 py-1 hover:bg-emerald-500/30 transition-colors disabled:opacity-50"
                      >
                        {purposeBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} {t('tree.copilotPurposeApply')}
                      </button>
                      <button onClick={() => setPurposeProposal(null)} className="rounded-full border border-border text-muted-foreground text-[11px] px-2.5 py-1 hover:text-foreground hover:bg-accent transition-colors">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                )}
                {note && <p className={cn('text-[11px] px-1', note.tone === 'warn' ? 'text-amber-400' : 'text-emerald-300')}>{note.text}</p>}
              </div>
            )}

          </motion.div>
        )}
      </AnimatePresence>

      {/* The fullscreen conversation — a real modal dialog (Radix: focus
          trap, aria-modal, scroll lock, Esc), animated by framer-motion. */}
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <AnimatePresence>
          {open && (
            <Dialog.Portal forceMount>
              <Dialog.Content
                asChild
                forceMount
                aria-describedby={undefined}
                // Committing/cancelling an IME composition (拼音) with Esc
                // must never collapse the conversation.
                onEscapeKeyDown={e => { if (e.isComposing) e.preventDefault() }}
                onOpenAutoFocus={e => { e.preventDefault(); setTimeout(() => inputRef.current?.focus(), 250) }}
              >
                <motion.div
                  initial={{ opacity: 0, scale: 0.985 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.985 }}
                  transition={{ duration: 0.16, ease: 'easeOut' }}
                  className="fixed inset-0 z-50 bg-background/95 backdrop-blur-xl flex flex-col"
                >
            <div className="w-full max-w-3xl mx-auto flex-1 min-h-0 flex flex-col px-4">
              {/* Header */}
              <div className="flex items-center gap-3 py-3.5 border-b border-border">
                <div className="w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0">
                  <Bot className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <Dialog.Title asChild>
                    <p className="text-sm font-bold text-foreground">{t('tree.copilotTitle')}</p>
                  </Dialog.Title>
                  <p className="text-[11px] text-muted-foreground truncate">{tree.title}</p>
                </div>
                <button
                  onClick={() => setOpen(false)}
                  className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  aria-label={t('common.dismiss')}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Thread */}
              <div className="flex-1 overflow-y-auto py-4 space-y-3.5 [scrollbar-gutter:stable]">
                {thread.length === 0 && (
                  <div className="px-1 py-3 space-y-3">
                    <p className="text-sm text-muted-foreground leading-relaxed">{t('tree.copilotHint')}</p>
                    <div className="flex flex-wrap gap-2">
                      {chipList.map(c => (
                        <button
                          key={c}
                          onClick={() => send(c)}
                          className="px-3 py-2 rounded-xl border border-border text-[13px] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                        >
                          {c}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {thread.map((m, i) => (
                  <div key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                    <div className={cn(
                      'rounded-2xl px-4 py-3 text-[15px] leading-relaxed',
                      m.role === 'user'
                        ? 'max-w-[80%] bg-primary text-primary-foreground rounded-br-sm whitespace-pre-wrap'
                        : 'max-w-[92%] bg-card border border-border text-foreground rounded-bl-sm',
                    )}>
                      {m.role === 'user' ? m.content : <MarkdownRenderer content={m.content} imageContext={`${tree.title}${tree.framing ? ` — ${tree.framing}` : ''}`} />}
                    </div>
                  </div>
                ))}
                {busy && (
                  <div className="flex items-center gap-2 text-muted-foreground text-sm px-1">
                    <Loader2 className="w-4 h-4 animate-spin" /> Bob…
                  </div>
                )}

                {/* Proposed ghosts — approvable right here (the canvas is behind us) */}
                {ghosts.length > 0 && !busy && (
                  <div className="max-w-[92%] border border-dashed border-emerald-400/40 bg-emerald-500/[0.05] rounded-2xl rounded-bl-sm px-4 py-3 space-y-2">
                    <p className="text-[11px] font-bold text-emerald-300 uppercase tracking-wider flex items-center gap-1.5">
                      <Sprout className="w-3.5 h-3.5" /> {t('tree.awaitingApproval')}
                    </p>
                    {ghosts.map(g => (
                      <div key={g.id} className="rounded-lg border border-dashed border-emerald-400/40 bg-background/60 px-3 py-2">
                        <p className="text-xs font-bold text-foreground leading-snug">{g.title}</p>
                        {g.summary && <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">{g.summary}</p>}
                        <div className="flex gap-1.5 mt-1.5">
                          <button
                            onClick={() => actGhost(g.id, 'approve')}
                            disabled={ghostBusy === g.id}
                            className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 text-[11px] font-medium px-2.5 py-1 hover:bg-emerald-500/30 transition-colors disabled:opacity-50"
                          >
                            {ghostBusy === g.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} {t('tree.addToTree')}
                          </button>
                          <button
                            onClick={() => actGhost(g.id, 'reject')}
                            disabled={ghostBusy === g.id}
                            className="inline-flex items-center justify-center rounded-full bg-red-500/15 border border-red-400/30 text-red-300 px-2.5 py-1 hover:bg-red-500/25 transition-colors disabled:opacity-50"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Reshape chips — edit / move / delete, applied one tap at a time */}
                {actions.length > 0 && !busy && (
                  <div className="max-w-[92%] border border-primary/40 bg-primary/[0.06] rounded-2xl rounded-bl-sm px-4 py-3 space-y-2">
                    <p className="text-[11px] font-bold text-primary uppercase tracking-wider">{t('tree.copilotChanges')}</p>
                    {actions.map((a, i) => (
                      <div key={`${a.nodeId}-${i}`} className="rounded-lg border border-border bg-background/60 px-3 py-2">
                        <div className="flex items-start gap-2">
                          <span className="mt-0.5"><ActionIcon type={a.type} /></span>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-bold text-foreground leading-snug">{actionDesc(a)}</p>
                            {a.type === 'edit' && a.newTitle && (
                              <p className="text-[11px] text-foreground/90 leading-snug mt-0.5">→ {a.newTitle}</p>
                            )}
                            {a.type === 'edit' && a.newSummary && (
                              <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">{a.newSummary}</p>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-1.5 mt-1.5">
                          <button
                            onClick={() => applyAction(a, i)}
                            disabled={actionBusy !== null}
                            className={cn(
                              'inline-flex items-center gap-1 rounded-full border text-[11px] font-medium px-2.5 py-1 transition-colors disabled:opacity-50',
                              a.type === 'delete'
                                ? 'bg-red-500/15 border-red-400/40 text-red-300 hover:bg-red-500/25'
                                : 'bg-primary/15 border-primary/40 text-primary hover:bg-primary/25',
                            )}
                          >
                            {actionBusy === i ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} {t('tree.copilotApply')}
                          </button>
                          <button
                            onClick={() => setActions(list => list.filter((_, j) => j !== i))}
                            disabled={actionBusy !== null}
                            className="inline-flex items-center justify-center rounded-full border border-border text-muted-foreground text-[11px] px-2.5 py-1 hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Purpose refinement — approval chip */}
                {purposeProposal && (
                  <div className="max-w-[92%] border border-emerald-400/40 bg-emerald-500/[0.08] rounded-2xl rounded-bl-sm px-4 py-3 space-y-2">
                    <p className="text-[11px] font-bold text-emerald-300 uppercase tracking-wider">{t('tree.copilotPurposeTitle')}</p>
                    <p className="text-sm text-foreground leading-relaxed">{purposeProposal}</p>
                    <div className="flex gap-2">
                      <button
                        onClick={applyPurpose}
                        disabled={purposeBusy}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 text-xs font-medium hover:bg-emerald-500/30 transition-colors disabled:opacity-50"
                      >
                        {purposeBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                        {t('tree.copilotPurposeApply')}
                      </button>
                      <button onClick={() => setPurposeProposal(null)} className="px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                        {t('common.dismiss')}
                      </button>
                    </div>
                  </div>
                )}
                <div ref={endRef} />
              </div>

              {/* Input dock — the SOTA multimodal capture row + text */}
              <div className="border-t border-border py-2.5 space-y-1.5 pb-[max(0.625rem,env(safe-area-inset-bottom))]">
                {note && <p className={cn('text-[11px]', note.tone === 'warn' ? 'text-amber-400' : 'text-emerald-300')}>{note.text}</p>}
                <AttachmentTray attachments={attachments} note={attachNote} onRemove={removeAt} />
                <CaptureControls addFiles={addFiles} recording={recording} toggleRecord={toggleRecord} />
                <div className="flex items-end gap-1.5">
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => {
                      // isComposing: Enter that commits an IME candidate (拼音)
                      // must never send the half-composed message.
                      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send() }
                    }}
                    rows={1}
                    placeholder={t('tree.copilotPlaceholder')}
                    className="flex-1 bg-background border border-border rounded-2xl px-4 py-3 text-[15px] text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/60 transition-all h-12 min-h-[48px] max-h-[140px]"
                  />
                  <button
                    onClick={() => send()}
                    disabled={busy || (!input.trim() && attachments.length === 0)}
                    className="w-11 h-11 flex-shrink-0 rounded-xl bg-primary flex items-center justify-center text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40"
                  >
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>
                </motion.div>
              </Dialog.Content>
            </Dialog.Portal>
          )}
        </AnimatePresence>
      </Dialog.Root>
    </>
  )
}
