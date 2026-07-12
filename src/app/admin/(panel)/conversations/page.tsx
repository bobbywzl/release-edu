'use client'
import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  Search, MessageSquare, Bot, User, ChevronLeft,
  Filter, Download, AlertCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface ConversationSummary {
  id: string
  title: string
  context: string | null
  messageCount: number
  updatedAt: string
  preview: string
  studentName: string | null
  studentEmail: string | null
  studentId: string
}

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}

interface ConversationDetail {
  id: string
  title: string
  context: string | null
  createdAt: string
  updatedAt: string
  messages: Message[]
}

function timeAgo(dateStr: string): string {
  const date = new Date(dateStr)
  const diff = Date.now() - date.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function ConversationBrowserInner() {
  const searchParams = useSearchParams()
  const highlightId = searchParams.get('highlight')

  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [selected, setSelected] = useState<ConversationDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)

  const loadDetail = useCallback(async (id: string) => {
    setLoadingDetail(true)
    try {
      // Admin-guarded detail route: the owner-scoped /api/conversations/[id]
      // 404s for every conversation the admin doesn't personally own.
      const res = await fetch(`/api/admin/conversations/${id}`)
      if (res.ok) {
        setSelected(await res.json() as ConversationDetail)
      } else {
        setError(`Could not load conversation (${res.status})`)
      }
    } catch {
      setError('Could not load conversation')
    } finally {
      setLoadingDetail(false)
    }
  }, [])

  useEffect(() => {
    async function load() {
      try {
        const url = search
          ? `/api/teacher/conversations?search=${encodeURIComponent(search)}`
          : '/api/teacher/conversations'
        const res = await fetch(url)
        if (res.ok) {
          const data = await res.json() as ConversationSummary[]
          setConversations(data)
          // Auto-select highlighted or first
          const toSelect = highlightId
            ? data.find(c => c.id === highlightId)
            : data[0]
          if (toSelect) await loadDetail(toSelect.id)
        }
      } catch {
        setError('Failed to load conversations')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [search, highlightId, loadDetail])

  function exportMarkdown(conv: ConversationDetail) {
    const md = `# ${conv.title}\n\n${conv.messages.map(m => `**${m.role === 'user' ? 'Student' : 'Bob'}:** ${m.content}`).join('\n\n')}`
    const blob = new Blob([md], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${conv.title.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-80 flex-shrink-0 border-r border-border bg-card flex flex-col">
        <div className="p-4 border-b border-border">
          <h1 className="font-semibold text-foreground mb-3">All Conversations</h1>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search conversations…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-background border border-border rounded-lg pl-9 pr-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-8 text-center text-muted-foreground text-sm">Loading…</div>
          ) : error ? (
            <div className="p-4 flex items-center gap-2 text-destructive text-sm">
              <AlertCircle className="w-4 h-4" />
              {error}
            </div>
          ) : conversations.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-sm">
              No conversations found.
            </div>
          ) : (
            conversations.map(conv => (
              <button
                key={conv.id}
                onClick={() => loadDetail(conv.id)}
                className={cn(
                  'w-full text-left p-4 border-b border-border hover:bg-accent transition-colors',
                  selected?.id === conv.id && 'bg-primary/10 border-l-2 border-l-primary'
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm text-foreground truncate">{conv.title}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {conv.studentName ?? conv.studentEmail ?? 'Unknown student'}
                    </div>
                    {conv.preview && (
                      <div className="text-xs text-muted-foreground/60 mt-1 truncate">
                        {conv.preview}
                      </div>
                    )}
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-[10px] text-muted-foreground">{timeAgo(conv.updatedAt)}</div>
                    <div className="text-[10px] text-muted-foreground mt-1">
                      {conv.messageCount} msgs
                    </div>
                  </div>
                </div>
                {conv.context && (
                  <div className="mt-1.5 flex items-center gap-1">
                    <Filter className="w-3 h-3 text-muted-foreground" />
                    <span className="text-[10px] text-muted-foreground">{conv.context}</span>
                  </div>
                )}
              </button>
            ))
          )}
        </div>
      </aside>

      {/* Main conversation view */}
      <div className="flex-1 flex flex-col min-w-0">
        {!selected ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center text-muted-foreground">
              <MessageSquare className="w-12 h-12 mx-auto mb-4 opacity-20" />
              <div className="text-sm">Select a conversation to read it</div>
            </div>
          </div>
        ) : loadingDetail ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-muted-foreground text-sm">Loading conversation…</div>
          </div>
        ) : (
          <>
            {/* Conversation header */}
            <div className="p-4 border-b border-border bg-card/50 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setSelected(null)}
                  className="text-muted-foreground hover:text-foreground transition-colors lg:hidden"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <div>
                  <div className="font-semibold text-foreground">{selected.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {selected.messages.length} messages
                    {selected.context && ` · ${selected.context}`}
                  </div>
                </div>
              </div>
              <button
                onClick={() => exportMarkdown(selected)}
                className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-1.5 transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                Export
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {selected.messages.map(msg => (
                <div
                  key={msg.id}
                  className={cn('flex items-start gap-3', msg.role === 'user' ? 'flex-row-reverse' : '')}
                >
                  <div className={cn(
                    'w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-1',
                    msg.role === 'user'
                      ? 'bg-primary/20'
                      : 'bg-muted'
                  )}>
                    {msg.role === 'user'
                      ? <User className="w-3.5 h-3.5 text-primary" />
                      : <Bot className="w-3.5 h-3.5 text-foreground" />
                    }
                  </div>
                  <div className={cn(
                    'max-w-[80%] rounded-2xl px-4 py-3 text-sm',
                    msg.role === 'user'
                      ? 'bg-primary text-primary-foreground rounded-br-sm'
                      : 'bg-card border border-border text-foreground rounded-bl-sm'
                  )}>
                    {msg.role === 'user' ? (
                      <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                    ) : (
                      <div className="prose prose-invert prose-sm max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {msg.content}
                        </ReactMarkdown>
                      </div>
                    )}
                    <div className={cn('text-[10px] mt-1.5 opacity-60', msg.role === 'user' ? 'text-right' : '')}>
                      {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default function ConversationsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-muted-foreground text-sm">Loading…</div>}>
      <ConversationBrowserInner />
    </Suspense>
  )
}
