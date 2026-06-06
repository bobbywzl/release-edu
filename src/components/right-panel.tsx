'use client'
import { useState, useEffect, useRef } from 'react'
import { BookOpen, Pin, FileText, ChevronRight, ChevronLeft, Trash2, MessageSquare } from 'lucide-react'
import { LectureNotesPanel } from './lecture-notes-panel'
import type { Highlight } from '@/lib/highlights'
import { cn } from '@/lib/utils'

type Tab = 'annotations' | 'notes' | 'review'

interface Props {
  tab: Tab
  open: boolean
  onTabChange: (t: Tab) => void
  onToggle: () => void
  chapter?: { id: string; title: string; trackId: string; trackName: string; description?: string; keyTopics?: string[] } | null
  conversationId: string | null
  trackId?: string
  highlights: Highlight[]
  focusedHighlightId?: string | null
  onDeleteHighlight: (id: string) => void
  onUpdateHighlight: (id: string, data: { comment?: string; color?: string }) => void
  onHighlightCardClick: (id: string) => void
}

const COLOR_STYLES: Record<string, { border: string; bg: string; ring: string }> = {
  amber:  { border: 'border-amber-500/40',   bg: 'bg-amber-500/5',   ring: 'ring-amber-400' },
  blue:   { border: 'border-blue-500/40',    bg: 'bg-blue-500/5',    ring: 'ring-blue-400' },
  green:  { border: 'border-emerald-500/40', bg: 'bg-emerald-500/5', ring: 'ring-emerald-400' },
  purple: { border: 'border-purple-500/40',  bg: 'bg-purple-500/5',  ring: 'ring-purple-400' },
}

function AnnotationCard({
  highlight,
  isFocused,
  onDelete,
  onUpdate,
  onClick,
}: {
  highlight: Highlight
  isFocused: boolean
  onDelete: () => void
  onUpdate: (comment: string) => void
  onClick: () => void
}) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [editing, setEditing] = useState(false)
  const [comment, setComment] = useState(highlight.comment || '')
  const colors = COLOR_STYLES[highlight.color] ?? COLOR_STYLES.amber

  // Scroll card into view when focused from chat
  useEffect(() => {
    if (isFocused && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [isFocused])

  // Dismiss edit on click-off
  useEffect(() => {
    if (!editing) return
    function handleClick(e: MouseEvent) {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
        setEditing(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [editing])

  function handleSave() {
    onUpdate(comment.trim())
    setEditing(false)
  }

  return (
    <div
      ref={cardRef}
      className={cn(
        'rounded-lg border p-2.5 space-y-1.5 cursor-pointer transition-all duration-200',
        colors.border, colors.bg,
        isFocused && `ring-2 ${colors.ring} ring-offset-1 ring-offset-background`
      )}
      onClick={onClick}
    >
      {/* Quoted text */}
      <p className="text-xs italic text-foreground/70 line-clamp-2 leading-snug">
        &ldquo;{highlight.selectedText}&rdquo;
      </p>

      {/* Comment display or edit */}
      {editing ? (
        <div onClick={e => e.stopPropagation()} className="space-y-1">
          <textarea
            autoFocus
            value={comment}
            onChange={e => setComment(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSave() } }}
            placeholder="Add a note…"
            className="w-full text-xs bg-background border border-border rounded px-2 py-1.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/40 resize-none"
            rows={3}
          />
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              className="flex-1 text-xs bg-primary text-primary-foreground rounded px-2 py-1 hover:bg-primary/90"
            >
              Save
            </button>
            <button
              onClick={() => { setComment(highlight.comment || ''); setEditing(false) }}
              className="text-xs text-muted-foreground hover:text-foreground px-2 py-1"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-start justify-between gap-1">
          <div className="flex-1 min-w-0">
            {highlight.comment ? (
              <p className="text-xs text-muted-foreground leading-snug">{highlight.comment}</p>
            ) : (
              <button
                onClick={e => { e.stopPropagation(); setEditing(true) }}
                className="text-xs text-muted-foreground/50 hover:text-muted-foreground flex items-center gap-1 transition-colors"
              >
                <MessageSquare className="w-3 h-3" />
                Add a note…
              </button>
            )}
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {highlight.comment && (
              <button
                onClick={e => { e.stopPropagation(); setEditing(true) }}
                className="text-muted-foreground/40 hover:text-muted-foreground transition-colors p-0.5"
                title="Edit comment"
              >
                <MessageSquare className="w-3 h-3" />
              </button>
            )}
            <button
              onClick={e => { e.stopPropagation(); onDelete() }}
              className="text-muted-foreground/40 hover:text-red-400 transition-colors p-0.5"
              title="Delete"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}

      <span className="text-[10px] text-muted-foreground/40">
        {new Date(highlight.createdAt).toLocaleDateString()}
      </span>
    </div>
  )
}

export function RightPanel({
  tab, open, onTabChange, onToggle, chapter, conversationId, trackId,
  highlights, focusedHighlightId, onDeleteHighlight, onUpdateHighlight, onHighlightCardClick,
}: Props) {
  const [reviewContent, setReviewContent] = useState<{ content: string; keyTopics: string[]; description: string } | null>(null)
  const [loadingReview, setLoadingReview] = useState(false)

  useEffect(() => {
    if (tab === 'review' && chapter && !reviewContent) {
      setLoadingReview(true)
      fetch(`/api/chapter/${chapter.id}`)
        .then(r => r.json())
        .then(async ({ chapter: ch }) => {
          let content = ch?.content || ''
          if (!content || content.includes('Content will be generated') || content.length < 200) {
            const gen = await fetch(`/api/chapter/${chapter.id}/generate-content`, { method: 'POST' })
            if (gen.ok) content = (await gen.json()).content || ''
          }
          setReviewContent({ content, keyTopics: ch?.keyTopics || [], description: ch?.description || '' })
        })
        .catch(() => {})
        .finally(() => setLoadingReview(false))
    }
  }, [tab, chapter, reviewContent])

  // Only show Notes + Review tabs when in a chapter session
  const TABS: { id: Tab; label: string; icon: typeof BookOpen; count?: number }[] = [
    { id: 'annotations', label: 'Annotations', icon: Pin, count: highlights.length || undefined },
    ...(chapter ? [
      { id: 'notes' as Tab, label: 'Notes', icon: FileText },
      { id: 'review' as Tab, label: 'Review', icon: BookOpen },
    ] : []),
  ]

  if (!open) {
    return (
      <div className="w-8 flex-shrink-0 border-l border-border bg-card/50 flex flex-col items-center pt-4 gap-3">
        <button onClick={onToggle} className="text-muted-foreground hover:text-foreground transition-colors">
          <ChevronLeft className="w-4 h-4" />
        </button>
        {TABS.map(t => {
          const Icon = t.icon
          return (
            <button key={t.id} onClick={() => { onTabChange(t.id); onToggle() }}
              className="text-muted-foreground hover:text-foreground transition-colors relative">
              <Icon className="w-4 h-4" />
              {t.count ? <span className="absolute -top-1 -right-1 w-3 h-3 bg-primary rounded-full text-[8px] text-white flex items-center justify-center">{t.count}</span> : null}
            </button>
          )
        })}
      </div>
    )
  }

  return (
    <div className="w-80 flex-shrink-0 border-l border-border bg-card flex flex-col overflow-hidden">
      {/* Tab bar */}
      <div className="flex items-center border-b border-border flex-shrink-0">
        {TABS.map(t => {
          const Icon = t.icon
          const active = tab === t.id
          return (
            <button
              key={t.id}
              onClick={() => onTabChange(t.id)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium border-b-2 -mb-px transition-colors ${
                active ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
              {t.count ? <span className="bg-primary/20 text-primary text-[9px] px-1 rounded-full">{t.count}</span> : null}
            </button>
          )
        })}
        <button onClick={onToggle} className="px-2 text-muted-foreground hover:text-foreground">
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {tab === 'annotations' && (
          <div className="p-3 space-y-2">
            {highlights.length === 0 ? (
              <div className="py-8 text-center">
                <Pin className="w-6 h-6 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-xs text-muted-foreground">No annotations yet.<br />Select text in any message to highlight it.</p>
              </div>
            ) : (
              highlights.map(h => (
                <AnnotationCard
                  key={h.id}
                  highlight={h}
                  isFocused={focusedHighlightId === h.id}
                  onDelete={() => onDeleteHighlight(h.id)}
                  onUpdate={comment => onUpdateHighlight(h.id, { comment })}
                  onClick={() => onHighlightCardClick(h.id)}
                />
              ))
            )}
          </div>
        )}

        {tab === 'notes' && chapter && (
          <LectureNotesPanel
            chapterId={chapter.id}
            chapterTitle={chapter.title}
            trackId={trackId || chapter.trackId}
            conversationId={conversationId}
            collapsed={false}
            onToggle={() => {}}
            inline={true}
          />
        )}

        {tab === 'review' && (
          <div className="p-4 space-y-4">
            {loadingReview ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-8 justify-center">
                <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                Loading chapter content…
              </div>
            ) : reviewContent ? (
              <>
                {reviewContent.description && (
                  <p className="text-xs text-muted-foreground leading-relaxed">{reviewContent.description}</p>
                )}
                {reviewContent.keyTopics.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {reviewContent.keyTopics.map((t: string) => (
                      <span key={t} className="text-[10px] px-2 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20">{t}</span>
                    ))}
                  </div>
                )}
                <div className="prose prose-invert prose-xs max-w-none text-xs">
                  <pre className="whitespace-pre-wrap font-sans text-xs text-foreground/80 leading-relaxed">{reviewContent.content}</pre>
                </div>
              </>
            ) : (
              <div className="py-8 text-center text-xs text-muted-foreground">Could not load chapter content.</div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
