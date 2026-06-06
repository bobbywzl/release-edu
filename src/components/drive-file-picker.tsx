'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  HardDrive, Search, Loader2, FileText, FileSpreadsheet, FileImage,
  Presentation, File, Download, AlertCircle, X, Sparkles, LogIn,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

// ── Types ────────────────────────────────────────────────────

interface DriveFile {
  id: string
  name: string
  mimeType: string
  modifiedTime: string
  size?: string
  webViewLink: string
  iconLink?: string
  thumbnailLink?: string
}

interface DriveFilePickerProps {
  onImport: (file: { id: string; name: string; mimeType: string; webViewLink: string }) => void
  suggestKeywords?: string[]
  trackName?: string
}

// ── Helpers ──────────────────────────────────────────────────

const DRIVE_FILE_ICONS: Record<string, { icon: typeof FileText; color: string; label: string }> = {
  'application/vnd.google-apps.document': { icon: FileText, color: 'text-blue-400', label: 'Doc' },
  'application/vnd.google-apps.spreadsheet': { icon: FileSpreadsheet, color: 'text-green-400', label: 'Sheet' },
  'application/vnd.google-apps.presentation': { icon: Presentation, color: 'text-yellow-400', label: 'Slides' },
  'application/pdf': { icon: FileText, color: 'text-red-400', label: 'PDF' },
  'text/plain': { icon: File, color: 'text-slate-400', label: 'TXT' },
  'text/csv': { icon: FileSpreadsheet, color: 'text-green-400', label: 'CSV' },
}

function getDriveFileIcon(mimeType: string) {
  if (mimeType.startsWith('image/')) return { icon: FileImage, color: 'text-purple-400', label: 'Image' }
  if (mimeType.includes('document')) return DRIVE_FILE_ICONS['application/vnd.google-apps.document']
  if (mimeType.includes('spreadsheet')) return DRIVE_FILE_ICONS['application/vnd.google-apps.spreadsheet']
  if (mimeType.includes('presentation')) return DRIVE_FILE_ICONS['application/vnd.google-apps.presentation']
  return DRIVE_FILE_ICONS[mimeType] || { icon: File, color: 'text-muted-foreground', label: mimeType.split('/').pop()?.toUpperCase() || 'FILE' }
}

function formatRelativeTime(dateStr: string) {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function matchesKeywords(name: string, keywords: string[]): boolean {
  const lower = name.toLowerCase()
  return keywords.some(kw => lower.includes(kw.toLowerCase()))
}

// ── Component ────────────────────────────────────────────────

export function DriveFilePicker({ onImport, suggestKeywords, trackName }: DriveFilePickerProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [files, setFiles] = useState<DriveFile[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [nextPageToken, setNextPageToken] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [importingId, setImportingId] = useState<string | null>(null)
  const [authError, setAuthError] = useState(false)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const fetchFiles = useCallback(async (query: string, pageToken?: string) => {
    if (pageToken) {
      setLoadingMore(true)
    } else {
      setLoading(true)
      setFiles([])
    }
    setError(null)
    setAuthError(false)

    try {
      const params = new URLSearchParams()
      if (query) params.set('q', query)
      if (pageToken) params.set('pageToken', pageToken)

      const res = await fetch(`/api/drive/list?${params.toString()}`)

      if (res.status === 401) {
        setAuthError(true)
        return
      }

      if (!res.ok) {
        throw new Error('Failed to load files')
      }

      const data = await res.json()
      const newFiles: DriveFile[] = data.files || []

      if (pageToken) {
        setFiles(prev => [...prev, ...newFiles])
      } else {
        setFiles(newFiles)
      }
      setNextPageToken(data.nextPageToken || null)
    } catch {
      setError('Could not load Drive files. Please try again.')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [])

  // Load files when picker opens
  useEffect(() => {
    if (isOpen && files.length === 0 && !loading && !authError) {
      fetchFiles('')
    }
  }, [isOpen, files.length, loading, authError, fetchFiles])

  // Debounced search
  useEffect(() => {
    if (!isOpen) return

    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      fetchFiles(searchQuery)
    }, 300)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [searchQuery, isOpen, fetchFiles])

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [isOpen])

  const handleImport = useCallback((file: DriveFile) => {
    setImportingId(file.id)
    onImport({
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      webViewLink: file.webViewLink,
    })
    setTimeout(() => {
      setImportingId(null)
      setIsOpen(false)
    }, 300)
  }, [onImport])

  // Split files into suggested and rest
  const suggested = suggestKeywords && suggestKeywords.length > 0
    ? files.filter(f => matchesKeywords(f.name, suggestKeywords))
    : []
  const rest = suggestKeywords && suggestKeywords.length > 0
    ? files.filter(f => !matchesKeywords(f.name, suggestKeywords))
    : files

  return (
    <div className="relative" ref={containerRef}>
      <Button
        size="sm"
        variant="outline"
        className="text-[11px] h-7"
        onClick={() => setIsOpen(!isOpen)}
      >
        <HardDrive className="w-3 h-3 mr-1" />
        Import from Drive
      </Button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="absolute z-50 top-full mt-1.5 left-0 right-0 min-w-[320px] w-full max-w-md rounded-lg border border-border bg-card shadow-xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-border">
              <div className="flex items-center gap-1.5">
                <HardDrive className="w-3.5 h-3.5 text-primary" />
                <span className="text-xs font-medium text-foreground">Google Drive</span>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Auth error state */}
            {authError ? (
              <div className="p-6 text-center space-y-2">
                <LogIn className="w-5 h-5 mx-auto text-muted-foreground" />
                <p className="text-xs text-muted-foreground">
                  Sign in with Google to browse your Drive files
                </p>
                <a href="/login">
                  <Button size="sm" variant="outline" className="text-[11px] h-7 mt-1">
                    Sign In
                  </Button>
                </a>
              </div>
            ) : (
              <>
                {/* Search */}
                <div className="px-3 py-2 border-b border-border">
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
                    <input
                      type="text"
                      placeholder="Search your files..."
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      className="w-full h-7 pl-7 pr-2 text-xs rounded-md border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                      autoFocus
                    />
                  </div>
                </div>

                {/* File list */}
                <div className="max-h-[400px] overflow-y-auto">
                  {loading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="w-4 h-4 animate-spin text-primary" />
                      <span className="ml-2 text-xs text-muted-foreground">Loading files...</span>
                    </div>
                  ) : error ? (
                    <div className="p-4 text-center space-y-1">
                      <AlertCircle className="w-4 h-4 mx-auto text-destructive" />
                      <p className="text-xs text-destructive">{error}</p>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-[10px] h-6"
                        onClick={() => fetchFiles(searchQuery)}
                      >
                        Retry
                      </Button>
                    </div>
                  ) : files.length === 0 ? (
                    <div className="py-8 text-center">
                      <p className="text-xs text-muted-foreground">
                        {searchQuery ? 'No files match your search' : 'No files found in Drive'}
                      </p>
                    </div>
                  ) : (
                    <div className="py-1">
                      {/* Suggested files */}
                      {suggested.length > 0 && (
                        <>
                          <div className="px-3 py-1.5 flex items-center gap-1">
                            <Sparkles className="w-3 h-3 text-amber-400" />
                            <span className="text-[10px] font-medium text-amber-400">
                              Suggested for {trackName || 'this work'}
                            </span>
                          </div>
                          {suggested.map(file => (
                            <FileRow
                              key={file.id}
                              file={file}
                              importing={importingId === file.id}
                              highlighted
                              onImport={handleImport}
                            />
                          ))}
                          {rest.length > 0 && (
                            <div className="px-3 py-1.5">
                              <span className="text-[10px] text-muted-foreground">All files</span>
                            </div>
                          )}
                        </>
                      )}

                      {/* Rest of files */}
                      {rest.map(file => (
                        <FileRow
                          key={file.id}
                          file={file}
                          importing={importingId === file.id}
                          onImport={handleImport}
                        />
                      ))}

                      {/* Load more */}
                      {nextPageToken && (
                        <div className="px-3 py-2 text-center">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-[10px] h-6"
                            onClick={() => fetchFiles(searchQuery, nextPageToken)}
                            disabled={loadingMore}
                          >
                            {loadingMore ? (
                              <Loader2 className="w-3 h-3 animate-spin mr-1" />
                            ) : null}
                            {loadingMore ? 'Loading...' : 'Load more'}
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── File Row ─────────────────────────────────────────────────

function FileRow({
  file,
  importing,
  highlighted,
  onImport,
}: {
  file: DriveFile
  importing: boolean
  highlighted?: boolean
  onImport: (file: DriveFile) => void
}) {
  const config = getDriveFileIcon(file.mimeType)
  const Icon = config.icon

  return (
    <div
      className={`flex items-center gap-2 px-3 py-1.5 hover:bg-muted/50 transition-colors group cursor-pointer ${
        highlighted ? 'bg-amber-500/5' : ''
      }`}
      onClick={() => !importing && onImport(file)}
    >
      <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${config.color}`} />
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-medium text-foreground truncate">{file.name}</p>
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <Badge variant="secondary" className="text-[9px] px-1 py-0 h-3.5">{config.label}</Badge>
          <span>{formatRelativeTime(file.modifiedTime)}</span>
        </div>
      </div>
      <div className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        {importing ? (
          <Loader2 className="w-3 h-3 animate-spin text-primary" />
        ) : (
          <Download className="w-3 h-3 text-muted-foreground" />
        )}
      </div>
    </div>
  )
}
