'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { motion } from 'framer-motion'
import { CheckCircle, BookOpen, FolderOpen, MessageSquare, ArrowLeft, ChevronRight, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import Link from 'next/link'
import { MarkdownRenderer } from '@/components/markdown-renderer'
import { WorkFileStorage } from '@/components/work-file-storage'
import { useWorkData } from '@/lib/work-data'

type ActiveTab = 'syllabus' | 'files'

export default function ContentPage() {
  const params = useParams()
  const trackId = params.trackId as string
  const id = params.id as string
  const [activeTab, setActiveTab] = useState<ActiveTab>('syllabus')

  const { data, loading } = useWorkData(trackId)
  const syllabus = data.syllabus

  // All hooks must be called before any conditional returns
  const [generatingContent, setGeneratingContent] = useState(false)
  const [generatedContent, setGeneratedContent] = useState<string | null>(null)

  const chapters = syllabus ? [...syllabus.chapters].sort((a, b) => a.order - b.order) : []
  const chapter = chapters.find(c => c.id === id)

  useEffect(() => {
    if (
      chapter &&
      (!chapter.content ||
        chapter.content.includes('Content will be generated') ||
        chapter.content.length < 200)
    ) {
      setGeneratingContent(true)
      fetch(`/api/chapter/${chapter.id}/generate-content`, { method: 'POST' })
        .then(r => r.json())
        .then(d => {
          if (d.content) setGeneratedContent(d.content)
        })
        .catch(() => {})
        .finally(() => setGeneratingContent(false))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapter?.id])

  if (loading) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-muted rounded w-48" />
          <div className="h-4 bg-muted rounded w-96" />
          <div className="h-32 bg-muted rounded" />
        </div>
      </div>
    )
  }

  if (!syllabus) return <div className="p-6 text-center text-muted-foreground">Subject not found.</div>
  if (!chapter) return <div className="p-6 text-center text-muted-foreground">Chapter not found.</div>

  const displayContent = generatedContent || chapter?.content || ''

  const idx = chapters.findIndex(c => c.id === id)
  const prev = idx > 0 ? chapters[idx - 1] : null
  const next = idx < chapters.length - 1 ? chapters[idx + 1] : null
  const status = chapter.status

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">
      {/* Back breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Link href="/dashboard/curriculum" className="hover:text-foreground transition-colors flex items-center gap-1">
          <ArrowLeft className="w-3 h-3" /> Curriculum
        </Link>
        <ChevronRight className="w-3 h-3" />
        <span className="text-foreground/70 truncate">{syllabus.title}</span>
        <ChevronRight className="w-3 h-3" />
        <span className="text-foreground truncate">{chapter.title}</span>
      </div>

      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground">Chapter {chapter.order} of {chapters.length}</span>
          <span className="text-muted-foreground/30">·</span>
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${
            status === 'completed' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' :
            status === 'in-progress' ? 'bg-blue-500/10 border-blue-500/20 text-blue-400' :
            'bg-muted/50 border-border text-muted-foreground'
          }`}>
            {status === 'completed' ? '✓ Mastered' : status === 'in-progress' ? 'In Progress' : 'Not Started'}
          </span>
        </div>
        <h1 className="text-2xl font-bold text-foreground">{chapter.title}</h1>
        {chapter.description && (
          <p className="text-sm text-muted-foreground leading-relaxed">{chapter.description}</p>
        )}
        {/* Key topics */}
        <div className="flex flex-wrap gap-1.5 pt-1">
          {chapter.keyTopics.map((t: string) => (
            <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>
          ))}
        </div>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 border-b border-border">
        <button
          onClick={() => setActiveTab('syllabus')}
          className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
            activeTab === 'syllabus' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <BookOpen className="w-3.5 h-3.5" />
          Syllabus & Content
        </button>
        <button
          onClick={() => setActiveTab('files')}
          className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
            activeTab === 'files' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <FolderOpen className="w-3.5 h-3.5" />
          Files & Notes
        </button>
      </div>

      {/* Tab content */}
      {activeTab === 'syllabus' && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <Card className="border-border">
            <CardContent className="p-5 md:p-6 space-y-4">
              {generatingContent && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                  Generating chapter content with Opus…
                </div>
              )}
              <div className="prose-sm">
                <MarkdownRenderer content={displayContent} />
              </div>

              {/* Lesson CTA — mastery is earned through Bob sessions, not a manual button */}
              <div className="pt-4 border-t border-border">
                {status === 'completed' ? (
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2 text-emerald-400 text-xs">
                      <CheckCircle className="w-4 h-4" />
                      <span className="font-medium">Mastered</span>
                    </div>
                    <Link
                      href={`/dashboard/chat?chapterId=${chapter.id}&trackId=${trackId}&mode=tutoring`}
                      className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      Review with Bob →
                    </Link>
                  </div>
                ) : (
                  <Link
                    href={`/dashboard/chat?chapterId=${chapter.id}&trackId=${trackId}&mode=tutoring`}
                    className="inline-flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    {status === 'in-progress' ? 'Continue with Bob →' : 'Start lesson with Bob →'}
                  </Link>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Prev / next navigation */}
          <div className="flex justify-between gap-3 text-xs">
            {prev ? (
              <Link href={`/dashboard/curriculum/${trackId}/content/${prev.id}`} className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors">
                <ArrowLeft className="w-3 h-3" /> {prev.title}
              </Link>
            ) : <span />}
            {next && (
              <Link href={`/dashboard/curriculum/${trackId}/content/${next.id}`} className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors ml-auto">
                {next.title} <ChevronRight className="w-3 h-3" />
              </Link>
            )}
          </div>
        </motion.div>
      )}

      {activeTab === 'files' && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <WorkFileStorage
            workType="content"
            workId={chapter.id}
            trackId={trackId}
            trackName={syllabus.title}
            label="Files & notes from your Bob conversation on this chapter"
          />
        </motion.div>
      )}
    </div>
  )
}
