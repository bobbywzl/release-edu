'use client'

import { useState, useMemo } from 'react'
import { useParams } from 'next/navigation'
import { motion } from 'framer-motion'
import { AlertCircle, CalendarDays, Clock, Send } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import WorkPage from '@/components/work-page'
import { MarkdownRenderer } from '@/components/markdown-renderer'
import { WorkFileStorage } from '@/components/work-file-storage'
import { useWorkData } from '@/lib/work-data'
import { useToast } from '@/components/toast'

function isOverdue(dueDate?: string): boolean {
  if (!dueDate) return false
  return new Date(dueDate) < new Date()
}

export default function HomeworkPage() {
  const params = useParams()
  const trackId = params.trackId as string
  const id = params.id as string
  const { success } = useToast()
  const [response, setResponse] = useState('')
  const [submitted, setSubmitted] = useState(false)

  const { data, loading } = useWorkData(trackId)
  const syllabus = data.syllabus
  const homework = data.homework

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

  const hw = homework.find(h => h.id === id)
  if (!hw) return <div className="p-6 text-center text-muted-foreground">Homework not found.</div>

  const hwIdx = homework.findIndex(h => h.id === id)
  const prev = hwIdx > 0 ? homework[hwIdx - 1] : null
  const next = hwIdx < homework.length - 1 ? homework[hwIdx + 1] : null
  const overdue = hw.status !== 'completed' && isOverdue(hw.dueDate)
  const displayStatus = overdue ? 'overdue' : (submitted ? 'completed' : hw.status)

  const homeworkWorkContext = useMemo(() => ({
    type: 'homework' as const,
    trackId,
    trackName: syllabus.title,
    itemId: hw.id,
    itemTitle: hw.title,
    content: `Homework: ${hw.title}\n\nInstructions: ${hw.instructions}\n\nCompetencies: ${hw.competencies.join(', ')}\n\nStudent's current work:\n${response}`,
  }), [trackId, syllabus.title, hw.id, hw.title, hw.instructions, hw.competencies, response])

  function handleSubmit() {
    setSubmitted(true)
    success('Submitted for review', 'Your Mentor will review your work.')
  }

  return (
    <WorkPage
      type="homework"
      trackId={trackId}
      trackName={syllabus.title}
      title={hw.title}
      description={hw.description}
      status={displayStatus}
      meta={[
        ...(hw.dueDate ? [{ label: 'Due', value: new Date(hw.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }] : []),
      ]}
      prevLink={prev ? { href: `/dashboard/curriculum/${trackId}/homework/${prev.id}`, label: prev.title } : undefined}
      nextLink={next ? { href: `/dashboard/curriculum/${trackId}/homework/${next.id}`, label: next.title } : undefined}
      workContext={homeworkWorkContext}
    >
      <div className="space-y-4">
        {/* Overdue warning */}
        {overdue && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs"
          >
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>This assignment is overdue. Submit as soon as possible.</span>
          </motion.div>
        )}

        {/* Instructions */}
        <Card className="border-border">
          <CardContent className="p-5 space-y-4">
            <h3 className="text-sm font-semibold text-foreground">Instructions</h3>
            <MarkdownRenderer content={hw.instructions} />

            {/* Competencies */}
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground font-medium">Competencies</p>
              <div className="flex flex-wrap gap-1.5">
                {hw.competencies.map(c => (
                  <Badge key={c} variant="secondary" className="text-[10px]">{c}</Badge>
                ))}
              </div>
            </div>

            {/* Meta row */}
            {hw.dueDate && (
              <div className="flex items-center gap-4 text-[11px] text-muted-foreground pt-1">
                <span className={`flex items-center gap-1 ${overdue ? 'text-red-400' : ''}`}>
                  <CalendarDays className="w-3 h-3" />
                  {new Date(hw.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Work Area */}
        <Card className="border-border">
          <CardContent className="p-5 space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Your Work</h3>
            {submitted ? (
              <div className="text-center py-8 space-y-2">
                <div className="text-emerald-400 text-sm font-medium">✓ Submitted for review</div>
                <p className="text-xs text-muted-foreground">Your Mentor will provide feedback soon.</p>
              </div>
            ) : (
              <>
                <textarea
                  value={response}
                  onChange={e => setResponse(e.target.value)}
                  placeholder="Write your response here..."
                  className="w-full min-h-[200px] bg-muted/30 border border-border rounded-lg p-3 text-sm text-foreground placeholder:text-muted-foreground resize-y focus:outline-none focus:ring-1 focus:ring-primary/30"
                />
                <WorkFileStorage
                  workType="homework"
                  workId={hw.id}
                  trackId={trackId}
                  trackName={syllabus.title}
                  label="Attach your work files"
                />
                <div className="flex justify-end">
                  <Button
                    onClick={handleSubmit}
                    disabled={!response.trim()}
                    className="gap-1.5 text-xs"
                  >
                    <Send className="w-3.5 h-3.5" />
                    Submit
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </WorkPage>
  )
}
