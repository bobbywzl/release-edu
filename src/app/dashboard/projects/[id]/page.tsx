'use client'
import { motion } from 'framer-motion'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useEffect } from 'react'
import {
  ArrowLeft, Sparkles, BookOpen, CheckCircle2, Clock, Circle,
  MessageSquare, FileText, Lock, AlertCircle, ChevronRight
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { WorkFileStorage } from '@/components/work-file-storage'

const fadeUp = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.18, ease: 'easeOut' as const } },
}
const stagger = { visible: { transition: { staggerChildren: 0.04 } } }

interface ProjectDetail {
  id: string
  title: string
  description: string
  status: string
  progress: number
  subject: string
  trackId: string
  trackName: string
  exploreConvId: string | null
  lockedIn: boolean
  proposal: string | null
  coverageMap: string[] | null
  mentorFeedback: string | null
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  proposal:    { label: 'Idea Stage',   color: 'text-amber-400',  bg: 'bg-amber-500/10 border-amber-500/20' },
  approved:    { label: 'Approved',     color: 'text-blue-400',   bg: 'bg-blue-500/10 border-blue-500/20' },
  'in-progress': { label: 'In Progress', color: 'text-primary',   bg: 'bg-primary/10 border-primary/20' },
  completed:   { label: 'Completed',    color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20' },
  'needs-revision': { label: 'Needs Revision', color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/20' },
}

export default function ProjectDetailPage({ params }: { params: { id: string } }) {
  const { id } = params
  const router = useRouter()
  const [project, setProject] = useState<ProjectDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/projects/${id}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) setError(d.error)
        else setProject(d.project)
      })
      .catch(() => setError('Failed to load project'))
      .finally(() => setLoading(false))
  }, [id])

  if (loading) return (
    <div className="p-6 md:p-8 max-w-3xl space-y-6 animate-pulse">
      {/* Back link */}
      <div className="h-4 bg-muted/50 rounded w-32" />
      {/* Header */}
      <div className="space-y-3">
        <div className="h-3 bg-muted/40 rounded w-24" />
        <div className="h-8 bg-muted/60 rounded w-2/3" />
        <div className="h-4 bg-muted/30 rounded w-full" />
        <div className="h-4 bg-muted/30 rounded w-3/4" />
      </div>
      {/* CTA card */}
      <div className="h-32 bg-muted/30 rounded-lg border border-border/40" />
      {/* Body cards */}
      <div className="h-24 bg-muted/20 rounded-lg border border-border/40" />
      <div className="h-40 bg-muted/20 rounded-lg border border-border/40" />
    </div>
  )

  if (error || !project) return (
    <div className="p-8 space-y-4">
      <Link href="/dashboard/projects" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-4 h-4" /> Back to Projects
      </Link>
      <div className="text-center py-16">
        <AlertCircle className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
        <p className="text-muted-foreground">Project not found.</p>
      </div>
    </div>
  )

  const statusCfg = STATUS_CONFIG[project.status] ?? STATUS_CONFIG.proposal
  const isLocked = project.lockedIn
  const hasConv = !!project.exploreConvId

  function openBobSession() {
    router.push(`/dashboard/chat?projectId=${project!.id}&trackId=${project!.trackId}&projectMode=${isLocked ? 'work' : 'explore'}`)
  }

  return (
    <motion.div className="p-6 md:p-8 max-w-3xl space-y-6" initial="hidden" animate="visible" variants={stagger}>
      {/* Back */}
      <motion.div variants={fadeUp}>
        <Link href="/dashboard/projects" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back to Projects
        </Link>
      </motion.div>

      {/* Header */}
      <motion.div variants={fadeUp} className="space-y-3">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-1 min-w-0">
            <p className="text-xs text-muted-foreground font-medium">{project.trackName}</p>
            <h1 className="text-2xl font-bold text-foreground leading-tight">{project.title}</h1>
          </div>
          <Badge className={`text-xs flex-shrink-0 ${statusCfg.bg} ${statusCfg.color} border`}>
            {statusCfg.label}
          </Badge>
        </div>
        {project.description && (
          <p className="text-sm text-muted-foreground leading-relaxed">{project.description}</p>
        )}
      </motion.div>

      {/* Progress bar (if in-progress or completed) */}
      {project.progress > 0 && (
        <motion.div variants={fadeUp}>
          <Card className="bg-card border-border">
            <CardContent className="p-4 space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Project Progress</span>
                <span className="font-medium text-foreground">{project.progress}%</span>
              </div>
              <Progress value={project.progress} className="h-2" />
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Main CTA — Bob session */}
      <motion.div variants={fadeUp}>
        <Card className={`border-2 ${isLocked ? 'border-primary/30 bg-primary/5' : 'border-purple-500/30 bg-purple-500/5'}`}>
          <CardContent className="p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${isLocked ? 'bg-primary/10' : 'bg-purple-500/10'}`}>
                {isLocked
                  ? <BookOpen className="w-4 h-4 text-primary" />
                  : <Sparkles className="w-4 h-4 text-purple-400" />
                }
              </div>
              <div className="space-y-1 min-w-0">
                <p className="text-sm font-semibold text-foreground">
                  {isLocked
                    ? (project.status === 'completed' ? 'Review Project with Bob' : 'Work on Project with Bob')
                    : hasConv ? 'Continue Exploring with Bob' : 'Discuss with Bob'
                  }
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {isLocked
                    ? 'Bob will guide you through milestones, review your work, and track completion.'
                    : 'Explore this project idea with Bob — understand what it involves, whether it fits your goals, and how to approach it.'
                  }
                </p>
              </div>
            </div>

            <Button
              className={`w-full text-sm font-medium ${isLocked ? 'bg-primary hover:bg-primary/90 text-white' : 'bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/30'}`}
              onClick={openBobSession}
            >
              <MessageSquare className="w-4 h-4 mr-2" />
              {isLocked
                ? (project.status === 'completed' ? 'Review with Bob' : 'Continue with Bob')
                : hasConv ? 'Continue Conversation' : 'Start Discussion'
              }
              <ChevronRight className="w-4 h-4 ml-auto" />
            </Button>
          </CardContent>
        </Card>
      </motion.div>

      {/* Lock-in status */}
      {!isLocked && (
        <motion.div variants={fadeUp}>
          <Card className="border-border bg-card">
            <CardContent className="p-4 flex items-center gap-3">
              <Lock className="w-4 h-4 text-muted-foreground/60 flex-shrink-0" />
              <p className="text-xs text-muted-foreground leading-relaxed">
                Discuss this project with Bob first. Once you're confident it's the right fit,{' '}
                <span className="text-foreground font-medium">lock it in</span> from the Projects page to start working.
              </p>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Proposal / coverage */}
      {project.proposal && (() => {
        // Try to parse as JSON (Bob sometimes stores structured proposal data)
        let parsed: { overview?: string; skills?: string[]; firstSteps?: string[]; deliverable?: string } | null = null
        try { parsed = JSON.parse(project.proposal) } catch { /* plain text */ }

        return (
          <motion.div variants={fadeUp}>
            <Card className="bg-card border-border">
              <CardContent className="p-5 space-y-4">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-muted-foreground" />
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Project Proposal</span>
                </div>
                {parsed ? (
                  <div className="space-y-4">
                    {parsed.overview && (
                      <p className="text-sm text-foreground/80 leading-relaxed">{parsed.overview}</p>
                    )}
                    {parsed.skills && parsed.skills.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground mb-2">Skills you'll develop</p>
                        <div className="flex flex-wrap gap-1.5">
                          {parsed.skills.map(s => (
                            <span key={s} className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">{s}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {parsed.firstSteps && parsed.firstSteps.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground mb-2">First steps</p>
                        <ol className="space-y-1.5 list-none">
                          {parsed.firstSteps.map((step, i) => (
                            <li key={i} className="text-sm text-foreground/80 flex gap-2.5">
                              <span className="text-xs font-bold text-primary mt-0.5 flex-shrink-0">{i + 1}.</span>
                              <span>{step}</span>
                            </li>
                          ))}
                        </ol>
                      </div>
                    )}
                    {parsed.deliverable && (
                      <div className="p-2.5 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
                        <p className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wider mb-1">Final deliverable</p>
                        <p className="text-xs text-foreground/70">{parsed.deliverable}</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap">{project.proposal}</p>
                )}
              </CardContent>
            </Card>
          </motion.div>
        )
      })()}

      {/* Coverage map */}
      {project.coverageMap && project.coverageMap.length > 0 && (
        <motion.div variants={fadeUp}>
          <Card className="bg-card border-border">
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Topics Covered</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {project.coverageMap.map((topic: string) => (
                  <span key={topic} className="text-[11px] px-2 py-1 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    {topic}
                  </span>
                ))}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* File Storage — all files submitted to Bob conversations */}
      <motion.div variants={fadeUp}>
        <WorkFileStorage
          workType="project"
          workId={project.id}
          trackId={project.trackId}
          trackName={project.trackName}
          label="Project Files"
        />
      </motion.div>

      {/* Mentor feedback */}
      {project.mentorFeedback && (
        <motion.div variants={fadeUp}>
          <Card className="bg-card border-purple-500/20 border">
            <CardContent className="p-5 space-y-2">
              <div className="flex items-center gap-2 mb-2">
                <MessageSquare className="w-4 h-4 text-purple-400" />
                <span className="text-xs font-semibold text-purple-400 uppercase tracking-wider">Mentor Feedback</span>
              </div>
              <p className="text-sm text-foreground/80 leading-relaxed">{project.mentorFeedback}</p>
            </CardContent>
          </Card>
        </motion.div>
      )}
    </motion.div>
  )
}
