'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { motion } from 'framer-motion'
import {
  CheckCircle, Circle, MessageSquare, Rocket, CalendarDays, Bot,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import WorkPage from '@/components/work-page'
import { WorkFileStorage } from '@/components/work-file-storage'
import { useWorkData } from '@/lib/work-data'

const PROJECT_STATUS_CONFIG: Record<string, string> = {
  proposal: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  approved: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  'in-progress': 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  completed: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  'needs-revision': 'bg-red-500/10 text-red-400 border-red-500/20',
}

export default function ProjectPage() {
  const params = useParams()
  const trackId = params.trackId as string

  const { data, loading } = useWorkData(trackId)
  const syllabus = data.syllabus
  const project = data.project

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

  // No project — CTA
  if (!project) {
    return (
      <WorkPage
        type="project"
        trackId={trackId}
        trackName={syllabus.title}
        title="Subject Project"
        description="Propose a creative project that connects what you're learning."
        status="not-started"
        workContext={{
          type: 'project',
          trackId,
          trackName: syllabus.title,
          itemId: 'new-project',
          itemTitle: 'New Project Proposal',
          content: `The student hasn't proposed a project yet for ${syllabus.title}. Help them brainstorm and come up with a creative project idea.`,
        }}
      >
        <Card className="border-border">
          <CardContent className="p-8 text-center space-y-4">
            <Rocket className="w-12 h-12 mx-auto text-muted-foreground" />
            <div>
              <h3 className="text-base font-semibold text-foreground">No project yet</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Projects are creative, student-driven work. Chat with Bob to brainstorm and propose one.
              </p>
            </div>
            <Link href="/dashboard/chat">
              <Button className="gap-1.5">
                <MessageSquare className="w-4 h-4" />
                Propose a Project — Chat with Bob
              </Button>
            </Link>
          </CardContent>
        </Card>
      </WorkPage>
    )
  }

  return (
    <WorkPage
      type="project"
      trackId={trackId}
      trackName={syllabus.title}
      title={project.title}
      description={project.description}
      status={project.status}
      meta={[{ label: 'Progress', value: `${project.progress}%` }]}
      workContext={{
        type: 'project',
        trackId,
        trackName: syllabus.title,
        itemId: project.id,
        itemTitle: project.title,
        content: `Project: ${project.title}\n\nProposal: ${project.proposal}\n\nStatus: ${project.status}\nProgress: ${project.progress}%\n\nTasks:\n${project.tasks.map(t => `- [${t.completed ? 'x' : ' '}] ${t.title}`).join('\n')}\n\nCoverage: ${project.coverageMap.join(', ')}`,
      }}
    >
      <ProjectContent project={project} syllabus={syllabus} trackId={trackId} />
    </WorkPage>
  )
}

// ── Project Content ────────────────────────────────────────

import type { SubjectProject, SubjectSyllabus } from '@/types'

function ProjectContent({ project, syllabus, trackId }: { project: SubjectProject; syllabus: SubjectSyllabus; trackId: string }) {
  const [taskStates, setTaskStates] = useState<Record<string, boolean>>(
    Object.fromEntries(project.tasks.map(t => [t.id, t.completed]))
  )

  const completedCount = Object.values(taskStates).filter(Boolean).length
  const totalTasks = project.tasks.length

  // Map coverage items to chapters
  const allTopics = syllabus.chapters.flatMap(ch => ch.keyTopics)
  const uniqueTopics = Array.from(new Set(allTopics))
  const coveredTopics = project.coverageMap
  const coveragePercent = uniqueTopics.length > 0
    ? Math.round((coveredTopics.filter(t => uniqueTopics.includes(t)).length / uniqueTopics.length) * 100)
    : 0

  function toggleTask(taskId: string) {
    setTaskStates(prev => ({ ...prev, [taskId]: !prev[taskId] }))
  }

  return (
    <div className="space-y-4">
      {/* Progress */}
      <Card className="border-border">
        <CardContent className="p-5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground font-medium">Overall Progress</span>
            <span className="text-sm font-bold text-foreground">{project.progress}%</span>
          </div>
          <Progress value={project.progress} className="h-2" />
        </CardContent>
      </Card>

      {/* Proposal */}
      <Card className="border-border">
        <CardContent className="p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">Proposal</h3>
            <Badge variant="outline" className={`text-[10px] capitalize ${PROJECT_STATUS_CONFIG[project.status] ?? ''}`}>
              {project.status.replace('-', ' ')}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">{project.proposal}</p>
        </CardContent>
      </Card>

      {/* Tasks */}
      <Card className="border-border">
        <CardContent className="p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">Tasks</h3>
            <span className="text-xs text-muted-foreground">{completedCount}/{totalTasks}</span>
          </div>
          <div className="space-y-2">
            {project.tasks.sort((a, b) => a.order - b.order).map(task => {
              const done = taskStates[task.id]
              return (
                <motion.button
                  key={task.id}
                  onClick={() => toggleTask(task.id)}
                  whileTap={{ scale: 0.98 }}
                  className="flex items-center gap-3 w-full text-left p-2 -mx-2 rounded-lg hover:bg-muted/30 transition-colors"
                >
                  {done ? (
                    <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                  ) : (
                    <Circle className="w-4 h-4 text-slate-500 flex-shrink-0" />
                  )}
                  <span className={`text-sm ${done ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                    {task.title}
                  </span>
                </motion.button>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Milestones */}
      <Card className="border-border">
        <CardContent className="p-5 space-y-3">
          <h3 className="text-sm font-semibold text-foreground">Milestones</h3>
          <div className="relative pl-4 space-y-4">
            <div className="absolute left-[7px] top-1 bottom-1 w-px bg-border" />
            {project.milestones.map(ms => {
              const date = new Date(ms.date)
              const isPast = date < new Date() && !ms.completed
              return (
                <div key={ms.id} className="relative flex items-start gap-3">
                  <div className={`w-3.5 h-3.5 rounded-full border-2 flex-shrink-0 -ml-[7px] z-10 ${
                    ms.completed
                      ? 'bg-emerald-400 border-emerald-400'
                      : isPast
                      ? 'bg-card border-red-400'
                      : 'bg-card border-slate-500'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-medium ${ms.completed ? 'text-muted-foreground' : 'text-foreground'}`}>
                      {ms.title}
                    </p>
                    <p className={`text-[10px] flex items-center gap-1 ${isPast ? 'text-red-400' : 'text-muted-foreground'}`}>
                      <CalendarDays className="w-3 h-3" />
                      {date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      {isPast && ' — overdue'}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Coverage Map */}
      <Card className="border-border">
        <CardContent className="p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">Coverage Map</h3>
            <span className="text-xs text-muted-foreground">{coveragePercent}% of topics</span>
          </div>
          <Progress value={coveragePercent} className="h-2" />
          <div className="flex flex-wrap gap-1.5 pt-1">
            {uniqueTopics.map(topic => {
              const covered = coveredTopics.includes(topic)
              return (
                <Badge
                  key={topic}
                  variant="outline"
                  className={`text-[10px] ${
                    covered
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                      : 'bg-slate-500/10 text-slate-400 border-slate-500/20'
                  }`}
                >
                  {covered && <CheckCircle className="w-2.5 h-2.5 mr-1" />}
                  {topic}
                </Badge>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Mentor Feedback */}
      {project.mentorFeedback && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-5 space-y-2">
            <div className="flex items-center gap-2">
              <Bot className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">Mentor Feedback</h3>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed italic">
              &ldquo;{project.mentorFeedback}&rdquo;
            </p>
          </CardContent>
        </Card>
      )}

      {/* Project Files */}
      <WorkFileStorage
        workType="project"
        workId={project.id}
        trackId={trackId}
        trackName={syllabus.title}
        label="Project Files"
      />

      {/* Discuss CTA */}
      {project.status !== 'completed' && (
        <Card className="border-border">
          <CardContent className="p-5 text-center space-y-3">
            <p className="text-xs text-muted-foreground">
              Projects are collaborative. Discuss next steps, get feedback, or brainstorm with Bob.
            </p>
            <Link href="/dashboard/chat">
              <Button size="sm" className="gap-1.5 text-xs">
                <MessageSquare className="w-3.5 h-3.5" />
                Discuss with Bob
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
