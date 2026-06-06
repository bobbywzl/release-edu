'use client'

import { useState, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Upload, FileText, Trash2, ExternalLink, Link2, File, X, AlertCircle,
  FileSpreadsheet, FileImage, Presentation, Bot, Loader2,
  ChevronDown, ChevronUp, Sparkles,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { DriveFilePicker } from '@/components/drive-file-picker'

// ── Types ────────────────────────────────────────────────────

interface WorkFile {
  id: string
  name: string
  type: string
  size?: number
  url: string
  addedAt: string
  isLinked?: boolean
}

interface FileAnalysis {
  progressAssessment?: string
  strengths?: string[]
  areasForImprovement?: string[]
  suggestions?: string[]
  insights?: { type: string; content: string; confidence: number }[]
  raw?: string
}

interface WorkFileStorageProps {
  workType: 'content' | 'homework' | 'quiz' | 'project'
  workId: string
  trackId: string
  trackName: string
  label?: string
}

// ── Helpers ──────────────────────────────────────────────────

function detectGoogleType(url: string): string | null {
  if (url.includes('docs.google.com/document')) return 'google-doc'
  if (url.includes('docs.google.com/presentation')) return 'google-slides'
  if (url.includes('docs.google.com/spreadsheets')) return 'google-sheets'
  return null
}

const FILE_ICONS: Record<string, { icon: typeof FileText; color: string; label: string }> = {
  'application/pdf': { icon: FileText, color: 'text-red-400', label: 'PDF' },
  'text/plain': { icon: File, color: 'text-slate-400', label: 'TXT' },
  'text/markdown': { icon: FileText, color: 'text-slate-400', label: 'MD' },
  'text/csv': { icon: FileSpreadsheet, color: 'text-green-400', label: 'CSV' },
  'google-doc': { icon: FileText, color: 'text-blue-400', label: 'Google Doc' },
  'google-slides': { icon: Presentation, color: 'text-yellow-400', label: 'Slides' },
  'google-sheets': { icon: FileSpreadsheet, color: 'text-green-400', label: 'Sheets' },
}

function getFileIcon(type: string) {
  if (type.startsWith('image/')) return { icon: FileImage, color: 'text-purple-400', label: 'Image' }
  return FILE_ICONS[type] || { icon: File, color: 'text-muted-foreground', label: type.split('/').pop()?.toUpperCase() || 'FILE' }
}

function formatSize(bytes?: number) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

// ── Component ────────────────────────────────────────────────

export function WorkFileStorage({ workType, workId, trackId, trackName, label }: WorkFileStorageProps) {
  const [files, setFiles] = useState<WorkFile[]>([])
  const [analyses, setAnalyses] = useState<Record<string, FileAnalysis>>({})
  const [expandedAnalysis, setExpandedAnalysis] = useState<Record<string, boolean>>({})
  const [analyzingFiles, setAnalyzingFiles] = useState<Record<string, boolean>>({})
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [showLinkModal, setShowLinkModal] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [linkTitle, setLinkTitle] = useState('')
  const [linkError, setLinkError] = useState('')

  // Load persisted files from DB on mount
  const loadFiles = useCallback(async () => {
    try {
      const res = await fetch(`/api/files/upload?workType=${workType}&workId=${workId}`)
      if (res.ok) {
        const { files: dbFiles } = await res.json()
        setFiles(dbFiles.map((f: { id: string; name: string; mimeType?: string; size?: number; url?: string | null; content?: string | null; addedAt: string; isLinked?: boolean }) => ({
          id: f.id,
          name: f.name,
          type: f.mimeType || 'application/octet-stream',
          size: f.size,
          url: f.url || (f.content?.startsWith('data:image/') ? f.content : null),
          addedAt: typeof f.addedAt === 'string' ? f.addedAt : new Date(f.addedAt).toISOString(),
          isLinked: f.isLinked,
        })))
      }
    } catch { /* non-critical */ }
  }, [workType, workId])

  useEffect(() => { loadFiles() }, [loadFiles])

  const handleFileUpload = useCallback(async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return
    setUploading(true)

    for (const file of Array.from(fileList)) {
      try {
        const formData = new FormData()
        formData.append('file', file)
        formData.append('workType', workType)
        formData.append('workId', workId)
        formData.append('trackId', trackId)

        const res = await fetch('/api/files/upload', { method: 'POST', body: formData })
        if (!res.ok) throw new Error('Upload failed')

        const record = await res.json()
        setFiles(prev => [...prev, {
          id: record.id,
          name: record.name,
          type: record.type,
          size: record.size,
          url: record.url,
          addedAt: record.addedAt,
        }])
      } catch (err) {
        console.error('File upload failed:', err)
      }
    }

    setUploading(false)
  }, [workType, workId, trackId])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    handleFileUpload(e.dataTransfer.files)
  }, [handleFileUpload])

  const handleLinkGoogle = useCallback(async () => {
    setLinkError('')
    if (!linkUrl.trim()) { setLinkError('Paste a Google Docs, Slides, or Sheets URL'); return }

    const googleType = detectGoogleType(linkUrl)
    if (!googleType) { setLinkError('Must be a Google Docs, Slides, or Sheets URL'); return }

    const title = linkTitle.trim() || linkUrl.split('/').pop()?.split('?')[0] || 'Linked Document'

    // Save to DB
    try {
      const res = await fetch('/api/files/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workType, workId, trackId, name: title, type: googleType, content: linkUrl }),
      })
      if (res.ok) {
        const record = await res.json()
        setFiles(prev => [...prev, { id: record.id, name: title, type: googleType, url: linkUrl, addedAt: record.addedAt, isLinked: true }])
      } else {
        throw new Error('Save failed')
      }
    } catch {
      // Fallback: add optimistically
      setFiles(prev => [...prev, { id: `file-${Date.now()}`, name: title, type: googleType, url: linkUrl, addedAt: new Date().toISOString(), isLinked: true }])
    }
    setLinkUrl('')
    setLinkTitle('')
    setShowLinkModal(false)
  }, [linkUrl, linkTitle, workType, workId, trackId])

  const handleDriveImport = useCallback((file: { id: string; name: string; mimeType: string; webViewLink: string }) => {
    // Map Google Drive mimeType to our internal type scheme
    let fileType = file.mimeType
    if (file.mimeType.includes('google-apps.document')) fileType = 'google-doc'
    else if (file.mimeType.includes('google-apps.presentation')) fileType = 'google-slides'
    else if (file.mimeType.includes('google-apps.spreadsheet')) fileType = 'google-sheets'

    setFiles(prev => [...prev, {
      id: `drive-${file.id}`,
      name: file.name,
      type: fileType,
      url: file.webViewLink,
      addedAt: new Date().toISOString(),
      isLinked: true,
    }])
  }, [])

  const handleDelete = useCallback(async (fileId: string) => {
    // Optimistic update
    setFiles(prev => prev.filter(f => f.id !== fileId))
    setAnalyses(prev => { const next = { ...prev }; delete next[fileId]; return next })
    // Persist deletion to DB
    try {
      await fetch(`/api/files/upload?id=${fileId}`, { method: 'DELETE' })
    } catch { /* non-critical */ }
  }, [])

  const handleAnalyze = useCallback(async (file: WorkFile) => {
    setAnalyzingFiles(prev => ({ ...prev, [file.id]: true }))

    try {
      // Step 1: Read file content
      const readRes = await fetch('/api/files/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileUrl: file.url, fileName: file.name }),
      })

      if (!readRes.ok) throw new Error('Could not read file')
      const { content } = await readRes.json()

      // Step 2: Analyze with AI
      const analyzeRes = await fetch('/api/files/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileContent: content,
          fileName: file.name,
          workType,
          workId,
          trackId,
          trackName,
        }),
      })

      if (!analyzeRes.ok) throw new Error('Analysis failed')
      const { analysis } = await analyzeRes.json()

      setAnalyses(prev => ({ ...prev, [file.id]: analysis }))
      setExpandedAnalysis(prev => ({ ...prev, [file.id]: true }))
    } catch {
      setAnalyses(prev => ({
        ...prev,
        [file.id]: { raw: 'Analysis failed. Make sure the file is a readable text format and the API key is configured.' },
      }))
      setExpandedAnalysis(prev => ({ ...prev, [file.id]: true }))
    } finally {
      setAnalyzingFiles(prev => ({ ...prev, [file.id]: false }))
    }
  }, [workType, workId, trackId, trackName])

  return (
    <Card className="border-border">
      <CardContent className="p-4 space-y-3">
        {label && (
          <h3 className="text-xs font-semibold text-foreground uppercase tracking-wide">{label}</h3>
        )}

        {/* Upload zone — entire dashed area is a clickable file picker */}
        <label
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className={`relative block cursor-pointer border-2 border-dashed rounded-lg p-5 text-center transition-colors ${
            dragOver
              ? 'border-primary bg-primary/10'
              : 'border-border hover:border-primary/50 hover:bg-primary/[0.03]'
          }`}
        >
          <input
            type="file"
            multiple
            accept=".pdf,.md,.txt,.csv,.doc,.docx,.xls,.xlsx,.ppt,.pptx,image/*"
            className="sr-only"
            onChange={e => handleFileUpload(e.target.files)}
          />
          <Upload className={`w-5 h-5 mx-auto mb-2 ${dragOver ? 'text-primary' : 'text-foreground/70'}`} />
          <p className="text-xs font-medium text-foreground">
            {dragOver ? 'Drop files to upload' : 'Drop files here, or click to browse'}
          </p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            PDF · Markdown · DOCX · Sheets · Slides · Images
          </p>
          <div
            className="flex items-center justify-center gap-2 mt-3"
            onClick={e => e.preventDefault()}
          >
            <Button
              size="sm"
              variant="outline"
              className="text-[11px] h-7"
              onClick={e => { e.preventDefault(); e.stopPropagation(); setShowLinkModal(true) }}
            >
              <Link2 className="w-3 h-3 mr-1" />
              Link Google File
            </Button>
            <span onClick={e => { e.preventDefault(); e.stopPropagation() }}>
              <DriveFilePicker
                onImport={handleDriveImport}
                trackName={trackName}
                suggestKeywords={trackName ? trackName.split(/[\s,]+/).filter(w => w.length > 2) : undefined}
              />
            </span>
          </div>
          {uploading && (
            <div className="absolute inset-0 bg-background/80 flex items-center justify-center rounded-lg">
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
            </div>
          )}
        </label>

        {/* Google Link Modal */}
        <AnimatePresence>
          {showLinkModal && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="p-3 rounded-lg border border-border bg-card space-y-2"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-foreground">Link Google Document</span>
                <button onClick={() => setShowLinkModal(false)} className="text-muted-foreground hover:text-foreground">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <input
                type="url"
                placeholder="Paste Google Docs, Slides, or Sheets URL..."
                value={linkUrl}
                onChange={e => { setLinkUrl(e.target.value); setLinkError('') }}
                className="w-full h-7 px-2.5 text-xs rounded-md border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <input
                type="text"
                placeholder="Display name (optional)"
                value={linkTitle}
                onChange={e => setLinkTitle(e.target.value)}
                className="w-full h-7 px-2.5 text-xs rounded-md border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
              {linkError && (
                <p className="text-[10px] text-destructive flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />{linkError}
                </p>
              )}
              <Button size="sm" className="w-full text-xs h-7" onClick={handleLinkGoogle}>
                Link Document
              </Button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* File list */}
        {files.length === 0 ? (
          <p className="text-[11px] text-muted-foreground text-center py-2">
            No files yet
          </p>
        ) : (
          <div className="space-y-1.5">
            {files.map(file => {
              const config = getFileIcon(file.type)
              const Icon = config.icon
              const isAnalyzing = analyzingFiles[file.id]
              const analysis = analyses[file.id]
              const isExpanded = expandedAnalysis[file.id]

              return (
                <div key={file.id} className="space-y-0">
                  <motion.div
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="flex items-center gap-2 p-2 rounded-lg border border-border/50 hover:border-border transition-colors group"
                  >
                    <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${config.color}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-medium text-foreground truncate">{file.name}</p>
                      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                        <Badge variant="secondary" className="text-[9px] px-1 py-0 h-3.5">{config.label}</Badge>
                        {file.size && <span>{formatSize(file.size)}</span>}
                        {file.isLinked && <span className="flex items-center gap-0.5"><Link2 className="w-2.5 h-2.5" />Linked</span>}
                      </div>
                    </div>

                    {/* Analyze button */}
                    {!file.isLinked && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-[10px] gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => handleAnalyze(file)}
                        disabled={isAnalyzing}
                      >
                        {isAnalyzing ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Sparkles className="w-3 h-3" />
                        )}
                        {isAnalyzing ? 'Analyzing...' : 'Analyze'}
                      </Button>
                    )}

                    {/* Open */}
                    {file.url && (
                      <a
                        href={file.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground hover:text-foreground p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}

                    {/* Delete */}
                    <button
                      onClick={() => handleDelete(file.id)}
                      className="text-muted-foreground hover:text-destructive p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </motion.div>

                  {/* Analysis results */}
                  <AnimatePresence>
                    {analysis && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="ml-5 mt-1 mb-1">
                          <button
                            onClick={() => setExpandedAnalysis(prev => ({ ...prev, [file.id]: !prev[file.id] }))}
                            className="flex items-center gap-1 text-[10px] text-primary hover:text-primary/80 transition-colors"
                          >
                            <Bot className="w-3 h-3" />
                            <span>AI Analysis</span>
                            {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          </button>

                          <AnimatePresence>
                            {isExpanded && (
                              <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                exit={{ opacity: 0, height: 0 }}
                                className="overflow-hidden"
                              >
                                {analysis.raw ? (
                                  <p className="text-[11px] text-muted-foreground mt-1.5 p-2 rounded bg-muted/30 whitespace-pre-wrap">
                                    {analysis.raw}
                                  </p>
                                ) : (
                                  <div className="mt-1.5 space-y-1.5">
                                    {/* Progress Assessment */}
                                    {analysis.progressAssessment && (
                                      <div className="p-2 rounded-md border-l-2 border-primary/50 bg-primary/5">
                                        <p className="text-[10px] font-medium text-primary mb-0.5">Progress</p>
                                        <p className="text-[11px] text-foreground/80">{analysis.progressAssessment}</p>
                                      </div>
                                    )}

                                    {/* Strengths */}
                                    {analysis.strengths && analysis.strengths.length > 0 && (
                                      <div className="p-2 rounded-md border-l-2 border-emerald-500/50 bg-emerald-500/5">
                                        <p className="text-[10px] font-medium text-emerald-400 mb-0.5">Strengths</p>
                                        <ul className="space-y-0.5">
                                          {analysis.strengths.map((s, i) => (
                                            <li key={i} className="text-[11px] text-foreground/80">• {s}</li>
                                          ))}
                                        </ul>
                                      </div>
                                    )}

                                    {/* Areas for Improvement */}
                                    {analysis.areasForImprovement && analysis.areasForImprovement.length > 0 && (
                                      <div className="p-2 rounded-md border-l-2 border-amber-500/50 bg-amber-500/5">
                                        <p className="text-[10px] font-medium text-amber-400 mb-0.5">Areas to Improve</p>
                                        <ul className="space-y-0.5">
                                          {analysis.areasForImprovement.map((a, i) => (
                                            <li key={i} className="text-[11px] text-foreground/80">• {a}</li>
                                          ))}
                                        </ul>
                                      </div>
                                    )}

                                    {/* Suggestions */}
                                    {analysis.suggestions && analysis.suggestions.length > 0 && (
                                      <div className="p-2 rounded-md border-l-2 border-blue-500/50 bg-blue-500/5">
                                        <p className="text-[10px] font-medium text-blue-400 mb-0.5">Suggestions</p>
                                        <ul className="space-y-0.5">
                                          {analysis.suggestions.map((s, i) => (
                                            <li key={i} className="text-[11px] text-foreground/80">• {s}</li>
                                          ))}
                                        </ul>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
