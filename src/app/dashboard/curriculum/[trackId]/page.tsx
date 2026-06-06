'use client'

import { useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import {
  BookOpen, FileText, Brain, Rocket,
  Clock, ChevronRight, CheckCircle, Circle, Loader2,
  AlertCircle, Trophy, MessageSquare, CalendarDays, ChevronDown,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'
import { useWorkData } from '@/lib/work-data'
import type { ContentChapter, Homework, Quiz, SubjectProject } from '@/types'

const fadeUp = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
}

type Tab = 'content' | 'homework' | 'quizzes' | 'project'

const TABS: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'content', label: 'Content', icon: BookOpen },
  { id: 'homework', label: 'Homework', icon: FileText },
  { id: 'quizzes', label: 'Quizzes', icon: Brain },
  { id: 'project', label: 'Project', icon: Rocket },
]

const STATUS_CONFIG = {
  completed: { icon: CheckCircle, class: 'text-emerald-400', badge: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
  'in-progress': { icon: Loader2, class: 'text-blue-400', badge: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
  'not-started': { icon: Circle, class: 'text-slate-500', badge: 'bg-slate-500/10 text-slate-400 border-slate-500/20' },
}

function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG['not-started']
  return (
    <Badge variant="outline" className={`text-[10px] capitalize ${config.badge}`}>
      {status.replace('-', ' ')}
    </Badge>
  )
}

function isOverdue(dueDate?: string): boolean {
  if (!dueDate) return false
  return new Date(dueDate) < new Date()
}

// ── Chapter Syllabus Expandable ────────────────────────────

function ChapterSyllabusPanel({ chapterId }: { chapterId: string }) {
  const [content, setContent] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (content !== null) { setOpen(o => !o); return }
    setLoading(true)
    setOpen(true)
    try {
      const res = await fetch(`/api/chapter/${chapterId}`)
      if (res.ok) {
        const { chapter } = await res.json()
        const text = chapter?.content || ''
        // Only show existing content — never trigger generation from here
        if (text && !text.includes('Content will be generated') && text.length > 100) {
          setContent(text)
        } else {
          setContent(chapter?.description || 'Content will be generated when you start this chapter with Bob.')
        }
      }
    } catch {
      setContent('Could not load chapter info.')
    } finally {
      setLoading(false)
    }
  }, [chapterId, content])

  return (
    <div className="border-t border-border/50 mt-3 pt-3">
      <button
        onClick={load}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors group"
      >
        <BookOpen className="w-3 h-3" />
        <span>Chapter syllabus</span>
        {loading ? (
          <Loader2 className="w-3 h-3 animate-spin ml-1" />
        ) : (
          <ChevronDown className={`w-3 h-3 ml-0.5 transition-transform ${open ? 'rotate-180' : ''}`} />
        )}
      </button>
      <AnimatePresence>
        {open && content && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mt-3 p-3 rounded-lg bg-muted/20 border border-border/40 text-xs text-foreground/70 leading-relaxed whitespace-pre-wrap max-h-64 overflow-y-auto">
              {content}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Content Tab ────────────────────────────────────────────

function ContentTab({ chapters, trackId, syllabus }: { chapters: ContentChapter[]; trackId: string; syllabus: { description: string } }) {
  const completed = chapters.filter(c => c.status === 'completed').length
  const progress = chapters.length > 0 ? Math.round((completed / chapters.length) * 100) : 0
  const allKeyTopics = Array.from(new Set(chapters.flatMap(ch => ch.keyTopics)))


  return (
    <motion.div {...fadeUp} className="space-y-4">
      {/* Syllabus Overview */}
      <Card className="border-border bg-card">
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">Syllabus Overview</h3>
            </div>
            <Badge variant="outline" className="text-[10px]">
              {completed}/{chapters.length} chapters
            </Badge>
          </div>

          <p className="text-xs text-muted-foreground leading-relaxed">
            {syllabus.description}
          </p>

          {/* Topics covered */}
          <div>
            <p className="text-[10px] text-muted-foreground mb-1.5 font-medium">Topics Covered</p>
            <div className="flex flex-wrap gap-1.5">
              {allKeyTopics.map(topic => (
                <Badge key={topic} variant="secondary" className="text-[10px]">{topic}</Badge>
              ))}
            </div>
          </div>

          {/* Learning objectives */}
          <div>
            <p className="text-[10px] text-muted-foreground mb-1.5 font-medium">Learning Objectives</p>
            <ul className="text-xs text-muted-foreground space-y-1">
              {chapters.map(ch => (
                <li key={ch.id} className="flex items-center gap-2">
                  {ch.status === 'completed' ? (
                    <CheckCircle className="w-3 h-3 text-emerald-400 flex-shrink-0" />
                  ) : (
                    <Circle className="w-3 h-3 text-slate-500 flex-shrink-0" />
                  )}
                  Understand {ch.title}
                </li>
              ))}
            </ul>
          </div>

          <div className="flex gap-4 text-xs text-muted-foreground">
            <span>📖 {chapters.length} chapters</span>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Progress value={progress} className="h-2 flex-1" />
        <span className="text-xs text-muted-foreground whitespace-nowrap">{completed}/{chapters.length} chapters</span>
      </div>

      <div className="space-y-3">
        {chapters.map((ch, i) => {
          const StatusIcon = STATUS_CONFIG[ch.status].icon
          const statusClass = STATUS_CONFIG[ch.status].class
          return (
            <motion.div
              key={ch.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
            >
              <Card className="border-border hover:border-border/80 transition-colors">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-muted/50 text-sm font-bold text-muted-foreground flex-shrink-0">
                      {ch.order}
                    </div>
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="text-sm font-medium text-foreground">{ch.title}</h4>
                        <StatusBadge status={ch.status} />
                        <StatusIcon className={`w-4 h-4 flex-shrink-0 ${statusClass} ${ch.status === 'in-progress' ? 'animate-spin' : ''}`} />
                      </div>
                      <p className="text-xs text-muted-foreground">{ch.description}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {ch.keyTopics.map(t => (
                          <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>
                        ))}
                      </div>
                      <div className="flex items-center justify-between pt-1">
                        <span />
                        <div className="flex items-center gap-2">
                          {ch.status === 'completed' ? (
                            <Link href={
                              ch.sessionConvId
                                ? `/dashboard/chat?chapterId=${ch.id}&trackId=${trackId}&review=true`
                                : `/dashboard/curriculum/${trackId}/content/${ch.id}`
                            }>
                              <Button size="sm" variant="outline" className="text-xs h-7 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10">
                                <BookOpen className="w-3 h-3 mr-1" /> Review
                              </Button>
                            </Link>
                          ) : (
                            <Link href={`/dashboard/curriculum/${trackId}/content/${ch.id}`}>
                              <Button size="sm" variant={ch.status === 'in-progress' ? 'default' : 'outline'} className="text-xs h-7">
                                {ch.status === 'in-progress' ? 'Continue' : 'Start'} <ChevronRight className="w-3 h-3 ml-1" />
                              </Button>
                            </Link>
                          )}
                        </div>
                      </div>
                      <ChapterSyllabusPanel chapterId={ch.id} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )
        })}
      </div>
    </motion.div>
  )
}

// ── Homework Tab ───────────────────────────────────────────

function HomeworkTab({ homework, trackId }: { homework: Homework[]; trackId: string }) {
  return (
    <motion.div {...fadeUp} className="space-y-3">
      {homework.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-8">No homework assigned yet.</p>
      )}
      {homework.map((hw, i) => {
        const overdue = hw.status !== 'completed' && isOverdue(hw.dueDate)
        return (
          <motion.div
            key={hw.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
          >
            <Card className={`border-border transition-colors ${overdue ? 'border-red-500/40 bg-red-500/5' : ''}`}>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <h4 className="text-sm font-medium text-foreground">{hw.title}</h4>
                  <StatusBadge status={hw.status} />
                  {overdue && (
                    <Badge variant="outline" className="text-[10px] bg-red-500/10 text-red-400 border-red-500/20">
                      <AlertCircle className="w-3 h-3 mr-1" /> Overdue
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{hw.description}</p>
                <div className="flex flex-wrap gap-1.5">
                  {hw.competencies.map(c => (
                    <Badge key={c} variant="secondary" className="text-[10px]">{c}</Badge>
                  ))}
                </div>
                <div className="flex items-center justify-between pt-1">
                  <div className="flex items-center gap-3 text-[11px] text-muted-foreground">

                    {hw.dueDate && (
                      <span className={`flex items-center gap-1 ${overdue ? 'text-red-400' : ''}`}>
                        <CalendarDays className="w-3 h-3" /> {new Date(hw.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    )}
                  </div>
                  {hw.status !== 'completed' && (
                    <Link href={`/dashboard/curriculum/${trackId}/homework/${hw.id}`}>
                      <Button size="sm" variant={hw.status === 'in-progress' ? 'default' : 'outline'} className="text-xs h-7">
                        {hw.status === 'in-progress' ? 'Continue' : 'Start'} <ChevronRight className="w-3 h-3 ml-1" />
                      </Button>
                    </Link>
                  )}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )
      })}
    </motion.div>
  )
}

// ── Quizzes Tab ────────────────────────────────────────────

function QuizzesTab({ quizzes, trackId }: { quizzes: Quiz[]; trackId: string }) {
  return (
    <motion.div {...fadeUp} className="space-y-3">
      {quizzes.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-8">No quizzes available yet.</p>
      )}
      {quizzes.map((quiz, i) => (
        <motion.div
          key={quiz.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.05 }}
        >
          <Card className="border-border">
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <h4 className="text-sm font-medium text-foreground">{quiz.title}</h4>
                <StatusBadge status={quiz.status} />
                {quiz.status === 'completed' && quiz.score !== undefined && (
                  <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
                    <Trophy className="w-3 h-3 mr-1" /> {quiz.score}/{quiz.totalPoints}
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">{quiz.description}</p>
              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                  <span>{quiz.questions.length} questions</span>
                  {quiz.timeLimit && <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {quiz.timeLimit} min</span>}
                  <span>{quiz.totalPoints} pts</span>
                </div>
                <Link href={`/dashboard/curriculum/${trackId}/quiz/${quiz.id}`}>
                  <Button size="sm" variant={quiz.status === 'completed' ? 'outline' : 'default'} className="text-xs h-7">
                    {quiz.status === 'completed' ? 'Review' : quiz.status === 'in-progress' ? 'Continue' : 'Take Quiz'} <ChevronRight className="w-3 h-3 ml-1" />
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      ))}
    </motion.div>
  )
}

// ── Project Tab ────────────────────────────────────────────

function ProjectTab({ project, trackId }: { project: SubjectProject | null; trackId: string }) {
  if (!project) {
    return (
      <motion.div {...fadeUp} className="text-center py-12 space-y-4">
        <Rocket className="w-10 h-10 mx-auto text-muted-foreground" />
        <div>
          <h4 className="text-sm font-medium text-foreground">No project yet</h4>
          <p className="text-xs text-muted-foreground mt-1">Propose a creative project that connects what you&apos;re learning.</p>
        </div>
        <Link href="/dashboard/chat">
          <Button size="sm" className="text-xs">
            <MessageSquare className="w-3 h-3 mr-1" /> Propose a Project with Bob
          </Button>
        </Link>
      </motion.div>
    )
  }

  const projectStatusConfig: Record<string, string> = {
    proposal: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    approved: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    'in-progress': 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    completed: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    'needs-revision': 'bg-red-500/10 text-red-400 border-red-500/20',
  }

  const completedTasks = project.tasks.filter(t => t.completed).length

  return (
    <motion.div {...fadeUp} className="space-y-4">
      <Card className="border-border">
        <CardContent className="p-5 space-y-4">
          {/* Header */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base font-semibold text-foreground">{project.title}</h3>
              <Badge variant="outline" className={`text-[10px] capitalize ${projectStatusConfig[project.status] ?? ''}`}>
                {project.status.replace('-', ' ')}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">{project.description}</p>
          </div>

          {/* Progress */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Progress</span>
              <span className="text-foreground font-medium">{project.progress}%</span>
            </div>
            <Progress value={project.progress} className="h-2" />
          </div>

          {/* Proposal */}
          <div className="p-3 rounded-lg bg-muted/30 border border-border/50">
            <p className="text-[11px] text-muted-foreground font-medium mb-1">Proposal</p>
            <p className="text-xs text-foreground leading-relaxed">{project.proposal}</p>
          </div>

          {/* Mentor Feedback */}
          {project.mentorFeedback && (
            <div className="p-3 rounded-lg bg-primary/5 border border-primary/10">
              <p className="text-[11px] text-primary font-medium mb-1">Mentor Feedback</p>
              <p className="text-xs text-muted-foreground leading-relaxed italic">&ldquo;{project.mentorFeedback}&rdquo;</p>
            </div>
          )}

          {/* Tasks */}
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground font-medium">Tasks ({completedTasks}/{project.tasks.length})</p>
            <div className="space-y-1.5">
              {project.tasks.sort((a, b) => a.order - b.order).map(task => (
                <div key={task.id} className="flex items-center gap-2 text-xs">
                  {task.completed ? (
                    <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                  ) : (
                    <Circle className="w-4 h-4 text-slate-500 flex-shrink-0" />
                  )}
                  <span className={task.completed ? 'text-muted-foreground line-through' : 'text-foreground'}>{task.title}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Milestones */}
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground font-medium">Milestones</p>
            <div className="relative pl-4 space-y-3">
              <div className="absolute left-[7px] top-1 bottom-1 w-px bg-border" />
              {project.milestones.map(ms => (
                <div key={ms.id} className="relative flex items-start gap-3">
                  <div className={`w-3.5 h-3.5 rounded-full border-2 flex-shrink-0 -ml-[7px] z-10 ${
                    ms.completed ? 'bg-emerald-400 border-emerald-400' : 'bg-card border-slate-500'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs ${ms.completed ? 'text-muted-foreground' : 'text-foreground'}`}>{ms.title}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {new Date(ms.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Coverage */}
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground font-medium">Covers</p>
            <div className="flex flex-wrap gap-1.5">
              {project.coverageMap.map(c => (
                <Badge key={c} variant="secondary" className="text-[10px]">{c}</Badge>
              ))}
            </div>
          </div>

          {/* Action */}
          {project.status !== 'completed' && (
            <Link href={`/dashboard/curriculum/${trackId}/project`}>
              <Button size="sm" className="w-full text-xs">
                Continue Project <ChevronRight className="w-3 h-3 ml-1" />
              </Button>
            </Link>
          )}
        </CardContent>
      </Card>
    </motion.div>
  )
}

// ── Main Page ──────────────────────────────────────────────

export default function SubjectOverviewPage() {
  const params = useParams()
  const trackId = params.trackId as string
  const [activeTab, setActiveTab] = useState<Tab>('content')

  const { data, loading } = useWorkData(trackId)
  const syllabus = data.syllabus
  const homework = data.homework
  const quizzes = data.quizzes
  const project = data.project

  if (loading) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-muted rounded w-48" />
          <div className="h-4 bg-muted rounded w-96" />
          <div className="h-32 bg-muted rounded" />
          <div className="h-10 bg-muted rounded w-64" />
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
        <p className="text-sm text-muted-foreground mt-2">No content available for this track yet.</p>
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

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Back link */}
      <Link href="/dashboard/curriculum" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
        ← Curriculum
      </Link>

      {/* Header */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-2">
        <h1 className="text-2xl font-bold text-foreground">{syllabus.title}</h1>
        <p className="text-sm text-muted-foreground">{syllabus.description}</p>
        <div className="flex items-center gap-3 pt-1">
          <Progress value={overallProgress} className="h-2 flex-1 max-w-xs" />
          <span className="text-xs text-muted-foreground">{overallProgress}% complete</span>
        </div>
      </motion.div>

      {/* Pill Tabs */}
      <div className="flex gap-1.5 bg-muted/30 p-1 rounded-lg w-fit">
        {TABS.map(tab => {
          const Icon = tab.icon
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                isActive
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Tab Content */}
      <AnimatePresence mode="wait">
        {activeTab === 'content' && <ContentTab key="content" chapters={chapters} trackId={trackId} syllabus={syllabus} />}
        {activeTab === 'homework' && <HomeworkTab key="homework" homework={homework} trackId={trackId} />}
        {activeTab === 'quizzes' && <QuizzesTab key="quizzes" quizzes={quizzes} trackId={trackId} />}
        {activeTab === 'project' && <ProjectTab key="project" project={project} trackId={trackId} />}
      </AnimatePresence>
    </div>
  )
}
