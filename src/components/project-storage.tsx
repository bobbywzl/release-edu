'use client'
import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Upload, FileText, Trash2, ExternalLink, Link2, File, X, AlertCircle,
  FileSpreadsheet, FileImage, Presentation,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { ProjectFile } from '@/types'
import { mockProjectFiles } from '@/lib/mock-data'

// Detect Google file type from URL
function detectGoogleType(url: string): 'google-doc' | 'google-slides' | 'google-sheets' | null {
  if (url.includes('docs.google.com/document')) return 'google-doc'
  if (url.includes('docs.google.com/presentation')) return 'google-slides'
  if (url.includes('docs.google.com/spreadsheets')) return 'google-sheets'
  return null
}

// File type config
const FILE_ICONS: Record<string, { icon: typeof FileText; color: string; label: string }> = {
  pdf: { icon: FileText, color: 'text-red-400', label: 'PDF' },
  markdown: { icon: FileText, color: 'text-slate-400', label: 'MD' },
  txt: { icon: File, color: 'text-slate-400', label: 'TXT' },
  'google-doc': { icon: FileText, color: 'text-blue-400', label: 'Google Doc' },
  'google-slides': { icon: Presentation, color: 'text-yellow-400', label: 'Slides' },
  'google-sheets': { icon: FileSpreadsheet, color: 'text-green-400', label: 'Sheets' },
  image: { icon: FileImage, color: 'text-purple-400', label: 'Image' },
  docx: { icon: FileText, color: 'text-blue-400', label: 'DOCX' },
  xlsx: { icon: FileSpreadsheet, color: 'text-green-400', label: 'XLSX' },
  pptx: { icon: Presentation, color: 'text-orange-400', label: 'PPTX' },
}

function getFileConfig(type: string) {
  return FILE_ICONS[type] || { icon: File, color: 'text-muted-foreground', label: type.toUpperCase() }
}

function formatSize(bytes?: number) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

interface FileStorageProps {
  projectId: string
  context?: 'project' | 'assignment'
}

export function ProjectStorage({ projectId, context = 'project' }: FileStorageProps) {
  const [files, setFiles] = useState<ProjectFile[]>(mockProjectFiles[projectId] || [])
  const [showLinkModal, setShowLinkModal] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [linkTitle, setLinkTitle] = useState('')
  const [linkError, setLinkError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  const handleFileUpload = useCallback(async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return
    setUploading(true)

    for (const file of Array.from(fileList)) {
      // Determine type
      let type: ProjectFile['type'] = 'txt'
      if (file.type === 'application/pdf') type = 'pdf'
      else if (file.name.endsWith('.md')) type = 'markdown'
      else if (file.type.startsWith('image/')) type = 'pdf' // treat as generic

      const newFile: ProjectFile = {
        id: `file-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        projectId,
        name: file.name,
        type,
        size: file.size,
        addedAt: new Date().toISOString(),
        isLinked: false,
        url: URL.createObjectURL(file), // local preview URL for demo
      }
      setFiles(prev => [...prev, newFile])
    }

    setUploading(false)
  }, [projectId])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    handleFileUpload(e.dataTransfer.files)
  }, [handleFileUpload])

  const handleLinkGoogle = useCallback(() => {
    setLinkError('')
    if (!linkUrl.trim()) { setLinkError('Paste a Google Docs, Slides, or Sheets URL'); return }

    const googleType = detectGoogleType(linkUrl)
    if (!googleType) { setLinkError('Must be a Google Docs, Slides, or Sheets URL'); return }

    const title = linkTitle.trim() || linkUrl.split('/').pop()?.split('?')[0] || 'Linked Document'

    const newFile: ProjectFile = {
      id: `file-${Date.now()}`,
      projectId,
      name: title,
      type: googleType,
      url: linkUrl,
      addedAt: new Date().toISOString(),
      isLinked: true,
    }

    setFiles(prev => [...prev, newFile])
    setLinkUrl('')
    setLinkTitle('')
    setShowLinkModal(false)
  }, [linkUrl, linkTitle, projectId])

  const handleDelete = useCallback((fileId: string) => {
    setFiles(prev => prev.filter(f => f.id !== fileId))
  }, [])

  return (
    <div className="space-y-3">
      {/* Upload zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`relative border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
          dragOver ? 'border-primary/50 bg-primary/5' : 'border-border hover:border-border/80'
        }`}
      >
        <Upload className="w-5 h-5 mx-auto mb-2 text-muted-foreground" />
        <p className="text-xs text-muted-foreground mb-2">
          Drag files here or click to upload
        </p>
        <div className="flex items-center justify-center gap-2">
          <label className="cursor-pointer">
            <Button size="sm" variant="outline" className="text-xs pointer-events-none" tabIndex={-1}>
              Upload Files
            </Button>
            <input
              type="file"
              multiple
              accept=".pdf,.md,.txt,.doc,.docx,.xls,.xlsx,.ppt,.pptx,image/*"
              className="hidden"
              onChange={e => handleFileUpload(e.target.files)}
            />
          </label>
          <Button size="sm" variant="outline" className="text-xs" onClick={() => setShowLinkModal(true)}>
            <Link2 className="w-3 h-3 mr-1" />
            Link Google File
          </Button>
        </div>
        {uploading && (
          <div className="absolute inset-0 bg-background/80 flex items-center justify-center rounded-lg">
            <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>

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
              className="w-full h-8 px-2.5 text-xs rounded-md border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <input
              type="text"
              placeholder="Display name (optional)"
              value={linkTitle}
              onChange={e => setLinkTitle(e.target.value)}
              className="w-full h-8 px-2.5 text-xs rounded-md border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
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
        <p className="text-xs text-muted-foreground text-center py-4">
          No files yet — upload {context} files or link Google documents
        </p>
      ) : (
        <div className="space-y-1">
          {files.map(file => {
            const config = getFileConfig(file.type)
            const Icon = config.icon
            return (
              <motion.div
                key={file.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 8 }}
                className="flex items-center gap-2.5 p-2 rounded-lg border border-border/50 hover:border-border transition-colors group"
              >
                <Icon className={`w-4 h-4 flex-shrink-0 ${config.color}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground truncate">{file.name}</p>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    <Badge variant="secondary" className="text-[9px] px-1 py-0">{config.label}</Badge>
                    {file.size && <span>{formatSize(file.size)}</span>}
                    {file.isLinked && <span className="flex items-center gap-0.5"><Link2 className="w-2.5 h-2.5" />Linked</span>}
                    <span>{new Date(file.addedAt).toLocaleDateString()}</span>
                  </div>
                </div>
                {file.url && (
                  <a
                    href={file.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-foreground p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
                <button
                  onClick={() => handleDelete(file.id)}
                  className="text-muted-foreground hover:text-destructive p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </motion.div>
            )
          })}
        </div>
      )}
    </div>
  )
}
