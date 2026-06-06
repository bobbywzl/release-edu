'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Bot, Send, Trash2, ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────

export interface WorkContext {
  type: 'content' | 'homework' | 'quiz' | 'project'
  trackId: string
  trackName: string
  itemId: string
  itemTitle: string
  content: string
}

interface BobChatWidgetProps {
  workContext: WorkContext
  compact?: boolean
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

const TYPE_LABELS: Record<string, string> = {
  content: 'Content',
  homework: 'Homework',
  quiz: 'Quiz',
  project: 'Project',
}

let nextMsgId = 1

// ── Typing Indicator ───────────────────────────────────────

function TypingIndicator() {
  return (
    <div className="flex items-end gap-2">
      <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
        <Bot className="w-3 h-3 text-primary" />
      </div>
      <div className="bg-card border border-border rounded-2xl rounded-bl-sm px-3 py-2">
        <div className="flex items-center gap-1">
          {[0, 1, 2].map(i => (
            <motion.div
              key={i}
              className="w-1.5 h-1.5 rounded-full bg-muted-foreground"
              animate={{ opacity: [0.3, 1, 0.3], y: [0, -3, 0] }}
              transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Message Bubble ─────────────────────────────────────────

function MiniMessageBubble({ message, compact }: { message: ChatMessage; compact?: boolean }) {
  const isUser = message.role === 'user'
  const textSize = compact ? 'text-xs' : 'text-xs'

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn('flex items-end gap-2', isUser ? 'flex-row-reverse' : '')}
    >
      {!isUser && (
        <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
          <Bot className="w-3 h-3 text-primary" />
        </div>
      )}
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-3 py-2',
          textSize,
          isUser
            ? 'bg-primary text-primary-foreground rounded-br-sm'
            : 'bg-card border border-border text-foreground rounded-bl-sm'
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
        ) : (
          <div className="prose prose-invert prose-xs max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                code({ children, className }) {
                  const isInline = !className
                  return isInline ? (
                    <code className="bg-muted px-1 py-0.5 rounded text-[10px] font-mono text-primary">
                      {children}
                    </code>
                  ) : (
                    <pre className="bg-muted rounded-lg p-2 overflow-x-auto my-1.5">
                      <code className="text-[10px] font-mono text-foreground">{children}</code>
                    </pre>
                  )
                },
                strong({ children }) {
                  return <strong className="font-semibold text-foreground">{children}</strong>
                },
                p({ children }) {
                  return <p className="mb-1.5 last:mb-0 leading-relaxed text-xs">{children}</p>
                },
                ul({ children }) {
                  return <ul className="my-1.5 space-y-0.5 list-disc list-inside">{children}</ul>
                },
                ol({ children }) {
                  return <ol className="my-1.5 space-y-0.5 list-decimal list-inside">{children}</ol>
                },
                li({ children }) {
                  return <li className="text-xs text-foreground">{children}</li>
                },
              }}
            >
              {message.content}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </motion.div>
  )
}

// ── Main Widget ────────────────────────────────────────────

export default function BobChatWidget({ workContext, compact }: BobChatWidgetProps) {
  const [isOpen, setIsOpen] = useState(true)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Collapse by default on mobile
  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      setIsOpen(false)
    }
  }, [])

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, streamingContent, scrollToBottom])

  function clearChat() {
    setMessages([])
    setStreamingContent('')
  }

  async function sendMessage() {
    const text = input.trim()
    if (!text || isStreaming) return

    const userMsg: ChatMessage = {
      id: `widget-${nextMsgId++}`,
      role: 'user',
      content: text,
      timestamp: new Date(),
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
          message: text,
          mode: 'tutoring',
          workContext,
        }),
      })

      if (!response.ok || !response.body) throw new Error('Stream error')

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let full = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        full += chunk
        setStreamingContent(full)
      }

      const assistantMsg: ChatMessage = {
        id: `widget-${nextMsgId++}`,
        role: 'assistant',
        content: full,
        timestamp: new Date(),
      }
      setMessages(prev => [...prev, assistantMsg])
    } catch {
      const errMsg: ChatMessage = {
        id: `widget-${nextMsgId++}`,
        role: 'assistant',
        content: "I'm having trouble connecting right now. Please try again.",
        timestamp: new Date(),
      }
      setMessages(prev => [...prev, errMsg])
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

  const typeLabel = TYPE_LABELS[workContext.type] ?? 'Work'

  return (
    <div className="w-full lg:w-80 flex-shrink-0">
      {/* Header — always visible */}
      <button
        onClick={() => setIsOpen(o => !o)}
        className={cn(
          'w-full flex items-center justify-between px-3 py-2.5 border border-border bg-card transition-colors hover:bg-accent/50',
          isOpen ? 'rounded-t-lg border-b-0' : 'rounded-lg'
        )}
      >
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center">
            <Bot className="w-3 h-3 text-primary" />
          </div>
          <span className="text-xs font-medium text-foreground">
            Bob · {typeLabel} Assistant
          </span>
          {isStreaming && (
            <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
          )}
        </div>
        <div className="flex items-center gap-1">
          {messages.length > 0 && isOpen && (
            <button
              onClick={e => { e.stopPropagation(); clearChat() }}
              className="p-1 text-muted-foreground hover:text-foreground rounded transition-colors"
              title="Clear chat"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
          {isOpen ? (
            <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
          )}
        </div>
      </button>

      {/* Body */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div
              className={cn(
                'border border-border border-t-0 rounded-b-lg bg-card flex flex-col',
                compact ? 'max-h-[300px]' : 'max-h-[calc(100vh-8rem)] lg:max-h-[calc(100vh-10rem)]'
              )}
            >
              {/* Messages area */}
              <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-[120px]">
                {messages.length === 0 && !isStreaming ? (
                  <div className="text-center py-6 px-2">
                    <Bot className="w-8 h-8 mx-auto text-muted-foreground/40 mb-2" />
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Need help with this {workContext.type}? Ask me anything — I can see exactly what you&apos;re working on.
                    </p>
                  </div>
                ) : (
                  <>
                    {messages.map(msg => (
                      <MiniMessageBubble key={msg.id} message={msg} compact={compact} />
                    ))}
                    {isStreaming && streamingContent && (
                      <MiniMessageBubble
                        message={{
                          id: 'streaming',
                          role: 'assistant',
                          content: streamingContent,
                          timestamp: new Date(),
                        }}
                        compact={compact}
                      />
                    )}
                    {isStreaming && !streamingContent && <TypingIndicator />}
                  </>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Input area — sticky at bottom */}
              <div className="p-2 border-t border-border flex-shrink-0">
                <div className="flex items-center gap-2">
                  <input
                    ref={inputRef}
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Ask Bob..."
                    disabled={isStreaming}
                    className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/60 transition-all disabled:opacity-50"
                  />
                  <button
                    onClick={sendMessage}
                    disabled={!input.trim() || isStreaming}
                    className="w-8 h-8 flex-shrink-0 rounded-lg bg-primary flex items-center justify-center text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Send className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
