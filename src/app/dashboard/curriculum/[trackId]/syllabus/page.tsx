'use client'

import { useParams } from 'next/navigation'
import Link from 'next/link'
import { motion } from 'framer-motion'
import {
  BookOpen, CheckCircle, Circle, Loader2,
  ArrowLeft, ChevronRight,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'
import { useWorkData } from '@/lib/work-data'
import type { ContentChapter } from '@/types'

const STATUS_ICON = {
  completed: { icon: CheckCircle, class: 'text-emerald-400' },
  'in-progress': { icon: Loader2, class: 'text-blue-400' },
  'not-started': { icon: Circle, class: 'text-slate-500' },
}

function ChapterRow({ chapter, index, totalChapters }: { chapter: ContentChapter; index: number; totalChapters: number }) {
  const StatusIcon = STATUS_ICON[chapter.status].icon
  const statusClass = STATUS_ICON[chapter.status].class
  const hasDependency = index > 0

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
    >
      <Card className="border-border">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            {/* Order number */}
            <div className="flex flex-col items-center gap-1">
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-muted/50 text-sm font-bold text-muted-foreground flex-shrink-0">
                {chapter.order}
              </div>
              {index < totalChapters - 1 && (
                <div className="w-px h-6 bg-border" />
              )}
            </div>

            <div className="flex-1 min-w-0 space-y-2">
              {/* Title and status */}
              <div className="flex items-center gap-2 flex-wrap">
                <StatusIcon className={`w-4 h-4 flex-shrink-0 ${statusClass} ${chapter.status === 'in-progress' ? 'animate-spin' : ''}`} />
                <h4 className="text-sm font-medium text-foreground">{chapter.title}</h4>
                <Badge
                  variant="outline"
                  className={`text-[10px] capitalize ${
                    chapter.status === 'completed'
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                      : chapter.status === 'in-progress'
                      ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                      : 'bg-slate-500/10 text-slate-400 border-slate-500/20'
                  }`}
                >
                  {chapter.status.replace('-', ' ')}
                </Badge>
              </div>

              {/* Description */}
              <p className="text-xs text-muted-foreground">{chapter.description}</p>

              {/* Key Topics */}
              <div className="flex flex-wrap gap-1.5">
                {chapter.keyTopics.map(t => (
                  <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>
                ))}
              </div>

              {/* Meta */}
              {hasDependency && (
                <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
                  <span className="text-muted-foreground/60">
                    Requires: Ch. {index}
                  </span>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  )
}

export default function SyllabusPage() {
  const params = useParams()
  const trackId = params.trackId as string

  const { data, loading } = useWorkData(trackId)
  const syllabus = data.syllabus

  if (loading) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-muted rounded w-48" />
          <div className="h-4 bg-muted rounded w-96" />
          <div className="h-32 bg-muted rounded" />
          <div className="h-24 bg-muted rounded" />
          <div className="h-24 bg-muted rounded" />
        </div>
      </div>
    )
  }

  if (!syllabus) {
    return (
      <div className="p-6 max-w-4xl mx-auto text-center py-20">
        <h2 className="text-lg font-semibold text-foreground">Subject not found</h2>
        <p className="text-sm text-muted-foreground mt-2">No syllabus available for this track.</p>
        <Link href="/dashboard/curriculum">
          <Button variant="outline" size="sm" className="mt-4 text-xs">
            ← Back to Curriculum
          </Button>
        </Link>
      </div>
    )
  }

  const chapters = syllabus.chapters
  const completedChapters = chapters.filter(c => c.status === 'completed').length
  const overallProgress = chapters.length > 0 ? Math.round((completedChapters / chapters.length) * 100) : 0
  const allKeyTopics = Array.from(new Set(chapters.flatMap(ch => ch.keyTopics)))

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Back link */}
      <Link
        href={`/dashboard/curriculum/${trackId}`}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="w-3 h-3" />
        Back to {syllabus.title}
      </Link>

      {/* Header */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-2">
        <div className="flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-primary" />
          <h1 className="text-2xl font-bold text-foreground">{syllabus.title} — Full Syllabus</h1>
        </div>
        <p className="text-sm text-muted-foreground">{syllabus.description}</p>
      </motion.div>

      {/* Progress Overview */}
      <Card className="border-border">
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">Overall Progress</h3>
            <span className="text-sm font-bold text-foreground">{overallProgress}%</span>
          </div>
          <Progress value={overallProgress} className="h-3" />
          <div className="grid grid-cols-2 gap-3 text-center">
            <div>
              <p className="text-lg font-bold text-foreground">{chapters.length}</p>
              <p className="text-[10px] text-muted-foreground">Chapters</p>
            </div>
            <div>
              <p className="text-lg font-bold text-emerald-400">{completedChapters}</p>
              <p className="text-[10px] text-muted-foreground">Completed</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Topics Covered */}
      <Card className="border-border">
        <CardContent className="p-5 space-y-3">
          <h3 className="text-sm font-semibold text-foreground">All Topics Covered</h3>
          <div className="flex flex-wrap gap-1.5">
            {allKeyTopics.map(topic => (
              <Badge key={topic} variant="secondary" className="text-[10px]">{topic}</Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Chapter-by-chapter breakdown */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">Chapter Breakdown</h3>
        {chapters.map((ch, i) => (
          <ChapterRow key={ch.id} chapter={ch} index={i} totalChapters={chapters.length} />
        ))}
      </div>

      {/* Learning objectives */}
      <Card className="border-border">
        <CardContent className="p-5 space-y-3">
          <h3 className="text-sm font-semibold text-foreground">Learning Objectives</h3>
          <ul className="text-xs text-muted-foreground space-y-2">
            {chapters.map(ch => (
              <li key={ch.id} className="flex items-center gap-2">
                {ch.status === 'completed' ? (
                  <CheckCircle className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                ) : (
                  <Circle className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                )}
                <span className={ch.status === 'completed' ? 'line-through text-muted-foreground/60' : 'text-foreground'}>
                  Understand {ch.title}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* Back to subject */}
      <div className="flex justify-center pt-2 pb-6">
        <Link href={`/dashboard/curriculum/${trackId}`}>
          <Button variant="outline" size="sm" className="text-xs gap-1.5">
            <ArrowLeft className="w-3 h-3" />
            Back to Subject Overview
          </Button>
        </Link>
      </div>
    </div>
  )
}
