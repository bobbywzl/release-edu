'use client'
import React, { useState, useRef, useEffect, useCallback, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import {
  Bot, Send, Plus, MessageSquare, Trash2, ChevronRight, ChevronLeft,
  ChevronDown, ChevronUp, Lightbulb, Target, Zap, BookOpen,
  Camera, X, Sparkles, Search, GraduationCap, SearchIcon, ClipboardList, FolderOpen,
  ThumbsUp, ThumbsDown, Paperclip, PanelLeftOpen, PanelRightOpen, Mic, Volume2, VolumeX,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSpeechRecognition, speak, stopSpeaking, speechSynthesisSupported, voiceLangTag } from '@/lib/use-voice'
import { triggerCurriculumRefresh } from '@/lib/refresh-bus'
import { pumpChatStream, getActiveChatStream, subscribeChatStream } from '@/lib/chat-stream'
import { SessionProgressBar } from '@/components/session-progress-bar'
import { Progress } from '@/components/ui/progress'
import { useHighlights } from '@/lib/highlights'
import type { Highlight } from '@/lib/highlights'
import { useStudentData } from '@/lib/student-data'
import { useLanguage } from '@/lib/i18n'
import { HighlightableText } from '@/components/highlightable-text'
import { RightPanel } from '@/components/right-panel'
import { useIsMobile } from '@/lib/use-is-mobile'
import { MermaidDiagram } from '@/components/mermaid-diagram'
import { DataChart } from '@/components/data-chart'
import { FuncPlot } from '@/components/func-plot'

// ── Shared Markdown Renderer (math, code, tables) ────────────────────────────

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
      className={cn('transition-colors', label ? 'text-[10px] text-muted-foreground/40 hover:text-foreground' : 'p-1 rounded text-muted-foreground/40 hover:text-foreground')}
      title="Copy"
    >
      {copied ? (
        <span className={label ? '' : 'text-[10px]'}>✓</span>
      ) : label ? (
        label
      ) : (
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
      )}
    </button>
  )
}

/**
 * Preprocess content to fix common KaTeX rendering issues.
 *
 * The core problem: remark-gfm (tables) processes pipe characters `|` BEFORE
 * remark-math processes LaTeX. So `$|ψ\rangle$` gets its `|` eaten by the
 * table parser, breaking the math. We fix this by converting `|` inside
 * math delimiters to `\vert` before the markdown parser sees it.
 *
 * Also fixes orphaned $ delimiters and unclosed math expressions.
 */
function preprocessMathContent(raw: string): string {
  let content = raw

  // ── Step 1: Protect pipe chars inside math from remark-gfm table parsing ──
  // Replace | inside $...$ and $$...$$ with \vert so tables don't break them
  // Block math ($$...$$)
  content = content.replace(/\$\$([\s\S]*?)\$\$/g, (match, inner: string) => {
    // Replace bare | that are part of bra-ket notation with \vert
    // But don't replace \| (already escaped) or | inside \left| \right|
    const fixed = inner.replace(/(?<!\\)(?<!\bleft)\|(?!\|)/g, '\\vert ')
    return `$$${fixed}$$`
  })
  // Inline math ($...$) — fix pipes inside single-line math
  content = content.replace(/(?<!\$)\$(?!\$)((?:[^$\n]|\\\$)+?)\$(?!\$)/g, (match, inner: string) => {
    if (!inner.includes('|')) return match
    const fixed = inner.replace(/(?<!\\)(?<!\bleft)\|(?!\|)/g, '\\vert ')
    return `$${fixed}$`
  })
  // Multi-line math written with single $ — convert to $$ display math
  // Matches $ at end of line ... $ at start of line (with optional whitespace)
  content = content.replace(/(?<!\$)\$(?!\$)((?:[^$]|\\\$)*?\n(?:[^$]|\\\$)*?)\$(?!\$)/g, (match, inner: string) => {
    // Only convert if the inner content has LaTeX commands (not just random $...$)
    if (!/\\[a-zA-Z]/.test(inner)) return match
    const fixed = inner.replace(/(?<!\\)(?<!\bleft)\|(?!\|)/g, '\\vert ')
    return `$$${fixed}$$`
  })

  // ── Step 2: Fix truly orphaned $ signs ──
  // Only escape $ that is clearly NOT math: surrounded by spaces/punctuation
  // with no LaTeX commands nearby. We must be conservative here — escaping
  // a valid math $ breaks rendering entirely.
  // Only target: standalone "$" on a line by itself, or "$ " at line start with no backslash content
  content = content.replace(/^(\$)\s*$/gm, '\\$')

  // ── Step 3: Auto-close unclosed LaTeX (e.g. $\psi(x) = \langle x\n) ──
  content = content.replace(/\$([^$\n]*\\(?:psi|phi|langle|rangle|alpha|beta|gamma|delta|vec|frac|int|sum|sqrt|infty|partial|nabla|theta|omega|sigma|lambda|mu|epsilon|pi|tau|eta|chi|xi|zeta|kappa|iota|rho|nu|upsilon|varepsilon|varphi)[^$\n]*?)(?:\n|$)/g, (match, inner) => {
    if (!match.trimEnd().endsWith('$')) {
      return `$${inner.trim()}$\n`
    }
    return match
  })

  return content
}

/**
 * Lightweight inline math renderer for quiz options / short text.
 * Unlike ChatMarkdown, this renders as a <span> (no block elements)
 * so it's safe inside <button>, <p>, etc.
 */
function InlineMath({ content: rawContent }: { content: string }) {
  const content = preprocessMathContent(rawContent)
  return (
    <span className="[&_.katex]:text-[0.95em]">
      <ReactMarkdown
        remarkPlugins={[remarkMath]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, errorColor: 'currentColor', strict: 'ignore' }]]}
        components={{
          p({ children }) { return <span>{children}</span> },
          strong({ children }) { return <strong className="font-semibold">{children}</strong> },
          em({ children }) { return <em>{children}</em> },
          code({ children }) { return <code className="bg-muted/80 px-1 py-0.5 rounded text-[13px] font-mono">{children}</code> },
        }}
      >
        {content}
      </ReactMarkdown>
    </span>
  )
}

function ChatMarkdown({ content: rawContent }: { content: string }) {
  const content = preprocessMathContent(rawContent)
  // Pre-extract LaTeX sources so we can offer "Copy LaTeX" on rendered math
  // Store mapping: rendered text → original LaTeX
  const mathSources = useRef<Map<string, string>>(new Map())
  useEffect(() => {
    const map = new Map<string, string>()
    // Block math
    const blockRegex = /\$\$([\s\S]*?)\$\$/g
    let m
    while ((m = blockRegex.exec(content)) !== null) map.set(m[1].trim(), m[0])
    // Inline math
    const inlineRegex = /(?<!\$)\$([^\$\n]+?)\$(?!\$)/g
    while ((m = inlineRegex.exec(content)) !== null) map.set(m[1].trim(), m[1])
    mathSources.current = map
  }, [content])

  return (
    <div
      className="max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_.katex-display]:my-5 [&_.katex-display]:text-center [&_.katex-display]:cursor-pointer [&_.katex-display:hover]:bg-muted/10 [&_.katex-display]:rounded-lg [&_.katex-display]:py-3 [&_.katex-display]:px-4 [&_.katex-display]:transition-colors [&_.katex]:cursor-pointer [&_.katex-display_.katex]:text-[1.3em] [&_.katex]:text-[1.1em]"
      // Add click handler for math elements — show copy tooltip
      onClick={(e) => {
        const target = e.target as HTMLElement
        const katexEl = target.closest('.katex-display, .katex:not(.katex-display .katex)')
        if (!katexEl) return
        // Find the LaTeX source from the annotation element
        const annotation = katexEl.querySelector('annotation[encoding="application/x-tex"]')
        if (annotation?.textContent) {
          const latex = annotation.textContent
          const isBlock = katexEl.classList.contains('katex-display') || katexEl.parentElement?.classList.contains('katex-display')
          navigator.clipboard.writeText(isBlock ? `$$${latex}$$` : `$${latex}$`)
          // Brief visual feedback
          const el = katexEl as HTMLElement
          el.style.outline = '1px solid hsl(var(--primary))'
          el.style.outlineOffset = '2px'
          el.style.borderRadius = '4px'
          setTimeout(() => { el.style.outline = ''; el.style.outlineOffset = '' }, 800)
        }
      }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, errorColor: 'currentColor', strict: 'ignore' }]]}
        components={{
          code({ children, className }) {
            const match = /language-(\w+)/.exec(className || '')
            const isInline = !className
            if (isInline) {
              return (
                <code className="bg-muted/80 px-1.5 py-0.5 rounded text-[14.5px] font-mono text-primary border border-border/40">
                  {children}
                </code>
              )
            }
            const codeText = String(children).replace(/\n$/, '')
            const lang = match?.[1] || 'text'
            return (
              <div className="relative group/code my-3 not-prose">
                <div className="flex items-center justify-between bg-[#21222c] border border-border/30 border-b-0 rounded-t-xl px-4 py-1.5">
                  <span className="text-[10px] text-muted-foreground/50 font-mono uppercase">{lang}</span>
                  <CopyButton text={codeText} label="Copy code" />
                </div>
                <SyntaxHighlighter
                  language={lang}
                  style={oneDark}
                  customStyle={{ margin: 0, borderRadius: '0 0 12px 12px', border: '1px solid hsl(var(--border) / 0.3)', borderTop: 'none', fontSize: '13px', lineHeight: '1.6' }}
                  showLineNumbers={codeText.split('\n').length > 3}
                  lineNumberStyle={{ minWidth: '2.5em', paddingRight: '1em', color: 'rgba(255,255,255,0.15)', fontSize: '11px' }}
                >
                  {codeText}
                </SyntaxHighlighter>
              </div>
            )
          },
          strong({ children }) {
            return <strong className="font-semibold text-foreground">{children}</strong>
          },
          em({ children }) {
            return <em className="italic text-foreground/80">{children}</em>
          },
          p({ children }) {
            return <p className="mb-3.5 last:mb-0 leading-[1.7] text-[17px] lg:text-[16px] text-foreground/90">{children}</p>
          },
          h1({ children }) {
            return <h1 className="text-2xl font-bold text-foreground mt-7 mb-3 pb-2 border-b border-border/40">{children}</h1>
          },
          h2({ children }) {
            return <h2 className="text-xl font-bold text-foreground mt-6 mb-2.5 pb-1.5 border-b border-border/30">{children}</h2>
          },
          h3({ children }) {
            return <h3 className="text-lg font-semibold text-foreground mt-5 mb-2">{children}</h3>
          },
          h4({ children }) {
            return <h4 className="text-base font-semibold text-foreground/90 mt-4 mb-1.5">{children}</h4>
          },
          ul({ children }) {
            return <ul className="my-3.5 space-y-2.5 pl-5 list-disc marker:text-muted-foreground/40">{children}</ul>
          },
          ol({ children }) {
            return <ol className="my-3.5 space-y-2.5 pl-5 list-decimal marker:text-muted-foreground/60">{children}</ol>
          },
          li({ children }) {
            return <li className="text-[17px] lg:text-[16px] text-foreground/90 leading-[1.7] pl-1">{children}</li>
          },
          blockquote({ children }) {
            return (
              <blockquote className="border-l-[3px] border-primary/30 pl-4 my-4 py-2 text-[15.5px] text-foreground/70 italic [&>p]:mb-1.5">
                {children}
              </blockquote>
            )
          },
          table({ children }) {
            return (
              <div className="overflow-x-auto my-4 rounded-xl border border-border/30 bg-muted/5">
                <table className="w-full text-[15px]">{children}</table>
              </div>
            )
          },
          thead({ children }) {
            return <thead className="bg-muted/20 border-b border-border/30">{children}</thead>
          },
          th({ children }) {
            return <th className="px-4 py-2.5 text-left font-semibold text-foreground/70 text-[13px] uppercase tracking-wider">{children}</th>
          },
          td({ children }) {
            return <td className="px-4 py-3 border-t border-border/15 text-foreground/80">{children}</td>
          },
          hr() {
            return <hr className="my-6 border-border/20" />
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

// ── Chat Modes (must match server-side ChatMode type) ────────────────────────

type ChatMode = 'tutoring' | 'research' | 'logistics'

interface ModeOption {
  id: ChatMode
  label: string
  shortLabel: string
  description: string
  icon: React.ComponentType<{ className?: string }>
}

const MODES: ModeOption[] = [
  { id: 'tutoring', label: 'Tutoring', shortLabel: 'Mentor', description: 'Socratic mentoring', icon: GraduationCap },
  { id: 'research', label: 'Research', shortLabel: 'Research', description: 'Deep exploration', icon: SearchIcon },
  { id: 'logistics', label: 'Logistics & Curriculum', shortLabel: 'Curriculum', description: 'Logistics & Curriculum — changes & planning', icon: ClipboardList },
]

// ── Types ────────────────────────────────────────────────────────────────────

interface ApiConversation {
  id: string
  title: string
  context: string | null
  preview: string
  messageCount: number
  createdAt: string
  updatedAt: string
}

interface ApiMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}

interface LocalMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: Date
  modeSwitch?: ChatMode // marks a mode-switch divider
  hidden?: boolean // hide auto system-instruction messages from UI
}

// Dynamic time-aware greeting for the empty chat state
function getBobGreeting(name: string | null): { title: string; subtitle: string } {
  const hour = new Date().getHours()
  const n = name || 'there'

  const pools: Record<string, Array<{ title: string; subtitle: string }>> = {
    earlyMorning: [
      { title: `Rise and grind ☀️`, subtitle: `Up early, ${n}? Let's make these hours count.` },
      { title: `You're up early!`, subtitle: `Most people are still asleep, ${n}. Let's use that edge.` },
      { title: `Morning, ${n} 🌅`, subtitle: `Brain's fresh, the day's wide open — what are we learning?` },
      { title: `Oh hey, an early bird 🐦`, subtitle: `Good to see you at this hour, ${n}. What's on the agenda?` },
    ],
    morning: [
      { title: `Morning, ${n} ☀️`, subtitle: `Coffee optional, curiosity required. What's on your mind?` },
      { title: `Good morning!`, subtitle: `Ready to learn something cool today, ${n}?` },
      { title: `Hey ${n}, good morning 👋`, subtitle: `Peak focus hours — let's put them to good use.` },
      { title: `Oh nice, ${n}'s here 🎯`, subtitle: `Morning brain is the sharpest brain. Let's go.` },
      { title: `Morning momentum, ${n} 🚀`, subtitle: `Great time to tackle something you've been putting off.` },
    ],
    midday: [
      { title: `Hey ${n}! 👋`, subtitle: `Midday check-in — how's the studying going?` },
      { title: `Afternoon, ${n} 🎯`, subtitle: `Good time to push through something challenging.` },
      { title: `Welcome back, ${n}`, subtitle: `Right in the thick of the day. What are we working on?` },
      { title: `Oh, it's ${n} 😄`, subtitle: `Lunchtime learning — respect. What's the topic today?` },
    ],
    afternoon: [
      { title: `Hey ${n} ⚡`, subtitle: `Afternoon slump? Not on my watch. Let's go.` },
      { title: `Afternoon, ${n}!`, subtitle: `The best time to lock in and get something done.` },
      { title: `There you are, ${n} 👀`, subtitle: `Afternoon deep work session incoming — I'm ready.` },
      { title: `${n}! Perfect timing 🎯`, subtitle: `Afternoons are underrated for learning. What's up?` },
      { title: `Back at it, ${n}?`, subtitle: `Good — consistency beats intensity. What's on the list?` },
    ],
    evening: [
      { title: `Evening, ${n} 🌆`, subtitle: `Wrapping up the day with something useful — I like it.` },
      { title: `Hey ${n}, welcome back 👋`, subtitle: `Good time to consolidate what you learned today.` },
      { title: `Evening grind, ${n}? 💪`, subtitle: `Day's winding down but your brain's still sharp. Let's use it.` },
      { title: `Oh hey ${n} 🌇`, subtitle: `Perfect time to revisit something before it fades.` },
    ],
    night: [
      { title: `Night owl mode 🌙`, subtitle: `Hey ${n} — the quiet hours are yours. What are we tackling?` },
      { title: `Late night session, ${n}?`, subtitle: `Some of the best breakthroughs happen right now. Let's go.` },
      { title: `Hey ${n} 🌙`, subtitle: `World's quiet, brain's loud — perfect conditions for thinking.` },
      { title: `Still at it, ${n}? 🦉`, subtitle: `Respect the dedication. I'm here, let's make it count.` },
      { title: `${n}! A fellow night thinker 🌙`, subtitle: `Best ideas come late. What's on your mind?` },
    ],
    lateNight: [
      { title: `Midnight oil, ${n}? 🦉`, subtitle: `Bold move. I'll keep up — what are we deep-diving into?` },
      { title: `It's late, ${n} 🌙`, subtitle: `But you're here, so let's make it worth it.` },
      { title: `Hey ${n}, burning bright 🔥`, subtitle: `The dedicated ones show up at all hours. What's the question?` },
      { title: `Oh, a midnight scholar 🦉`, subtitle: `${n}, you never cease to impress. What's on the agenda?` },
    ],
  }

  let pool: Array<{ title: string; subtitle: string }>
  if (hour >= 5 && hour < 8)        pool = pools.earlyMorning
  else if (hour >= 8 && hour < 12)  pool = pools.morning
  else if (hour >= 12 && hour < 14) pool = pools.midday
  else if (hour >= 14 && hour < 17) pool = pools.afternoon
  else if (hour >= 17 && hour < 20) pool = pools.evening
  else if (hour >= 20 && hour < 23) pool = pools.night
  else                               pool = pools.lateNight

  return pool[Math.floor(Math.random() * pool.length)]
}

// Auto-sent system instructions that should not appear in the chat UI
function isAutoSystemMessage(content: string): boolean {
  return (
    content.startsWith('[RESUME SESSION]') ||
    content.startsWith('[NEW SESSION — START]') ||
    content.startsWith('[PROJECT REVIEW SESSION]') ||
    content.startsWith('[PROJECT OVERVIEW REQUEST]')
  )
}

// ── Typing Indicator ─────────────────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div className="flex items-end gap-3 max-w-[85%]">
      <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
        <Bot className="w-3.5 h-3.5 text-primary" />
      </div>
      <div className="bg-card border border-border rounded-2xl rounded-bl-sm px-4 py-3">
        <div className="flex items-center gap-1">
          {[0, 1, 2].map(i => (
            <motion.div
              key={i}
              className="w-2 h-2 rounded-full bg-muted-foreground"
              animate={{ opacity: [0.3, 1, 0.3], y: [0, -4, 0] }}
              transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Message Bubble ────────────────────────────────────────────────────────────

function MessageBubbleImpl({ message, highlights: msgHighlights, onAddHighlight, onUpdateHighlight, onDeleteHighlight, onHighlightClick, focusedHighlightId, onQuizAnswer, onQuizScore, onSubmissionReview, onFeedback, existingFeedback, answeredQuestionIds, onReply, onRegenerate, lessonMode, capstoneUnlocked }: { message: LocalMessage; highlights?: Highlight[]; onAddHighlight?: (data: { messageId: string; selectedText: string; startOffset: number; endOffset: number; color: string; comment: string | null }) => Promise<Highlight | undefined>; onUpdateHighlight?: (id: string, data: { comment?: string; color?: string }) => void; onDeleteHighlight?: (id: string) => void; onHighlightClick?: (id: string) => void; focusedHighlightId?: string | null; onQuizAnswer?: (answer: string) => void; onQuizScore?: (questionId: string, score: number) => void; onSubmissionReview?: (review: ParsedSubmissionReview) => void; onFeedback?: (messageId: string, rating: 1 | -1) => void; existingFeedback?: number | null; answeredQuestionIds?: Set<string>; onReply?: (quotedText: string) => void; onRegenerate?: () => void; lessonMode?: boolean; capstoneUnlocked?: boolean }) {
  const isUser = message.role === 'user'
  // Parse quiz blocks from assistant messages
  const { text: cleanContent, quizzes } = !isUser
    ? parseQuizBlocks(message.content)
    : { text: message.content, quizzes: [] }
  // Parse problem and submission-review blocks
  const { text: afterProblems, problems: rawProblems } = !isUser
    ? parseProblemBlocks(cleanContent)
    : { text: cleanContent, problems: [] }
  // Capstone guardrail (client-side): Bob sometimes emits ```problem blocks
  // before the system has unlocked the capstone (sessionScore < 80). The
  // server-side strip catches this on the next page load; this filter
  // catches the in-flight streamed pset so the student never sees a
  // premature capstone at all. Parent passes capstoneUnlocked = score>=80.
  const problems = capstoneUnlocked === false ? [] : rawProblems
  const { text: afterReview, review } = !isUser
    ? parseSubmissionReview(afterProblems)
    : { text: afterProblems, review: null }
  // Parse mermaid, chart, and funcplot blocks from assistant messages
  const { text: afterMermaid, diagrams: mermaidDiagrams } = !isUser
    ? parseMermaidBlocks(afterReview)
    : { text: afterReview, diagrams: [] }
  const { text: afterCharts, charts: chartBlocks } = !isUser
    ? parseChartBlocks(afterMermaid)
    : { text: afterMermaid, charts: [] }
  const { text: afterFuncPlots, funcPlots } = !isUser
    ? parseFuncPlotBlocks(afterCharts)
    : { text: afterCharts, funcPlots: [] }
  // Strip progress and reflection blocks from display
  const displayContent = !isUser
    ? afterFuncPlots.replace(/```progress\n[\s\S]*?```/g, '').replace(/```reflection\n[\s\S]*?```/g, '').replace(/\[CHAPTER_MASTERED\]/gi, '').trim()
    : afterFuncPlots

  const feedback = existingFeedback ?? null

  // Fire submission review callback once
  const reviewFired = useRef(false)
  useEffect(() => {
    if (review && !reviewFired.current && onSubmissionReview) {
      reviewFired.current = true
      onSubmissionReview(review)
    }
  }, [review, onSubmissionReview])

  const hasHighlightSupport = !isUser && msgHighlights && onAddHighlight && onUpdateHighlight && onDeleteHighlight

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      data-message-id={message.id}
      // content-visibility lets the browser skip layout/paint for this
      // bubble while it's scrolled out of view. Combined with windowing it
      // keeps long chats cheap to type in. `contain-intrinsic-size` reserves
      // a rough height so the scrollbar doesn't jump as bubbles virtualize.
      // Skip it for the live streaming bubble (id 'streaming') so its
      // height tracks content updates smoothly.
      style={message.id === 'streaming' ? undefined : { contentVisibility: 'auto', containIntrinsicSize: 'auto 240px' }}
      className={cn(
        'group flex items-end gap-3 transition-colors duration-700',
        isUser ? 'flex-row-reverse' : '',
        '[&.highlight-pulse]:bg-primary/10 [&.highlight-pulse]:rounded-xl',
        lessonMode && 'w-full max-w-3xl'
      )}
    >
      {!isUser && !lessonMode && (
        <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
          <Bot className="w-3.5 h-3.5 text-primary" />
        </div>
      )}
      <div
        className={cn(
          'rounded-2xl px-5 py-4 text-base',
          lessonMode && !isUser
            ? 'w-full bg-transparent border-0 px-2 py-2'
            : isUser
              ? 'max-w-[85%] bg-primary text-primary-foreground rounded-br-sm'
              : 'max-w-[85%] bg-card border border-border text-foreground rounded-bl-sm'
        )}
      >
        {isUser ? (
          (() => {
            const replyMatch = displayContent.match(/^\[Referring to this specific part of your response: "(.+?)"\]\n\n([\s\S]*)$/)
            if (replyMatch) {
              return (
                <div>
                  <div className="mb-2 pl-2 border-l-2 border-primary-foreground/30 text-xs text-primary-foreground/70 italic leading-relaxed">
                    &ldquo;{replyMatch[1]}&rdquo;
                  </div>
                  <p className="whitespace-pre-wrap leading-relaxed">{replyMatch[2]}</p>
                </div>
              )
            }
            return <p className="whitespace-pre-wrap leading-relaxed">{displayContent}</p>
          })()
        ) : hasHighlightSupport ? (
          <HighlightableText
            messageId={message.id}
            highlights={msgHighlights!}
            focusedHighlightId={focusedHighlightId}
            onAddHighlight={onAddHighlight!}
            onUpdateHighlight={onUpdateHighlight!}
            onDeleteHighlight={onDeleteHighlight!}
            onHighlightClick={onHighlightClick}
            onReply={onReply}
          >
            <ChatMarkdown content={displayContent} />
            {problems.map((prob, i) => (
              <ProblemBlock key={`prob-${i}`} {...prob} />
            ))}
            {quizzes.map((quiz, i) => (
              <QuizBlock
                key={i}
                quiz={quiz}
                onAnswer={(answer) => onQuizAnswer?.(answer)}
                onCorrect={onQuizScore}
                initialAnswered={answeredQuestionIds?.has(getQuestionId(quiz.question))}
              />
            ))}
            {review && <SubmissionReviewBlock review={review} />}
            {mermaidDiagrams.map((chart, i) => (
              <MermaidDiagram key={`mermaid-${i}`} chart={chart} />
            ))}
            {chartBlocks.map((raw, i) => (
              <DataChart key={`chart-${i}`} raw={raw} />
            ))}
            {funcPlots.map((raw, i) => (
              <FuncPlot key={`funcplot-${i}`} raw={raw} />
            ))}
          </HighlightableText>
        ) : (
          <>
            <ChatMarkdown content={displayContent} />
            {problems.map((prob, i) => (
              <ProblemBlock key={`prob-${i}`} {...prob} />
            ))}
            {quizzes.map((quiz, i) => (
              <QuizBlock
                key={i}
                quiz={quiz}
                onAnswer={(answer) => onQuizAnswer?.(answer)}
                onCorrect={onQuizScore}
                initialAnswered={answeredQuestionIds?.has(getQuestionId(quiz.question))}
              />
            ))}
            {review && <SubmissionReviewBlock review={review} />}
            {mermaidDiagrams.map((chart, i) => (
              <MermaidDiagram key={`mermaid-${i}`} chart={chart} />
            ))}
            {chartBlocks.map((raw, i) => (
              <DataChart key={`chart-${i}`} raw={raw} />
            ))}
            {funcPlots.map((raw, i) => (
              <FuncPlot key={`funcplot-${i}`} raw={raw} />
            ))}
          </>
        )}
        <div className={cn('text-[10px] mt-1.5 opacity-60', isUser ? 'text-right' : '')}>
          {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
        {/* Action row — copy, feedback, regenerate, PDF */}
        {!isUser && message.id !== 'streaming' && (
          <div className="flex items-center gap-0.5 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
            {/* Copy message */}
            <CopyButton text={message.content} label="" />
            <span className="w-px h-3 bg-border/30 mx-1" />
            <button
              onClick={() => onFeedback?.(message.id, 1)}
              className={cn('p-1 rounded transition-colors', feedback === 1 ? 'text-emerald-400' : 'text-muted-foreground/40 hover:text-emerald-400')}
              title="Good response"
            >
              <ThumbsUp className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onFeedback?.(message.id, -1)}
              className={cn('p-1 rounded transition-colors', feedback === -1 ? 'text-red-400' : 'text-muted-foreground/40 hover:text-red-400')}
              title="Bad response"
            >
              <ThumbsDown className="w-3.5 h-3.5" />
            </button>
            {/* Regenerate */}
            {onRegenerate && (
              <button onClick={onRegenerate} className="p-1 rounded text-muted-foreground/40 hover:text-foreground transition-colors" title="Regenerate response">
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 4v6h6M23 20v-6h-6" /><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" /></svg>
              </button>
            )}
            {/* Save as PDF — for long-form document responses */}
            {displayContent.length > 800 && /#{1,3} |---|\|.*\|/.test(displayContent) && (
              <button
                onClick={async () => {
                  const titleMatch = displayContent.match(/^#+ (.+)$/m)
                  const title = titleMatch?.[1] || 'Document'
                  const res = await fetch('/api/pdf', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title, markdown: displayContent }),
                  })
                  if (res.ok) {
                    const blob = await res.blob()
                    const url = URL.createObjectURL(blob)
                    const w = window.open(url, '_blank')
                    if (w) setTimeout(() => URL.revokeObjectURL(url), 60000)
                  }
                }}
                className="p-1 rounded text-muted-foreground/40 hover:text-primary transition-colors ml-1"
                title="Open as printable document"
              >
                <FolderOpen className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
      </div>
    </motion.div>
  )
}

/**
 * Memoized wrapper around MessageBubbleImpl.
 *
 * Why: during streaming, the parent re-renders on every chunk to update the
 * last message's content. Without memo, EVERY prior message also re-renders
 * — and each re-render runs the full quiz/reflection/mermaid/funcplot parse
 * pipeline plus the markdown renderer. On a 50-message conversation this
 * costs ~150ms per chunk and the chat becomes visibly laggy.
 *
 * Custom comparator: skip re-render if message identity + content + a tiny
 * set of mutable per-message inputs (highlights, answeredQuestionIds, focus
 * state) are unchanged. The callbacks are intentionally NOT compared — the
 * parent uses stable references for them (created at chat root, not per-row).
 */
const MessageBubble = React.memo(MessageBubbleImpl, (prev, next) => {
  if (prev.message.id !== next.message.id) return false
  if (prev.message.content !== next.message.content) return false
  if (prev.message.role !== next.message.role) return false
  if (prev.focusedHighlightId !== next.focusedHighlightId) return false
  if (prev.existingFeedback !== next.existingFeedback) return false
  if (prev.lessonMode !== next.lessonMode) return false
  if (prev.capstoneUnlocked !== next.capstoneUnlocked) return false
  // Highlight array equality by length + identity check on each item (cheap).
  const a = prev.highlights ?? []
  const b = next.highlights ?? []
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  // answeredQuestionIds is a Set — compare by reference (parent recreates
  // it only when an answer lands; that IS when we want a re-render).
  if (prev.answeredQuestionIds !== next.answeredQuestionIds) return false
  return true
})

// ── Context Panel ─────────────────────────────────────────────────────────────

interface StudentContextSummary {
  name: string
  stage: string
  xp: number
  streak: number
  currentTopics: string[]
  struggling: string[]
  projects: string[]
}

// ── Quiz Block Parser & Component ─────────────────────────────────────────────

interface ParsedReflection {
  gap: string
  gapDepth: string
  gapResolved: string
  confidence: string
  lastQuizScore: string
  nextFocus: string
  approach: string
  explainedThisTurn: string
  covered: string
  stuckOn: string
  personalThread: string
  quizBalance: string
  quizCompliance: string
  quizViolationDetail: string
  streakCorrect: string
  streakWrong: string
  currentDifficulty: string
  nextDifficulty: string
}

function parseReflectionBlock(text: string): { reflection: ParsedReflection | null } {
  const match = text.match(/```reflection\n([\s\S]*?)```/)
  if (!match) return { reflection: null }
  const lines = match[1].split('\n')
  const get = (key: string) => lines.find(l => l.startsWith(`${key}:`))?.split(':').slice(1).join(':').trim() || ''
  return {
    reflection: {
      gap: get('GAP'),
      gapDepth: get('GAP_DEPTH'),
      gapResolved: get('GAP_RESOLVED'),
      confidence: get('CONFIDENCE'),
      lastQuizScore: get('LAST_QUIZ_SCORE'),
      nextFocus: get('NEXT_FOCUS'),
      approach: get('APPROACH'),
      explainedThisTurn: get('EXPLAINED_THIS_TURN'),
      covered: get('COVERED'),
      stuckOn: get('STUCK_ON'),
      personalThread: get('PERSONAL_THREAD'),
      quizBalance: get('QUIZ_BALANCE'),
      quizCompliance: get('QUIZ_COMPLIANCE'),
      quizViolationDetail: get('QUIZ_VIOLATION_DETAIL'),
      streakCorrect: get('STREAK_CORRECT'),
      streakWrong: get('STREAK_WRONG'),
      currentDifficulty: get('CURRENT_DIFFICULTY'),
      nextDifficulty: get('NEXT_DIFFICULTY'),
    }
  }
}

interface ParsedQuiz {
  question: string
  type: 'multiple-choice' | 'short-answer' | 'true-false'
  options: string[]
  answer: string
  keywords?: string[]
  expectedLength?: string
  explanation: string
}

interface ParsedProgress {
  score: number
  objectives: Record<string, string>
  notes: string
}

interface ParsedProblem {
  number: string
  question: string
  type: string
  points: string
  accept?: string // text | image | file
  expectations?: ParsedExpectations
}

interface ParsedExpectations {
  problem: string
  learningGoals: string
  strongAnswer: string
  criticalThinkingMarkers: string
  commonMistakes: string
  acceptFormat: string
}

interface ParsedSubmissionReview {
  scores: { problem: string; score: string; feedback: string }[]
  totalScore: string
  passed: boolean
  feedback: string
}

function parseExpectationsBlocks(content: string): { text: string; expectations: ParsedExpectations[] } {
  const regex = /```expectations\n([\s\S]*?)```/g
  const expectations: ParsedExpectations[] = []
  const text = content.replace(regex, (_, block: string) => {
    const e: ParsedExpectations = { problem: '', learningGoals: '', strongAnswer: '', criticalThinkingMarkers: '', commonMistakes: '', acceptFormat: 'text' }
    for (const line of block.split('\n')) {
      if (line.startsWith('PROBLEM:')) e.problem = line.slice(8).trim()
      else if (line.startsWith('LEARNING_GOALS:')) e.learningGoals = line.slice(15).trim()
      else if (line.startsWith('STRONG_ANSWER:')) e.strongAnswer = line.slice(14).trim()
      else if (line.startsWith('CRITICAL_THINKING_MARKERS:')) e.criticalThinkingMarkers = line.slice(26).trim()
      else if (line.startsWith('COMMON_MISTAKES:')) e.commonMistakes = line.slice(16).trim()
      else if (line.startsWith('ACCEPT_FORMAT:')) e.acceptFormat = line.slice(14).trim()
    }
    if (e.problem) expectations.push(e)
    return '' // hide from displayed text
  })
  return { text: text.trim(), expectations }
}

function parseProblemBlocks(content: string): { text: string; problems: ParsedProblem[] } {
  // First extract expectations (hidden), then problems
  const { text: afterExpectations, expectations } = parseExpectationsBlocks(content)
  const regex = /```problem\n([\s\S]*?)```/g
  const problems: ParsedProblem[] = []
  const text = afterExpectations.replace(regex, (_, block: string) => {
    const p: ParsedProblem = { number: '', question: '', type: '', points: '' }
    for (const line of block.split('\n')) {
      if (line.startsWith('NUMBER:')) p.number = line.slice(7).trim()
      else if (line.startsWith('QUESTION:')) p.question = line.slice(9).trim()
      else if (line.startsWith('TYPE:')) p.type = line.slice(5).trim()
      else if (line.startsWith('POINTS:')) p.points = line.slice(7).trim()
      else if (line.startsWith('ACCEPT:')) p.accept = line.slice(7).trim()
    }
    // Match expectations to problem by number
    const matchingExp = expectations.find(e => e.problem === p.number || p.number.startsWith(e.problem))
    if (matchingExp) p.expectations = matchingExp
    if (p.question) problems.push(p)
    return ''
  })
  return { text: text.trim(), problems }
}

function parseSubmissionReview(content: string): { text: string; review: ParsedSubmissionReview | null } {
  const regex = /```submission-review\n([\s\S]*?)```/g
  let review: ParsedSubmissionReview | null = null
  const text = content.replace(regex, (_, block: string) => {
    const r: ParsedSubmissionReview = { scores: [], totalScore: '0', passed: false, feedback: '' }
    const scoreMap: Record<string, { score: string; feedback: string }> = {}
    for (const line of block.split('\n')) {
      const scoreMatch = line.match(/^PROBLEM_(\d+)_SCORE:\s*(.+)/)
      const feedbackMatch = line.match(/^PROBLEM_(\d+)_FEEDBACK:\s*(.+)/)
      if (scoreMatch) {
        const num = scoreMatch[1]
        if (!scoreMap[num]) scoreMap[num] = { score: '', feedback: '' }
        scoreMap[num].score = scoreMatch[2].trim()
      } else if (feedbackMatch) {
        const num = feedbackMatch[1]
        if (!scoreMap[num]) scoreMap[num] = { score: '', feedback: '' }
        scoreMap[num].feedback = feedbackMatch[2].trim()
      } else if (line.startsWith('TOTAL_SCORE:')) {
        r.totalScore = line.slice(12).trim()
      } else if (line.startsWith('PASSED:')) {
        r.passed = line.slice(7).trim().toLowerCase() === 'true'
      } else if (line.startsWith('OVERALL_FEEDBACK:')) {
        r.feedback = line.slice(17).trim()
      }
    }
    r.scores = Object.entries(scoreMap).map(([num, data]) => ({
      problem: num, score: data.score, feedback: data.feedback,
    }))
    if (r.scores.length > 0) review = r
    return ''
  })
  return { text: text.trim(), review }
}

function parseQuizBlocks(content: string): { text: string; quizzes: ParsedQuiz[] } {
  const quizRegex = /```quiz\n([\s\S]*?)```/g
  const quizzes: ParsedQuiz[] = []
  const text = content.replace(quizRegex, (_, block: string) => {
    const q: ParsedQuiz = { question: '', type: 'short-answer', options: [], answer: '', explanation: '' }
    for (const line of block.split('\n')) {
      if (line.startsWith('QUESTION:')) q.question = line.slice(9).trim()
      else if (line.startsWith('TYPE:')) {
        const t = line.slice(5).trim().toLowerCase()
        if (t.includes('multiple')) q.type = 'multiple-choice'
        else if (t.includes('true')) q.type = 'true-false'
        else q.type = 'short-answer'
      }
      else if (line.startsWith('OPTIONS:')) q.options = line.slice(8).split('|').map(o => o.trim())
      else if (line.startsWith('ANSWER:')) q.answer = line.slice(7).trim()
      else if (line.startsWith('KEYWORDS:')) q.keywords = line.slice(9).split(',').map(k => k.trim()).filter(Boolean)
      else if (line.startsWith('EXPECTED_LENGTH:')) q.expectedLength = line.slice(16).trim()
      else if (line.startsWith('EXPLANATION:')) q.explanation = line.slice(12).trim()
    }
    if (q.question) quizzes.push(q)
    return '' // remove from displayed text
  })
  return { text: text.trim(), quizzes }
}

function parseProgressBlock(content: string): { text: string; progress: ParsedProgress | null } {
  const progressRegex = /```progress\n([\s\S]*?)```/g
  let progress: ParsedProgress | null = null
  const text = content.replace(progressRegex, (_, block: string) => {
    const p: ParsedProgress = { score: 0, objectives: {}, notes: '' }
    for (const line of block.split('\n')) {
      if (line.startsWith('SCORE:')) p.score = parseInt(line.slice(6).trim()) || 0
      else if (line.startsWith('NOTES:')) p.notes = line.slice(6).trim()
      else if (line.match(/^OBJECTIVE_\d+:/)) {
        const [key, ...rest] = line.split(':')
        p.objectives[key.trim()] = rest.join(':').trim()
      }
    }
    if (p.score > 0) progress = p
    return '' // hide from displayed text
  })
  return { text: text.trim(), progress }
}

function stripProgressAndQuizBlocks(content: string): string {
  return content
    .replace(/```progress\n[\s\S]*?```/g, '')
    .replace(/```reflection\n[\s\S]*?```/g, '')
    .replace(/```quiz\n[\s\S]*?```/g, '')
    .replace(/```expectations\n[\s\S]*?```/g, '')
    .replace(/```problem\n[\s\S]*?```/g, '')
    .replace(/```submission-review\n[\s\S]*?```/g, '')
    .trim()
}

function parseMermaidBlocks(text: string): { text: string; diagrams: string[] } {
  const diagrams: string[] = []
  const cleaned = text.replace(/```mermaid\n([\s\S]*?)```/g, (_, code: string) => {
    diagrams.push(code.trim())
    return ''
  })
  return { text: cleaned.trim(), diagrams }
}

function parseChartBlocks(text: string): { text: string; charts: string[] } {
  const charts: string[] = []
  const cleaned = text.replace(/```chart\n([\s\S]*?)```/g, (_, code: string) => {
    charts.push(code.trim())
    return ''
  })
  return { text: cleaned.trim(), charts }
}

function parseFuncPlotBlocks(text: string): { text: string; funcPlots: string[] } {
  const funcPlots: string[] = []
  const cleaned = text.replace(/```funcplot\n([\s\S]*?)```/g, (_, code: string) => {
    funcPlots.push(code.trim())
    return ''
  })
  return { text: cleaned.trim(), funcPlots }
}

// Semantic short-answer evaluation — Haiku judges meaning, not exact wording
interface ShortAnswerEval {
  score: number
  verdict: 'correct' | 'partial' | 'incorrect'
  feedback: string
  loading?: boolean
}

// Generate a stable question ID from question text
function getQuestionId(question: string): string {
  // Simple hash based on question content to uniquely identify
  let hash = 0
  for (let i = 0; i < question.length; i++) {
    hash = ((hash << 5) - hash) + question.charCodeAt(i)
    hash = hash & hash // Convert to 32-bit integer
  }
  return `q_${Math.abs(hash).toString(36)}`
}

function QuizBlock({ quiz, onAnswer, onCorrect, initialAnswered }: { quiz: ParsedQuiz; onAnswer: (answer: string) => void; onCorrect?: (questionId: string, score: number) => void; initialAnswered?: boolean }) {
  const { t: tr } = useLanguage()
  const [selected, setSelected] = useState<string | null>(null)
  const [textAnswer, setTextAnswer] = useState('')
  const [submitted, setSubmitted] = useState(initialAnswered ?? false)
  const [shortAnswerEval, setShortAnswerEval] = useState<ShortAnswerEval | null>(null)

  function handleSubmit() {
    if (submitted) return
    const answer = quiz.type === 'short-answer' ? textAnswer : (selected || '')
    if (!answer) return
    setSubmitted(true)

    if (quiz.type === 'short-answer') {
      // Show loading state while Haiku evaluates semantically
      setShortAnswerEval({ score: 0, verdict: 'partial', feedback: '', loading: true })

      fetch('/api/quiz/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentAnswer: textAnswer,
          expectedAnswer: quiz.answer || '',
          question: quiz.question,
        }),
      })
        .then(r => r.json())
        .then(eval_ => {
          setShortAnswerEval({ score: eval_.score, verdict: eval_.verdict, feedback: eval_.feedback, loading: false })
          // Send augmented answer to Bob with semantic verdict
          const augmentedAnswer = `${textAnswer}\n\n[Semantic evaluation — verdict: ${eval_.verdict} (${eval_.score}/100). ${eval_.feedback} Respond based on this verdict.]`
          onAnswer(augmentedAnswer)
          // Pass numeric score (0–100) so caller can apply proportional weighting
          onCorrect?.(getQuestionId(quiz.question), eval_.score)
        })
        .catch(() => {
          setShortAnswerEval({ score: 50, verdict: 'partial', feedback: 'Evaluation unavailable.', loading: false })
          onAnswer(textAnswer)
        })
      return
    } else {
      // MCQ / true-false — binary: correct = 100, incorrect = 0
      onAnswer(answer)
      const score = answer.charAt(0) === quiz.answer?.charAt(0) ? 100 : 0
      onCorrect?.(getQuestionId(quiz.question), score)
    }
  }

  const isCorrect = submitted && selected && quiz.answer && selected.charAt(0) === quiz.answer.charAt(0)

  // When loaded from history and already answered but we don't have the original response — show collapsed state
  if (initialAnswered && !selected && !textAnswer) {
    return (
      <div className="my-3 p-3 rounded-xl bg-muted/20 border border-border/40 flex items-center gap-2 text-xs text-muted-foreground">
        <span className="text-emerald-400 font-semibold">✓</span>
        <span className="font-medium text-foreground/70 [&_.katex]:text-[0.85em]"><InlineMath content={quiz.question} /></span>
        <span className="ml-auto text-muted-foreground/50 flex-shrink-0">{tr('chat.alreadyAnswered')}</span>
      </div>
    )
  }

  return (
    <div className="my-3 p-4 rounded-xl bg-primary/5 border border-primary/20 space-y-3">
      <div className="flex items-center gap-2 text-xs font-semibold text-primary uppercase tracking-wider">
        <span>📝 {tr('chat.quiz')}</span>
        {quiz.type !== 'short-answer' && (
          <span className="text-muted-foreground font-normal normal-case">
            ({quiz.type === 'true-false' ? tr('chat.trueFalse') : tr('chat.multipleChoice')})
          </span>
        )}
      </div>
      <div className="text-sm text-foreground font-medium"><ChatMarkdown content={quiz.question} /></div>

      {quiz.type === 'multiple-choice' && (
        <div className="space-y-1.5">
          {quiz.options.map((opt, i) => (
            <button
              key={i}
              onClick={() => !submitted && setSelected(opt)}
              disabled={submitted}
              className={cn(
                'w-full text-left text-sm px-3 py-2 rounded-lg border transition-colors [&_.katex]:text-[0.95em]',
                // Before submit: only show selection highlight (blue), no green/red
                !submitted && selected === opt && 'bg-primary/10 border-primary/40 text-foreground',
                !submitted && selected !== opt && 'bg-card border-border text-muted-foreground hover:border-border/80 hover:text-foreground',
                // After submit: show correct (green) and wrong selection (red)
                submitted && selected === opt && (opt.charAt(0) === quiz.answer.charAt(0)
                  ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                  : 'bg-red-500/20 border-red-500/40 text-red-300'),
                submitted && selected !== opt && opt.charAt(0) === quiz.answer.charAt(0) && 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400/70',
                submitted && selected !== opt && opt.charAt(0) !== quiz.answer.charAt(0) && 'bg-card border-border text-muted-foreground/50',
              )}
            >
              <InlineMath content={opt} />
            </button>
          ))}
        </div>
      )}

      {quiz.type === 'true-false' && (
        <div className="flex gap-2">
          {['True', 'False'].map(opt => (
            <button
              key={opt}
              onClick={() => !submitted && setSelected(opt)}
              disabled={submitted}
              className={cn(
                'flex-1 text-sm px-3 py-2 rounded-lg border transition-colors',
                selected === opt
                  ? submitted
                    ? opt.toLowerCase() === quiz.answer.toLowerCase()
                      ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                      : 'bg-red-500/20 border-red-500/40 text-red-300'
                    : 'bg-primary/10 border-primary/30 text-foreground'
                  : 'bg-card border-border text-muted-foreground hover:border-border/80',
              )}
            >
              {opt}
            </button>
          ))}
        </div>
      )}

      {quiz.type === 'short-answer' && (
        <div className="space-y-1.5">
          {quiz.expectedLength && !submitted && (
            <p className="text-[10px] text-muted-foreground/60 italic">{quiz.expectedLength}</p>
          )}
          <textarea
            value={textAnswer}
            onChange={e => setTextAnswer(e.target.value)}
            disabled={submitted}
            placeholder={tr("chat.typeAnswer")}
            className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
            rows={3}
          />
        </div>
      )}

      {!submitted && (
        <button
          onClick={handleSubmit}
          disabled={quiz.type === 'short-answer' ? !textAnswer.trim() : !selected}
          className="px-4 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {tr("chat.submitAnswer")}
        </button>
      )}

      {submitted && quiz.explanation && (
        <div className="p-3 rounded-lg bg-muted/30 border border-border/50 text-xs text-muted-foreground">
          <div className="font-semibold text-foreground mb-1">{tr("chat.explanation")}</div>
          <ChatMarkdown content={quiz.explanation} />
        </div>
      )}

      {submitted && quiz.type === 'short-answer' && shortAnswerEval && (
        <div className="mt-2">
          {shortAnswerEval.loading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground px-3 py-2">
              <div className="w-3 h-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
              {tr("chat.evaluatingAnswer")}
            </div>
          ) : (
            <div className={cn('flex items-start gap-2 px-3 py-2 rounded-lg text-xs border', {
              'bg-emerald-500/10 border-emerald-500/30 text-emerald-400': shortAnswerEval.verdict === 'correct',
              'bg-amber-500/10 border-amber-500/30 text-amber-400': shortAnswerEval.verdict === 'partial',
              'bg-red-500/10 border-red-500/30 text-red-400': shortAnswerEval.verdict === 'incorrect',
            })}>
              <span className="font-semibold flex-shrink-0">
                {shortAnswerEval.verdict === 'correct' ? tr('chat.verdictCorrect') : shortAnswerEval.verdict === 'partial' ? tr('chat.verdictPartial') : tr('chat.verdictIncorrect')}
              </span>
              {shortAnswerEval.feedback && (
                <>
                  <span className="opacity-40">·</span>
                  <span className="font-normal opacity-80">{shortAnswerEval.feedback}</span>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Context Panel ─────────────────────────────────────────────────────────────

function ProblemBlock({ number, question, type, points, accept, expectations }: ParsedProblem) {
  const { t: tr } = useLanguage()
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [evaluating, setEvaluating] = useState(false)
  const [evalResult, setEvalResult] = useState<{ score: number; verdict: string; learningGoalsMet: string[]; learningGoalsMissed: string[]; criticalThinking: string; creativity: string; feedback: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const acceptsImage = accept === 'image' || accept === 'any' || type === 'diagram'
  const acceptsFile = accept === 'file' || accept === 'any'
  const showUpload = acceptsImage || acceptsFile

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    setFile(f)
    if (f.type.startsWith('image/')) setPreview(URL.createObjectURL(f))
    else setPreview(null)
  }

  async function handleEvaluate() {
    if (!file || !expectations || evaluating) return
    setEvaluating(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('question', question)
      formData.append('expectations', [
        `Learning goals: ${expectations.learningGoals}`,
        `Strong answer: ${expectations.strongAnswer}`,
        `Critical thinking markers: ${expectations.criticalThinkingMarkers}`,
        `Common mistakes to watch for: ${expectations.commonMistakes}`,
      ].join('\n'))
      const res = await fetch('/api/capstone/evaluate', { method: 'POST', body: formData })
      if (res.ok) setEvalResult(await res.json())
    } catch { /* ignore */ } finally { setEvaluating(false) }
  }

  return (
    <div className="my-3 p-4 rounded-xl bg-amber-500/5 border border-amber-500/20 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-semibold text-amber-400 uppercase tracking-wider">
          <span>📐 Problem {number}</span>
          {type && <span className="text-muted-foreground font-normal normal-case capitalize">({type})</span>}
        </div>
        {points && <span className="text-[10px] text-muted-foreground">{points} {tr('chat.pts')}</span>}
      </div>
      <div className="text-sm text-foreground font-medium"><ChatMarkdown content={question} /></div>

      {/* File/image upload for diagram, image, file-based submissions */}
      {showUpload && (
        <div className="space-y-2">
          <input ref={fileRef} type="file" accept={acceptsImage ? 'image/*,.pdf' : '*'} onChange={handleFileChange} className="hidden" />
          <div className="flex items-center gap-2">
            <button onClick={() => fileRef.current?.click()} className="text-xs px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500/20 transition-colors flex items-center gap-1.5">
              <Paperclip className="w-3 h-3" />
              {acceptsImage ? tr('chat.uploadDiagram') : tr('chat.uploadFile')}
            </button>
            {file && <span className="text-[10px] text-muted-foreground truncate max-w-[200px]">{file.name}</span>}
          </div>
          {preview && <img src={preview} alt="Submission preview" className="max-h-40 rounded-lg border border-border" />}
          {file && expectations && !evalResult && (
            <button onClick={handleEvaluate} disabled={evaluating} className="text-xs px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40">
              {evaluating ? tr('chat.evaluating') : tr('chat.submitForEval')}
            </button>
          )}
        </div>
      )}

      {/* Evaluation result */}
      {evalResult && (
        <div className={cn('p-3 rounded-lg border text-xs space-y-2', evalResult.score >= 70 ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-amber-500/30 bg-amber-500/5')}>
          <div className="flex items-center justify-between">
            <span className="font-semibold">{evalResult.verdict === 'excellent' ? tr('chat.verdictExcellent') : evalResult.verdict === 'good' ? tr('chat.verdictGood') : evalResult.verdict === 'partial' ? tr('chat.verdictPartial') : tr('chat.verdictInsufficient')}</span>
            <span className={evalResult.score >= 70 ? 'text-emerald-400' : 'text-amber-400'}>{evalResult.score}/100</span>
          </div>
          {evalResult.learningGoalsMet.length > 0 && <p className="text-emerald-400">{tr('chat.met')} {evalResult.learningGoalsMet.join(', ')}</p>}
          {evalResult.learningGoalsMissed.length > 0 && <p className="text-red-400">{tr('chat.missed')} {evalResult.learningGoalsMissed.join(', ')}</p>}
          <p className="text-muted-foreground"><span className="text-foreground font-medium">{tr('chat.thinkingLabel')}</span> {evalResult.criticalThinking}</p>
          {evalResult.creativity && evalResult.creativity !== 'N/A' && <p className="text-muted-foreground"><span className="text-foreground font-medium">{tr('chat.creativityLabel')}</span> {evalResult.creativity}</p>}
          <p className="text-foreground">{evalResult.feedback}</p>
        </div>
      )}
    </div>
  )
}

function SubmissionReviewBlock({ review }: { review: ParsedSubmissionReview }) {
  const { t: tr } = useLanguage()
  return (
    <div className={`my-3 p-4 rounded-xl border space-y-3 ${review.passed ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-red-500/30 bg-red-500/5'}`}>
      <div className="flex items-center justify-between">
        <div className={`flex items-center gap-2 text-xs font-semibold uppercase tracking-wider ${review.passed ? 'text-emerald-400' : 'text-red-400'}`}>
          <span>{review.passed ? '✓ ' : '✗ '}{tr('chat.submissionReview')}</span>
        </div>
        <span className={`text-xs font-medium ${review.passed ? 'text-emerald-400' : 'text-red-400'}`}>{review.totalScore}/100 · {review.passed ? tr('chat.passed') : tr('chat.needsRevision')}</span>
      </div>
      <div className="space-y-2">
        {review.scores.map(s => (
          <div key={s.problem} className="text-xs">
            <div className="flex items-center gap-2">
              <span className="font-medium text-foreground">Problem {s.problem}:</span>
              <span className={parseInt(s.score) >= 7 ? 'text-emerald-400' : 'text-red-400'}>{s.score}/10</span>
            </div>
            {s.feedback && <p className="text-muted-foreground ml-4 mt-0.5">{s.feedback}</p>}
          </div>
        ))}
      </div>
      {review.feedback && (
        <p className="text-xs text-muted-foreground border-t border-border/50 pt-2">{review.feedback}</p>
      )}
    </div>
  )
}

function ContextPanel({ summary }: { summary: StudentContextSummary | null }) {
  const { t: tr } = useLanguage()
  const [open, setOpen] = useState(false)

  if (!summary) return null

  return (
    <div className="border-b border-border bg-card/30">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <span className="flex items-center gap-1.5">
          <Lightbulb className="w-3 h-3 text-primary" />
          {tr('chat.bobKnows')}
        </span>
        {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-3 grid grid-cols-3 gap-3 text-xs">
              <div>
                <div className="text-muted-foreground mb-1 flex items-center gap-1">
                  <Zap className="w-3 h-3" /> {tr('chat.rightStageXP')}
                </div>
                <div className="text-foreground font-medium">{summary.stage}</div>
                <div className="text-muted-foreground">{summary.xp} XP · {summary.streak}d streak</div>
              </div>
              <div>
                <div className="text-muted-foreground mb-1 flex items-center gap-1">
                  <BookOpen className="w-3 h-3" /> {tr('chat.rightStudyingNow')}
                </div>
                {summary.currentTopics.slice(0, 3).map(t => (
                  <div key={t} className="text-foreground">{t.replace(/-/g, ' ')}</div>
                ))}
              </div>
              <div>
                <div className="text-muted-foreground mb-1 flex items-center gap-1">
                  <Target className="w-3 h-3" /> {tr('chat.rightActiveProjects')}
                </div>
                {summary.projects.slice(0, 2).map(p => (
                  <div key={p} className="text-foreground truncate">{p}</div>
                ))}
                {summary.struggling.length > 0 && (
                  <div className="text-orange-400 mt-1">
                    {tr('chat.rightWorkingOn')} {summary.struggling[0]}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Toast ─────────────────────────────────────────────────────────────────────

interface Toast {
  id: string
  message: string
  type: 'info' | 'success'
}

function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  return (
    <div className="fixed bottom-20 right-4 z-50 space-y-2 pointer-events-none">
      <AnimatePresence>
        {toasts.map(t => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, x: 20, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 20, scale: 0.95 }}
            className="pointer-events-auto flex items-center gap-2 bg-card border border-border rounded-lg px-3 py-2.5 text-xs shadow-lg"
          >
            <Sparkles className="w-3.5 h-3.5 text-primary flex-shrink-0" />
            <span className="text-foreground">{t.message}</span>
            <button onClick={() => onDismiss(t.id)} className="ml-1 text-muted-foreground hover:text-foreground">
              <X className="w-3 h-3" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

let nextTempId = 1000

interface ActiveChapterContext {
  id: string
  title: string
  trackName: string
  trackId: string
  description?: string
  keyTopics?: string[]
  status?: string
  sessionConvId?: string | null
}

function ChatPageInner() {
  const { t: tr, language } = useLanguage()
  const searchParams = useSearchParams()
  const chapterIdParam = searchParams.get('chapterId')
  const trackIdParam = searchParams.get('trackId')
  const modeParam = searchParams.get('mode') as ChatMode | null
  const projectIdParam = searchParams.get('projectId')
  const projectModeParam = searchParams.get('projectMode') as 'explore' | 'work' | null
  const reviewParam = searchParams.get('review') === 'true'
  const newConvParam = searchParams.get('new') === 'true'
  const { data: studentData } = useStudentData()
  const displayName = studentData?.student?.name && studentData.student.name !== 'Loading...' ? studentData.student.name.split(' ')[0] : null
  const bobGreeting = getBobGreeting(displayName)
  const [conversations, setConversations] = useState<ApiConversation[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<LocalMessage[]>([])
  // Render windowing: only the most recent `visibleWindow` non-hidden
  // messages are kept in the DOM. Older ones collapse behind a "show
  // earlier" button. This is what actually fixes typing lag in long chats —
  // a 100-message conversation with KaTeX/Mermaid/quiz DOM is huge, and the
  // browser re-lays-out the whole tree on every keystroke. Capping the DOM
  // to ~20 messages keeps typing instant no matter how long the chat is.
  const MESSAGE_WINDOW = 20
  const [visibleWindow, setVisibleWindow] = useState(MESSAGE_WINDOW)
  const [input, setInput] = useState('')
  const [replyQuote, setReplyQuote] = useState<string | null>(null)
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')

  // ── Re-attach to in-flight streams (like the Claude apps) ───────────────
  // The pump lives at module scope (chat-stream.ts), so Bob keeps streaming
  // while the user is on another page. When this page (re)mounts or the
  // active conversation changes, pick the live stream back up and render it.
  const isStreamingNowRef = useRef(false)
  useEffect(() => { isStreamingNowRef.current = isStreaming }, [isStreaming])
  useEffect(() => {
    if (!activeId || activeId.startsWith('temp-')) return
    const stream = getActiveChatStream(activeId)
    if (!stream || stream.done) return
    if (isStreamingNowRef.current) return // this instance already renders it
    setIsStreaming(true)
    setStreamingContent(stream.content)
    const unsub = subscribeChatStream(activeId, s => {
      setStreamingContent(s.content)
      if (s.done) {
        setIsStreaming(false)
        setStreamingContent('')
        // The server persists the assistant message right after the stream
        // closes — reload the thread to pick it up with real IDs.
        setTimeout(() => { void loadConversationMessages(activeId) }, 900)
      }
    })
    return unsub
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId])

  // ── Voice (Web Speech API) ──────────────────────────────────────────────
  const ttsSupported = speechSynthesisSupported()
  const [readAloud, setReadAloud] = useState(false)
  const prevStreamingRef = useRef(false)
  const lastSpokenIdRef = useRef<string | null>(null)
  useEffect(() => {
    try { setReadAloud(localStorage.getItem('bob-read-aloud') === '1') } catch { /* noop */ }
  }, [])
  // Mic → text: append final transcripts into the composer for review.
  const { supported: micSupported, listening, toggle: toggleMic } = useSpeechRecognition({
    lang: voiceLangTag(language),
    onFinal: (text) => setInput(prev => (prev && !prev.endsWith(' ') ? prev + ' ' : prev) + text),
  })
  const toggleReadAloud = useCallback(() => {
    setReadAloud(prev => {
      const next = !prev
      try { localStorage.setItem('bob-read-aloud', next ? '1' : '0') } catch { /* noop */ }
      if (!next) stopSpeaking()
      return next
    })
  }, [])
  // When read-aloud is on, speak Bob's reply the moment a stream finishes.
  useEffect(() => {
    const justFinished = prevStreamingRef.current && !isStreaming
    prevStreamingRef.current = isStreaming
    if (!justFinished || !readAloud) return
    const last = [...messages].reverse().find(m => m.role === 'assistant' && !m.hidden)
    if (last && lastSpokenIdRef.current !== last.id) {
      lastSpokenIdRef.current = last.id
      speak(last.content, voiceLangTag(language))
    }
  }, [isStreaming, messages, readAloud, language])
  const [loading, setLoading] = useState(true)
  const [contextSummary, setContextSummary] = useState<StudentContextSummary | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [pendingImage, setPendingImage] = useState<{ file: File; preview: string } | null>(null)
  const [isResearching, setIsResearching] = useState(false)
  // Always start as 'tutoring' to avoid SSR/client hydration mismatch.
  // localStorage read happens in a useEffect after mount.
  const [chatMode, setChatMode] = useState<ChatMode>('tutoring')
  const [isDragOver, setIsDragOver] = useState(false)
  const [conversationMode, setConversationMode] = useState<ChatMode | null>(null) // mode of current conversation
  const [activeChapterContext, setActiveChapterContext] = useState<ActiveChapterContext | null>(null)
  const chapterContextLoaded = useRef(false)
  const [activeProjectContext, setActiveProjectContext] = useState<{ id: string; title: string; trackName: string; trackId: string; projectMode: 'explore' | 'work' } | null>(null)
  const projectContextLoaded = useRef(false)
  type RightPanelTab = 'annotations' | 'notes' | 'review'
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>('notes')
  const [rightPanelOpen, setRightPanelOpen] = useState(true)
  const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(false)
  const lessonAutoCollapsedFor = useRef<string | null>(null)
  const isMobile = useIsMobile()

  // On mobile the side panels are slide-in overlays, not columns — start with
  // both closed so the chat opens clean and full-width. Runs once when the
  // viewport is first known to be mobile.
  const mobileDefaultsApplied = useRef(false)
  useEffect(() => {
    if (isMobile && !mobileDefaultsApplied.current) {
      mobileDefaultsApplied.current = true
      setLeftSidebarCollapsed(true)
      setRightPanelOpen(false)
    }
  }, [isMobile])
  const [focusedHighlightId, setFocusedHighlightId] = useState<string | null>(null)
  const [showReviewMenu, setShowReviewMenu] = useState<string | null>(null)

  // Clicking a highlight in chat → focus card in right panel
  function handleHighlightClick(id: string) {
    setFocusedHighlightId(id)
    setRightPanelTab('annotations')
    setRightPanelOpen(true)
    // Clear focus after animation
    setTimeout(() => setFocusedHighlightId(null), 1600)
  }

  // Clicking an annotation card → scroll to + flash the highlight in chat
  function handleAnnotationCardClick(id: string) {
    setFocusedHighlightId(id)
    const el = document.querySelector(`[data-highlight-id="${id}"]`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
    setTimeout(() => setFocusedHighlightId(null), 1600)
  }
  // Session learning loop state
  const [sessionPlan, setSessionPlan] = useState<{ objectives: string[]; plan: string; checkpoints: string[]; estimatedExchanges: number } | null>(null)
  const [sessionScore, setSessionScore] = useState(0)
  const [quizzesGiven, setQuizzesGiven] = useState(0)
  const [objectiveStatuses, setObjectiveStatuses] = useState<Record<string, 'understood' | 'partial' | 'not-understood'>>({})
  const [sessionInitialized, setSessionInitialized] = useState(false)
  const [answeredQuestionIds, setAnsweredQuestionIds] = useState<Set<string>>(new Set())
  const [capstoneTriggered, setCapstoneTriggered] = useState(false)
  // Maps of convId → context — each conversation independently knows its own banner/session
  const [chapterByConvId, setChapterByConvId] = useState<Record<string, ActiveChapterContext & { sessionScore?: number }>>({})
  const [projectByConvId, setProjectByConvId] = useState<Record<string, { id: string; title: string; trackName: string; trackId: string; projectMode: 'explore' | 'work' }>>({})
  // Derived: what's active right now
  const activeChapterForConv = activeId ? chapterByConvId[activeId] ?? null : null
  const activeProjectForConv = activeId ? projectByConvId[activeId] ?? null : null
  const isLessonMode = !!activeChapterForConv
  const [feedbackMap, setFeedbackMap] = useState<Record<string, 1 | -1>>({})
  const { highlights, addHighlight, updateHighlight, deleteHighlight } = useHighlights(activeId)
  // Memoize highlights grouped by messageId so each MessageBubble doesn't
  // trigger a fresh .filter() on every parent re-render (keystroke). On a
  // 50-message conversation this was 50 array allocations per keystroke —
  // even though React.memo skipped the children, the parent loop itself was
  // observable as typing lag. Replacing it with a single Map.get is ~free.
  const highlightsByMessageId = React.useMemo(() => {
    const map = new Map<string, Highlight[]>()
    for (const h of highlights) {
      const arr = map.get(h.messageId)
      if (arr) arr.push(h)
      else map.set(h.messageId, [h])
    }
    return map
  }, [highlights])
  const EMPTY_HIGHLIGHTS: Highlight[] = React.useMemo(() => [], [])

  // Windowed message list — only the last `visibleWindow` non-hidden
  // messages are rendered into the DOM. `earlierHiddenCount` drives the
  // "show earlier messages" button. Slicing from the end means new messages
  // always stay visible without any extra bookkeeping.
  const nonHiddenMessages = React.useMemo(() => messages.filter(m => !m.hidden), [messages])
  const earlierHiddenCount = Math.max(0, nonHiddenMessages.length - visibleWindow)
  const windowedMessages = React.useMemo(
    () => (earlierHiddenCount > 0 ? nonHiddenMessages.slice(-visibleWindow) : nonHiddenMessages),
    [nonHiddenMessages, visibleWindow, earlierHiddenCount],
  )
  // Reset the window when switching conversations so a long prior chat
  // doesn't leave a giant DOM mounted on the new one.
  useEffect(() => { setVisibleWindow(MESSAGE_WINDOW) }, [activeId])

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  // Set when the user clicks Stop. Distinguishes a user-initiated abort
  // (preserve the partial) from a real fetch error (show the error message).
  const userStoppedRef = useRef(false)
  const [lastUserMessage, setLastUserMessage] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const projectFileInputRef = useRef<HTMLInputElement>(null)
  const [projectFileUploading, setProjectFileUploading] = useState(false)

  // Auto-collapse sidebars when a lesson starts (once per lesson)
  useEffect(() => {
    const chapterId = activeChapterForConv?.id
    if (chapterId && chapterId !== lessonAutoCollapsedFor.current) {
      lessonAutoCollapsedFor.current = chapterId
      setLeftSidebarCollapsed(true)
      setRightPanelOpen(false)
    }
  }, [activeChapterForConv?.id])

  async function handleProjectFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !activeProjectContext) return
    setProjectFileUploading(true)
    try {
      let fileContent = ''
      const isText = file.type.startsWith('text/') || /\.(md|txt|py|js|ts|jsx|tsx|html|css|json|csv|yaml|yml|xml|sh|rb|go|rs|java|cpp|c|h)$/i.test(file.name)
      const isImage = file.type.startsWith('image/')

      if (isText) {
        fileContent = await file.text()
      } else if (isImage) {
        const buf = await file.arrayBuffer()
        fileContent = `[Image file: ${file.name}]`
        // For images, use existing image upload flow
        const blob = new Blob([buf], { type: file.type })
        const fakeFile = new File([blob], file.name, { type: file.type })
        const dt = new DataTransfer()
        dt.items.add(fakeFile)
        if (fileInputRef.current) {
          Object.defineProperty(fileInputRef.current, 'files', { value: dt.files, configurable: true })
          handleImageSelect({ target: fileInputRef.current } as React.ChangeEvent<HTMLInputElement>)
          setProjectFileUploading(false)
          return
        }
      } else {
        fileContent = `[Binary file: ${file.name} (${file.type || 'unknown type'}, ${(file.size / 1024).toFixed(1)} KB) — cannot display contents directly. Please share the relevant text/code portions in chat.]`
      }

      // Save as LinkedFile
      if (activeId && !activeId.startsWith('temp-')) {
        await fetch('/api/files/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workType: 'project',
            workId: activeProjectContext.id,
            trackId: activeProjectContext.trackId,
            name: file.name,
            type: file.type || 'text/plain',
            content: fileContent,
          }),
        }).catch(() => {})
      }

      // Inject file content into message
      const fileBlock = isText
        ? `**📎 File submitted: ${file.name}**\n\`\`\`\n${fileContent.slice(0, 8000)}${fileContent.length > 8000 ? '\n... (truncated)' : ''}\n\`\`\``
        : fileContent
      setInput(prev => prev ? `${prev}\n\n${fileBlock}` : fileBlock)
    } catch {
      // ignore
    } finally {
      setProjectFileUploading(false)
      if (projectFileInputRef.current) projectFileInputRef.current.value = ''
    }
  }

  const scrollToBottom = useCallback((instant = false) => {
    messagesEndRef.current?.scrollIntoView({ behavior: instant ? 'instant' : 'smooth' })
  }, [])

  const addToast = useCallback((message: string, type: Toast['type'] = 'success') => {
    const id = `toast-${Date.now()}`
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000)
  }, [])

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, streamingContent, scrollToBottom])

  // Restore chat mode from localStorage after mount (avoids SSR hydration mismatch)
  useEffect(() => {
    const saved = localStorage.getItem('bob-chat-mode') as ChatMode | null
    if (saved && saved !== 'logistics' && ['tutoring', 'research'].includes(saved)) {
      setChatMode(saved)
    }
  }, [])

  // Load conversations on mount
  useEffect(() => {
    loadConversations()
    loadContextSummary()
  }, [])

  // Auto-create new conversation if ?new=true (e.g. from "Discuss with Bob" button)
  const newConvCreated = useRef(false)
  useEffect(() => {
    if (!newConvParam || newConvCreated.current || loading) return
    newConvCreated.current = true
    if (modeParam) setChatMode(modeParam)
    newConversation()
  }, [newConvParam, loading])

  // Unified chapter context loading — checks DB for existing sessionConvId first
  useEffect(() => {
    if (!chapterIdParam || !trackIdParam || chapterContextLoaded.current) return
    chapterContextLoaded.current = true
    if (modeParam) setChatMode(modeParam)

    ;(async () => {
      try {
        const chapterRes = await fetch(`/api/chapter/${chapterIdParam}`)
        const { chapter } = await chapterRes.json()
        if (!chapter) return

        const ctx: ActiveChapterContext = {
          id: chapter.id,
          title: chapter.title,
          trackName: chapter.trackName,
          trackId: chapter.trackId,
          description: chapter.description,
          keyTopics: chapter.keyTopics,
          status: chapter.status,
          sessionConvId: chapter.sessionConvId ?? null,
        }
        setActiveChapterContext(ctx)
        // Set score immediately from chapter data — prevents 0% flash on reload
        setSessionScore(chapter.sessionScore || 0)

        // 1) If chapter already has a conversation, load it directly
        if (chapter.sessionConvId) {
          const convRes = await fetch(`/api/conversations/${chapter.sessionConvId}`)
          if (convRes.ok) {
            const data = await convRes.json()
            const conv: ApiConversation = {
              id: data.id, title: data.title, context: data.context ?? null,
              preview: data.preview ?? '', messageCount: data.messages?.length ?? 0,
              createdAt: data.createdAt, updatedAt: data.updatedAt,
            }
            const msgs: LocalMessage[] = (data.messages || []).map((m: ApiMessage) => ({
              id: m.id, role: m.role, content: m.content, timestamp: new Date(m.createdAt),
              hidden: isAutoSystemMessage(m.content),
            }))
            setConversations(prev => prev.some(c => c.id === conv.id) ? prev : [conv, ...prev])
            setActiveId(conv.id)
            setMessages(msgs)
            setConversationMode('tutoring')
            setChapterByConvId(prev => ({ ...prev, [conv.id]: { ...ctx, sessionScore: chapter.sessionScore || 0 } }))
            requestAnimationFrame(() => requestAnimationFrame(() => scrollToBottom(true)))

            // If conversation has messages, just show history — no auto-send on reload/login
            if (msgs.length > 0) {
              return // DONE — show history silently
            }

            // Empty conversation — send the chapter start signal (user explicitly clicked Start)
            const topicsList = chapter.keyTopics?.join(', ') || 'the chapter topics'
            const startSignal = `[NEW SESSION — START] Starting chapter "${chapter.title}" in ${chapter.trackName}. Topics: ${topicsList}. Output the full structured syllabus block first (chapter title, central question, objectives, core concepts table, recurring themes, session structure). Then ask ONE engagement hook question to spark curiosity. Do NOT begin teaching until the student responds to the hook.`
            setTimeout(() => sendMessageWithText(startSignal, conv.id, chapterIdParam, true), 400)
            return // DONE — full history loaded
          }

          // Conv fetch failed (404 = deleted) — check for archived messages
          const archiveRes = await fetch(`/api/conversations/archive?linkedType=chapter&linkedId=${chapterIdParam}`)
          const archiveData = await archiveRes.json()
          // Fall through to create new conversation, but we'll restore archived messages
          if (archiveData.archive) {
            const archivedMsgs: LocalMessage[] = archiveData.archive.messages.map((m: { role: 'user' | 'assistant'; content: string; createdAt: string }, i: number) => ({
              id: `archived-${i}`,
              role: m.role,
              content: i === 0 ? `> 💬 *Chat history restored from archive*\n\n${m.content}` : m.content,
              timestamp: new Date(m.createdAt),
            }))
            // Create new conversation and restore
            const newRes = await fetch('/api/conversations', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ title: chapter.title }),
            })
            if (newRes.ok) {
              const newConv = await newRes.json() as ApiConversation
              setConversations(prev => [newConv, ...prev])
              setActiveId(newConv.id)
              setMessages(archivedMsgs)
              setConversationMode('tutoring')
              setChapterByConvId(prev => ({ ...prev, [newConv.id]: { ...ctx, sessionScore: 0 } }))
              await fetch(`/api/chapter/${chapterIdParam}/set-conv`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ conversationId: newConv.id }),
              }).catch(() => {})
              requestAnimationFrame(() => requestAnimationFrame(() => scrollToBottom(true)))
            }
            return
          }
        }

        // Trigger content generation if placeholder
        if (
          !chapter.content ||
          chapter.content.includes('Content will be generated') ||
          chapter.content.length < 200
        ) {
          fetch(`/api/chapter/${chapterIdParam}/generate-content`, { method: 'POST' }).catch(() => {})
        }

        // 2) No existing conversation — create new and auto-send opening message
        const topicsList = chapter.keyTopics?.join(', ') || 'the chapter topics'
        // No prior conversation — always a fresh start regardless of status
        const autoMessage = `[NEW SESSION — START] Starting chapter "${chapter.title}" in ${chapter.trackName}. Topics: ${topicsList}. Output the full structured syllabus block first (chapter title, central question, objectives, core concepts table, recurring themes, session structure). Then ask ONE engagement hook question to spark curiosity. Do NOT begin teaching until the student responds to the hook.`

        const newRes = await fetch('/api/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: chapter.title }),
        })
        if (newRes.ok) {
          const conv = await newRes.json() as ApiConversation
          setConversations(prev => [conv, ...prev])
          setActiveId(conv.id)
          setMessages([])
          setConversationMode('tutoring')
          setChapterByConvId(prev => ({ ...prev, [conv.id]: { ...ctx, sessionScore: 0 } }))
          await fetch(`/api/chapter/${chapterIdParam}/set-conv`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ conversationId: conv.id }),
          }).catch(() => {})
          setTimeout(() => {
            sendMessageWithText(autoMessage, conv.id, chapterIdParam)
          }, 100)
        }
      } catch {
        // Non-critical
      }
    })()
  }, [chapterIdParam, trackIdParam, modeParam])

  // Reset session state when active conversation changes so plan reloads correctly
  useEffect(() => {
    setSessionInitialized(false)
    setSessionPlan(null)
    setObjectiveStatuses({})
    setQuizzesGiven(0)
    setCapstoneTriggered(false)
  }, [activeId])

  // Initialize session plan whenever chapter context is loaded (fires after activeId reset above)
  useEffect(() => {
    if (activeChapterContext && !sessionInitialized) {
      setSessionInitialized(true)
      // Fetch existing session or init a new one
      fetch(`/api/chapter/${activeChapterContext.id}/session`)
        .then(r => r.json())
        .then(data => {
          if (data.sessionPlan) {
            setSessionPlan(data.sessionPlan)
            setSessionScore(data.sessionScore || 0)
            if (data.sessionData?.objectives) {
              const statuses: Record<string, 'understood' | 'partial' | 'not-understood'> = {}
              data.sessionData.objectives.forEach((o: { id?: string; understood?: string }, i: number) => {
                statuses[`OBJECTIVE_${i + 1}`] = (o.understood as 'understood' | 'partial' | 'not-understood') || 'not-understood'
              })
              setObjectiveStatuses(statuses)
            }
            // Load already-answered question IDs to prevent duplicate credit
            if (data.sessionData?.answeredQuestionIds) {
              setAnsweredQuestionIds(new Set(data.sessionData.answeredQuestionIds))
            }
            // Restore capstone trigger state so we don't re-send on reload
            if (data.sessionData?.capstoneTriggered) {
              setCapstoneTriggered(true)
            }
          } else {
            // Init a new session plan
            fetch(`/api/chapter/${activeChapterContext.id}/session`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'init' }),
            })
              .then(r => r.json())
              .then(data => {
                if (data.plan) setSessionPlan(data.plan)
              })
              .catch(() => {})
          }
        })
        .catch(() => {})
    }
  }, [activeChapterContext, sessionInitialized])

  // Unified project context loading — checks DB for existing exploreConvId first
  useEffect(() => {
    if (!projectIdParam || projectContextLoaded.current) return
    projectContextLoaded.current = true
    if (modeParam) setChatMode(modeParam)

    ;(async () => {
      try {
        // Fetch project info directly from API (includes exploreConvId)
        const projRes = await fetch(`/api/projects/${projectIdParam}`)
        if (!projRes.ok) return
        const { project } = await projRes.json()
        if (!project) return

        const pMode = projectModeParam || 'explore'
        const projCtx = {
          id: project.id,
          title: project.title,
          trackName: project.trackName || project.subject || 'Project',
          trackId: project.trackId || trackIdParam || '',
          projectMode: pMode,
        }
        setActiveProjectContext(projCtx)

        // 1) If project already has a conversation, load it directly
        if (project.exploreConvId) {
          const convRes = await fetch(`/api/conversations/${project.exploreConvId}`)
          if (convRes.ok) {
            const data = await convRes.json()
            const conv: ApiConversation = {
              id: data.id, title: data.title, context: data.context ?? null,
              preview: data.preview ?? '', messageCount: data.messages?.length ?? 0,
              createdAt: data.createdAt, updatedAt: data.updatedAt,
            }
            const msgs: LocalMessage[] = (data.messages || []).map((m: ApiMessage) => ({
              id: m.id, role: m.role, content: m.content, timestamp: new Date(m.createdAt),
              hidden: isAutoSystemMessage(m.content),
            }))
            setConversations(prev => prev.some(c => c.id === conv.id) ? prev : [conv, ...prev])
            setActiveId(conv.id)
            setMessages(msgs)
            setConversationMode('tutoring')
            setProjectByConvId(prev => ({ ...prev, [conv.id]: projCtx }))
            requestAnimationFrame(() => requestAnimationFrame(() => scrollToBottom(true)))
            // If conversation exists but is empty, send opening briefing
            if (msgs.length === 0) {
              const openingMsg = pMode === 'work'
                ? `[PROJECT REVIEW SESSION] Project: "${project.title}". Present the evaluation rubric you will use to assess my work — show all criteria, weightings, and what each level looks like. Explain what professional/academic work of this type looks like in the real world. Then invite me to share my files, code, writing, or any work I've done so you can provide detailed feedback.`
                : `[PROJECT OVERVIEW REQUEST] Project: "${project.title}". Give me a rich overview covering: (1) what this project involves and what I'd build or produce, (2) how it connects to the track's curriculum content, (3) 3-4 different directions this project could go depending on my focus, (4) key concepts and skills I'd develop, (5) at least 4 specific resources — research papers, books, or authoritative blogs with links — to start exploring, (6) what makes this project challenging and rewarding. Be specific and thorough.`
              setTimeout(() => sendMessageWithProject(openingMsg, conv.id, projectIdParam, pMode as 'explore' | 'work'), 300)
            }
            return // DONE — existing conversation loaded
          }

          // Conv fetch failed (404 = deleted) — check for archived messages
          const archiveRes = await fetch(`/api/conversations/archive?linkedType=project&linkedId=${projectIdParam}`)
          const archiveData = await archiveRes.json()
          if (archiveData.archive) {
            const archivedMsgs: LocalMessage[] = archiveData.archive.messages.map((m: { role: 'user' | 'assistant'; content: string; createdAt: string }, i: number) => ({
              id: `archived-${i}`,
              role: m.role,
              content: i === 0 ? `> 💬 *Chat history restored from archive*\n\n${m.content}` : m.content,
              timestamp: new Date(m.createdAt),
            }))
            const newRes = await fetch('/api/conversations', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ title: `Exploring: ${project.title}` }),
            })
            if (newRes.ok) {
              const newConv = await newRes.json() as ApiConversation
              setConversations(prev => [newConv, ...prev])
              setActiveId(newConv.id)
              setMessages(archivedMsgs)
              setConversationMode('tutoring')
              setProjectByConvId(prev => ({ ...prev, [newConv.id]: projCtx }))
              await fetch(`/api/projects/${projectIdParam}/set-conv`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ conversationId: newConv.id }),
              }).catch(() => {})
              requestAnimationFrame(() => requestAnimationFrame(() => scrollToBottom(true)))
            }
            return
          }
        }

        // 2) No existing conversation — create new and auto-send
        if (pMode === 'work') {
          const autoMessage = `[PROJECT REVIEW SESSION] Project: "${project.title}". Present the evaluation rubric you will use to assess my work — show all criteria, weightings, and what each level looks like. Explain what professional/academic work of this type looks like in the real world. Then invite me to share my files, code, writing, or any work I've done so you can provide detailed feedback.`
          const convTitle = `Working on: ${project.title}`
          const newRes = await fetch('/api/conversations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: convTitle }),
          })
          if (newRes.ok) {
            const conv = await newRes.json() as ApiConversation
            setConversations(prev => [conv, ...prev])
            setActiveId(conv.id)
            setMessages([])
            setConversationMode('tutoring')
            setProjectByConvId(prev => ({ ...prev, [conv.id]: projCtx }))
            await fetch(`/api/projects/${projectIdParam}/set-conv`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ conversationId: conv.id }),
            }).catch(() => {})
            setTimeout(() => {
              sendMessageWithProject(autoMessage, conv.id, projectIdParam, 'work')
            }, 100)
          }
        }

        if (pMode === 'explore') {
          const autoMessage = `[PROJECT OVERVIEW REQUEST] Project: "${project.title}". Give me a rich overview covering: (1) what this project involves and what I'd build or produce, (2) how it connects to the track's curriculum content, (3) 3-4 different directions this project could go depending on my focus, (4) key concepts and skills I'd develop, (5) at least 4 specific resources — research papers, books, or authoritative blogs with links — to start exploring, (6) what makes this project challenging and rewarding. Be specific and thorough.`
          const convTitle = `Exploring: ${project.title}`
          const newRes = await fetch('/api/conversations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: convTitle }),
          })
          if (newRes.ok) {
            const conv = await newRes.json() as ApiConversation
            setConversations(prev => [conv, ...prev])
            setActiveId(conv.id)
            setMessages([])
            setConversationMode('tutoring')
            setProjectByConvId(prev => ({ ...prev, [conv.id]: projCtx }))
            await fetch(`/api/projects/${projectIdParam}/set-conv`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ conversationId: conv.id }),
            }).catch(() => {})
            setTimeout(() => {
              sendMessageWithProject(autoMessage, conv.id, projectIdParam, 'explore')
            }, 100)
          }
        }
      } catch {
        // Non-critical
      }
    })()
  }, [projectIdParam, trackIdParam, projectModeParam, modeParam])

  // Note: chapter auto-send is handled in the unified chapter context loading effect above

  async function loadContextSummary() {
    try {
      const res = await fetch('/api/student-data')
      if (!res.ok) return
      const d = await res.json()
      const student = d.student
      const tracks = d.tracks || []
      const projects = (d.projects || []).filter((p: any) => p.status === 'active').slice(0, 3)
      const stageNames: Record<string, string> = {
        'motivation': 'Motivation & Inspiration',
        'review': 'Review & Adjustment',
        'self-guided': 'Self-Guided Learning',
        'expert-feedback': 'Expert Feedback',
      }
      setContextSummary({
        name: student.name || 'Student',
        stage: stageNames[student.stage] || 'Self-Guided Learning',
        xp: student.xp || 0,
        streak: student.streak || 0,
        currentTopics: tracks.slice(0, 3).map((t: any) => t.name),
        struggling: [],
        projects: projects.map((p: any) => p.title),
      })
    } catch {
      // Non-critical
    }
  }

  async function loadConversations() {
    try {
      setLoading(true)
      const res = await fetch('/api/conversations')
      if (res.ok) {
        const data = await res.json() as ApiConversation[]
        setConversations(data)

        // Bulk-restore context badges for all conversations in one call
        if (data.length > 0) {
          bulkRestoreContextBadges(data.map(c => c.id))
        }

        // Only auto-select the first conversation if no URL params will handle it
        const hasUrlContext = chapterIdParam || projectIdParam
        if (data.length > 0 && !activeId && !hasUrlContext) {
          await loadConversationMessages(data[0].id)
          setActiveId(data[0].id)
          await restoreChapterContext(data[0].id)
          loadFeedback(data[0].id)
        }
      }
    } catch {
      // Network error — show empty state
    } finally {
      setLoading(false)
    }
  }

  // Bulk restore chapter/project context for all conversations so sidebar badges show on mount
  async function bulkRestoreContextBadges(convIds: string[]) {
    try {
      const res = await fetch('/api/conversations/context-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationIds: convIds }),
      })
      if (!res.ok) return
      const { chapters, projects } = await res.json()
      // chapters: Record<convId, chapter context>
      // projects: Record<convId, project context>
      if (chapters && Object.keys(chapters).length > 0) {
        setChapterByConvId(prev => ({ ...prev, ...chapters }))
      }
      if (projects && Object.keys(projects).length > 0) {
        setProjectByConvId(prev => ({ ...prev, ...projects }))
      }
    } catch {
      // Non-critical — badges just won't show until clicked
    }
  }

  async function loadConversationMessages(convId: string) {
    try {
      const res = await fetch(`/api/conversations/${convId}`)
      if (res.ok) {
        const data = await res.json() as { messages: ApiMessage[] }
        setMessages(
          data.messages.map(m => ({
            id: m.id,
            role: m.role,
            content: m.content,
            timestamp: new Date(m.createdAt),
            hidden: isAutoSystemMessage(m.content),
          }))
        )
      }
    } catch {
      setMessages([])
    }
  }

  // Restore session context for a conversation — uses Maps so every conv has independent context
  async function restoreChapterContext(convId: string) {
    // Check cache first — already know this conv's context
    if (chapterByConvId[convId]) {
      const ctx = chapterByConvId[convId]
      setActiveChapterContext(ctx)
      setActiveProjectContext(null)
      setSessionScore(ctx.sessionScore || 0)
      return
    }
    if (projectByConvId[convId]) {
      setActiveProjectContext(projectByConvId[convId])
      setActiveChapterContext(null)
      setSessionScore(0)
      setSessionPlan(null)
      return
    }

    // Not in cache — look up from DB
    try {
      const [chapRes, projRes] = await Promise.all([
        fetch(`/api/conversations/${convId}/chapter`),
        fetch(`/api/conversations/${convId}/project`),
      ])

      let foundChapter = false
      if (chapRes.ok) {
        const { chapter } = await chapRes.json()
        if (chapter) {
          const ctx: ActiveChapterContext = {
            id: chapter.id, title: chapter.title,
            trackName: chapter.trackName, trackId: chapter.trackId,
            description: chapter.description, keyTopics: chapter.keyTopics,
            status: chapter.status, sessionConvId: chapter.sessionConvId,
          }
          setChapterByConvId(prev => ({ ...prev, [convId]: { ...ctx, sessionScore: chapter.sessionScore || 0 } }))
          setActiveChapterContext(ctx)
          setActiveProjectContext(null)
          setSessionScore(chapter.sessionScore || 0)
          foundChapter = true
        }
      }

      if (!foundChapter && projRes.ok) {
        const { project } = await projRes.json()
        if (project) {
          // Determine actual project mode based on lock status
          const pMode: 'explore' | 'work' = project.status === 'locked' || project.status === 'in-progress' ? 'work' : 'explore'
          const ctx = { id: project.id, title: project.title, trackName: project.trackName, trackId: project.trackId, projectMode: pMode }
          setProjectByConvId(prev => ({ ...prev, [convId]: ctx }))
          setActiveProjectContext(ctx)
          setActiveChapterContext(null)
          setSessionScore(0)
          setSessionPlan(null)
        } else {
          // Plain conversation — no special context
          setActiveChapterContext(null)
          setActiveProjectContext(null)
          setSessionScore(0)
          setSessionPlan(null)
        }
      } else if (!foundChapter) {
        setActiveChapterContext(null)
        setActiveProjectContext(null)
        setSessionScore(0)
        setSessionPlan(null)
      }
    } catch {
      // Non-critical
    }
  }

  async function loadFeedback(convId: string) {
    try {
      const res = await fetch(`/api/feedback?conversationId=${convId}`)
      if (res.ok) {
        const data = await res.json() as { messageId: string; rating: number }[]
        const map: Record<string, 1 | -1> = {}
        for (const f of data) {
          if (f.rating === 1 || f.rating === -1) map[f.messageId] = f.rating as 1 | -1
        }
        setFeedbackMap(map)
      }
    } catch {
      // Non-critical
    }
  }

  async function handleFeedback(messageId: string, rating: 1 | -1) {
    if (!activeId) return
    const isToggleOff = feedbackMap[messageId] === rating
    // Optimistic update — toggle off if same rating clicked again
    setFeedbackMap(prev => {
      if (prev[messageId] === rating) {
        const next = { ...prev }
        delete next[messageId]
        return next
      }
      return { ...prev, [messageId]: rating }
    })
    // Show acknowledgment toast on new feedback (not on toggle-off)
    if (!isToggleOff) {
      addToast('We listen carefully to your feedback, thank you.', 'info')
    }
    try {
      await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId, conversationId: activeId, rating }),
      })
    } catch {
      // Revert on error
      setFeedbackMap(prev => {
        const next = { ...prev }
        delete next[messageId]
        return next
      })
    }
  }

  async function switchConversation(convId: string) {
    if (convId === activeId) return
    setActiveId(convId)
    setMessages([])
    setStreamingContent('')
    setConversationMode(null)
    setFeedbackMap({})
    await loadConversationMessages(convId)
    await loadFeedback(convId)
    await restoreChapterContext(convId)
    requestAnimationFrame(() => requestAnimationFrame(() => scrollToBottom(true)))
  }

  async function newConversation() {
    try {
      const res = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'New Conversation' }),
      })
      if (res.ok) {
        const conv = await res.json() as ApiConversation
        setConversations(prev => [conv, ...prev])
        setActiveId(conv.id)
        setMessages([])
        setConversationMode(null)
        setInput('')
      }
    } catch {
      // Fallback: local only
      const tempId = `temp-${nextTempId++}`
      const tempConv: ApiConversation = {
        id: tempId,
        title: 'New Conversation',
        context: null,
        preview: '',
        messageCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      setConversations(prev => [tempConv, ...prev])
      setActiveId(tempId)
      setMessages([])
    }
  }

  async function deleteConversation(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    try {
      // Archive linked conversations before deleting
      const chapterCtx = chapterByConvId[id]
      const projectCtx = projectByConvId[id]
      if (chapterCtx) {
        await fetch(`/api/conversations/${id}/archive`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ linkedType: 'chapter', linkedId: chapterCtx.id, linkedTitle: chapterCtx.title }),
        }).catch(() => {})
        // Clear the sessionConvId on the chapter so next visit creates fresh
        await fetch(`/api/chapter/${chapterCtx.id}/set-conv`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conversationId: null }),
        }).catch(() => {})
      } else if (projectCtx) {
        await fetch(`/api/conversations/${id}/archive`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ linkedType: 'project', linkedId: projectCtx.id, linkedTitle: projectCtx.title }),
        }).catch(() => {})
        // Clear the exploreConvId on the project
        await fetch(`/api/projects/${projectCtx.id}/set-conv`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conversationId: null }),
        }).catch(() => {})
      }

      await fetch(`/api/conversations/${id}`, { method: 'DELETE' })
    } catch {
      // Ignore errors
    }
    setConversations(prev => prev.filter(c => c.id !== id))
    if (activeId === id) {
      const remaining = conversations.filter(c => c.id !== id)
      if (remaining.length > 0) {
        setActiveId(remaining[0].id)
        await loadConversationMessages(remaining[0].id)
      } else {
        setActiveId(null)
        setMessages([])
      }
    }
  }

  function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const preview = URL.createObjectURL(file)
    setPendingImage({ file, preview })
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(true)
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (!file) return
    // Accept images and common document types
    if (file.type.startsWith('image/') || file.type.startsWith('video/') || file.type === 'application/pdf' || file.type.includes('document') || file.type.includes('text')) {
      const preview = URL.createObjectURL(file)
      setPendingImage({ file, preview })
    }
  }

  function clearPendingImage() {
    if (pendingImage) URL.revokeObjectURL(pendingImage.preview)
    setPendingImage(null)
  }

  async function sendImageMessage() {
    if (!pendingImage || isStreaming) return

    const text = input.trim()
    const userMsg: LocalMessage = {
      id: `temp-${nextTempId++}`,
      role: 'user',
      content: text || '[Image uploaded]',
      timestamp: new Date(),
    }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setIsStreaming(true)
    setStreamingContent('')
    setIsResearching(true)
    const imageToSend = pendingImage
    clearPendingImage()

    try {
      const formData = new FormData()
      formData.append('image', imageToSend.file)
      if (text) formData.append('message', text)
      if (activeId && !activeId.startsWith('temp-')) formData.append('conversationId', activeId)

      const response = await fetch('/api/chat/image', { method: 'POST', body: formData })
      setIsResearching(false)

      if (!response.ok || !response.body) throw new Error('Image upload error')

      const returnedConvId = response.headers.get('X-Conversation-Id')
      if (returnedConvId && returnedConvId !== activeId) {
        setActiveId(returnedConvId)
      }

      // Pump via the module-scope registry so a remounted chat page can
      // re-attach to this stream after navigating away and back.
      const streamKey = returnedConvId ?? `pending-${Date.now()}`
      let full = ''
      try {
        full = await pumpChatStream(streamKey, response.body, p => setStreamingContent(p))
      } catch (err) {
        // Keep whatever streamed before the failure; only error out if we
        // got nothing at all.
        full = getActiveChatStream(streamKey)?.content ?? ''
        if (!full) throw err
      }

      setMessages(prev => [...prev, {
        id: `temp-${nextTempId++}`,
        role: 'assistant',
        content: full,
        timestamp: new Date(),
      }])
    } catch {
      setIsResearching(false)
      setMessages(prev => [...prev, {
        id: `temp-${nextTempId++}`,
        role: 'assistant',
        content: "I couldn't process that image. Try uploading it again or describe what you see.",
        timestamp: new Date(),
      }])
    } finally {
      setIsStreaming(false)
      setStreamingContent('')
    }
  }

  async function sendMessage() {
    // If there's a pending image, use the image endpoint
    if (pendingImage) {
      await sendImageMessage()
      return
    }

    const rawText = input.trim()
    if (!rawText || isStreaming) return

    // Slash commands — handled client-side, never sent to Bob.
    if (rawText.toLowerCase() === '/compact') {
      setInput('')
      if (!activeId || activeId.startsWith('temp-')) {
        addToast('Nothing to compact yet — send a message first.', 'info')
        return
      }
      addToast('Compacting earlier messages…', 'info')
      try {
        const res = await fetch(`/api/conversations/${activeId}/compact`, { method: 'POST' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json() as { droppedMessages: number; summaryLength: number }
        addToast(`✓ Compacted ${data.droppedMessages} earlier messages into a ${data.summaryLength}-char memo.`, 'success')
      } catch (err) {
        addToast(`Compaction failed: ${err instanceof Error ? err.message : 'unknown'}`, 'info')
      }
      return
    }
    if (rawText.toLowerCase() === '/help' || rawText.toLowerCase() === '/commands') {
      setInput('')
      addToast('Slash commands: /compact — summarize earlier messages to reduce context.', 'info')
      return
    }

    // Prepend reply quote context if replying to a selection — make it explicit for Bob
    const text = replyQuote
      ? `[Referring to this specific part of your response: "${replyQuote}"]\n\n${rawText}`
      : rawText
    setReplyQuote(null)

    // Auto-detect curriculum/logistics keywords and switch to L&C
    const lowerText = text.toLowerCase()
    const curriculumKeywords = ['add a subject', 'add subject', 'new subject', 'create a track', 'add track', 'change my curriculum', 'modify curriculum', 'add a course', 'remove subject', 'change syllabus', 'update curriculum', 'add homework', 'create quiz', 'add chapter', 'restructure', 'change my schedule', 'adjust curriculum', 'new track']
    const shouldBeLnC = curriculumKeywords.some(kw => lowerText.includes(kw))
    let effectiveMode = chatMode
    if (shouldBeLnC && chatMode !== 'logistics') {
      effectiveMode = 'logistics'
      setChatMode('logistics')
      // Don't persist L&C to localStorage — it resets to tutoring on next session
      addToast('Switched to Logistics & Curriculum mode for curriculum changes', 'info')
    }

    // If mode changed from the conversation's mode:
    // - Logistics/Curriculum: always start a new conversation (different AI, different purpose)
    // - Research/Tutoring switch: stay in same conversation, just add a mode label
    const modeChanged = conversationMode !== null && effectiveMode !== conversationMode
    let sendConversationId = activeId
    if (modeChanged) {
      if (effectiveMode === 'logistics' || conversationMode === 'logistics') {
        // Logistics requires a new conversation
        sendConversationId = null
        setMessages([])
      } else {
        // Research <-> Tutoring: stay in same conversation, insert mode divider
        const modeLabel = MODES.find(m => m.id === effectiveMode)
        setMessages(prev => [...prev, {
          id: `mode-switch-${Date.now()}`,
          role: 'system' as const,
          content: `Switched to ${modeLabel?.label || effectiveMode}`,
          timestamp: new Date(),
          modeSwitch: effectiveMode,
        }])
      }
      setConversationMode(effectiveMode)
    }

    // Track mode for this conversation
    if (conversationMode === null) {
      setConversationMode(effectiveMode)
    }

    // Optimistically add user message
    const userMsg: LocalMessage = {
      id: `temp-${nextTempId++}`,
      role: 'user',
      content: text,
      timestamp: new Date(),
    }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLastUserMessage(rawText)
    setIsStreaming(true)
    setStreamingContent('')
    userStoppedRef.current = false

    try {
      abortRef.current = new AbortController()
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortRef.current.signal,
        body: JSON.stringify({
          conversationId: sendConversationId && !sendConversationId.startsWith('temp-') ? sendConversationId : undefined,
          message: text,
          mode: effectiveMode,
          ...(activeChapterContext ? {
            chapterId: activeChapterContext.id,
            workContext: {
              type: 'content',
              trackId: activeChapterContext.trackId || '',
              trackName: activeChapterContext.trackName || '',
              itemId: activeChapterContext.id || '',
              itemTitle: activeChapterContext.title || '',
              content: `Key Topics: ${activeChapterContext.keyTopics?.join(', ') || 'N/A'}\nDescription: ${activeChapterContext.description || ''}`,
            },
          } : {}),
          ...(activeProjectContext ? {
            projectId: activeProjectContext.id,
            projectMode: activeProjectContext.projectMode,
          } : {}),
        }),
      })

      if (!response.ok || !response.body) throw new Error('Stream error')

      // Get conversation ID from header (may be new)
      const returnedConvId = response.headers.get('X-Conversation-Id')
      // If the server compacted older messages this turn, show a one-time
      // indicator so the student knows context is preserved as a summary.
      const compactedCount = parseInt(response.headers.get('X-Compacted-Count') ?? '0', 10)
      if (compactedCount > 0) {
        addToast(`📋 ${compactedCount} earlier messages compacted into a summary to keep the chat snappy.`, 'info')
      }
      if (returnedConvId && returnedConvId !== activeId) {
        setActiveId(returnedConvId)
        // Update conversation list
        setConversations(prev => {
          const exists = prev.find(c => c.id === returnedConvId)
          if (!exists) {
            const newConv: ApiConversation = {
              id: returnedConvId,
              title: text.slice(0, 50),
              context: null,
              preview: text.slice(0, 80),
              messageCount: 1,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            }
            return [newConv, ...prev.filter(c => !c.id.startsWith('temp-'))]
          }
          return prev
        })
      }

      // Pump through the module-scope registry so a remounted chat page can
      // re-attach to this stream after navigating away and back.
      const streamKey = returnedConvId ?? (activeId && !activeId.startsWith('temp-') ? activeId : `pending-${Date.now()}`)
      let full = ''

      // Read until done OR the user clicks Stop. On AbortError we fall
      // through with whatever's accumulated and treat it as the final
      // (truncated) assistant message — no error UI, no data loss.
      try {
        full = await pumpChatStream(streamKey, response.body, p => setStreamingContent(p))
      } catch (err) {
        const isAbort = err instanceof Error && (err.name === 'AbortError' || abortRef.current?.signal.aborted)
        if (!isAbort) throw err
        // User stopped — recover the partial content and persist it.
        full = getActiveChatStream(streamKey)?.content ?? ''
      }

      const stoppedByUser = userStoppedRef.current
      const assistantMsg: LocalMessage = {
        id: `temp-${nextTempId++}`,
        role: 'assistant',
        content: full + (stoppedByUser && full ? '\n\n_(stopped)_' : ''),
        timestamp: new Date(),
      }
      setMessages(prev => {
        const updated = [...prev, assistantMsg]
        // Auto-generate notes every 4 messages in chapter sessions
        if (activeChapterContext && activeId && updated.length > 0 && updated.length % 4 === 0) {
          fetch(`/api/chapter/${activeChapterContext.id}/generate-notes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ conversationId: activeId }),
          }).catch(() => {})
        }
        return updated
      })

      // Silently reload messages from DB to replace temp IDs (needed for annotations to work)
      const reloadConvId = returnedConvId ?? (activeId && !activeId.startsWith('temp-') ? activeId : null)
      if (reloadConvId) {
        setTimeout(async () => {
          try {
            const reloadRes = await fetch(`/api/conversations/${reloadConvId}`)
            if (reloadRes.ok) {
              const reloadData = await reloadRes.json() as { messages: ApiMessage[] }
              setMessages(reloadData.messages.map(m => ({
                id: m.id, role: m.role as 'user' | 'assistant' | 'system',
                content: m.content, timestamp: new Date(m.createdAt),
                hidden: isAutoSystemMessage(m.content),
              })))
            }
          } catch {}
        }, 800)
      }

      // Parse progress blocks — update objective statuses only, NOT score.
      // Score only increases from correct quiz/assignment answers (onQuizCorrect).
      if (activeChapterContext) {
        const { progress: parsedProgress } = parseProgressBlock(full)
        const { reflection: parsedReflection } = parseReflectionBlock(full)
        if (parsedProgress) {
          const newStatuses: Record<string, 'understood' | 'partial' | 'not-understood'> = {}
          for (const [key, val] of Object.entries(parsedProgress.objectives)) {
            const v = val.toLowerCase().trim()
            if (v === 'understood') newStatuses[key] = 'understood'
            else if (v === 'partial') newStatuses[key] = 'partial'
            else newStatuses[key] = 'not-understood'
          }
          setObjectiveStatuses(prev => ({ ...prev, ...newStatuses }))

          // Count quizzes in this response and accumulate
          const quizCount = (full.match(/```quiz\n/g) || []).length
          const newQuizzesGiven = quizCount > 0 ? quizzesGiven + quizCount : quizzesGiven
          if (quizCount > 0) setQuizzesGiven(newQuizzesGiven)

          // Persist objective statuses + reflection only (no score from conversation)
          const sessionData = {
            objectives: sessionPlan?.objectives?.map((text, i) => ({
              id: `OBJECTIVE_${i + 1}`,
              text,
              understood: newStatuses[`OBJECTIVE_${i + 1}`] || 'not-understood',
              evidence: parsedProgress.notes,
            })) || [],
            quizResults: [],
            quizzesGiven: newQuizzesGiven,
          }
          fetch(`/api/chapter/${activeChapterContext.id}/session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'update_score', score: sessionScore, sessionData, reflection: parsedReflection }),
          }).catch(() => {})
        }
      }

      // Chapter completion detection (client-side)
      const chapterCompletionPhrases = ['chapter complete', 'chapter completed', '✓ chapter', "you've mastered", 'you have mastered', 'lesson complete', "well done! you've completed", '[chapter_mastered]', 'chapter_mastered']
      const isChapterComplete = activeChapterContext && chapterCompletionPhrases.some(phrase => full.toLowerCase().includes(phrase))
      if (isChapterComplete && activeChapterContext) {
        setSessionScore(100)
        addToast(`✓ Chapter complete: ${activeChapterContext.title}`, 'success')

        // Call session complete API for final evaluation
        const convId = returnedConvId ?? activeId
        fetch(`/api/chapter/${activeChapterContext.id}/session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'complete',
            conversationId: convId,
            score: sessionScore,
            sessionData: {
              objectives: sessionPlan?.objectives?.map((text, i) => ({
                id: `OBJECTIVE_${i + 1}`,
                text,
                understood: objectiveStatuses[`OBJECTIVE_${i + 1}`] || 'understood',
              })) || [],
              quizResults: [],
            },
          }),
        }).catch(() => {})

        // Refresh all relevant data via event bus (one call, all hooks re-fetch)
        triggerCurriculumRefresh()
        import('@/lib/student-data').then(m => m.refreshStudentData())
        import('@/lib/work-data').then(m => m.refreshWorkData())
        setTimeout(() => {
          addToast('Ready to start the next chapter? →', 'info')
        }, 3000)
      }

      // In L&C mode, refresh after DB writes settle
      if (effectiveMode === 'logistics') {
        triggerCurriculumRefresh()
        setTimeout(() => {
          triggerCurriculumRefresh()
          import('@/lib/student-data').then(m => m.refreshStudentData())
          import('@/lib/work-data').then(m => m.refreshWorkData())
          }, 1500)
      } else if (!isChapterComplete) {
        const curriculumMentionKeywords = ['curriculum', 'learning path', 'added to your', 'updated your', 'marked as', 'module', 'chapter complete', 'completed the chapter']
        const hasCurriculumChange = curriculumMentionKeywords.some(kw => full.toLowerCase().includes(kw))
        if (hasCurriculumChange) {
          setTimeout(() => {
            addToast('Bob updated your curriculum', 'success')
            triggerCurriculumRefresh()
            import('@/lib/student-data').then(m => m.refreshStudentData())
            import('@/lib/work-data').then(m => m.refreshWorkData())
              }, 500)
        }
      }

      // Update conversation preview and detect first exchange for title generation
      if (returnedConvId || activeId) {
        const convId = returnedConvId ?? activeId
        setConversations(prev => {
          const updated = prev.map(c => {
            if (c.id !== convId) return c
            const updatedConv = {
              ...c,
              preview: full.slice(0, 80),
              messageCount: c.messageCount + 2,
              updatedAt: new Date().toISOString(),
            }
            // Check first exchange using the PREVIOUS messageCount (before +2)
            // messageCount was 0 or 1 before this exchange = first exchange
            if (c.messageCount <= 1 && convId && !convId.startsWith('temp-')) {
              fetch(`/api/conversations/${convId}/generate-title`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userMessage: text, assistantMessage: full }),
              }).then(r => r.json()).then(({ title }) => {
                if (title) {
                  setConversations(p => p.map(cc => cc.id === convId ? { ...cc, title } : cc))
                }
              }).catch(() => {})
            }
            return updatedConv
          })
          return updated
        })
      }
    } catch (err) {
      // AbortError fired before any stream content was received (e.g. user
      // clicked Stop before the first chunk arrived). Don't show the
      // connection-error message — just clean up. The "Stop" intent is
      // honored even when there's no partial to keep.
      const isAbort = err instanceof Error && (err.name === 'AbortError' || userStoppedRef.current)
      if (!isAbort) {
        const errMsg: LocalMessage = {
          id: `temp-${nextTempId++}`,
          role: 'assistant',
          content: "I'm having trouble connecting right now. Please try again in a moment.",
          timestamp: new Date(),
        }
        setMessages(prev => [...prev, errMsg])
      }
    } finally {
      setIsStreaming(false)
      setStreamingContent('')
      userStoppedRef.current = false
    }
  }

  // Send a specific message with a given conversation ID (used for chapter auto-send)
  async function sendMessageWithText(text: string, convId: string, chapterId?: string, hideMessage = false) {
    if (!text.trim() || isStreaming) return

    const userMsg: LocalMessage = {
      id: `temp-${nextTempId++}`,
      role: 'user',
      content: text,
      timestamp: new Date(),
      hidden: hideMessage || isAutoSystemMessage(text),
    }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setIsStreaming(true)
    setStreamingContent('')

    try {
      const requestBody: Record<string, unknown> = {
        conversationId: convId.startsWith('temp-') ? undefined : convId,
        message: text,
        mode: 'tutoring' as ChatMode,
      }

      // If we have chapter context, include it as workContext
      if (chapterId && activeChapterContext) {
        requestBody.chapterId = chapterId
        requestBody.workContext = {
          type: 'content',
          trackId: activeChapterContext.trackId || '',
          trackName: activeChapterContext.trackName || '',
          itemId: chapterId,
          itemTitle: activeChapterContext.title || '',
          content: `Key Topics: ${activeChapterContext.keyTopics?.join(', ') || 'N/A'}\nDescription: ${activeChapterContext.description || ''}`,
        }
      }

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      })

      if (!response.ok || !response.body) throw new Error('Stream error')

      const returnedConvId = response.headers.get('X-Conversation-Id')
      if (returnedConvId && returnedConvId !== activeId) {
        setActiveId(returnedConvId)
        setConversations(prev => {
          const exists = prev.find(c => c.id === returnedConvId)
          if (!exists) {
            const newConv: ApiConversation = {
              id: returnedConvId,
              title: text.slice(0, 50),
              context: null,
              preview: text.slice(0, 80),
              messageCount: 1,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            }
            return [newConv, ...prev.filter(c => !c.id.startsWith('temp-'))]
          }
          return prev
        })
      }

      // Pump via the module-scope registry so a remounted chat page can
      // re-attach to this stream after navigating away and back.
      const streamKey = returnedConvId ?? `pending-${Date.now()}`
      let full = ''
      try {
        full = await pumpChatStream(streamKey, response.body, p => setStreamingContent(p))
      } catch (err) {
        // Keep whatever streamed before the failure; only error out if we
        // got nothing at all.
        full = getActiveChatStream(streamKey)?.content ?? ''
        if (!full) throw err
      }

      setMessages(prev => [...prev, {
        id: `temp-${nextTempId++}`,
        role: 'assistant',
        content: full,
        timestamp: new Date(),
      }])

      // Silently reload messages from DB to replace temp IDs (needed for annotations to work)
      const reloadConvId2 = returnedConvId ?? (convId && !convId.startsWith('temp-') ? convId : null)
      if (reloadConvId2) {
        setTimeout(async () => {
          try {
            const reloadRes = await fetch(`/api/conversations/${reloadConvId2}`)
            if (reloadRes.ok) {
              const reloadData = await reloadRes.json() as { messages: ApiMessage[] }
              setMessages(reloadData.messages.map(m => ({
                id: m.id, role: m.role as 'user' | 'assistant' | 'system',
                content: m.content, timestamp: new Date(m.createdAt),
                hidden: isAutoSystemMessage(m.content),
              })))
            }
          } catch {}
        }, 800)
      }

      // Parse progress blocks from sendMessageWithText — objectives only, no score
      if (activeChapterContext) {
        const { progress: parsedProgress2 } = parseProgressBlock(full)
        const { reflection: parsedReflection2 } = parseReflectionBlock(full)
        if (parsedProgress2) {
          const newStatuses2: Record<string, 'understood' | 'partial' | 'not-understood'> = {}
          for (const [key, val] of Object.entries(parsedProgress2.objectives)) {
            const v = val.toLowerCase().trim()
            if (v === 'understood') newStatuses2[key] = 'understood'
            else if (v === 'partial') newStatuses2[key] = 'partial'
            else newStatuses2[key] = 'not-understood'
          }
          setObjectiveStatuses(prev => ({ ...prev, ...newStatuses2 }))
          fetch(`/api/chapter/${activeChapterContext.id}/session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'update_score',
              score: sessionScore,
              sessionData: {
                objectives: sessionPlan?.objectives?.map((text, i) => ({
                  id: `OBJECTIVE_${i + 1}`, text,
                  understood: newStatuses2[`OBJECTIVE_${i + 1}`] || 'not-understood',
                })) || [],
                quizResults: [],
              },
              reflection: parsedReflection2,
            }),
          }).catch(() => {})
        }
      }

      // Always generate title after chapter session first exchange
      const effectiveConvId2 = returnedConvId ?? convId
      if (effectiveConvId2 && !effectiveConvId2.startsWith('temp-')) {
        setConversations(prev => prev.map(c => c.id === effectiveConvId2 ? { ...c, messageCount: c.messageCount + 2, preview: full.slice(0, 80) } : c))
        fetch(`/api/conversations/${effectiveConvId2}/generate-title`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userMessage: text, assistantMessage: full }),
        }).then(r => r.json()).then(({ title }) => {
          if (title) setConversations(p => p.map(c => c.id === effectiveConvId2 ? { ...c, title } : c))
        }).catch(() => {})
      }

      // Chapter completion detection for sendMessageWithText
      const chapterCompletionPhrases2 = ['chapter complete', 'chapter completed', '✓ chapter', "you've mastered", 'you have mastered', 'lesson complete', "well done! you've completed", '[chapter_mastered]', 'chapter_mastered']
      const isChapterComplete2 = activeChapterContext && chapterCompletionPhrases2.some(phrase => full.toLowerCase().includes(phrase))
      if (isChapterComplete2 && activeChapterContext) {
        setSessionScore(100)
        addToast(`✓ Chapter complete: ${activeChapterContext.title}`, 'success')
        fetch(`/api/chapter/${activeChapterContext.id}/session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'complete', conversationId: returnedConvId ?? activeId, score: sessionScore }),
        }).catch(() => {})
        triggerCurriculumRefresh()
        import('@/lib/student-data').then(m => m.refreshStudentData())
        import('@/lib/work-data').then(m => m.refreshWorkData())
        setTimeout(() => {
          addToast('Ready to start the next chapter? →', 'info')
        }, 3000)
      }
    } catch {
      setMessages(prev => [...prev, {
        id: `temp-${nextTempId++}`,
        role: 'assistant',
        content: "I'm having trouble connecting right now. Please try again in a moment.",
        timestamp: new Date(),
      }])
    } finally {
      setIsStreaming(false)
      setStreamingContent('')
    }
  }

  // Send a message with project context
  async function sendMessageWithProject(text: string, convId: string, projectId: string, projectMode: 'explore' | 'work') {
    if (!text.trim() || isStreaming) return

    const userMsg: LocalMessage = {
      id: `temp-${nextTempId++}`,
      role: 'user',
      content: text,
      timestamp: new Date(),
      hidden: isAutoSystemMessage(text),
    }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setIsStreaming(true)
    setStreamingContent('')

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: convId.startsWith('temp-') ? undefined : convId,
          message: text,
          mode: 'tutoring' as ChatMode,
          projectId,
          projectMode,
        }),
      })

      if (!response.ok || !response.body) throw new Error('Stream error')

      const returnedConvId = response.headers.get('X-Conversation-Id')
      if (returnedConvId && returnedConvId !== activeId) {
        setActiveId(returnedConvId)
        setConversations(prev => {
          const exists = prev.find(c => c.id === returnedConvId)
          if (!exists) {
            const newConv: ApiConversation = {
              id: returnedConvId,
              title: text.slice(0, 50),
              context: null,
              preview: text.slice(0, 80),
              messageCount: 1,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            }
            return [newConv, ...prev.filter(c => !c.id.startsWith('temp-'))]
          }
          return prev
        })
      }

      // Pump via the module-scope registry so a remounted chat page can
      // re-attach to this stream after navigating away and back.
      const streamKey = returnedConvId ?? `pending-${Date.now()}`
      let full = ''
      try {
        full = await pumpChatStream(streamKey, response.body, p => setStreamingContent(p))
      } catch (err) {
        // Keep whatever streamed before the failure; only error out if we
        // got nothing at all.
        full = getActiveChatStream(streamKey)?.content ?? ''
        if (!full) throw err
      }

      setMessages(prev => [...prev, {
        id: `temp-${nextTempId++}`,
        role: 'assistant',
        content: full,
        timestamp: new Date(),
      }])

      // Silently reload messages from DB to replace temp IDs (needed for annotations to work)
      const reloadConvIdP = returnedConvId ?? (convId && !convId.startsWith('temp-') ? convId : null)
      if (reloadConvIdP) {
        setTimeout(async () => {
          try {
            const reloadRes = await fetch(`/api/conversations/${reloadConvIdP}`)
            if (reloadRes.ok) {
              const reloadData = await reloadRes.json() as { messages: ApiMessage[] }
              setMessages(reloadData.messages.map(m => ({
                id: m.id, role: m.role as 'user' | 'assistant' | 'system',
                content: m.content, timestamp: new Date(m.createdAt),
                hidden: isAutoSystemMessage(m.content),
              })))
            }
          } catch {}
        }, 800)
      }

      // Always generate title after project session first exchange
      const effectiveConvIdP = returnedConvId ?? convId
      if (effectiveConvIdP && !effectiveConvIdP.startsWith('temp-')) {
        setConversations(prev => prev.map(c => c.id === effectiveConvIdP ? { ...c, messageCount: c.messageCount + 2, preview: full.slice(0, 80) } : c))
        fetch(`/api/conversations/${effectiveConvIdP}/generate-title`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userMessage: text, assistantMessage: full }),
        }).then(r => r.json()).then(({ title }) => {
          if (title) setConversations(p => p.map(c => c.id === effectiveConvIdP ? { ...c, title } : c))
        }).catch(() => {})
      }
    } catch {
      setMessages(prev => [...prev, {
        id: `temp-${nextTempId++}`,
        role: 'assistant',
        content: "I'm having trouble connecting right now. Please try again in a moment.",
        timestamp: new Date(),
      }])
    } finally {
      setIsStreaming(false)
      setStreamingContent('')
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  // Auto-resize textarea. Force a single-line height when empty (some mobile
  // browsers report an inflated scrollHeight for an empty textarea, which made
  // the box render very tall); grow with content up to a sane cap.
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = input.trim() ? `${Math.min(ta.scrollHeight, 140)}px` : '48px'
  }, [input])

  const activeConv = conversations.find(c => c.id === activeId)

  const QUICK_PROMPTS = [
    'What should I learn next?',
    'Help me with my current project',
    'Explain eigenvalues with intuition',
    'How do I get better at algorithms?',
  ]

  return (
    <div className="flex h-[100dvh] overflow-hidden">
      {/* Mobile backdrop — tap to close the conversations drawer */}
      {isMobile && !leftSidebarCollapsed && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
          onClick={() => setLeftSidebarCollapsed(true)}
        />
      )}
      {/* Conversation sidebar — collapsible column on desktop, slide-in drawer on mobile */}
      <aside className={cn(
        'border-border bg-card flex flex-col overflow-hidden',
        isMobile
          ? cn(
              'fixed inset-y-0 left-0 z-50 w-[82vw] max-w-[300px] border-r shadow-2xl transition-transform duration-300 ease-in-out',
              leftSidebarCollapsed ? '-translate-x-full' : 'translate-x-0'
            )
          : cn(
              'flex-shrink-0 border-r transition-all duration-300 ease-in-out',
              leftSidebarCollapsed ? 'w-0 border-r-0' : 'w-64'
            )
      )}>
        <div className={cn('p-4 border-b border-border flex items-center gap-2', leftSidebarCollapsed && 'hidden')}>
          <button
            onClick={() => { newConversation(); if (isMobile) setLeftSidebarCollapsed(true) }}
            className="flex-1 flex items-center justify-center gap-2 bg-primary/10 hover:bg-primary/20 border border-primary/20 rounded-lg py-2.5 px-4 text-sm font-medium text-primary transition-colors"
          >
            <Plus className="w-4 h-4" />
            {tr('chat.newConversation')}
          </button>
          <button
            onClick={() => setLeftSidebarCollapsed(true)}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title={tr('chat.collapseSidebar')}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        </div>

        <div className={cn('flex-1 overflow-y-auto p-2 space-y-1', leftSidebarCollapsed && 'hidden')}>
          {loading ? (
            <div className="px-3 py-8 text-center text-xs text-muted-foreground">Loading…</div>
          ) : conversations.length === 0 ? (
            <div className="px-3 py-8 text-center text-xs text-muted-foreground">
              No conversations yet.<br />Start one above!
            </div>
          ) : (
            conversations.map(conv => (
              <div key={conv.id} className="group relative">
                <button
                  onClick={() => { switchConversation(conv.id); if (isMobile) setLeftSidebarCollapsed(true) }}
                  className={cn(
                    'w-full text-left rounded-lg p-3 transition-colors pr-8',
                    conv.id === activeId
                      ? 'bg-primary/10 border border-primary/20'
                      : 'hover:bg-accent'
                  )}
                >
                  <div className="flex items-center gap-2 mb-1">
                    {chapterByConvId[conv.id]
                      ? <BookOpen className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                      : projectByConvId[conv.id]
                        ? <Sparkles className="w-3.5 h-3.5 text-purple-400 flex-shrink-0" />
                        : <MessageSquare className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                    }
                    <div className={cn('text-xs font-medium truncate', conv.id === activeId ? 'text-primary' : 'text-foreground')}>
                      {conv.title}
                    </div>
                    {chapterByConvId[conv.id] && (
                      <span
                        className="flex-shrink-0 text-[9px] font-semibold tracking-wider px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 truncate max-w-[120px]"
                        title={`📖 ${chapterByConvId[conv.id].title}`}
                      >
                        📖 {chapterByConvId[conv.id].title.length > 25 ? chapterByConvId[conv.id].title.slice(0, 25) + '…' : chapterByConvId[conv.id].title}
                      </span>
                    )}
                    {projectByConvId[conv.id] && (
                      <span
                        className="flex-shrink-0 text-[9px] font-semibold tracking-wider px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20 truncate max-w-[120px]"
                        title={`✨ ${projectByConvId[conv.id].title}`}
                      >
                        ✨ {projectByConvId[conv.id].title.length > 25 ? projectByConvId[conv.id].title.slice(0, 25) + '…' : projectByConvId[conv.id].title}
                      </span>
                    )}
                  </div>
                  {conv.preview && (
                    <div className="text-[10px] text-muted-foreground truncate pl-5">
                      {conv.preview}
                    </div>
                  )}
                </button>
                <button
                  onClick={(e) => deleteConversation(conv.id, e)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all p-1 rounded"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))
          )}
        </div>

        <div className={cn('p-4 border-t border-border', leftSidebarCollapsed && 'hidden')}>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Bot className="w-4 h-4 text-primary" />
            <div>
              <div className="font-medium text-foreground">Bob</div>
              <div>Bob · {tr(`chat.mode.${chatMode}.label`)} · {
                chatMode === 'tutoring' ? 'Claude Opus' :
                chatMode === 'research' ? 'Gemini 3.1 Pro' :
                'Claude Sonnet'
              }</div>
            </div>
          </div>
        </div>
      </aside>

      {/* Chat area + notes panel */}
      <div className="flex flex-1 min-w-0 overflow-hidden">
      <div
        className={`flex-1 flex flex-col min-w-0 relative ${isDragOver ? 'ring-2 ring-primary/50 ring-inset' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Drag overlay */}
        {isDragOver && (
          <div className="absolute inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center pointer-events-none">
            <div className="flex flex-col items-center gap-2 text-primary">
              <Camera className="w-10 h-10" />
              <p className="text-sm font-medium">Drop image, video, or file to attach</p>
            </div>
          </div>
        )}
        {/* Header */}
        <div className="border-b border-border bg-card/50 backdrop-blur-sm">
          <div className="p-4 pl-14 lg:pl-4 flex items-center gap-3">
            {leftSidebarCollapsed && (
              <button
                onClick={() => setLeftSidebarCollapsed(false)}
                className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors mr-1"
                title={tr('chat.showConversations')}
              >
                <PanelLeftOpen className="w-4 h-4" />
              </button>
            )}
            <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
              <Bot className="w-4 h-4 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-foreground text-sm">Bob — Architect Bob</div>
              <div className="text-xs text-muted-foreground truncate">
                {activeConv?.title ?? 'New conversation'}
              </div>
            </div>
            {isResearching && (
              <div className="flex items-center gap-2 text-xs text-blue-400">
                <Search className="w-3 h-3 animate-pulse" />
                Researching…
              </div>
            )}
            {isStreaming && !isResearching && (
              <div className="flex items-center gap-2 text-xs text-primary">
                <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                Thinking…
              </div>
            )}
            {/* Mobile-only: open the right panel (annotations / notes / review) */}
            {isMobile && activeId && !rightPanelOpen && (
              <button
                onClick={() => setRightPanelOpen(true)}
                className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                title={tr('chat.showPanel', 'Notes & annotations')}
              >
                <PanelRightOpen className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Mode selector — hidden on mobile to keep the chat minimal */}
          <div className="px-4 pb-3 hidden lg:flex items-center gap-1.5">
            {MODES.map(m => {
              const Icon = m.icon
              const active = chatMode === m.id
              return (
                <button
                  key={m.id}
                  onClick={() => { setChatMode(m.id); if (m.id !== 'logistics') localStorage.setItem('bob-chat-mode', m.id) }}
                  disabled={isStreaming}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all',
                    active
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground',
                    isStreaming && 'opacity-50 cursor-not-allowed'
                  )}
                  title={tr(`chat.mode.${m.id}.desc`)}
                >
                  <Icon className="w-3 h-3" />
                  {tr(`chat.mode.${m.id}.short`)}
                </button>
              )
            })}
          </div>
        </div>

        {/* Active chapter session banner — only shows for the specific lesson conversation */}
        {activeChapterForConv && activeId && (
          <div className="px-4 py-2.5 bg-primary/5 border-b border-primary/10 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-6 h-6 rounded-md bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
                <BookOpen className="w-3 h-3 text-primary" />
              </div>
              <div className="min-w-0">
                {/* Label line — hidden on mobile to keep the top bar to title + progress only */}
                <div className="hidden lg:flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-primary/60">
                    {activeChapterForConv.status === 'in-progress' ? tr('chat.continuingLesson') : tr('chat.lessonSession')}
                  </span>
                  <span className="text-[10px] text-muted-foreground/40">·</span>
                  <span className="text-[10px] text-muted-foreground/60 truncate">{activeChapterForConv.trackName}</span>
                </div>
                <p className="text-xs font-semibold text-foreground truncate leading-tight">{activeChapterForConv.title}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {sessionScore > 0 && (
                <div className="hidden lg:flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  <span className="text-[10px] font-medium text-emerald-400">{sessionScore}% {tr("chat.understood")}</span>
                </div>
              )}
              {/* Review button — opens new review session window */}
              <div className="relative">
                <button
                  onClick={() => setShowReviewMenu(prev => prev === activeChapterForConv.id ? null : activeChapterForConv.id)}
                  className="text-[10px] font-medium text-primary/70 hover:text-primary border border-primary/20 hover:border-primary/40 bg-primary/5 hover:bg-primary/10 rounded-md px-2 py-0.5 transition-colors flex items-center gap-1"
                >
                  <BookOpen className="w-3 h-3" />
                  {tr('chat.review')}
                </button>
                {showReviewMenu === activeChapterForConv.id && (
                  <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowReviewMenu(null)} />
                  <div className="absolute top-full left-0 mt-1 z-50 bg-card border border-border rounded-lg shadow-xl p-2 w-60 space-y-1">
                    <p className="text-[10px] text-muted-foreground px-2 pb-1 border-b border-border">{tr("chat.reviewMenuHint")}</p>
                    {[
                      { label: tr('chat.reviewRecap'), msg: `[REVIEW SESSION] I have completed the chapter "${activeChapterForConv.title}". Please review all the key concepts we covered in the original session, summarise what I should have learned, then quiz me with 3 targeted questions on the areas where I was weakest.` },
                      { label: tr('chat.reviewWeak'), msg: `[REVIEW SESSION] I have completed the chapter "${activeChapterForConv.title}". Based on my performance in the original session, identify the topics I struggled with most and give me 3 focused practice problems specifically targeting those gaps. Explain each concept again after my answer if I get it wrong.` },
                      { label: tr('chat.reviewExtra'), msg: `[REVIEW SESSION] I have completed the chapter "${activeChapterForConv.title}". Give me 5 extra practice problems covering all the main topics from this chapter. Mix difficulty levels — start easier and get harder. Give feedback after each answer.` },
                    ].map(({ label, msg }) => (
                      <button
                        key={label}
                        onClick={async () => {
                          setShowReviewMenu(null)
                          // Create a new conversation for the review session
                          const reviewTitle = `Review: ${activeChapterForConv.title}`
                          const res = await fetch('/api/conversations', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ title: reviewTitle }),
                          })
                          if (!res.ok) return
                          const conv = await res.json() as ApiConversation
                          // Link it to the same chapter so it gets chapter context in the system prompt
                          await fetch(`/api/chapter/${activeChapterForConv.id}/set-conv`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ conversationId: conv.id }),
                          }).catch(() => {})
                          setConversations(prev => [conv, ...prev])
                          setActiveId(conv.id)
                          setMessages([])
                          setConversationMode('tutoring')
                          setChapterByConvId(prev => ({ ...prev, [conv.id]: { ...activeChapterForConv, sessionScore: 0 } }))
                          setTimeout(() => sendMessageWithText(msg, conv.id, activeChapterForConv.id), 150)
                        }}
                        className="w-full text-left text-xs text-foreground hover:bg-accent rounded px-2 py-1.5 transition-colors"
                      >
                        {label}
                      </button>
                    ))}
                    <button
                      onClick={() => {
                        setShowReviewMenu(null)
                        setInput(`[REVIEW SESSION] I have completed "${activeChapterForConv.title}". `)
                      }}
                      className="w-full text-left text-xs text-muted-foreground hover:bg-accent rounded px-2 py-1.5 transition-colors"
                    >
                      {tr('chat.reviewCustom')}
                    </button>
                  </div>
                  </>
                )}
              </div>
              {/* Chapter syllabus page link */}
              {activeChapterForConv.trackId && (
                <a
                  href={`/dashboard/curriculum/${activeChapterForConv.trackId}/content/${activeChapterForConv.id}`}
                  className="hidden lg:flex text-[10px] text-muted-foreground/50 hover:text-muted-foreground transition-colors items-center gap-1"
                  target="_blank"
                  rel="noopener"
                >
                  {tr('chat.syllabus')} ↗
                </a>
              )}
            </div>
          </div>
        )}

        {/* Session progress bar — only for the active chapter conv */}
        {activeChapterForConv && (sessionPlan || sessionScore > 0) && (
          <SessionProgressBar
            chapterId={activeChapterForConv.id}
            objectives={sessionPlan?.objectives || activeChapterForConv.keyTopics || []}
            currentScore={sessionScore}
            objectiveStatuses={objectiveStatuses}
          />
        )}

        {/* Active project context banner — only for the specific project conv (desktop only) */}
        {activeProjectForConv && activeId && !isMobile && (
          <div className="px-4 py-2 bg-purple-500/5 border-b border-border text-xs text-muted-foreground flex items-center gap-2">
            <Sparkles className="w-3 h-3 text-purple-400" />
            <span>
              {activeProjectForConv.projectMode === 'explore' ? tr('chat.exploring') : tr('chat.workingOn2')}:{' '}
              <span className="text-foreground font-medium">{activeProjectForConv.title}</span>
              {' · '}
              <span className="text-muted-foreground">{activeProjectForConv.trackName}</span>
            </span>
          </div>
        )}

        {/* Context panel ("Bob knows about you") — desktop only; hidden on mobile to keep the chat minimal */}
        {!isMobile && <ContextPanel summary={contextSummary} />}

        {/* Messages */}
        <div className={cn('flex-1 overflow-y-auto p-4 lg:p-6 space-y-4', isLessonMode && 'flex flex-col items-center')}>
          {messages.length === 0 && !isStreaming ? (
            <div className="h-full flex flex-col items-center justify-center text-center px-8">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                <Bot className="w-8 h-8 text-primary" />
              </div>
              <h2 className="text-xl font-bold text-foreground mb-2">{bobGreeting.title}</h2>
              <p className="text-muted-foreground text-sm max-w-sm leading-relaxed">
                {bobGreeting.subtitle}
              </p>
              <div className="mt-6 grid grid-cols-1 gap-2 w-full max-w-sm">
                {QUICK_PROMPTS.map(s => (
                  <button
                    key={s}
                    onClick={() => setInput(s)}
                    className="text-left text-sm text-muted-foreground hover:text-foreground border border-border hover:border-primary/40 rounded-lg px-4 py-2.5 transition-colors flex items-center justify-between group"
                  >
                    {s}
                    <ChevronRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {earlierHiddenCount > 0 && (
                <div className="flex justify-center py-2">
                  <button
                    onClick={() => setVisibleWindow(v => v + 30)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border bg-card hover:bg-accent text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <ChevronUp className="w-3.5 h-3.5" />
                    Show {Math.min(30, earlierHiddenCount)} earlier message{Math.min(30, earlierHiddenCount) === 1 ? '' : 's'}
                    <span className="text-muted-foreground/50">({earlierHiddenCount} hidden)</span>
                  </button>
                </div>
              )}
              <AnimatePresence>
                {windowedMessages.map(msg => (
                  msg.role === 'system' && msg.modeSwitch ? (
                    <motion.div
                      key={msg.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="flex items-center gap-3 py-2 px-4"
                    >
                      <div className="flex-1 h-px bg-border" />
                      <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                        {(() => { const M = MODES.find(m => m.id === msg.modeSwitch); const Icon = M?.icon; return Icon ? <Icon className="w-3 h-3" /> : null })()}
                        {msg.content}
                      </span>
                      <div className="flex-1 h-px bg-border" />
                    </motion.div>
                  ) :
                  <MessageBubble
                    key={msg.id}
                    message={msg}
                    highlights={highlightsByMessageId.get(msg.id) ?? EMPTY_HIGHLIGHTS}
                    onAddHighlight={addHighlight}
                    onUpdateHighlight={updateHighlight}
                    onDeleteHighlight={deleteHighlight}
                    onHighlightClick={handleHighlightClick}
                    focusedHighlightId={focusedHighlightId}
                    onQuizAnswer={(answer) => {
                      setInput(answer)
                      setTimeout(() => sendMessage(), 50)
                    }}
                    onQuizScore={(questionId, quizScore) => {
                      // Only credit score for NEW answers — no duplicate credit
                      if (!activeChapterContext) return
                      if (answeredQuestionIds.has(questionId)) return
                      // Mark question as answered
                      const newAnsweredIds = new Set(answeredQuestionIds)
                      newAnsweredIds.add(questionId)
                      setAnsweredQuestionIds(newAnsweredIds)
                      // Proportional weighting: weight=8pts per question
                      // < 50% score → 0 pts; >= 50% → (score/100) * 8 pts
                      const WEIGHT = 8
                      const points = quizScore < 50 ? 0 : (quizScore / 100) * WEIGHT
                      const newScore = Math.min(95, sessionScore + points)
                      setSessionScore(newScore)
                      setChapterByConvId(prev => {
                        if (!activeId || !prev[activeId]) return prev
                        return { ...prev, [activeId]: { ...prev[activeId], sessionScore: newScore } }
                      })
                      // Fire capstone pset strictly when score first crosses 80%
                      const crossedCapstone = newScore >= 80 && sessionScore < 80 && !capstoneTriggered
                      if (crossedCapstone) {
                        setCapstoneTriggered(true)
                      }
                      // Persist to DB — include answeredQuestionIds and capstoneTriggered
                      fetch(`/api/chapter/${activeChapterContext.id}/session`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          action: 'update_score',
                          score: newScore,
                          sessionData: {
                            objectives: [],
                            quizResults: [{ score: quizScore }],
                            quizzesGiven: quizzesGiven + 1,
                            conversationScore: newScore,
                            answeredQuestionIds: Array.from(newAnsweredIds),
                            capstoneTriggered: capstoneTriggered || crossedCapstone,
                          },
                        }),
                      }).then(r => r.ok ? r.json() : null).then(data => {
                        if (data?.xpAwards?.length) {
                          import('@/components/xp-toast').then(m => m.emitXpAwards(data.xpAwards))
                        }
                      }).catch(() => {})
                      setQuizzesGiven(prev => prev + 1)
                      // Auto-send capstone trigger after a short delay (lets the quiz response settle)
                      if (crossedCapstone && activeId) {
                        setTimeout(() => {
                          sendMessageWithText(
                            `[CAPSTONE] Student score reached ${Math.round(newScore)}%. Output the capstone problem set now per Phase 4 instructions. Cover all chapter topics and objectives, weight toward demonstrated weak areas from conversation history, include theory/conceptual/application/synthesis questions, use sub-questions and progressive difficulty. Use \`\`\`problem blocks.`,
                            activeId,
                            activeChapterContext.id,
                            true
                          )
                        }, 800)
                      }
                    }}
                    onSubmissionReview={(review) => {
                      // Auto-save submission to chapter file storage
                      if (!activeChapterContext) return
                      const md = [
                        `# ${activeChapterContext.title} — Submission Review`,
                        '',
                        `**Score:** ${review.totalScore}/100`,
                        `**Result:** ${review.passed ? 'Passed ✓' : 'Needs Revision ✗'}`,
                        '',
                        '## Problem Scores',
                        ...review.scores.map(s => `- **Problem ${s.problem}:** ${s.score}/10 — ${s.feedback}`),
                        '',
                        '## Overall Feedback',
                        review.feedback,
                      ].join('\n')
                      fetch('/api/files/upload', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          workType: 'content',
                          workId: activeChapterContext.id,
                          trackId: activeChapterContext.trackId,
                          name: `${activeChapterContext.title} — Submission.md`,
                          type: 'text/markdown',
                          content: md,
                        }),
                      }).catch(() => {})
                    }}
                    onFeedback={handleFeedback}
                    existingFeedback={feedbackMap[msg.id] ?? null}
                    answeredQuestionIds={answeredQuestionIds}
                    onReply={(quotedText) => {
                      setReplyQuote(quotedText)
                      setTimeout(() => {
                        const textarea = document.querySelector<HTMLTextAreaElement>('textarea[placeholder*="Ask Bob"]')
                        textarea?.focus()
                      }, 50)
                    }}
                    onRegenerate={msg.role === 'assistant' && lastUserMessage ? () => {
                      // Remove last assistant message and resend
                      setMessages(prev => prev.slice(0, -1))
                      setInput(lastUserMessage)
                      setTimeout(() => sendMessage(), 50)
                    } : undefined}
                    lessonMode={isLessonMode}
                    capstoneUnlocked={sessionScore === 0 || sessionScore >= 80}
                  />
                ))}
              </AnimatePresence>
              {isStreaming && streamingContent && (
                <div className={cn(isLessonMode && 'w-full max-w-3xl')}>
                  <MessageBubble
                    message={{
                      id: 'streaming',
                      role: 'assistant',
                      content: streamingContent,
                      timestamp: new Date(),
                    }}
                    lessonMode={isLessonMode}
                    capstoneUnlocked={sessionScore === 0 || sessionScore >= 80}
                  />
                  {/* Blinking cursor */}
                  <div className={cn('flex items-end gap-3 -mt-3 mb-2', isLessonMode ? 'ml-2' : 'ml-10')}>
                    <span className="inline-block w-0.5 h-4 bg-primary animate-pulse rounded-full" />
                  </div>
                </div>
              )}
              {isStreaming && !streamingContent && <TypingIndicator />}
              {/* Stop generating button */}
              {isStreaming && (
                <div className="flex justify-center py-2">
                  <button
                    onClick={() => {
                      // Mark this as a user-initiated stop BEFORE aborting,
                      // so the streaming loop's catch can preserve the
                      // partial output instead of erasing it.
                      userStoppedRef.current = true
                      abortRef.current?.abort()
                      // Do NOT clear streamingContent here — the loop's
                      // finalizer will move it into a permanent assistant
                      // message and then clear it.
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-card hover:bg-accent text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <div className="w-2.5 h-2.5 rounded-sm bg-foreground/60" />
                    {tr('chat.stopGenerating')}
                  </button>
                </div>
              )}
            </>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className={cn('p-3 lg:p-4 border-t border-border bg-card/50 backdrop-blur-sm', isLessonMode && 'flex flex-col items-center')}>
          {/* Pending image preview */}
          {pendingImage && (
            <div className="flex items-center gap-2 mb-3 max-w-4xl mx-auto">
              <div className="relative w-14 h-14 rounded-lg overflow-hidden border border-border flex-shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={pendingImage.preview} alt="Upload preview" className="w-full h-full object-cover" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-foreground font-medium truncate">{pendingImage.file.name}</p>
                <p className="text-[10px] text-muted-foreground">{tr("chat.imageWillAnalyze")}</p>
              </div>
              <button onClick={clearPendingImage} className="text-muted-foreground hover:text-destructive p-1 rounded transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Researching indicator */}
          {isResearching && (
            <div className="flex items-center gap-2 mb-2 max-w-4xl mx-auto text-xs text-muted-foreground">
              <Search className="w-3 h-3 text-primary animate-pulse" />
              <span>Analyzing image with Gemini…</span>
            </div>
          )}

          {/* Reply quote banner */}
          {replyQuote && (
            <div className="flex items-start gap-2 mb-2 max-w-4xl mx-auto bg-primary/5 border border-primary/20 rounded-lg px-3 py-2">
              <div className="flex-1 min-w-0">
                <p className="text-[10px] text-primary/60 font-medium mb-0.5">Replying to:</p>
                <p className="text-xs text-foreground/70 italic line-clamp-2">&ldquo;{replyQuote}&rdquo;</p>
              </div>
              <button onClick={() => setReplyQuote(null)} className="text-muted-foreground hover:text-foreground p-0.5 rounded transition-colors flex-shrink-0 mt-0.5">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          <div className={cn('flex items-end gap-2 lg:gap-3 mx-auto w-full', isLessonMode ? 'max-w-3xl' : 'max-w-4xl')}>
            {/* Image upload button */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*,.pdf,.doc,.docx,.txt,.md"
              onChange={handleImageSelect}
              className="hidden"
            />
            {/* Project file upload button — only in project work mode */}
            <input
              ref={projectFileInputRef}
              type="file"
              accept=".txt,.md,.py,.js,.ts,.jsx,.tsx,.html,.css,.json,.csv,.yaml,.yml,.xml,.sh,.rb,.go,.rs,.java,.cpp,.c,.h,.pdf,image/*"
              onChange={handleProjectFileSelect}
              className="hidden"
            />
            {activeProjectContext?.projectMode === 'work' ? (
              <button
                onClick={() => projectFileInputRef.current?.click()}
                disabled={isStreaming || projectFileUploading}
                title={tr("chat.uploadWorkFile")}
                className="w-11 h-11 flex-shrink-0 rounded-xl border border-primary/40 bg-primary/10 hover:bg-primary/20 flex items-center justify-center text-primary hover:text-primary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {projectFileUploading ? (
                  <div className="w-4 h-4 border-2 border-primary/40 border-t-primary rounded-full animate-spin" />
                ) : (
                  <Paperclip className="w-4 h-4" />
                )}
              </button>
            ) : (
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isStreaming}
                title={tr("chat.uploadImageAnalyze")}
                className="w-11 h-11 flex-shrink-0 rounded-xl border border-border bg-card hover:bg-accent flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Camera className="w-4 h-4" />
              </button>
            )}

            <textarea
              ref={textareaRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={pendingImage ? tr('chat.imagePlaceholder') : (isMobile ? tr('chat.placeholderShort', 'Ask Bob anything…') : tr('chat.placeholder'))}
              disabled={isStreaming}
              rows={1}
              className="flex-1 bg-background border border-border rounded-2xl px-4 py-3 text-[15px] lg:text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/60 transition-all disabled:opacity-50 h-12 min-h-[48px] max-h-[140px]"
            />
            {ttsSupported && !isMobile && (
              <button
                type="button"
                onClick={toggleReadAloud}
                title={readAloud ? tr('chat.voice.readAloudOn', 'Read Bob’s replies aloud: on') : tr('chat.voice.readAloudOff', 'Read Bob’s replies aloud: off')}
                className={cn(
                  'w-11 h-11 flex-shrink-0 rounded-xl border flex items-center justify-center transition-colors',
                  readAloud
                    ? 'border-primary/40 bg-primary/10 text-primary'
                    : 'border-border bg-card text-muted-foreground hover:text-foreground hover:bg-accent',
                )}
              >
                {readAloud ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
              </button>
            )}
            {micSupported && (
              <button
                type="button"
                onClick={toggleMic}
                disabled={isStreaming}
                title={listening ? tr('chat.voice.stop', 'Stop voice input') : tr('chat.voice.start', 'Speak your message')}
                className={cn(
                  'w-11 h-11 flex-shrink-0 rounded-xl border flex items-center justify-center transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
                  listening
                    ? 'border-red-500/50 bg-red-500/15 text-red-400 animate-pulse'
                    : 'border-border bg-card text-muted-foreground hover:text-foreground hover:bg-accent',
                )}
              >
                <Mic className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={sendMessage}
              disabled={(!input.trim() && !pendingImage) || isStreaming}
              className="w-11 h-11 flex-shrink-0 rounded-xl bg-primary flex items-center justify-center text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
          <p className="hidden lg:block text-center text-[10px] text-muted-foreground mt-2">
            {chatMode === 'tutoring' && tr('chat.footer.tutoring')}
            {chatMode === 'logistics' && tr('chat.footer.logistics')}
            {chatMode === 'research' && tr('chat.footer.research')}

          </p>
        </div>

        {/* Toast notifications */}
        <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      </div>

      {/* Mobile backdrop — tap to close the right panel drawer */}
      {isMobile && activeId && rightPanelOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
          onClick={() => setRightPanelOpen(false)}
        />
      )}
      {/* Right panel — inline column on desktop, slide-in drawer on mobile */}
      {activeId && (
        <RightPanel
          tab={rightPanelTab}
          open={rightPanelOpen}
          isMobile={isMobile}
          onTabChange={setRightPanelTab}
          onToggle={() => setRightPanelOpen(p => !p)}
          chapter={activeChapterContext ?? null}
          conversationId={activeId}
          trackId={activeChapterContext?.trackId}
          highlights={highlights}
          focusedHighlightId={focusedHighlightId}
          onDeleteHighlight={deleteHighlight}
          onUpdateHighlight={updateHighlight}
          onHighlightCardClick={handleAnnotationCardClick}
        />
      )}
      </div>
    </div>
  )
}

export default function ChatPage() {
  return (
    <Suspense fallback={
      <div className="flex h-screen items-center justify-center">
        <div className="text-sm text-muted-foreground">Loading chat…</div>
      </div>
    }>
      <ChatPageInner />
    </Suspense>
  )
}
