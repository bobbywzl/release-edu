'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { motion } from 'framer-motion'
import {
  BookOpen, Download, RefreshCw, Save, ChevronRight,
  Pencil, X, FileText, FolderPlus, Loader2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import ReactMarkdown from 'react-markdown'

// ── Types ────────────────────────────────────────────────────────────────────

interface LectureNotesPanelProps {
  chapterId: string
  chapterTitle: string
  trackId: string
  conversationId: string | null
  collapsed: boolean
  onToggle: () => void
  inline?: boolean
}

// ── Note Section Component ───────────────────────────────────────────────────

function NoteSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <h3 className="text-[11px] font-bold uppercase tracking-wider text-primary/70 flex items-center gap-1.5">
        <span className="w-3 h-px bg-primary/40 inline-block" />
        {title}
      </h3>
      <div className="pl-2">{children}</div>
    </div>
  )
}

// ── Parse markdown into sections ─────────────────────────────────────────────

interface ParsedSection {
  title: string
  content: string
}

function parseNoteSections(markdown: string): ParsedSection[] | null {
  try {
    const sections: ParsedSection[] = []
    const lines = markdown.split('\n')
    let currentTitle = ''
    let currentContent: string[] = []

    for (const line of lines) {
      const headerMatch = line.match(/^##\s+(.+)/)
      if (headerMatch) {
        if (currentTitle) {
          sections.push({ title: currentTitle, content: currentContent.join('\n').trim() })
        }
        currentTitle = headerMatch[1]
        currentContent = []
      } else {
        currentContent.push(line)
      }
    }
    if (currentTitle) {
      sections.push({ title: currentTitle, content: currentContent.join('\n').trim() })
    }

    return sections.length >= 2 ? sections : null
  } catch {
    return null
  }
}

// ── Structured Notes Renderer ────────────────────────────────────────────────

function StructuredNotes({ markdown }: { markdown: string }) {
  const sections = useMemo(() => parseNoteSections(markdown), [markdown])

  if (!sections) {
    // Fallback: render raw markdown with styled components
    return (
      <div className="prose prose-invert prose-sm max-w-none">
        <ReactMarkdown
          components={{
            h2: ({ children }) => (
              <div className="border-l-2 border-primary/40 pl-2 mb-2 mt-4 first:mt-0">
                <span className="text-[11px] font-bold uppercase tracking-wider text-primary/70">
                  {children}
                </span>
              </div>
            ),
            ul: ({ children }) => (
              <ul className="space-y-1.5 my-2 ml-1">{children}</ul>
            ),
            li: ({ children }) => (
              <li className="flex items-start gap-2 text-sm text-foreground/80 leading-relaxed">
                <span className="w-1 h-1 rounded-full bg-primary/50 mt-2 flex-shrink-0" />
                <span>{children}</span>
              </li>
            ),
            p: ({ children }) => (
              <p className="text-sm text-foreground/80 leading-relaxed mb-2">{children}</p>
            ),
            strong: ({ children }) => (
              <strong className="font-semibold text-foreground">{children}</strong>
            ),
          }}
        >
          {markdown}
        </ReactMarkdown>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {sections.map((section, i) => (
        <NoteSection key={i} title={section.title}>
          {section.content.match(/^[-*]\s/) ? (
            // Render bullet list
            <ul className="space-y-1.5">
              {section.content
                .split('\n')
                .filter(l => l.match(/^[-*]\s/))
                .map((line, j) => (
                  <li key={j} className="flex items-start gap-2 text-sm text-foreground/80 leading-relaxed">
                    <span className="w-1 h-1 rounded-full bg-primary/50 mt-2 flex-shrink-0" />
                    <span>
                      <ReactMarkdown
                        components={{
                          p: ({ children }) => <>{children}</>,
                          strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
                          em: ({ children }) => <em className="text-foreground/70">{children}</em>,
                          code: ({ children }) => <code className="bg-muted px-1 py-0.5 rounded text-[11px] font-mono text-primary">{children}</code>,
                        }}
                      >
                        {line.replace(/^[-*]\s+/, '')}
                      </ReactMarkdown>
                    </span>
                  </li>
                ))}
            </ul>
          ) : (
            // Render paragraph content (e.g. Summary)
            <div className="text-sm text-foreground/80 leading-relaxed">
              <ReactMarkdown
                components={{
                  p: ({ children }) => <p className="mb-1.5 last:mb-0">{children}</p>,
                  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
                  em: ({ children }) => <em className="text-foreground/70">{children}</em>,
                  code: ({ children }) => <code className="bg-muted px-1 py-0.5 rounded text-[11px] font-mono text-primary">{children}</code>,
                }}
              >
                {section.content}
              </ReactMarkdown>
            </div>
          )}
        </NoteSection>
      ))}
    </div>
  )
}

// ── Main Panel ───────────────────────────────────────────────────────────────

export function LectureNotesPanel({
  chapterId,
  chapterTitle,
  trackId,
  conversationId,
  collapsed,
  onToggle,
  inline,
}: LectureNotesPanelProps) {
  const [notes, setNotes] = useState<string>('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editedNotes, setEditedNotes] = useState('')
  const [lastSaved, setLastSaved] = useState<Date | null>(null)
  const [isSavingToFiles, setIsSavingToFiles] = useState(false)
  const [savedToFiles, setSavedToFiles] = useState(false)

  // Load existing notes on mount
  useEffect(() => {
    fetch(`/api/chapter/${chapterId}/notes`)
      .then(r => r.json())
      .then(d => {
        if (d.notes) {
          setNotes(d.notes)
          setEditedNotes(d.notes)
        }
      })
      .catch(() => {})
  }, [chapterId])

  const generateNotes = useCallback(async () => {
    if (!conversationId) return
    setIsGenerating(true)
    try {
      const res = await fetch(`/api/chapter/${chapterId}/generate-notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId }),
      })
      const data = await res.json()
      if (data.notes) {
        setNotes(data.notes)
        setEditedNotes(data.notes)
        setLastSaved(new Date())
      }
    } catch {
      // silently fail
    } finally {
      setIsGenerating(false)
    }
  }, [chapterId, conversationId])

  const saveNotes = useCallback(async () => {
    await fetch(`/api/chapter/${chapterId}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: editedNotes }),
    })
    setNotes(editedNotes)
    setIsEditing(false)
    setLastSaved(new Date())
  }, [chapterId, editedNotes])

  const downloadNotes = useCallback(() => {
    const blob = new Blob([notes], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${chapterTitle.replace(/\s+/g, '_')}_notes.md`
    a.click()
    URL.revokeObjectURL(url)
  }, [notes, chapterTitle])

  const saveToFiles = useCallback(async () => {
    if (!notes || isSavingToFiles) return
    setIsSavingToFiles(true)
    try {
      const res = await fetch('/api/files/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workType: 'content',
          workId: chapterId,
          trackId,
          name: `${chapterTitle} — Session Notes.md`,
          type: 'text/markdown',
          content: notes,
        }),
      })
      if (res.ok) {
        setSavedToFiles(true)
        setTimeout(() => setSavedToFiles(false), 3000)
      }
    } catch {
      // silently fail
    } finally {
      setIsSavingToFiles(false)
    }
  }, [notes, chapterId, trackId, chapterTitle, isSavingToFiles])

  // ── Collapsed state (non-inline only) ─────────────────────────────────

  if (!inline && collapsed) {
    return (
      <button
        onClick={onToggle}
        className="flex flex-col items-center justify-center w-10 bg-card border-l border-border hover:bg-muted transition-colors py-4"
        title="Open session notes"
      >
        <FileText className="w-4 h-4 text-primary mb-2" />
        <span className="text-[9px] text-muted-foreground rotate-90 whitespace-nowrap tracking-wider">
          NOTES
        </span>
      </button>
    )
  }

  // ── Inline content (embedded inside RightPanel) ──────────────────────

  const notesContent = (
    <>
      {/* Content area */}
      <div className={inline ? '' : 'flex-1 overflow-y-auto'}>
        {/* Empty state */}
        {!notes && !isGenerating && (
          <div className="flex flex-col items-center justify-center text-center gap-3 px-6 py-12">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
              <BookOpen className="w-6 h-6 text-primary/60" />
            </div>
            <div>
              <p className="text-xs font-medium text-foreground">No notes yet</p>
              <p className="text-[10px] text-muted-foreground mt-1 leading-relaxed">
                Chat with Bob first, then generate<br />structured notes from the session
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="text-xs h-7 mt-1"
              onClick={generateNotes}
              disabled={!conversationId}
            >
              <FileText className="w-3 h-3 mr-1.5" />
              Generate Notes
            </Button>
          </div>
        )}

        {/* Generating state */}
        {isGenerating && (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
            <p className="text-xs text-muted-foreground">Generating structured notes…</p>
          </div>
        )}

        {/* Edit mode */}
        {notes && !isGenerating && isEditing && (
          <div className="p-3 space-y-2 flex flex-col">
            <textarea
              value={editedNotes}
              onChange={e => setEditedNotes(e.target.value)}
              className="w-full text-xs font-mono bg-background border border-border rounded-lg p-3 text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary/40 leading-relaxed min-h-[200px]"
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="text-xs h-7 flex-1"
                onClick={() => { setIsEditing(false); setEditedNotes(notes) }}
              >
                Cancel
              </Button>
              <Button size="sm" className="text-xs h-7 flex-1" onClick={saveNotes}>
                <Save className="w-3 h-3 mr-1" />
                Save
              </Button>
            </div>
          </div>
        )}

        {/* Notes display */}
        {notes && !isGenerating && !isEditing && (
          <div className="p-3">
            <StructuredNotes markdown={notes} />
          </div>
        )}
      </div>

      {/* Toolbar — always visible when notes exist */}
      {notes && !isGenerating && !isEditing && (
        <div className="border-t border-border bg-card px-3 py-2 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setIsEditing(true)}
              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              title="Edit notes"
            >
              <Pencil className="w-3 h-3" />
              Edit
            </button>
            <button
              onClick={downloadNotes}
              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              title="Download as .md"
            >
              <Download className="w-3 h-3" />
              .md
            </button>
            <button
              onClick={saveToFiles}
              disabled={isSavingToFiles}
              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-40"
              title="Save to chapter files"
            >
              {isSavingToFiles ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : savedToFiles ? (
                <span className="text-emerald-400 flex items-center gap-1">
                  <FolderPlus className="w-3 h-3" />
                  Saved ✓
                </span>
              ) : (
                <>
                  <FolderPlus className="w-3 h-3" />
                  Save to Files
                </>
              )}
            </button>
            {!inline && (
              <button
                onClick={generateNotes}
                disabled={isGenerating || !conversationId}
                className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-30 ml-auto"
                title="Regenerate notes"
              >
                <RefreshCw className={`w-3 h-3 ${isGenerating ? 'animate-spin' : ''}`} />
              </button>
            )}
          </div>
          {lastSaved && (
            <p className="text-[9px] text-muted-foreground/60 text-right">
              Saved {lastSaved.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </p>
          )}
        </div>
      )}
    </>
  )

  // ── Inline mode — render content directly ────────────────────────────

  if (inline) {
    return (
      <div className="flex flex-col h-full">
        {/* Inline header with regenerate button */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-border/50 flex-shrink-0">
          <p className="text-[10px] text-muted-foreground truncate">{chapterTitle}</p>
          <button
            onClick={generateNotes}
            disabled={isGenerating || !conversationId}
            className="p-1 hover:bg-accent rounded transition-colors disabled:opacity-30"
            title="Regenerate notes"
          >
            <RefreshCw className={`w-3 h-3 text-muted-foreground ${isGenerating ? 'animate-spin' : ''}`} />
          </button>
        </div>
        {notesContent}
      </div>
    )
  }

  // ── Expanded panel (standalone) ──────────────────────────────────────

  return (
    <motion.div
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: 300, opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      className="flex flex-col border-l border-border bg-card/30 overflow-hidden"
      style={{ minWidth: 280, maxWidth: 320 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border bg-card">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5 text-primary flex-shrink-0" />
            <span className="text-xs font-semibold text-foreground">Session Notes</span>
          </div>
          <p className="text-[10px] text-muted-foreground truncate mt-0.5 pl-5">
            {chapterTitle}
          </p>
        </div>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button
            onClick={generateNotes}
            disabled={isGenerating || !conversationId}
            className="p-1.5 hover:bg-accent rounded transition-colors disabled:opacity-30"
            title="Regenerate notes"
          >
            <RefreshCw className={`w-3 h-3 text-muted-foreground ${isGenerating ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={onToggle}
            className="p-1.5 hover:bg-accent rounded transition-colors"
            title="Collapse panel"
          >
            <ChevronRight className="w-3 h-3 text-muted-foreground" />
          </button>
        </div>
      </div>

      {notesContent}
    </motion.div>
  )
}
