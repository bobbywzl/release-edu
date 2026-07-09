'use client'
/**
 * Workspace — the per-node work area. Retains the Bob chat look (bubbles,
 * streaming, markdown, input bar) with a formal NOTES panel alongside:
 * the node's retained knowledge (explainer + your annotations), its context
 * in the tree, checkpoint-mastery state, and files from previous sessions —
 * all scoped to the node you're working on.
 *
 * Mastery is proven IN the chat: Bob's [[QUIZ]] blocks render as interactive
 * checkpoint cards (MCQ / short answer). Correct answers earn XP and count
 * toward the node's verification — there is no separate test screen.
 */
import { useState, useEffect, useCallback, useRef, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { motion } from 'framer-motion'
import {
  Bot, Send, ArrowLeft, ShieldCheck, Loader2, StickyNote, Paperclip,
  Sprout, FileText, PanelRightOpen, PanelRightClose, HelpCircle,
} from 'lucide-react'
import { MarkdownRenderer } from '@/components/markdown-renderer'
import { HighlightableText } from '@/components/highlightable-text'
import { useHighlights } from '@/lib/highlights'
import { useLanguage } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { emitXpAwards } from '@/components/xp-toast'
import { MASTERY_TARGET, MASTERY_MIN_SHORT, parseQuizState } from '@/lib/mastery'

interface Msg { id: string; role: 'user' | 'assistant'; content: string }
interface NodeData {
  id: string; parentId: string | null; kind: string; title: string; summary: string
  explainer: string | null; status: string; annotations: string | null; notes: string | null
  quizState: string | null; progressLog: string | null
}
interface TreeData { id: string; title: string; framing: string | null; nodes: NodeData[] }
interface NodeFileRow { id: string; name: string; type?: string | null }

interface QuizPayload {
  kind: 'mcq' | 'short'
  question: string
  options?: string[]
  correctIndex?: number
  explanation?: string
  rubric?: string
}

/**
 * Split Bob's message into visible prose + the trailing [[QUIZ]] block.
 * Markers are sanitized server-side ({kind, question, options} — the answer
 * key never reaches the client); a malformed block is dropped entirely so
 * no dead card can render.
 */
function splitQuiz(content: string): { text: string; quiz: QuizPayload | null } {
  const idx = content.indexOf('[[QUIZ]]')
  if (idx === -1) return { text: content, quiz: null }
  let quiz: QuizPayload | null = null
  try {
    const parsed = JSON.parse(content.slice(idx + 8).trim()) as QuizPayload
    if (typeof parsed.question === 'string' && parsed.question.trim()) {
      if (parsed.kind === 'short') quiz = parsed
      else if (parsed.kind === 'mcq' && Array.isArray(parsed.options) && parsed.options.length >= 2) quiz = parsed
    }
  } catch { /* malformed — hide the marker, show only prose */ }
  return { text: content.slice(0, idx).trimEnd(), quiz }
}

let tempId = 0

function WorkspaceInner() {
  const search = useSearchParams()
  const router = useRouter()
  const { t, language } = useLanguage()
  const treeId = search.get('tree')
  const nodeId = search.get('node')
  // review=1 → retention-review entry (from the tree list's Review button):
  // Bob reactivates this verified node and asks one fresh checkpoint.
  const reviewEntry = search.get('review') === '1'

  const [tree, setTree] = useState<TreeData | null>(null)
  const [messages, setMessages] = useState<Msg[]>([])
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [streamText, setStreamText] = useState('')
  // Open by default on desktop, CLOSED on phones — otherwise the fixed-width
  // notes panel covers the whole viewport and the Bob chat (where mastery is
  // actually proven) opens at zero width and reads as missing. (Client-only
  // component under Suspense, so window is available at first render.)
  const [showNotes, setShowNotes] = useState<boolean>(() => (typeof window === 'undefined' ? true : window.innerWidth >= 1024))
  const [panelTab, setPanelTab] = useState<'notes' | 'annotations' | 'files' | 'log'>('notes')
  const [explainerLoading, setExplainerLoading] = useState(false)
  const [notesDraft, setNotesDraft] = useState<string | null>(null)
  const [notesSaved, setNotesSaved] = useState(false)
  const [files, setFiles] = useState<NodeFileRow[]>([])
  // The in-chat checkpoint currently awaiting an answer (Bob's [[QUIZ]] card).
  const [activeQuiz, setActiveQuiz] = useState<QuizPayload | null>(null)
  const [quizSel, setQuizSel] = useState<number | null>(null)
  const [quizText, setQuizText] = useState('')
  // Confidence is an ACTIVE self-assessment — null until the student taps.
  // A silent default would poison the calibration counters (sureWrong).
  const [quizConf, setQuizConf] = useState<'sure' | 'unsure' | null>(null)
  const [quizBusy, setQuizBusy] = useState(false)
  const [quizError, setQuizError] = useState(false)
  // correctIndex arrives from the server on submit — the answer key never
  // ships with the card itself.
  const [quizResult, setQuizResult] = useState<{ correct: boolean; verified: boolean; correctIndex?: number } | null>(null)
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
  // Latest node in view + the pending quiz-resync timer — so an async resync
  // that resolves after the user switches nodes can't clobber the new node's
  // chat, and the timer is cancelled on switch.
  const nodeIdRef = useRef(nodeId)
  const quizTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => { nodeIdRef.current = nodeId }, [nodeId])

  // Annotations come from HIGHLIGHTS made directly on the conversation —
  // select any text in Bob's messages, pick a color, attach a comment
  // (the Release EDU annotation system, running on this node's chat).
  const { highlights, addHighlight, updateHighlight, deleteHighlight } = useHighlights(conversationId)

  const node = tree?.nodes.find(n => n.id === nodeId) ?? null

  // The node's build log (real-world progress Bob detected in chat) —
  // newest first for the runbook card. Tolerates malformed JSON.
  const buildLog: Array<{ text: string; createdAt?: string }> = (() => {
    try {
      const parsed = JSON.parse(node?.progressLog ?? '[]') as Array<{ text?: string; createdAt?: string }>
      return Array.isArray(parsed)
        ? parsed.filter(e => e && typeof e.text === 'string').map(e => ({ text: e.text as string, createdAt: e.createdAt })).reverse()
        : []
    } catch {
      return []
    }
  })()

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
        // An unanswered checkpoint survives a reload: if the conversation
        // ends on a Bob message carrying a quiz, re-arm the card.
        const last = d.messages[d.messages.length - 1] as Msg | undefined
        if (last?.role === 'assistant') {
          const { quiz } = splitQuiz(last.content)
          if (quiz) setActiveQuiz(quiz)
        }
        if (reviewEntry) {
          // Retention review: Bob reactivates the idea + asks one fresh
          // checkpoint. Strip the flag so a reload doesn't re-trigger it.
          void streamFromBob('[NODE_REVIEW]', false)
          router.replace(`/dashboard/workspace?tree=${treeId}&node=${nodeId}`, { scroll: false })
        } else if (d.messages.length === 0) {
          // First visit to this node: Bob opens with a condensed
          // syllabus-style hook. Triggered once; the saved reply prevents
          // re-runs.
          void streamFromBob('[NODE_INTRO]', false)
        }
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
  useEffect(() => {
    if (quizTimerRef.current) { clearTimeout(quizTimerRef.current); quizTimerRef.current = null }
    setNotesDraft(null); setPanelTab('notes'); setMessages([]); setSuggestion(null); setGrowQ(''); setGrowClarify(null); setGrowDone(null); setActiveQuiz(null); setQuizSel(null); setQuizText(''); setQuizConf(null); setQuizResult(null); setQuizError(false)
  }, [nodeId])

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
      // Trailing machine markers ride at the end of the stream, in server
      // order: [[TREE_SUGGEST]] then [[XP]]. Strip back-to-front.
      const xpIdx = full.indexOf('[[XP]]')
      if (xpIdx !== -1) {
        try { emitXpAwards(JSON.parse(full.slice(xpIdx + 6))) } catch { /* malformed — ignore */ }
        full = full.slice(0, xpIdx).trimEnd()
      }
      const markerIdx = full.indexOf('[[TREE_SUGGEST]]')
      if (markerIdx !== -1) {
        try { setSuggestion(JSON.parse(full.slice(markerIdx + 16))) } catch { /* malformed — ignore */ }
        full = full.slice(0, markerIdx).trimEnd()
      }
      setMessages(prev => [...prev, { id: `t-${tempId++}`, role: 'assistant', content: full }])
      // A [[QUIZ]] block inside Bob's own text becomes the interactive
      // checkpoint card (the message keeps the marker; rendering strips it).
      const { quiz } = splitQuiz(full)
      if (quiz) {
        setActiveQuiz(quiz)
        setQuizSel(null); setQuizText(''); setQuizConf(null); setQuizResult(null); setQuizError(false)
        // Attention arbiter (client side): the checkpoint card is the one
        // CTA this turn — a lingering discovery card yields to it.
        setSuggestion(null)
      }
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
      const res = await fetch(`/api/tree/${treeId}/node/${nodeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add_child', title: suggestion.title, summary: suggestion.summary }),
      })
      // Only dismiss the card once the node actually joined the tree — the
      // discovery card is ephemeral client state, not a persisted ghost, so
      // clearing it on a failed add would silently lose the growth the user
      // approved (permission granted, nothing grew). Keep it armed to retry.
      if (res.ok) {
        setSuggestion(null)
        loadTree()
      }
    } catch { /* keep the card armed for retry */ } finally {
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

  // Answer the active checkpoint card. The server judges (MCQ locally, short
  // answers by AI), pays XP, advances the node's mastery tally — and flips
  // the node to verified when the target is reached. Both sides of the
  // exchange are persisted, so after a short beat we pull the conversation
  // (answer + Bob's feedback bubbles) and retire the card.
  async function submitQuiz() {
    if (!activeQuiz || quizBusy || quizResult || !treeId || !nodeId) return
    const answer = activeQuiz.kind === 'mcq' ? quizSel : quizText.trim()
    if (answer === null || answer === '') return
    setQuizBusy(true)
    try {
      const res = await fetch(`/api/tree/${treeId}/node/${nodeId}/quiz`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quiz: activeQuiz, answer, confidence: quizConf ?? undefined, lang: language }),
      })
      const body = await res.json().catch(() => null)
      // Only apply a resync if the user is still on the node we answered.
      const answeredNode = nodeId
      const resyncChat = () => {
        if (nodeIdRef.current !== answeredNode) return
        fetch(`/api/tree/${treeId}/node/${answeredNode}/chat`, { cache: 'no-store' })
          .then(r => (r.ok ? r.json() : null))
          .then(d => { if (nodeIdRef.current === answeredNode && d?.messages?.length) { setMessages(d.messages); setConversationId(d.conversationId ?? null) } })
          .catch(() => {})
      }
      if (res.status === 400 || res.status === 404 || res.status === 409) {
        // Permanently unanswerable card (stale after a newer checkpoint, or
        // malformed) — retire it and resync rather than dead-ending the
        // student on a Submit button that never resolves.
        setActiveQuiz(null); setQuizResult(null); setQuizSel(null); setQuizText(''); setQuizConf(null)
        resyncChat()
        return
      }
      if (!res.ok || !body) throw new Error('quiz error')
      if (Array.isArray(body.xp) && body.xp.length > 0) emitXpAwards(body.xp)
      setQuizResult({ correct: !!body.correct, verified: !!body.verified, correctIndex: typeof body.correctIndex === 'number' ? body.correctIndex : undefined })
      if (quizTimerRef.current) clearTimeout(quizTimerRef.current)
      quizTimerRef.current = setTimeout(() => {
        quizTimerRef.current = null
        resyncChat()
        loadTree()
        // Only retire the card if we're still on the answered node — the
        // node-switch reset effect already cleared it otherwise.
        if (nodeIdRef.current === answeredNode) { setActiveQuiz(null); setQuizResult(null); setQuizSel(null); setQuizText('') }
      }, 1600)
      setQuizError(false)
    } catch {
      // Transient (judge unavailable / network) — surface it so the button
      // doesn't silently revert from "Judging…" to "Submit"; the card stays
      // armed and the server re-arms the pending, so retry is safe.
      setQuizError(true)
    } finally {
      setQuizBusy(false)
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
          /* Mastery pips: correct checkpoint answers toward verification —
             the checkpoints live in the chat itself, "Quiz me" just asks Bob.
             The LAST pip is reserved for the own-words short answer: MCQs alone
             can only fill the first MASTERY_TARGET-1, so a full meter never
             lies about verification (recognition alone never verifies). */
          (() => {
            const qs = parseQuizState(node?.quizState)
            const needShort = qs.shortCorrect < MASTERY_MIN_SHORT
            const filled = needShort ? Math.min(qs.correct, MASTERY_TARGET - MASTERY_MIN_SHORT) : Math.min(qs.correct, MASTERY_TARGET)
            return (
              <div className="flex items-center gap-2 flex-shrink-0" title={t('workspace.masteryHint').replace('{n}', String(MASTERY_TARGET))}>
                <div className="flex items-center gap-1">
                  {Array.from({ length: MASTERY_TARGET }).map((_, i) => {
                    const isShortPip = i >= MASTERY_TARGET - MASTERY_MIN_SHORT
                    return (
                      <span
                        key={i}
                        className={cn(
                          'w-2 h-2 rounded-full transition-colors',
                          i < filled ? 'bg-emerald-400' : isShortPip && needShort ? 'bg-border ring-1 ring-emerald-400/40' : 'bg-border',
                        )}
                      />
                    )
                  })}
                </div>
                {qs.correct >= MASTERY_TARGET - MASTERY_MIN_SHORT && needShort && (
                  <span className="text-[10px] text-amber-400/90 hidden sm:inline">{t('workspace.needShort')}</span>
                )}
                <button
                  onClick={() => streamFromBob(t('workspace.quizMeMessage'), true)}
                  disabled={streaming}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-400/40 bg-emerald-500/10 text-emerald-300 text-xs font-medium hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                >
                  <HelpCircle className="w-3.5 h-3.5" /> {t('workspace.quizMeBtn')}
                </button>
              </div>
            )
          })()
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
                <p className="text-sm text-muted-foreground max-w-md mx-auto">{t('workspace.emptyHint').replace('{n}', String(MASTERY_TARGET))}</p>
              </div>
            )}
            {messages.map((m, mi) => {
              const parts = m.role === 'assistant' ? splitQuiz(m.content) : null
              // A quiz chip in an OLD message is inert — answered if any
              // student message follows it; the live card renders separately.
              const isActiveQuizMsg = !!(activeQuiz && parts?.quiz && mi === messages.length - 1)
              const wasAnswered = !!parts?.quiz && messages.slice(mi + 1).some(x => x.role === 'user')
              return (
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
                      <>
                        <HighlightableText
                          messageId={m.id}
                          highlights={highlights}
                          onAddHighlight={addHighlight}
                          onUpdateHighlight={updateHighlight}
                          onDeleteHighlight={deleteHighlight}
                        >
                          <MarkdownRenderer content={parts!.text} imageContext={node ? `${node.title} — ${node.summary}` : ''} />
                        </HighlightableText>
                        {parts!.quiz && !isActiveQuizMsg && (
                          <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground border border-border rounded-lg px-2.5 py-1.5 bg-background/50">
                            <HelpCircle className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                            <span className="truncate">{parts!.quiz.question}</span>
                            {wasAnswered && <span className="ml-auto flex-shrink-0 text-emerald-400">✓ {t('workspace.quizAnswered')}</span>}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </motion.div>
              )
            })}
            {streaming && streamText && (
              <div className="flex justify-start">
                <div className="max-w-[92%] rounded-2xl rounded-bl-sm px-4 py-3 bg-card border border-border text-foreground text-[15px] leading-relaxed">
                  <MarkdownRenderer content={streamText.split('[[TREE_SUGGEST]]')[0].split('[[QUIZ]]')[0].split('[[XP]]')[0]} imageContext={node ? `${node.title} — ${node.summary}` : ''} />
                  <span className="inline-block w-0.5 h-4 bg-primary animate-pulse rounded-full align-middle ml-0.5" />
                </div>
              </div>
            )}

            {/* Live checkpoint card — Bob's [[QUIZ]] block, answerable in place.
                Correct answers earn XP and count toward node verification. */}
            {activeQuiz && !streaming && (
              <motion.div
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                className="max-w-[92%] border border-primary/40 bg-primary/[0.06] rounded-2xl rounded-bl-sm px-4 py-3 space-y-3"
              >
                <p className="text-xs font-bold text-primary uppercase tracking-wider flex items-center gap-1.5">
                  <HelpCircle className="w-3.5 h-3.5" /> {t('workspace.checkpoint')}
                </p>
                <div className="text-sm text-foreground leading-relaxed">
                  <MarkdownRenderer content={activeQuiz.question} />
                </div>
                {activeQuiz.kind === 'mcq' && Array.isArray(activeQuiz.options) && (
                  <div className="space-y-1.5">
                    {activeQuiz.options.map((opt, oi) => (
                      <button
                        key={oi}
                        type="button"
                        disabled={quizBusy || !!quizResult}
                        onClick={() => setQuizSel(oi)}
                        className={cn(
                          'w-full text-left flex items-start gap-2.5 px-3 py-2 rounded-lg border text-sm transition-colors',
                          quizSel === oi && !quizResult ? 'border-primary/60 bg-primary/15 text-foreground' : 'border-border text-foreground/85 hover:bg-accent',
                          quizResult && quizResult.correctIndex === oi && 'border-emerald-400/70 bg-emerald-500/15',
                          quizResult && quizSel === oi && quizResult.correctIndex !== oi && 'border-red-400/60 bg-red-500/10',
                        )}
                      >
                        <span className="font-bold text-xs mt-0.5 text-primary">{String.fromCharCode(65 + oi)}</span>
                        <span>{opt}</span>
                      </button>
                    ))}
                  </div>
                )}
                {activeQuiz.kind === 'short' && (
                  <textarea
                    value={quizText}
                    onChange={e => setQuizText(e.target.value)}
                    rows={3}
                    disabled={quizBusy || !!quizResult}
                    placeholder={t('workspace.quizShortPlaceholder')}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary/40 disabled:opacity-60"
                  />
                )}
                {/* Metacognitive calibration — confident-wrong answers get the
                    hypercorrection treatment from the judge. */}
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-muted-foreground">{t('workspace.confidenceLabel')}</span>
                  {(['sure', 'unsure'] as const).map(c => (
                    <button
                      key={c}
                      type="button"
                      disabled={quizBusy || !!quizResult}
                      onClick={() => setQuizConf(c)}
                      className={cn(
                        'px-2 py-0.5 rounded-full text-[11px] border transition-colors',
                        quizConf === c
                          ? 'border-primary/60 bg-primary/15 text-primary'
                          : 'border-border text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {c === 'sure' ? t('workspace.confSure') : t('workspace.confUnsure')}
                    </button>
                  ))}
                </div>
                {quizResult ? (
                  <p className={cn('text-sm font-bold', quizResult.correct ? 'text-emerald-400' : 'text-amber-400')}>
                    {quizResult.correct ? t('workspace.quizCorrect') : t('workspace.quizIncorrect')}
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {quizError && <p className="text-[11px] text-amber-400">{t('workspace.connectError')}</p>}
                    <button
                      onClick={submitQuiz}
                      disabled={quizBusy || (activeQuiz.kind === 'mcq' ? quizSel === null : !quizText.trim())}
                      className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium py-2.5 hover:bg-primary/90 transition-colors disabled:opacity-40"
                    >
                      {quizBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                      {quizBusy ? t('workspace.quizJudging') : quizError ? t('workspace.quizRetry') : t('workspace.quizSubmit')}
                    </button>
                  </div>
                )}
              </motion.div>
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

        {/* Formal notes panel — retained knowledge above Notes/Annotations/Files
            tabs. Inline column on desktop; a right-side overlay on phones so it
            never squeezes the chat to zero width. */}
        {showNotes && (
          <div className="fixed inset-y-0 right-0 z-40 w-full max-w-sm shadow-2xl bg-card lg:static lg:z-auto lg:w-96 lg:max-w-none lg:shadow-none lg:bg-card/40 flex-shrink-0 border-l border-border overflow-y-auto">
            <div className="p-4 space-y-4">
              <div>
                <h3 className="text-xs font-bold text-foreground uppercase tracking-wider flex items-center gap-1.5 mb-2">
                  <StickyNote className="w-3.5 h-3.5 text-primary" /> {t('workspace.retainedKnowledge')}
                </h3>
                {node?.explainer ? (
                  <div className="text-[13px] leading-relaxed border border-border rounded-xl p-3 bg-background/50 max-h-72 overflow-y-auto">
                    <MarkdownRenderer content={node.explainer} imageContext={`${node.title} — ${node.summary}`} />
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

              {/* Tabs: Notes (editable) · Annotations · Files · Build log — all retained per node */}
              <div className="flex gap-1 border-b border-border">
                {(['notes', 'annotations', 'files', 'log'] as const).map(tab => (
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
                    {tab === 'notes' ? t('workspace.tabNotes') : tab === 'annotations' ? t('workspace.annotations') : tab === 'files' ? t('workspace.files') : t('workspace.tabLog')}
                    {tab === 'files' && files.length > 0 ? ` (${files.length})` : ''}
                    {tab === 'log' && buildLog.length > 0 ? ` (${buildLog.length})` : ''}
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

              {panelTab === 'log' && (
                <div>
                  {/* The runbook: real-world execution Bob detected in your
                      chats — what you actually built, ran, and measured. */}
                  <p className="text-[11px] text-muted-foreground leading-snug mb-2">{t('workspace.logHint')}</p>
                  <div className="space-y-1.5">
                    {buildLog.length === 0 && <p className="text-[11px] text-muted-foreground">{t('workspace.noLog')}</p>}
                    {buildLog.map((entry, li) => (
                      <div key={li} className="text-xs border-l-2 border-emerald-400/60 rounded-r-md px-2.5 py-1.5 bg-background/60">
                        <p className="text-foreground/90">{entry.text}</p>
                        <span className="text-[10px] text-muted-foreground/60">{entry.createdAt ? new Date(entry.createdAt).toLocaleDateString() : ''}</span>
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
