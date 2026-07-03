'use client'
import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { signOut } from 'next-auth/react'
import { motion, AnimatePresence } from 'framer-motion'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Bot, Send, Sparkles, CheckCircle, Loader2, LogOut } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useT, useLanguage } from '@/lib/i18n'
import { LanguageChoiceModal } from '@/components/language-choice-modal'

// Warm opening greeting shown if Bob's first message can't be generated (API
// blip, degenerate output). MUST match the student's chosen language — never
// fall back to English for a Chinese learner.
const FALLBACK_OPENER: Record<'en' | 'zh', string> = {
  en: "Hey! I'm Bob, your learning architect. I'm going to build you a curriculum made entirely around you — but first I need to get to know you. What's the one thing you could spend hours on and never get bored?",
  zh: '嘿！我是 Bob，你的学习架构师。我会为你打造一套完全围绕你的课程——不过首先，我需要了解你。有什么事情是你可以花上好几个小时、永远也不会觉得无聊的？',
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface LocalMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

interface OnboardingProfile {
  interests: string[]
  strengths: string[]
  weaknesses: string[]
  learningStyle: string
  personalityTraits: string[]
  aspirations: string
  baselineAssessment: {
    math: number
    writing: number
    science: number
    history: number
    criticalThinking: number
  }
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ONBOARDING_PHASES = [
  { key: 'welcome', label: 'Welcome', description: 'Getting to know you' },
  { key: 'interests', label: 'Interests', description: 'What excites you' },
  { key: 'foundations', label: 'Foundations', description: 'Core courses' },
  { key: 'learningStyle', label: 'Learning Style', description: 'How you learn' },
  { key: 'yourPath', label: 'Your Path', description: 'Building your curriculum' },
]

// ── Mini Tetris Game ─────────────────────────────────────────────────────────

const TETRIS_COLS = 10
const TETRIS_ROWS = 18
const CELL = 16
const SHAPES = [
  [[1,1,1,1]],
  [[1,1],[1,1]],
  [[0,1,0],[1,1,1]],
  [[1,0,0],[1,1,1]],
  [[0,0,1],[1,1,1]],
  [[1,1,0],[0,1,1]],
  [[0,1,1],[1,1,0]],
]
const SHAPE_COLORS = ['#06b6d4','#eab308','#a855f7','#f97316','#3b82f6','#22c55e','#ef4444']

function MiniTetris() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stateRef = useRef<{
    board: number[][]; piece: number[][]; pieceColor: string; px: number; py: number;
    score: number; gameOver: boolean; dropTimer: number; speed: number
  }>({
    board: Array.from({ length: TETRIS_ROWS }, () => Array(TETRIS_COLS).fill(0)),
    piece: [], pieceColor: '', px: 0, py: 0, score: 0, gameOver: false, dropTimer: 0, speed: 400,
  })
  const [score, setScore] = useState(0)
  const [gameOver, setGameOver] = useState(false)

  function spawnPiece() {
    const s = stateRef.current
    const idx = Math.floor(Math.random() * SHAPES.length)
    s.piece = SHAPES[idx].map(r => [...r])
    s.pieceColor = SHAPE_COLORS[idx]
    s.px = Math.floor((TETRIS_COLS - s.piece[0].length) / 2)
    s.py = 0
    if (collides(s.board, s.piece, s.px, s.py)) { s.gameOver = true; setGameOver(true) }
  }

  function collides(board: number[][], piece: number[][], px: number, py: number) {
    for (let r = 0; r < piece.length; r++)
      for (let c = 0; c < piece[r].length; c++)
        if (piece[r][c] && (py + r >= TETRIS_ROWS || px + c < 0 || px + c >= TETRIS_COLS || board[py + r]?.[px + c]))
          return true
    return false
  }

  function merge() {
    const s = stateRef.current
    for (let r = 0; r < s.piece.length; r++)
      for (let c = 0; c < s.piece[r].length; c++)
        if (s.piece[r][c]) s.board[s.py + r][s.px + c] = 1
    // Clear lines
    let cleared = 0
    s.board = s.board.filter(row => { if (row.every(c => c)) { cleared++; return false } return true })
    while (s.board.length < TETRIS_ROWS) s.board.unshift(Array(TETRIS_COLS).fill(0))
    if (cleared) { s.score += cleared * 100; s.speed = Math.max(150, 400 - s.score); setScore(s.score) }
  }

  function rotate() {
    const s = stateRef.current
    const rotated = s.piece[0].map((_, c) => s.piece.map(r => r[c]).reverse())
    if (!collides(s.board, rotated, s.px, s.py)) s.piece = rotated
  }

  function restart() {
    const s = stateRef.current
    s.board = Array.from({ length: TETRIS_ROWS }, () => Array(TETRIS_COLS).fill(0))
    s.score = 0; s.gameOver = false; s.speed = 400
    setScore(0); setGameOver(false)
    spawnPiece()
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    spawnPiece()

    function handleKey(e: KeyboardEvent) {
      const s = stateRef.current
      if (s.gameOver) { if (e.key === 'r') restart(); return }
      if (e.key === 'ArrowLeft' && !collides(s.board, s.piece, s.px - 1, s.py)) s.px--
      else if (e.key === 'ArrowRight' && !collides(s.board, s.piece, s.px + 1, s.py)) s.px++
      else if (e.key === 'ArrowDown' && !collides(s.board, s.piece, s.px, s.py + 1)) s.py++
      else if (e.key === 'ArrowUp') rotate()
      else if (e.key === ' ') { while (!collides(s.board, s.piece, s.px, s.py + 1)) s.py++; merge(); spawnPiece() }
    }
    window.addEventListener('keydown', handleKey)

    let lastDrop = 0
    let raf: number
    function draw(time: number) {
      const s = stateRef.current
      if (!s.gameOver) {
        if (time - lastDrop > s.speed) {
          lastDrop = time
          if (!collides(s.board, s.piece, s.px, s.py + 1)) s.py++
          else { merge(); spawnPiece() }
        }
      }

      const W = TETRIS_COLS * CELL, H = TETRIS_ROWS * CELL
      ctx!.clearRect(0, 0, W, H)
      // Grid
      ctx!.strokeStyle = 'rgba(255,255,255,0.04)'
      for (let r = 0; r < TETRIS_ROWS; r++) for (let c = 0; c < TETRIS_COLS; c++) ctx!.strokeRect(c * CELL, r * CELL, CELL, CELL)
      // Board
      for (let r = 0; r < TETRIS_ROWS; r++)
        for (let c = 0; c < TETRIS_COLS; c++)
          if (s.board[r][c]) { ctx!.fillStyle = 'rgba(255,255,255,0.3)'; ctx!.fillRect(c * CELL + 1, r * CELL + 1, CELL - 2, CELL - 2) }
      // Current piece
      if (!s.gameOver)
        for (let r = 0; r < s.piece.length; r++)
          for (let c = 0; c < s.piece[r].length; c++)
            if (s.piece[r][c]) { ctx!.fillStyle = s.pieceColor; ctx!.fillRect((s.px + c) * CELL + 1, (s.py + r) * CELL + 1, CELL - 2, CELL - 2) }
      // Game over overlay
      if (s.gameOver) {
        ctx!.fillStyle = 'rgba(0,0,0,0.6)'; ctx!.fillRect(0, 0, W, H)
        ctx!.fillStyle = 'rgba(255,255,255,0.7)'; ctx!.font = '14px sans-serif'; ctx!.textAlign = 'center'
        ctx!.fillText('Game Over', W / 2, H / 2 - 10)
        ctx!.font = '10px sans-serif'; ctx!.fillStyle = 'rgba(255,255,255,0.4)'
        ctx!.fillText('Press R to restart', W / 2, H / 2 + 10)
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('keydown', handleKey) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex items-center justify-between w-full max-w-[160px]">
        <p className="text-[10px] text-white/25">Arrow keys to play</p>
        <p className="text-[10px] text-white/40 font-mono">{score}</p>
      </div>
      <canvas
        ref={canvasRef}
        width={TETRIS_COLS * CELL}
        height={TETRIS_ROWS * CELL}
        className="rounded-lg border border-white/10 bg-white/[0.02]"
      />
      {gameOver && (
        <button onClick={restart} className="text-[10px] text-primary/60 hover:text-primary transition-colors">
          Play again
        </button>
      )}
    </div>
  )
}

// ── Rotating Quotes ──────────────────────────────────────────────────────────

const LEARNING_QUOTES = [
  { text: "The mind is not a vessel to be filled, but a fire to be kindled.", author: "Plutarch" },
  { text: "Education is not the learning of facts, but the training of the mind to think.", author: "Albert Einstein" },
  { text: "The only person who is educated is the one who has learned how to learn and change.", author: "Carl Rogers" },
  { text: "Live as if you were to die tomorrow. Learn as if you were to live forever.", author: "Mahatma Gandhi" },
  { text: "He who has a why to live can bear almost any how.", author: "Friedrich Nietzsche" },
  { text: "The beautiful thing about learning is that nobody can take it away from you.", author: "B.B. King" },
  { text: "Do what you can, with what you have, where you are.", author: "Theodore Roosevelt" },
  { text: "Imagination is more important than knowledge. Knowledge is limited. Imagination encircles the world.", author: "Albert Einstein" },
  { text: "The more I read, the more I acquire, the more certain I am that I know nothing.", author: "Voltaire" },
  { text: "It is not that I'm so smart. But I stay with the questions much longer.", author: "Albert Einstein" },
  { text: "One must still have chaos in oneself to be able to give birth to a dancing star.", author: "Friedrich Nietzsche" },
  { text: "In the middle of difficulty lies opportunity.", author: "Albert Einstein" },
  { text: "The only way to do great work is to love what you do.", author: "Steve Jobs" },
  { text: "Believe you can and you're halfway there.", author: "Theodore Roosevelt" },
  { text: "The roots of education are bitter, but the fruit is sweet.", author: "Aristotle" },
  { text: "Wonder is the beginning of wisdom.", author: "Socrates" },
  { text: "Man is condemned to be free; because once thrown into the world, he is responsible for everything he does.", author: "Jean-Paul Sartre" },
  { text: "The only true wisdom is in knowing you know nothing.", author: "Socrates" },
  { text: "To teach is to learn twice.", author: "Joseph Joubert" },
  { text: "Without struggle, there is no progress.", author: "Frederick Douglass" },
  { text: "Wisdom begins in wonder.", author: "Socrates" },
  { text: "The mind once stretched by a new idea never returns to its original dimensions.", author: "Oliver Wendell Holmes" },
  { text: "That which does not kill us makes us stronger.", author: "Friedrich Nietzsche" },
  { text: "An investment in knowledge pays the best interest.", author: "Benjamin Franklin" },
]

function RotatingQuote() {
  const [index, setIndex] = useState(() => Math.floor(Math.random() * LEARNING_QUOTES.length))
  useEffect(() => {
    const interval = setInterval(() => setIndex(i => (i + 1) % LEARNING_QUOTES.length), 7000)
    return () => clearInterval(interval)
  }, [])
  const q = LEARNING_QUOTES[index]
  return (
    <div className="mt-6 max-w-md text-center px-4 min-h-[60px] flex items-center justify-center">
      <AnimatePresence mode="wait">
        <motion.div
          key={index}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.5 }}
        >
          <p className="text-sm text-white/40 italic leading-relaxed">&ldquo;{q.text}&rdquo;</p>
          <p className="text-xs text-white/25 mt-1.5">— {q.author}</p>
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

// ── Skip Button (appears after delay) ─────────────────────────────────────────

function SkipAfterDelay({ delay, onSkip }: { delay: number; onSkip: () => void }) {
  const [visible, setVisible] = useState(false)
  const [confirming, setConfirming] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), delay * 1000)
    return () => clearTimeout(timer)
  }, [delay])
  if (!visible) return null
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-4 flex flex-col items-center gap-2">
      {!confirming ? (
        <button onClick={() => setConfirming(true)} className="text-xs text-white/30 hover:text-white/60 underline underline-offset-2 transition-colors">
          Taking too long? Skip to dashboard →
        </button>
      ) : (
        <div className="flex items-center gap-3 text-xs">
          <span className="text-white/40">Curriculum may still be generating — skip anyway?</span>
          <button onClick={onSkip} className="text-primary hover:text-primary/80 font-medium transition-colors">Yes, skip</button>
          <button onClick={() => setConfirming(false)} className="text-white/30 hover:text-white/50 transition-colors">Wait</button>
        </div>
      )}
    </motion.div>
  )
}

// ── Typing Indicator ──────────────────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div className="flex items-end gap-3">
      <div className="w-8 h-8 rounded-full bg-primary/30 flex items-center justify-center flex-shrink-0 ring-2 ring-primary/20">
        <Bot className="w-4 h-4 text-primary" />
      </div>
      <div className="bg-white/5 border border-white/10 rounded-2xl rounded-bl-sm px-4 py-3">
        <div className="flex items-center gap-1.5">
          {[0, 1, 2].map(i => (
            <motion.div
              key={i}
              className="w-2 h-2 rounded-full bg-primary/60"
              animate={{ opacity: [0.3, 1, 0.3], y: [0, -4, 0] }}
              transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Message Bubble ─────────────────────────────────────────────────────────────

function MessageBubble({ message }: { message: LocalMessage }) {
  const isUser = message.role === 'user'
  // Strip [PROFILE_COMPLETE] and JSON from display
  const displayContent = message.content
    .replace(/\[PROFILE_COMPLETE\][\s\S]*$/, '')
    .trim()

  if (!displayContent) return null

  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.3 }}
      className={cn('flex items-end gap-3 max-w-[85%]', isUser ? 'ml-auto flex-row-reverse' : '')}
    >
      {!isUser && (
        <div className="w-8 h-8 rounded-full bg-primary/30 flex items-center justify-center flex-shrink-0 ring-2 ring-primary/20">
          <Bot className="w-4 h-4 text-primary" />
        </div>
      )}
      {isUser && (
        <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center flex-shrink-0 text-white font-bold text-sm">
          Y
        </div>
      )}
      <div
        className={cn(
          'rounded-2xl px-4 py-3 text-sm leading-relaxed',
          isUser
            ? 'bg-primary text-white rounded-br-sm'
            : 'bg-white/5 border border-white/10 text-white/90 rounded-bl-sm'
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{displayContent}</p>
        ) : (
          <div className="prose prose-invert prose-sm max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                p({ children }) { return <p className="mb-2 last:mb-0">{children}</p> },
                strong({ children }) { return <strong className="font-semibold text-white">{children}</strong> },
                ul({ children }) { return <ul className="my-2 space-y-1 list-disc list-inside">{children}</ul> },
                li({ children }) { return <li className="text-sm">{children}</li> },
              }}
            >
              {displayContent}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </motion.div>
  )
}

// ── Phase Indicator ────────────────────────────────────────────────────────────

function PhaseIndicator({ phase, total }: { phase: number; total: number }) {
  return (
    <div className="flex items-center justify-center gap-2">
      {Array.from({ length: total }).map((_, i) => (
        <motion.div
          key={i}
          animate={{
            width: i === phase ? 24 : 8,
            opacity: i <= phase ? 1 : 0.3,
          }}
          transition={{ duration: 0.3 }}
          className={cn(
            'h-2 rounded-full transition-colors',
            i < phase ? 'bg-primary' : i === phase ? 'bg-primary' : 'bg-white/20'
          )}
        />
      ))}
    </div>
  )
}

// ── Curriculum Summary ─────────────────────────────────────────────────────────

function CurriculumSummaryView({ plan }: { plan: { profileSummary: string; primaryInterests: string | string[]; primaryStrengths: string | string[]; tracks: Array<{ name: string; color: string }> } | null }) {
  if (!plan) return null
  // Ensure arrays — API sometimes returns strings
  const interests = Array.isArray(plan.primaryInterests) ? plan.primaryInterests : (typeof plan.primaryInterests === 'string' ? [plan.primaryInterests] : [])
  const strengths = Array.isArray(plan.primaryStrengths) ? plan.primaryStrengths : (typeof plan.primaryStrengths === 'string' ? [plan.primaryStrengths] : [])
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="w-full max-w-lg mx-auto space-y-4"
    >
      <div className="text-center">
        <div className="w-16 h-16 rounded-2xl bg-primary/20 border border-primary/30 flex items-center justify-center mx-auto mb-3">
          <Sparkles className="w-8 h-8 text-primary" />
        </div>
        <h2 className="text-2xl font-bold text-white mb-2">Your curriculum is ready!</h2>
        <p className="text-white/60 text-sm leading-relaxed">{plan.profileSummary.slice(0, 200)}…</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white/5 border border-white/10 rounded-xl p-3">
          <p className="text-xs text-white/50 mb-2">Your interests</p>
          {interests.slice(0, 3).map(interest => (
            <div key={interest} className="flex items-center gap-1.5 py-0.5">
              <CheckCircle className="w-3 h-3 text-primary flex-shrink-0" />
              <span className="text-xs text-white/80">{interest}</span>
            </div>
          ))}
        </div>
        <div className="bg-white/5 border border-white/10 rounded-xl p-3">
          <p className="text-xs text-white/50 mb-2">Your strengths</p>
          {strengths.slice(0, 3).map(strength => (
            <div key={strength} className="flex items-center gap-1.5 py-0.5">
              <CheckCircle className="w-3 h-3 text-emerald-400 flex-shrink-0" />
              <span className="text-xs text-white/80">{strength}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white/5 border border-white/10 rounded-xl p-3 space-y-2">
        <p className="text-xs text-white/50">Learning tracks</p>
        {plan.tracks.map(track => (
          <div key={track.name} className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: track.color }} />
            <span className="text-sm text-white/80">{track.name}</span>
          </div>
        ))}
      </div>
    </motion.div>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────────

let nextId = 1

export default function OnboardingPage() {
  const router = useRouter()
  const t = useT()
  const { language } = useLanguage()
  // Gate Bob's first message on a deliberate language choice so it generates in
  // the right language. The modal (which self-gates to not-yet-onboarded users)
  // flips this via onProceed when the user confirms a language.
  const [langChosen, setLangChosen] = useState(false)
  const [messages, setMessages] = useState<LocalMessage[]>([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [phase, setPhase] = useState(0)
  const [stage, setStage] = useState<'chat' | 'generating' | 'summary' | 'redirecting'>('chat')
  const [generatedPlan, setGeneratedPlan] = useState<{ profileSummary: string; primaryInterests: string[]; primaryStrengths: string[]; tracks: Array<{ name: string; color: string }> } | null>(null)
  const conversationRef = useRef<string | undefined>(undefined)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const hasStarted = useRef(false)

  // Restore banner state — if the user just hit Start Over, surface a one-click
  // undo for the next 24 hours so accidental resets aren't catastrophic.
  type RecentArchive = { id: string; title: string; primaryInterests: string[]; totalChapters: number; completedChapters: number; overallProgress: number; expiresAt: string }
  const [recentArchive, setRecentArchive] = useState<RecentArchive | null>(null)
  const [restoring, setRestoring] = useState(false)
  const [archiveDismissed, setArchiveDismissed] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/curriculum/recent-archive')
      .then(r => (r.ok ? r.json() : null))
      .then(data => { if (!cancelled && data?.archive) setRecentArchive(data.archive) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  async function handleRestore() {
    if (!recentArchive || restoring) return
    setRestoring(true)
    try {
      const res = await fetch('/api/curriculum/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archiveId: recentArchive.id }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        alert(data.error || 'Could not restore. Try again.')
        setRestoring(false)
        return
      }
      // Bounce to the curriculum view — restored data is live.
      router.replace('/dashboard/curriculum')
      router.refresh()
      void import('@/lib/student-data').then(m => m.refreshStudentData())
    } catch {
      setRestoring(false)
    }
  }

  // Redirect logic lives in dashboard/layout.tsx (single source of truth).

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, streamingContent, scrollToBottom])

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`
  }, [input])

  // Start the conversation with Bob's opening message — but only after the user
  // has chosen a language (via the modal), so Bob's first message generates in it.
  useEffect(() => {
    if (!langChosen) return
    if (hasStarted.current) return
    hasStarted.current = true
    void startConversation()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [langChosen])

  async function startConversation() {
    setIsStreaming(true)
    setStreamingContent('')
    try {
      const res = await fetch('/api/chat/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: '__START__', conversationId: undefined }),
      })
      if (!res.ok || !res.body) throw new Error('Failed to start')
      const convId = res.headers.get('X-Conversation-Id') ?? undefined
      conversationRef.current = convId

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let full = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        full += decoder.decode(value, { stream: true })
        setStreamingContent(full)
      }
      // Backstop: never render a degenerate opener (empty, or the model
      // parroting the "__START__" trigger). Fall back to a warm greeting.
      const cleaned = full.trim()
      const isDegenerate = !cleaned || /^_{0,2}\s*start\s*_{0,2}$/i.test(cleaned)
      const safe = isDegenerate ? (FALLBACK_OPENER[language] ?? FALLBACK_OPENER.en) : full
      const msg: LocalMessage = { id: `msg-${nextId++}`, role: 'assistant', content: safe, timestamp: new Date() }
      setMessages([msg])
    } catch {
      const msg: LocalMessage = {
        id: `msg-${nextId++}`, role: 'assistant',
        content: FALLBACK_OPENER[language] ?? FALLBACK_OPENER.en,
        timestamp: new Date(),
      }
      setMessages([msg])
    } finally {
      setIsStreaming(false)
      setStreamingContent('')
    }
  }

  function detectPhase(allMessages: LocalMessage[]) {
    // Phase is driven by what Bob has actually covered in conversation, not message count
    const allText = allMessages.map(m => m.content.toLowerCase()).join(' ')
    let p = 0
    // Phase 0 → 1: Bob has asked about or student has mentioned interests/passions
    if (/passion|interest|excit|love doing|spend hours|fascin/.test(allText)) p = 1
    // Phase 1 → 2: Goals/aspirations discussed
    if (p >= 1 && /build|achieve|become|goal|aspir|dream|create|career|want to/.test(allText)) p = 2
    // Phase 2 → 3: Learning style or strengths/weaknesses discussed
    if (p >= 2 && /learn.*style|hands-on|strength|weakness|struggle|prefer.*learn|visual|reading/.test(allText)) p = 3
    // Phase 3 → 4: Bob signals readiness to build (or PROFILE_COMPLETE)
    if (p >= 3 && /profile_complete|curriculum.*on its way|let.*build|building.*curriculum|got everything|enough to build/.test(allText)) p = 4
    return p
  }

  async function sendMessage() {
    const text = input.trim()
    if (!text || isStreaming) return

    const userMsg: LocalMessage = { id: `msg-${nextId++}`, role: 'user', content: text, timestamp: new Date() }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setIsStreaming(true)
    setStreamingContent('')

    try {
      const res = await fetch('/api/chat/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          conversationId: conversationRef.current,
        }),
      })
      if (!res.ok || !res.body) throw new Error('Stream error')

      const returnedConvId = res.headers.get('X-Conversation-Id')
      if (returnedConvId) conversationRef.current = returnedConvId

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let full = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        full += decoder.decode(value, { stream: true })
        setStreamingContent(full)
      }

      const assistantMsg: LocalMessage = { id: `msg-${nextId++}`, role: 'assistant', content: full, timestamp: new Date() }
      setMessages(prev => {
        const updated = [...prev, assistantMsg]
        setPhase(detectPhase(updated))
        return updated
      })

      // Check for PROFILE_COMPLETE signal — or Bob indicating he's ready to build
      if (full.includes('[PROFILE_COMPLETE]')) {
        await handleProfileComplete(full)
      } else {
        const msgCount = messages.length + 1 // +1 for the assistant message we just added
        const lc = full.toLowerCase()
        // If Bob ends with a question, he's still gathering info — never trigger build.
        const stillAsking = /\?\s*$/.test(lc.trimEnd())
        // Strong commitment phrases — Bob explicitly committing to build right now.
        // Single keywords like "curriculum" or "learning path" are too loose and
        // routinely show up in normal conversation (and in API error fallbacks).
        const strongCommitment =
          /\b(ready to (build|create|design)|let me (build|create|design|put together)|building your (curriculum|learning|personalized|path)|creating your (curriculum|learning|personalized|path)|time to (build|create) your)\b/.test(lc)
        // Summary form: Bob recapping what he's learned with subject keywords.
        const summaryForm =
          /based on|from what you've told|from our conversation|what you've shared|sounds like you/.test(lc) &&
          /interest|passion|goal|aspir|strength|learn/.test(lc)
        // Require enough back-and-forth (Bob asks up to 5 questions) AND that
        // Bob is no longer asking a question, before falling back to heuristics.
        const readyToBuild = msgCount >= 6 && !stillAsking && (strongCommitment || summaryForm)
        if (readyToBuild) {
          await handleBuildFromConversation()
        }
      }
    } catch {
      const errMsg: LocalMessage = {
        id: `msg-${nextId++}`, role: 'assistant',
        content: "I'm having a moment of connection trouble. Let's continue — tell me more about yourself!",
        timestamp: new Date(),
      }
      setMessages(prev => [...prev, errMsg])
    } finally {
      setIsStreaming(false)
      setStreamingContent('')
    }
  }

  // Shared: plant the student's FIRST problem tree from their final answer,
  // then redirect to it. Sets the `onboarding-completing` session flag for
  // the full window so the layout's redirect guard stands down.
  async function generateAndRedirect(body: { problem?: string }) {
    setStage('generating')
    setPhase(4)
    try { sessionStorage.setItem('onboarding-completing', String(Date.now())) } catch { /* SSR safe */ }

    async function finalRedirect(delay: number, dest = '/dashboard/tree') {
      // Make sure the client cache is fresh BEFORE navigating, so the
      // dashboard layout sees isOnboarded:true on first render.
      try {
        const sd = await import('@/lib/student-data')
        sd.refreshStudentData()
      } catch { /* non-fatal */ }
      setStage('redirecting')
      setTimeout(() => {
        router.push(dest)
        // Clear the lock a beat after navigation so the destination
        // gets a clean read of the now-fresh data.
        setTimeout(() => {
          try { sessionStorage.removeItem('onboarding-completing') } catch { /* SSR safe */ }
        }, 1500)
      }, delay)
    }

    const timeoutId = setTimeout(() => {
      console.warn('[Onboarding] Tree seeding timed out — forcing redirect')
      void finalRedirect(1500)
    }, 130_000)

    try {
      if (!body.problem) throw new Error('no problem statement')
      const res = await fetch('/api/tree', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ problem: body.problem, lang: language }),
      })
      clearTimeout(timeoutId)
      if (!res.ok) throw new Error('Seeding failed')
      const data = await res.json() as { id: string }
      void finalRedirect(1200, `/dashboard/tree/${data.id}`)
    } catch {
      clearTimeout(timeoutId)
      // Seeding failed but profile + isOnboarded may already be set
      // server-side. Land on the tree page where they can plant manually.
      void finalRedirect(1500)
    }
  }

  async function handleBuildFromConversation() {
    // Heuristic fallback: use the student's last substantial message as the
    // problem statement if the structured profile never arrived.
    const lastUser = [...messages].reverse().find(m => m.role === 'user' && m.content.trim().length > 10)
    await generateAndRedirect({ problem: lastUser?.content.trim() })
  }

  async function handleProfileComplete(responseText: string) {
    const profileMatch = responseText.match(/\[PROFILE_COMPLETE\]\s*(\{[\s\S]*\})/)

    if (!profileMatch) {
      await handleBuildFromConversation()
      return
    }

    let profile: OnboardingProfile & { problem?: string }
    try {
      profile = JSON.parse(profileMatch[1]) as OnboardingProfile & { problem?: string }
    } catch {
      await handleBuildFromConversation()
      return
    }

    await generateAndRedirect({ problem: profile.problem })
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void sendMessage()
    }
  }

  // ── Generation / Summary screens ──────────────────────────────────────────

  if (stage === 'generating') {
    const STEPS = [
      { label: t('onboarding.gen.step1'), delay: 0 },
      { label: t('onboarding.gen.step2'), delay: 3 },
      { label: t('onboarding.gen.step3'), delay: 7 },
      { label: t('onboarding.gen.step4'), delay: 12 },
      { label: t('onboarding.gen.step5'), delay: 18 },
      { label: t('onboarding.gen.step6'), delay: 25 },
    ]

    return (
      <div className="fixed inset-0 z-50 bg-background flex flex-col items-center justify-center gap-8 px-6">
        {/* Animated orb */}
        <div className="relative">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
            className="w-20 h-20 rounded-full border-4 border-primary/20 border-t-primary"
          />
          <motion.div
            animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0.6, 0.3] }}
            transition={{ duration: 2, repeat: Infinity }}
            className="absolute inset-0 rounded-full bg-primary/10"
          />
        </div>

        <div className="text-center max-w-md">
          <h2 className="text-xl font-bold text-white mb-2">{t('onboarding.gen.title')}</h2>
          <p className="text-white/40 text-sm mb-1">
            {t('onboarding.gen.subtitle')}
          </p>
        </div>

        {/* Progress steps — appear one by one */}
        <div className="flex flex-col gap-1.5 items-start max-w-xs w-full">
          {STEPS.map((step, i) => (
            <motion.div
              key={step.label}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: step.delay }}
              className="flex items-center gap-2 text-xs"
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: step.delay + 2, type: 'spring' }}
              >
                <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
              </motion.div>
              <span className="text-white/50">{step.label}</span>
            </motion.div>
          ))}
        </div>

        {/* Mini pong game to kill time */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 5 }}>
          <MiniTetris />
        </motion.div>

        {/* Rotating fun facts */}
        <RotatingQuote />

        {/* Skip button after 3 minutes */}
        <SkipAfterDelay delay={60} onSkip={() => router.push('/dashboard')} />
      </div>
    )
  }

  if (stage === 'summary' || stage === 'redirecting') {
    return (
      <div className="fixed inset-0 z-50 bg-background flex flex-col items-center justify-center p-8">
        <AnimatePresence>
          {stage === 'summary' && <CurriculumSummaryView plan={generatedPlan} />}
          {stage === 'redirecting' && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center"
            >
              <Loader2 className="w-8 h-8 text-primary animate-spin mx-auto mb-3" />
              <p className="text-white/60">{t('onboarding.redirecting')}</p>
            </motion.div>
          )}
        </AnimatePresence>
        {stage === 'summary' && (
          <motion.button
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.8 }}
            onClick={() => { setStage('redirecting'); setTimeout(() => router.push('/dashboard'), 800) }}
            className="mt-8 bg-primary text-white px-8 py-3 rounded-xl font-semibold hover:bg-primary/90 transition-colors"
          >
            {t('onboarding.letsGo')}
          </motion.button>
        )}
      </div>
    )
  }

  // ── Main chat UI ──────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      {/* Language picker — self-gates to not-yet-onboarded users; onProceed
          unblocks Bob's first message in the chosen language. */}
      <LanguageChoiceModal onProceed={() => setLangChosen(true)} />
      <button
        onClick={() => signOut({ callbackUrl: '/login' })}
        className="absolute top-6 left-6 z-10 flex items-center gap-1.5 text-xs text-white/40 hover:text-white/80 transition-colors"
        title="Sign out and return to log in"
      >
        <LogOut className="w-3.5 h-3.5" />
        {t('setup.backToLogin')}
      </button>
      {/* Restore banner — shown for ~24h after a reset so accidental Start Over isn't catastrophic */}
      {recentArchive && !archiveDismissed && (
        <div className="flex-shrink-0 bg-amber-500/10 border-b border-amber-500/20 px-6 py-3">
          <div className="max-w-2xl mx-auto flex items-center justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-amber-100">
                {t('onboarding.restoreTitle')}
              </div>
              <div className="text-xs text-amber-200/70 mt-0.5">
                {recentArchive.title} · {recentArchive.completedChapters}/{recentArchive.totalChapters} {t('onboarding.chaptersCompleted')} · {recentArchive.overallProgress}% {t('onboarding.progress')}. {t('onboarding.availableUntil')} {new Date(recentArchive.expiresAt).toLocaleString()}.
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={() => setArchiveDismissed(true)}
                className="text-xs text-amber-200/60 hover:text-amber-100 px-2 py-1 transition-colors"
              >
                {t('onboarding.dismiss')}
              </button>
              <button
                onClick={handleRestore}
                disabled={restoring}
                className="text-xs font-medium bg-amber-500 hover:bg-amber-400 text-amber-950 px-3 py-1.5 rounded-md transition-colors disabled:opacity-50"
              >
                {restoring ? t('onboarding.restoring') : t('onboarding.restore')}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Header */}
      <div className="flex-shrink-0 px-6 pt-6 pb-4 border-b border-white/10">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center">
                <Bot className="w-4 h-4 text-primary" />
              </div>
              <div>
                <div className="text-sm font-semibold text-white">{t('onboarding.bobTitle')}</div>
                <div className="text-xs text-white/40">
                  {t(`onboarding.phase.${ONBOARDING_PHASES[phase]?.key}`)} · {t(`onboarding.phase.${ONBOARDING_PHASES[phase]?.key}Desc`)}
                </div>
              </div>
            </div>
            <div className="text-xs text-white/30">
              {messages.length > 0 ? `${messages.length} ${messages.length > 1 ? t('onboarding.messages') : t('onboarding.message')}` : t('onboarding.starting')}
            </div>
          </div>
          <PhaseIndicator phase={phase} total={ONBOARDING_PHASES.length} />
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-2xl mx-auto space-y-5">
          {messages.length === 0 && !isStreaming && (
            <div className="flex items-center justify-center h-32">
              <div className="flex gap-1">
                {[0, 1, 2].map(i => (
                  <motion.div
                    key={i}
                    className="w-2 h-2 rounded-full bg-primary/40"
                    animate={{ opacity: [0.3, 1, 0.3], y: [0, -4, 0] }}
                    transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
                  />
                ))}
              </div>
            </div>
          )}

          <AnimatePresence>
            {messages.map(msg => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
          </AnimatePresence>

          {isStreaming && streamingContent && (
            <MessageBubble
              message={{ id: 'streaming', role: 'assistant', content: streamingContent, timestamp: new Date() }}
            />
          )}
          {isStreaming && !streamingContent && <TypingIndicator />}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <div className="flex-shrink-0 px-6 pb-6 pt-4 border-t border-white/10">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-end gap-3">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('onboarding.placeholder')}
              disabled={isStreaming || stage !== 'chat'}
              rows={1}
              className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/30 resize-none focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40 transition-all disabled:opacity-40 min-h-[48px] max-h-28"
            />
            <button
              onClick={() => void sendMessage()}
              disabled={!input.trim() || isStreaming || stage !== 'chat'}
              className="w-11 h-11 flex-shrink-0 rounded-xl bg-primary flex items-center justify-center text-white hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
          <p className="text-center text-[11px] text-white/25 mt-2">
            {t('onboarding.pressEnter')}
          </p>
          {messages.length >= 5 && stage === 'chat' && !isStreaming && (
            <button
              onClick={() => void handleBuildFromConversation()}
              className="w-full mt-3 py-2.5 rounded-xl bg-primary/15 border border-primary/30 text-primary text-sm font-medium hover:bg-primary/25 hover:border-primary/50 transition-all flex items-center justify-center gap-2"
            >
              <Sparkles className="w-4 h-4" />
              {t('onboarding.buildNow')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

