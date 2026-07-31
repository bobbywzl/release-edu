'use client'
/**
 * GROW BRANCH — the workspace's growth affordance (FOUNDATION: the tree
 * grows small-to-big through the learner's own questions).
 *
 * A conversational dialog anchored to the CURRENT node: the student asks
 * what they don't understand, Bob replies and proposes 1-4 child nodes as
 * pending ghosts (persisted server-side by /api/tree/[id]/expand), and
 * NOTHING joins the tree until the student taps Add — approved children
 * attach under this node, never the root. Follow-up turns refine the same
 * ghost set (replaceIds), exactly the grow-box conversation the engine's
 * proposeExpansion was built for.
 *
 * Opened from the workspace header ("Grow branch") or from any chat turn /
 * checkpoint ("Grow this into a branch"), which seeds the question box with
 * that turn's text.
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Sprout, X, Check, Send, Loader2 } from 'lucide-react'
import { useLanguage } from '@/lib/i18n'
import { cn } from '@/lib/utils'

interface GhostProposal { id: string; title: string; summary: string }
interface Turn { role: 'user' | 'assistant'; content: string }

export function GrowBranchDialog({ treeId, nodeId, nodeTitle, seedQuestion, onClose, onGrown }: {
  treeId: string
  nodeId: string
  nodeTitle: string
  /** Pre-filled (editable) question — the chat turn the student grew from. */
  seedQuestion?: string
  onClose: () => void
  /** Called after a ghost is approved so the caller can refresh the tree. */
  onGrown: () => void
}) {
  const { t, language } = useLanguage()
  const [input, setInput] = useState(seedQuestion ?? '')
  const [thread, setThread] = useState<Turn[]>([])
  const [proposals, setProposals] = useState<GhostProposal[]>([])
  const [busy, setBusy] = useState(false)
  const [ghostBusy, setGhostBusy] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [thread, proposals, busy])
  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 150) }, [])
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  async function send() {
    const q = input.trim()
    if (!q || busy) return
    setBusy(true)
    setFailed(false)
    setInput('')
    const nextThread: Turn[] = [...thread, { role: 'user', content: q }]
    setThread(nextThread)
    try {
      const res = await fetch(`/api/tree/${treeId}/expand`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodeId, question: q, lang: language,
          history: thread, replaceIds: proposals.map(p => p.id),
        }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok || !body) throw new Error('expand failed')
      const reply = typeof body.reply === 'string' && body.reply.trim() ? body.reply.trim() : (typeof body.clarify === 'string' ? body.clarify : '')
      if (reply) setThread(t2 => [...t2, { role: 'assistant', content: reply }])
      const list = Array.isArray(body.proposals) ? (body.proposals as Array<{ id?: string; title?: string; summary?: string }>) : []
      if (list.length > 0) {
        setProposals(list.filter(p => p?.id).map(p => ({ id: p.id as string, title: p.title ?? '', summary: p.summary ?? '' })))
      }
      // New ghosts also appear on the canvas — let the tree refresh behind us.
      onGrown()
    } catch {
      setFailed(true)
      setThread(t2 => [...t2, { role: 'assistant', content: t('tree.proposeFailed') }])
    } finally {
      setBusy(false)
    }
  }

  async function actGhost(ghostId: string, action: 'approve' | 'reject') {
    if (ghostBusy) return
    setGhostBusy(ghostId)
    try {
      const res = await fetch(`/api/tree/${treeId}/node/${ghostId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      // 4xx = the ghost was already handled/replaced — retire the chip.
      if (res.ok || (res.status >= 400 && res.status < 500)) {
        setProposals(list => list.filter(p => p.id !== ghostId))
        onGrown()
      }
    } catch { /* keep the chip for retry */ } finally {
      setGhostBusy(null)
    }
  }

  if (typeof document === 'undefined') return null
  return createPortal(
    <div className="fixed inset-0 z-[150] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-xl max-h-[85vh] flex flex-col bg-card border border-border rounded-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border flex-shrink-0">
          <Sprout className="w-4 h-4 text-emerald-400 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-foreground truncate">{t('workspace.growTitle').replace('{node}', nodeTitle)}</p>
            <p className="text-[11px] text-muted-foreground truncate">{t('workspace.growSub')}</p>
          </div>
          <button onClick={onClose} aria-label={t('common.dismiss')} className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex-shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5 min-h-[120px]">
          {thread.length === 0 && !busy && (
            <p className="text-xs text-muted-foreground leading-relaxed py-2">{t('workspace.growHint')}</p>
          )}
          {thread.map((m, i) => (
            <div key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
              <div className={cn(
                'rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed whitespace-pre-wrap',
                m.role === 'user' ? 'max-w-[80%] bg-primary text-primary-foreground rounded-br-sm' : 'max-w-[90%] bg-background border border-border text-foreground/95 rounded-bl-sm',
              )}>
                {m.content}
              </div>
            </div>
          ))}
          {busy && (
            <div className="flex items-center gap-2 text-muted-foreground text-xs px-1">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Bob…
            </div>
          )}
          {proposals.length > 0 && !busy && (
            <div className="border border-dashed border-emerald-400/40 bg-emerald-500/[0.05] rounded-xl px-3 py-2.5 space-y-2">
              <p className="text-[10px] font-bold text-emerald-300 uppercase tracking-wider flex items-center gap-1.5">
                <Sprout className="w-3 h-3" /> {t('tree.awaitingApproval')}
              </p>
              {proposals.map(g => (
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
              <p className="text-[10px] text-muted-foreground">{t('workspace.growAttachNote').replace('{node}', nodeTitle)}</p>
            </div>
          )}
          {failed && !busy && <p className="text-[11px] text-amber-400">{t('tree.proposeFailed')}</p>}
          <div ref={endRef} />
        </div>

        <div className="border-t border-border p-3 flex items-end gap-2 flex-shrink-0">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send() }
            }}
            rows={2}
            placeholder={t('workspace.growPlaceholder')}
            className="flex-1 bg-background border border-border rounded-xl px-3 py-2.5 text-[13px] text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
          <button
            onClick={send}
            disabled={busy || !input.trim()}
            className="w-10 h-10 flex-shrink-0 rounded-xl bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 flex items-center justify-center hover:bg-emerald-500/30 transition-colors disabled:opacity-40"
            aria-label={t('workspace.growBranch')}
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
