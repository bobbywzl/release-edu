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
 * Shell: a single floating bubble (Spotlight-style — just the orb) that
 * expands into a FULLSCREEN conversation when talked to; Esc or ✕ collapses
 * it back to the bubble.
 */
import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Bot, X, Check, Send, Loader2, Sprout, Pencil, MoveRight, Trash2,
} from 'lucide-react'
import { MarkdownRenderer } from '@/components/markdown-renderer'
import { useAttachments, CaptureControls, AttachmentTray, attachmentLabel } from '@/components/multimodal-input'
import { useLanguage } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import type { CopilotAction } from '@/lib/tree-engine'

interface CopilotTree { id: string; title: string; framing: string | null }
interface GhostChip { id: string; title: string; summary: string }

export function TreeCopilot({ tree, onChanged, fit }: {
  tree: CopilotTree
  onChanged: () => Promise<void> | void
  fit: () => void
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
  const [note, setNote] = useState<string | null>(null)
  const {
    attachments, note: attachNote, recording,
    addFiles, toggleRecord, removeAt, clear: clearAttachments,
  } = useAttachments()
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { if (open) endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [thread, busy, open])
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 250) }, [open])

  // Esc collapses back to the bubble (a live mic keeps recording so a stray
  // Esc can't eat a voice note — the bubble state persists everything).
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // Rehydrate the persisted thread on first open.
  useEffect(() => {
    if (!open || loaded) return
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
  }, [open, loaded, tree.id])

  async function send() {
    const msg = input.trim()
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
        setNote(t('tree.proposedN').replace('{n}', String(proposals.length)))
      }
      // Reshape chips are per-turn: the latest turn's set is the live one.
      setActions(Array.isArray(body.actions) ? (body.actions as CopilotAction[]) : [])
      if (typeof body.purposeUpdate === 'string' && body.purposeUpdate.trim()) {
        setPurposeProposal(body.purposeUpdate.trim())
      }
      await onChanged()
      if (proposals.length > 0) setTimeout(fit, 150)
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
        if (action === 'approve') setTimeout(fit, 150)
      } else {
        setNote(t('tree.actionFailed'))
      }
    } catch {
      setNote(t('tree.actionFailed'))
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
          : { action: 'delete' }
      const res = await fetch(`/api/tree/${tree.id}/node/${a.nodeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (res.ok) {
        setActions(list => list.filter((_, i) => i !== idx))
        setNote(t('tree.copilotApplied'))
        await onChanged()
        setTimeout(fit, 150)
      } else {
        setNote(t('tree.actionFailed'))
      }
    } catch {
      setNote(t('tree.actionFailed'))
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
        setNote(t('tree.actionFailed'))
      }
    } catch {
      setNote(t('tree.actionFailed'))
    } finally {
      setPurposeBusy(false)
    }
  }

  const actionDesc = (a: CopilotAction): string => {
    if (a.type === 'edit') return t('tree.actEditDesc').replace('{a}', a.title)
    if (a.type === 'move') return t('tree.actMoveDesc').replace('{a}', a.title).replace('{b}', a.newParentTitle ?? '')
    return t('tree.actDeleteDesc').replace('{a}', a.title)
  }
  const ActionIcon = ({ type }: { type: CopilotAction['type'] }) =>
    type === 'edit' ? <Pencil className="w-3.5 h-3.5 text-sky-300 flex-shrink-0" />
      : type === 'move' ? <MoveRight className="w-3.5 h-3.5 text-violet-300 flex-shrink-0" />
        : <Trash2 className="w-3.5 h-3.5 text-red-300 flex-shrink-0" />

  return (
    <>
      {/* The bubble — a single floating orb, Spotlight-style */}
      <AnimatePresence>
        {!open && (
          <motion.button
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            onClick={() => setOpen(true)}
            className="fixed bottom-5 right-5 z-40 w-14 h-14 rounded-full bg-primary text-primary-foreground shadow-xl shadow-primary/25 ring-1 ring-primary/50 flex items-center justify-center hover:scale-105 transition-transform"
            title={t('tree.copilotTitle')}
            aria-label={t('tree.copilotTitle')}
          >
            <Bot className="w-6 h-6" />
            {recording && <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-red-500 animate-pulse" />}
          </motion.button>
        )}
      </AnimatePresence>

      {/* The fullscreen conversation */}
      <AnimatePresence>
        {open && (
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
                  <p className="text-sm font-bold text-foreground">{t('tree.copilotTitle')}</p>
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
              <div className="flex-1 overflow-y-auto py-4 space-y-3.5">
                {thread.length === 0 && (
                  <p className="text-sm text-muted-foreground leading-relaxed px-1 py-3">{t('tree.copilotHint')}</p>
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
                {note && <p className="text-[11px] text-emerald-300">{note}</p>}
                <AttachmentTray attachments={attachments} note={attachNote} onRemove={removeAt} />
                <CaptureControls addFiles={addFiles} recording={recording} toggleRecord={toggleRecord} />
                <div className="flex items-end gap-1.5">
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                    rows={1}
                    placeholder={t('tree.copilotPlaceholder')}
                    className="flex-1 bg-background border border-border rounded-2xl px-4 py-3 text-[15px] text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/60 transition-all h-12 min-h-[48px] max-h-[140px]"
                  />
                  <button
                    onClick={send}
                    disabled={busy || (!input.trim() && attachments.length === 0)}
                    className="w-11 h-11 flex-shrink-0 rounded-xl bg-primary flex items-center justify-center text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40"
                  >
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
