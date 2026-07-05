'use client'
/**
 * Workspace — the per-node work area. Retains the Bob chat look (bubbles,
 * streaming, markdown, input bar) with a formal NOTES panel alongside:
 * the node's retained knowledge (explainer + your annotations), its context
 * in the tree, verification state, and files from previous sessions — all
 * scoped to the node you're working on.
 */
import { useState, useEffect, useCallback, useRef, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { motion } from 'framer-motion'
import {
  Bot, Send, ArrowLeft, ShieldCheck, Loader2, StickyNote, Paperclip,
  Sprout, X, FileText, PanelRightOpen, PanelRightClose,
} from 'lucide-react'
import { MarkdownRenderer } from '@/components/markdown-renderer'
import { HighlightableText } from '@/components/highlightable-text'
import { useHighlights } from '@/lib/highlights'
import { useLanguage } from '@/lib/i18n'
import { cn } from '@/lib/utils'

interface Msg { id: string; role: 'user' | 'assistant'; content: string }
interface NodeData {
  id: string; parentId: string | null; kind: string; title: string; summary: string
  explainer: string | null; status: string; annotations: string | null; notes: string | null
}
interface TreeData { id: string; title: string; framing: string | null; nodes: NodeData[] }
interface NodeFileRow { id: string; name: string; type?: string | null }

let tempId = 0

function WorkspaceInner() {
  const search = useSearchParams()
  const router = useRouter()
  const { t, language } = useLanguage()
  const treeId = search.get('tree')
  const nodeId = search.get('node')

  const [tree, setTree] = useState<TreeData | null>(null)
  const [messages, setMessages] = useState<Msg[]>([])
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [streamText, setStreamText] = useState('')
  const [showNotes, setShowNotes] = useState(true)
  const [panelTab, setPanelTab] = useState<'notes' | 'annotations' | 'files'>('notes')
  const [explainerLoading, setExplainerLoading] = useState(false)
  const [notesDraft, setNotesDraft] = useState<string | null>(null)
  const [notesSaved, setNotesSaved] = useState(false)
  const [files, setFiles] = useState<NodeFileRow[]>([])
  const [verify, setVerify] = useState<null | { phase: 'loading' | 'answering' | 'judging' | 'done'; questions?: string[]; answers?: string[]; confidences?: Array<'sure' | 'unsure'>; passed?: boolean; feedback?: string }>(null)
  // Discovery card from Bob's contextual pre-pass ([[TREE_SUGGEST]] marker).
  const [suggestion, setSuggestion] = useState<null | { type: 'add'; title: string; summary: string } | { type: 'move'; nodeId: string; title: string }>(null)
  const [suggestionBusy, setSuggestionBusy] = useState(false)
  // Grow-branch box (also available here, not just on the canvas).
  const [growQ, setGrowQ] = useState('')
  const [growBusy, setGrowBusy] = useState(false)
  const [growClarify, setGrowClarify] = useState<string | null>(null)
  const [growDone, setGrowDone] = useState<number | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Annotations come from HIGHLIGHTS made directly on the conversation —
  // select any text in Bob's messages, pick a color, attach a comment
  // (the Release EDU annotation system, running on this node's chat).
  const { highlights, addHighlight, updateHighlight, deleteHighlight } = useHighlights(conversationId)

  const node = tree?.nodes.find(n => n.id === nodeId) ?? null

  const loadTree = useCallback(async () => {
    if (!treeId) return
    try {
      const res = await fetch(`/api/tree/${treeId}`, { cache: 'no-store' })
      if (res.ok) setTree((await res.json()).tree)
    } catch { /* transient */ }
  }, [treeId])
  useEffect(() => { loadTree() }, [loadTree])

  useEffect(() => {
    if (!treeId || !nodeId) return
    let cancelled = false
    fetch(`/api/tree/${treeId}/node/${nodeId}/chat`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (cancelled || !d?.messages) return
        setMessages(d.messages)
        setConversationId(d.conversationId ?? null)
        // First visit to this node: Bob opens with a condensed syllabus-style
        // hook — the concept, where it sits in the tree, and why it matters
        // to the root problem. Triggered once; the saved reply prevents re-runs.
        if (d.messages.length === 0) void streamFromBob('[NODE_INTRO]', false)
      })
      .catch(() => {})
    fetch(`/api/files/upload?workType=tree-node&workId=${nodeId}`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d?.files) setFiles(d.files) })
      .catch(() => {})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treeId, nodeId])

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, streamText])

  // Fresh node → fresh panel state (draft notes belong to one node only).
  useEffect(() => { setNotesDraft(null); setPanelTab('notes'); setMessages([]); setSuggestion(null); setGrowQ(''); setGrowClarify(null); setGrowDone(null) }, [nodeId])

  // Stream one Bob turn. showUser=false is used for the [NODE_INTRO]
  // first-open trigger — Bob speaks without a student bubble appearing.
  async function streamFromBob(text: string, showUser: boolean) {
    if (streaming || !treeId || !nodeId) return
    if (showUser) setMessages(prev => [...prev, { id: `t-${tempId++}`, role: 'user', content: text }])
    setStreaming(true)
    setStreamText('')
    try {
      abortRef.current = new AbortController()
      const res = await fetch(`/api/tree/${treeId}/node/${nodeId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortRef.current.signal,
        body: JSON.stringify({ message: text, lang: language }),
      })
      if (!res.ok || !res.body) throw new Error('stream error')
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let full = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        full += decoder.decode(value, { stream: true })
        setStreamText(full)
      }
      // Discovery marker rides at the end of the stream — strip it from the
      // visible message and surface it as an approve/dismiss card.
      const markerIdx = full.indexOf('[[TREE_SUGGEST]]')
      if (markerIdx !== -1) {
        try { setSuggestion(JSON.parse(full.slice(markerIdx + 16))) } catch { /* malformed — ignore */ }
        full = full.slice(0, markerIdx).trimEnd()
      }
      setMessages(prev => [...prev, { id: `t-${tempId++}`, role: 'assistant', content: full }])
      // Swap temp ids for persisted ids so text in this turn is highlightable.
      setTimeout(() => {
        fetch(`/api/tree/${treeId}/node/${nodeId}/chat`, { cache: 'no-store' })
          .then(r => (r.ok ? r.json() : null))
          .then(d => { if (d?.messages?.length) { setMessages(d.messages); setConversationId(d.conversationId ?? null) } })
          .catch(() => {})
      }, 600)
    } catch {
      if (showUser) setMessages(prev => [...prev, { id: `t-${tempId++}`, role: 'assistant', content: t('workspace.connectError') }])
    } finally {
      setStreaming(false)
      setStreamText('')
    }
  }

  async function send() {
    const text = input.trim()
    if (!text) return
    setInput('')
    await streamFromBob(text, true)
  }

  async function ensureExplainer() {
    if (!treeId || !nodeId || node?.explainer || explainerLoading) return
    setExplainerLoading(true)
    try {
      await fetch(`/api/tree/${treeId}/node/${nodeId}/explainer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lang: language }),
      })
      await loadTree()
    } finally {
      setExplainerLoading(false)
    }
  }

  async function saveNotes() {
    if (notesDraft === null || !treeId || !nodeId) return
    await fetch(`/api/tree/${treeId}/node/${nodeId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'notes', text: notesDraft }),
    }).catch(() => {})
    setNotesSaved(true)
    setTimeout(() => setNotesSaved(false), 1500)
    loadTree()
  }


  async function uploadEvidence(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !nodeId) return
    if (fileInputRef.current) fileInputRef.current.value = ''
    const isImage = file.type.startsWith('image/')
    const content: string = await new Promise(resolve => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result ?? ''))
      if (isImage) reader.readAsDataURL(file)
      else reader.readAsText(file)
    })
    await fetch('/api/files/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workType: 'tree-node', workId: nodeId, name: file.name, type: file.type || 'text/plain', content: content.slice(0, 1_500_000) }),
    }).catch(() => {})
    fetch(`/api/files/upload?workType=tree-node&workId=${nodeId}`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d?.files) setFiles(d.files) })
      .catch(() => {})
  }

  async function approveSuggestion() {
    if (!suggestion || suggestion.type !== 'add' || !treeId || !nodeId || suggestionBusy) return
    setSuggestionBusy(true)
    try {
      await fetch(`/api/tree/${treeId}/node/${nodeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add_child', title: suggestion.title, summary: suggestion.summary }),
      })
      setSuggestion(null)
      loadTree()
    } finally {
      setSuggestionBusy(false)
    }
  }

  async function growFromWorkspace() {
    const q = growQ.trim()
    if (!q || growBusy || !treeId || !nodeId) return
    setGrowBusy(true)
    setGrowClarify(null)
    setGrowDone(null)
    try {
      const res = await fetch(`/api/tree/${treeId}/expand`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId, question: q, lang: language }),
      })
      const body = await res.json().catch(() => ({}))
      if (body.clarify) setGrowClarify(body.clarify)
      else if (Array.isArray(body.proposals)) { setGrowDone(body.proposals.length); setGrowQ('') }
    } finally {
      setGrowBusy(false)
    }
  }

  async function startVerify() {
    if (!treeId || !nodeId) return
    setVerify({ phase: 'loading' })
    try {
      const res = await fetch(`/api/tree/${treeId}/node/${nodeId}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phase: 'start', lang: language }),
      })
      const body = await res.json()
      if (!res.ok || !body.questions) throw new Error()
      setVerify({ phase: 'answering', questions: body.questions, answers: body.questions.map(() => ''), confidences: body.questions.map(() => 'sure' as const) })
    } catch {
      setVerify(null)
    }
  }

  async function submitVerify() {
    if (!verify?.questions || !treeId || !nodeId) return
    setVerify(v => v ? { ...v, phase: 'judging' } : v)
    try {
      const res = await fetch(`/api/tree/${treeId}/node/${nodeId}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phase: 'judge', questions: verify.questions, answers: verify.answers, confidences: verify.confidences, lang: language }),
      })
      const body = await res.json()
      setVerify(v => v ? { ...v, phase: 'done', passed: !!body.passed, feedback: body.feedback ?? '' } : v)
      if (body.passed && body.passed === true) {
        import('@/components/xp-toast').then(m => m.emitXpAwards([{ awarded: 20, label: 'Objective Mastered', levelUp: false, newLevel: 0 }])).catch(() => {})
      }
      loadTree()
    } catch {
      setVerify(null)
    }
  }

  if (!treeId || !nodeId) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 p-8 text-center">
        <Sprout className="w-8 h-8 text-emerald-400" />
        <p className="text-sm text-muted-foreground max-w-sm">{t('workspace.pickNode')}</p>
        <button onClick={() => router.push('/dashboard/tree')} className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
          {t('workspace.goToTree')}
        </button>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header — Bob chat style */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border bg-card/50 backdrop-blur-sm">
        <Link href={`/dashboard/tree/${treeId}`} className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="w-7 h-7 rounded-lg bg-primary/15 flex items-center justify-center flex-shrink-0">
          <Bot className="w-4 h-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-foreground truncate">{node?.title ?? '…'}</p>
          <p className="text-[11px] text-muted-foreground truncate">{tree?.title}</p>
        </div>
        {node?.status === 'understood' ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400 flex-shrink-0">
            <ShieldCheck className="w-4 h-4" /> {t('tree.verified')}
          </span>
        ) : (
          <button
            onClick={startVerify}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-400/40 bg-emerald-500/10 text-emerald-300 text-xs font-medium hover:bg-emerald-500/20 transition-colors flex-shrink-0"
          >
            <ShieldCheck className="w-3.5 h-3.5" /> {t('workspace.verify')}
          </button>
        )}
        <button
          onClick={() => setShowNotes(s => !s)}
          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex-shrink-0"
          title={t('workspace.notes')}
        >
          {showNotes ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
        </button>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* Chat column — retains the Bob chat look */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 && !streaming && (
              <div className="text-center py-10 space-y-2">
                <Bot className="w-8 h-8 text-primary mx-auto" />
                <p className="text-sm text-muted-foreground max-w-md mx-auto">{t('workspace.emptyHint')}</p>
              </div>
            )}
            {messages.map(m => (
              <motion.div
                key={m.id}
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}
              >
                <div className={cn(
                  'rounded-2xl px-4 py-3 text-[15px] leading-relaxed',
                  m.role === 'user'
                    ? 'max-w-[80%] bg-primary text-primary-foreground rounded-br-sm whitespace-pre-wrap'
                    : 'max-w-[92%] bg-card border border-border text-foreground rounded-bl-sm',
                )}>
                  {m.role === 'user' ? m.content : (
                    <HighlightableText
                      messageId={m.id}
                      highlights={highlights}
                      onAddHighlight={addHighlight}
                      onUpdateHighlight={updateHighlight}
                      onDeleteHighlight={deleteHighlight}
                    >
                      <MarkdownRenderer content={m.content} />
                    </HighlightableText>
                  )}
                </div>
              </motion.div>
            ))}
            {streaming && streamText && (
              <div className="flex justify-start">
                <div className="max-w-[92%] rounded-2xl rounded-bl-sm px-4 py-3 bg-card border border-border text-foreground text-[15px] leading-relaxed">
                  <MarkdownRenderer content={streamText.split('[[TREE_SUGGEST]]')[0]} />
                  <span className="inline-block w-0.5 h-4 bg-primary animate-pulse rounded-full align-middle ml-0.5" />
                </div>
              </div>
            )}
            {streaming && !streamText && (
              <div className="flex items-center gap-2 text-muted-foreground text-sm px-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Bob…
              </div>
            )}

            {/* Discovery card — Bob found a hole worth a new node, or the
                discussion belongs elsewhere. Nothing happens without a click. */}
            {suggestion && (
              <motion.div
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                className="max-w-[92%] border border-emerald-400/40 bg-emerald-500/[0.08] rounded-2xl rounded-bl-sm px-4 py-3"
              >
                {suggestion.type === 'add' ? (
                  <>
                    <p className="text-xs font-bold text-emerald-300 uppercase tracking-wider flex items-center gap-1.5">
                      <Sprout className="w-3.5 h-3.5" /> {t('workspace.suggestAddTitle')}
                    </p>
                    <p className="text-sm font-bold text-foreground mt-1.5">{suggestion.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{suggestion.summary}</p>
                    <div className="flex gap-2 mt-2.5">
                      <button
                        onClick={approveSuggestion}
                        disabled={suggestionBusy}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 text-xs font-medium hover:bg-emerald-500/30 transition-colors disabled:opacity-50"
                      >
                        {suggestionBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sprout className="w-3 h-3" />}
                        {t('workspace.suggestAdd')}
                      </button>
                      <button
                        onClick={() => setSuggestion(null)}
                        className="px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                      >
                        {t('workspace.suggestDismiss')}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-xs font-bold text-emerald-300 uppercase tracking-wider">{t('workspace.suggestMoveTitle')}</p>
                    <p className="text-sm font-bold text-foreground mt-1.5">{suggestion.title}</p>
                    <div className="flex gap-2 mt-2.5">
                      <button
                        onClick={() => { const target = suggestion; setSuggestion(null); router.push(`/dashboard/workspace?tree=${treeId}&node=${target.nodeId}`) }}
                        className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
                      >
                        {t('workspace.suggestGo')}
                      </button>
                      <button
                        onClick={() => setSuggestion(null)}
                        className="px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                      >
                        {t('workspace.suggestDismiss')}
                      </button>
                    </div>
                  </>
                )}
              </motion.div>
            )}
            <div ref={endRef} />
          </div>

          {/* Input bar — same visual language as the Bob chat */}
          <div className="p-3 lg:p-4 border-t border-border bg-card/50 backdrop-blur-sm">
            <div className="flex items-end gap-2 max-w-3xl mx-auto w-full">
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                placeholder={t('workspace.placeholder')}
                rows={1}
                className="flex-1 bg-background border border-border rounded-2xl px-4 py-3 text-[15px] text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/60 transition-all h-12 min-h-[48px] max-h-[140px]"
              />
              {streaming ? (
                <button
                  onClick={() => abortRef.current?.abort()}
                  className="w-11 h-11 flex-shrink-0 rounded-xl bg-primary flex items-center justify-center text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  <div className="w-3 h-3 rounded-[2px] bg-primary-foreground" />
                </button>
              ) : (
                <button
                  onClick={send}
                  disabled={!input.trim()}
                  className="w-11 h-11 flex-shrink-0 rounded-xl bg-primary flex items-center justify-center text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40"
                >
                  <Send className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Formal notes panel — retained knowledge above Notes/Annotations/Files tabs */}
        {showNotes && (
          <div className="w-96 flex-shrink-0 border-l border-border bg-card/40 overflow-y-auto">
            <div className="p-4 space-y-4">
              <div>
                <h3 className="text-xs font-bold text-foreground uppercase tracking-wider flex items-center gap-1.5 mb-2">
                  <StickyNote className="w-3.5 h-3.5 text-primary" /> {t('workspace.retainedKnowledge')}
                </h3>
                {node?.explainer ? (
                  <div className="text-[13px] leading-relaxed border border-border rounded-xl p-3 bg-background/50 max-h-72 overflow-y-auto">
                    <MarkdownRenderer content={node.explainer} />
                  </div>
                ) : (
                  <button
                    onClick={ensureExplainer}
                    disabled={explainerLoading}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-primary/40 bg-primary/10 text-primary text-xs font-medium py-2.5 hover:bg-primary/20 transition-colors disabled:opacity-50"
                  >
                    {explainerLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
                    {explainerLoading ? t('workspace.explainerLoading') : t('workspace.generateExplainer')}
                  </button>
                )}
              </div>

              {/* Grow this branch — also available here, not just on the canvas */}
              <div className="border border-emerald-400/30 rounded-xl p-3 space-y-2 bg-emerald-500/[0.04]">
                <p className="text-xs font-bold text-foreground flex items-center gap-1.5">
                  <Sprout className="w-3.5 h-3.5 text-emerald-400" /> {t('tree.growBranch')}
                </p>
                <textarea
                  value={growQ}
                  onChange={e => setGrowQ(e.target.value)}
                  placeholder={t('tree.growPlaceholder')}
                  rows={2}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary/40"
                />
                {growClarify && (
                  <p className="text-[11px] text-amber-300 leading-snug"><span className="font-bold">{t('tree.clarifyLabel')}</span> {growClarify}</p>
                )}
                {growDone !== null && (
                  <Link href={`/dashboard/tree/${treeId}`} className="block text-[11px] text-emerald-300 hover:underline">
                    {t('workspace.growProposed').replace('{n}', String(growDone))}
                  </Link>
                )}
                <button
                  onClick={growFromWorkspace}
                  disabled={!growQ.trim() || growBusy}
                  className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-500/15 border border-emerald-400/40 text-emerald-300 text-xs font-medium py-2 hover:bg-emerald-500/25 transition-colors disabled:opacity-40"
                >
                  {growBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sprout className="w-3.5 h-3.5" />}
                  {growBusy ? t('tree.proposing') : t('tree.propose')}
                </button>
              </div>

              {/* Tabs: Notes (editable) · Annotations · Files — all retained per node */}
              <div className="flex gap-1 border-b border-border">
                {(['notes', 'annotations', 'files'] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setPanelTab(tab)}
                    className={cn(
                      'px-3 py-1.5 text-xs font-medium rounded-t-lg transition-colors -mb-px border-b-2',
                      panelTab === tab
                        ? 'text-primary border-primary'
                        : 'text-muted-foreground border-transparent hover:text-foreground',
                    )}
                  >
                    {tab === 'notes' ? t('workspace.tabNotes') : tab === 'annotations' ? t('workspace.annotations') : t('workspace.files')}
                    {tab === 'files' && files.length > 0 ? ` (${files.length})` : ''}
                  </button>
                ))}
              </div>

              {panelTab === 'notes' && (
                <div className="space-y-2">
                  <textarea
                    value={notesDraft ?? node?.notes ?? ''}
                    onChange={e => setNotesDraft(e.target.value)}
                    placeholder={t('workspace.notesPlaceholder')}
                    rows={10}
                    className="w-full text-xs leading-relaxed bg-background border border-border rounded-xl px-3 py-2.5 text-foreground placeholder:text-muted-foreground resize-y focus:outline-none focus:ring-1 focus:ring-primary/40"
                  />
                  <button
                    onClick={saveNotes}
                    disabled={notesDraft === null}
                    className="w-full rounded-lg bg-primary/10 border border-primary/40 text-primary text-xs font-medium py-2 hover:bg-primary/20 transition-colors disabled:opacity-40"
                  >
                    {notesSaved ? t('workspace.notesSaved') : t('workspace.notesSave')}
                  </button>
                </div>
              )}

              {panelTab === 'annotations' && (
                <div>
                  <p className="text-[11px] text-muted-foreground leading-snug mb-2">{t('workspace.annotationsHint')}</p>
                  <div className="space-y-1.5">
                    {highlights.length === 0 && <p className="text-[11px] text-muted-foreground">{t('workspace.noAnnotations')}</p>}
                    {highlights.map(h => (
                      <div
                        key={h.id}
                        className="text-xs border-l-2 rounded-r-md px-2.5 py-1.5 bg-background/60 group/hl"
                        style={{ borderColor: { amber: '#FBBF24', blue: '#60A5FA', green: '#34D399', purple: '#A78BFA' }[h.color] ?? '#FBBF24' }}
                      >
                        <p className="text-foreground/90 italic">&ldquo;{h.selectedText.slice(0, 140)}{h.selectedText.length > 140 ? '…' : ''}&rdquo;</p>
                        {h.comment && <p className="text-foreground mt-1 font-medium">💬 {h.comment}</p>}
                        <div className="flex items-center justify-between mt-0.5">
                          <span className="text-[10px] text-muted-foreground/60">{new Date(h.createdAt).toLocaleDateString()}</span>
                          <button
                            onClick={() => deleteHighlight(h.id)}
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

              {panelTab === 'files' && (
                <div>
                  <div className="space-y-1.5 mb-2">
                    {files.length === 0 && <p className="text-[11px] text-muted-foreground">{t('workspace.noFiles')}</p>}
                    {files.map(f => (
                      <div key={f.id} className="flex items-center gap-2 text-xs text-foreground border border-border rounded-lg px-2.5 py-2">
                        <FileText className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                        <span className="truncate">{f.name}</span>
                      </div>
                    ))}
                  </div>
                  <input ref={fileInputRef} type="file" onChange={uploadEvidence} className="hidden" />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-accent text-xs py-2 transition-colors"
                  >
                    <Paperclip className="w-3.5 h-3.5" /> {t('workspace.uploadEvidence')}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Verification modal — the Differentiator probe */}
      {verify && (
        <div className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-overlay-in">
          <div className="w-full max-w-lg bg-card border border-border rounded-2xl p-5 animate-modal-in space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" /> {t('workspace.verifyTitle')}
              </h3>
              <button onClick={() => setVerify(null)} className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            {verify.phase === 'loading' && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
                <Loader2 className="w-4 h-4 animate-spin" /> {t('workspace.verifyPreparing')}
              </div>
            )}
            {(verify.phase === 'answering' || verify.phase === 'judging') && verify.questions && (
              <>
                {verify.questions.map((q, i) => (
                  <div key={i} className="space-y-1.5">
                    <p className="text-sm text-foreground font-medium">{i + 1}. {q}</p>
                    <textarea
                      value={verify.answers?.[i] ?? ''}
                      onChange={e => setVerify(v => v ? { ...v, answers: v.answers?.map((a, j) => j === i ? e.target.value : a) } : v)}
                      rows={3}
                      disabled={verify.phase === 'judging'}
                      className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary/40 disabled:opacity-60"
                    />
                    {/* Metacognitive calibration — confident-wrong answers get
                        the hypercorrection treatment from the judge. */}
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-muted-foreground">{t('workspace.confidenceLabel')}</span>
                      {(['sure', 'unsure'] as const).map(c => (
                        <button
                          key={c}
                          type="button"
                          disabled={verify.phase === 'judging'}
                          onClick={() => setVerify(v => v ? { ...v, confidences: v.confidences?.map((x, j) => j === i ? c : x) } : v)}
                          className={cn(
                            'px-2 py-0.5 rounded-full text-[11px] border transition-colors',
                            verify.confidences?.[i] === c
                              ? 'border-primary/60 bg-primary/15 text-primary'
                              : 'border-border text-muted-foreground hover:text-foreground',
                          )}
                        >
                          {c === 'sure' ? t('workspace.confSure') : t('workspace.confUnsure')}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                <button
                  onClick={submitVerify}
                  disabled={verify.phase === 'judging' || verify.answers?.some(a => !a.trim())}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 text-white text-sm font-medium py-2.5 hover:bg-emerald-500 transition-colors disabled:opacity-40"
                >
                  {verify.phase === 'judging' ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                  {verify.phase === 'judging' ? t('workspace.verifyJudging') : t('workspace.verifySubmit')}
                </button>
              </>
            )}
            {verify.phase === 'done' && (
              <div className="space-y-3">
                <p className={cn('text-sm font-bold', verify.passed ? 'text-emerald-400' : 'text-amber-400')}>
                  {verify.passed ? t('workspace.verifyPassed') : t('workspace.verifyFailed')}
                </p>
                {verify.feedback && <p className="text-sm text-muted-foreground leading-relaxed">{verify.feedback}</p>}
                <button
                  onClick={() => setVerify(null)}
                  className="w-full rounded-xl bg-primary text-primary-foreground text-sm font-medium py-2.5 hover:bg-primary/90 transition-colors"
                >
                  {t('workspace.verifyClose')}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default function WorkspacePage() {
  return (
    <Suspense fallback={<div className="h-full flex items-center justify-center"><Loader2 className="w-6 h-6 text-primary animate-spin" /></div>}>
      <WorkspaceInner />
    </Suspense>
  )
}
