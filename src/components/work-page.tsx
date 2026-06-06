'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'
import {
  BookOpen, FileText, Brain, FolderOpen,
  ArrowLeft, ChevronLeft, ChevronRight,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import BobChatWidget, { type WorkContext } from '@/components/bob-chat-widget'

// ── Config ─────────────────────────────────────────────────

const TYPE_CONFIG = {
  content: { label: 'Content', icon: BookOpen, color: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
  homework: { label: 'Homework', icon: FileText, color: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
  quiz: { label: 'Quiz', icon: Brain, color: 'bg-purple-500/10 text-purple-400 border-purple-500/20' },
  project: { label: 'Project', icon: FolderOpen, color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
}

const STATUS_CONFIG: Record<string, string> = {
  completed: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  'in-progress': 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  'not-started': 'bg-slate-500/10 text-slate-400 border-slate-500/20',
  proposal: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  approved: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  'needs-revision': 'bg-red-500/10 text-red-400 border-red-500/20',
  overdue: 'bg-red-500/10 text-red-400 border-red-500/20',
}

// ── Types ──────────────────────────────────────────────────

interface WorkPageProps {
  type: 'content' | 'homework' | 'quiz' | 'project'
  trackId: string
  trackName: string
  title: string
  description?: string
  status: string
  children: React.ReactNode
  prevLink?: { href: string; label: string }
  nextLink?: { href: string; label: string }
  meta?: { label: string; value: string }[]
  workContext?: WorkContext
}

// ── Component ──────────────────────────────────────────────

export default function WorkPage({
  type,
  trackId,
  trackName,
  title,
  description,
  status,
  children,
  prevLink,
  nextLink,
  meta,
  workContext,
}: WorkPageProps) {
  const typeConfig = TYPE_CONFIG[type]
  const TypeIcon = typeConfig.icon
  const statusClass = STATUS_CONFIG[status] ?? STATUS_CONFIG['not-started']

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-5">
      {/* Back link */}
      <motion.div initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}>
        <Link
          href={`/dashboard/curriculum/${trackId}`}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to {trackName}
        </Link>
      </motion.div>

      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="space-y-3"
      >
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className={`text-[10px] ${typeConfig.color}`}>
            <TypeIcon className="w-3 h-3 mr-1" />
            {typeConfig.label}
          </Badge>
          <Badge variant="outline" className={`text-[10px] capitalize ${statusClass}`}>
            {status.replace('-', ' ')}
          </Badge>
        </div>
        <h1 className="text-xl md:text-2xl font-bold text-foreground">{title}</h1>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
        {meta && meta.length > 0 && (
          <div className="flex flex-wrap gap-3">
            {meta.map(m => (
              <span key={m.label} className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground/70">{m.label}:</span> {m.value}
              </span>
            ))}
          </div>
        )}
      </motion.div>

      {/* Main content + Bob sidebar */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="flex flex-col lg:flex-row gap-4"
      >
        {/* Main content */}
        <div className="flex-1 min-w-0">
          {children}
        </div>

        {/* Bob Chat Widget */}
        {workContext && (
          <div className="lg:sticky lg:top-4 self-start">
            <BobChatWidget workContext={workContext} />
          </div>
        )}
      </motion.div>

      {/* Prev / Next Navigation */}
      {(prevLink || nextLink) && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.15 }}
          className="flex items-center justify-between pt-4 border-t border-border"
        >
          {prevLink ? (
            <Link href={prevLink.href}>
              <Button variant="ghost" size="sm" className="text-xs gap-1.5 text-muted-foreground hover:text-foreground">
                <ChevronLeft className="w-3.5 h-3.5" />
                {prevLink.label}
              </Button>
            </Link>
          ) : <div />}
          {nextLink ? (
            <Link href={nextLink.href}>
              <Button variant="ghost" size="sm" className="text-xs gap-1.5 text-muted-foreground hover:text-foreground">
                {nextLink.label}
                <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            </Link>
          ) : <div />}
        </motion.div>
      )}
    </div>
  )
}
