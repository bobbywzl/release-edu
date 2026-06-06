'use client'
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Link from 'next/link'
import { useLanguage } from '@/lib/i18n'
import { useRouter } from 'next/navigation'
import {
  FolderOpen, CheckCircle2, Sparkles, MessageCircle,
  ArrowRight, Rocket, BookOpen, Tag, ChevronDown, ChevronUp, Loader2,
  Plus, Wand2, X, Check,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { useStudentData, refreshStudentData } from '@/lib/student-data'

const fadeUp = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.18, ease: 'easeOut' as const } },
}
const stagger = { visible: { transition: { staggerChildren: 0.04 } } }

type ProjectData = ReturnType<typeof useStudentData>['data']['projects'][number]

// ── Active Project Card ──────────────────────────────────────────────────────

function ActiveProjectCard({ project }: { project: ProjectData }) {
  const trackColor = project.trackColor || '#3B82F6'

  return (
    <motion.div variants={fadeUp}>
      <Link
        href={`/dashboard/projects/${project.id}`}
        className="block group"
      >
        <motion.div
          whileHover={{ y: -2, boxShadow: '0 8px 30px rgba(0,0,0,0.25)' }}
          transition={{ duration: 0.2 }}
        >
          <Card className="bg-card border-border group-hover:border-primary/40 transition-all duration-200 ring-1 ring-primary/10 overflow-hidden">
            <div className="h-1" style={{ backgroundColor: trackColor }} />
            <CardContent className="p-5">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <div
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: trackColor }}
                    />
                    <span className="text-xs text-muted-foreground">
                      {project.trackName || project.subject}
                    </span>
                  </div>
                  <h3 className="font-semibold text-foreground text-base leading-tight group-hover:text-primary transition-colors">
                    {project.title}
                  </h3>
                </div>
                <div className={`flex items-center gap-1.5 rounded-full px-3 py-1 border text-xs font-medium flex-shrink-0 ${
                  project.status === 'completed'
                    ? 'bg-purple-400/10 border-purple-400/30 text-purple-400'
                    : 'bg-green-400/10 border-green-400/30 text-green-400'
                }`}>
                  {project.status === 'completed' ? (
                    <CheckCircle2 className="w-3 h-3" />
                  ) : (
                    <Rocket className="w-3 h-3" />
                  )}
                  {project.status === 'completed' ? 'Completed' : 'Active'}
                </div>
              </div>

              {project.description && (
                <p className="text-sm text-muted-foreground leading-relaxed mb-4 line-clamp-2">
                  {project.description}
                </p>
              )}

              {/* Progress bar */}
              <div className="mb-4">
                <div className="flex justify-between text-xs text-muted-foreground mb-1.5">
                  <span>Progress</span>
                  <span>{project.progress}%</span>
                </div>
                <Progress
                  value={project.progress}
                  className="h-2"
                  indicatorClassName={
                    project.status === 'completed'
                      ? 'bg-purple-400'
                      : 'bg-primary'
                  }
                />
              </div>

              {/* Tags */}
              {project.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-4">
                  {project.tags.map(tag => (
                    <div
                      key={tag}
                      className="flex items-center gap-1 text-[10px] bg-muted rounded-md px-2 py-0.5 text-muted-foreground"
                    >
                      <Tag className="w-2.5 h-2.5" />
                      {tag}
                    </div>
                  ))}
                </div>
              )}

              {/* Actions */}
              <div className="pt-3 border-t border-border flex items-center gap-2">
                <Link
                  href={`/dashboard/chat?projectId=${project.id}&trackId=${project.trackId || ''}&projectMode=${project.status === 'active' ? 'work' : 'explore'}&mode=tutoring`}
                  onClick={e => e.stopPropagation()}
                  className="flex items-center gap-1.5 text-xs text-primary hover:bg-primary/10 rounded-lg px-2.5 py-1.5 transition-colors"
                >
                  <MessageCircle className="w-3 h-3" />
                  Continue with Bob
                </Link>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </Link>
    </motion.div>
  )
}

// ── Inspiration Project Card ─────────────────────────────────────────────────

interface ProjectDetails {
  overview: string
  skills: string[]
  firstSteps: string[]
  deliverable: string
}

function InspirationCard({ project }: { project: ProjectData }) {
  const router = useRouter()
  const [locking, setLocking] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [details, setDetails] = useState<ProjectDetails | null>(null)
  const [loadingDetails, setLoadingDetails] = useState(false)
  const trackColor = project.trackColor || '#6366f1'

  async function toggleExpand(e: React.MouseEvent) {
    // Don't expand if clicking action buttons
    const target = e.target as HTMLElement
    if (target.closest('a, button')) return
    if (expanded) { setExpanded(false); return }
    setExpanded(true)
    if (details) return
    setLoadingDetails(true)
    try {
      const res = await fetch(`/api/projects/${project.id}/details`)
      if (res.ok) {
        const { details: d } = await res.json()
        if (d) setDetails(d)
      }
    } catch { /* non-critical */ }
    finally { setLoadingDetails(false) }
  }

  async function handleLockIn(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (locking) return
    setLocking(true)
    try {
      const res = await fetch(`/api/projects/${project.id}/lock-in`, { method: 'POST' })
      if (res.ok) {
        const { refreshStudentData } = await import('@/lib/student-data')
        refreshStudentData()
        router.push(`/dashboard/projects/${project.id}`)
      } else {
        const data = await res.json().catch(() => ({}))
        alert(data.message || 'Could not lock in project.')
      }
    } catch {
      // ignore
    } finally {
      setLocking(false)
    }
  }

  return (
    <motion.div variants={fadeUp}>
      <Card
        className="bg-card/60 border-border hover:border-muted-foreground/30 transition-all duration-200 overflow-hidden group cursor-pointer"
        onClick={toggleExpand}
      >
        <div className="flex">
          <div className="w-1 flex-shrink-0" style={{ backgroundColor: trackColor }} />
          <CardContent className="p-5 flex-1">
            {/* Header */}
            <div className="flex items-center justify-between gap-2 mb-2">
              <span
                className="text-[10px] font-medium rounded-full px-2.5 py-0.5 border"
                style={{ color: trackColor, borderColor: `${trackColor}40`, backgroundColor: `${trackColor}10` }}
              >
                {project.trackName || project.subject}
              </span>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-medium text-muted-foreground/60 bg-muted/50 rounded-full px-2.5 py-0.5 flex items-center gap-1">
                  <Sparkles className="w-2.5 h-2.5" />
                  Inspiration
                </span>
                {expanded
                  ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
                  : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                }
              </div>
            </div>

            {/* Title */}
            <h3 className="font-semibold text-foreground/90 text-base leading-tight mb-2 group-hover:text-foreground transition-colors">
              {project.title}
            </h3>

            {/* Description — collapsed: 2 lines, expanded: full */}
            {project.description && (
              <p className={`text-sm text-muted-foreground/80 leading-relaxed mb-3 ${expanded ? '' : 'line-clamp-2'}`}>
                {project.description}
              </p>
            )}

            {/* Expanded details */}
            {expanded && (
              <div className="mt-3 mb-3 space-y-3">
                {loadingDetails && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Generating project details…
                  </div>
                )}
                {details && (
                  <>
                    <div className="p-3 rounded-lg bg-background/60 border border-border/50 space-y-1">
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">What you'll build</p>
                      <p className="text-xs text-foreground/80 leading-relaxed">{details.overview}</p>
                    </div>

                    {details.skills?.length > 0 && (
                      <div>
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Skills developed</p>
                        <div className="flex flex-wrap gap-1.5">
                          {details.skills.map((s, i) => (
                            <span key={i} className="text-[10px] px-2 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20">{s}</span>
                          ))}
                        </div>
                      </div>
                    )}

                    {details.firstSteps?.length > 0 && (
                      <div>
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">First steps</p>
                        <ol className="space-y-1">
                          {details.firstSteps.map((step, i) => (
                            <li key={i} className="flex items-start gap-2 text-xs text-foreground/70">
                              <span className="flex-shrink-0 w-4 h-4 rounded-full bg-muted flex items-center justify-center text-[9px] font-bold text-muted-foreground mt-0.5">{i + 1}</span>
                              {step}
                            </li>
                          ))}
                        </ol>
                      </div>
                    )}

                    {details.deliverable && (
                      <div className="p-2.5 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
                        <p className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wider mb-1">Final deliverable</p>
                        <p className="text-xs text-foreground/70">{details.deliverable}</p>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-2 pt-3 border-t border-border/50">
              <Link
                href={`/dashboard/chat?projectId=${project.id}&trackId=${project.trackId || ''}&projectMode=explore&mode=tutoring`}
                className="flex items-center gap-1.5 text-xs font-medium text-primary hover:bg-primary/10 rounded-lg px-3 py-2 transition-colors"
              >
                <MessageCircle className="w-3.5 h-3.5" />
                Discuss with Bob
              </Link>
              <button
                onClick={handleLockIn}
                disabled={locking}
                className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg px-3 py-2 transition-colors ml-auto disabled:opacity-50"
              >
                {locking ? 'Locking…' : 'Lock In'}
                <ArrowRight className="w-3 h-3" />
              </button>
            </div>
          </CardContent>
        </div>
      </Card>
    </motion.div>
  )
}

// ── Generate Inspirations Card ───────────────────────────────────────────────

function GenerateInspirationsCard() {
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [count, setCount] = useState(0)
  const [error, setError] = useState<string | null>(null)

  async function handleGenerate() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/projects/generate-inspirations', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      setCount(data.count)
      setDone(true)
      refreshStudentData()
      setTimeout(() => setDone(false), 3000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <motion.div variants={fadeUp}>
      <button
        onClick={handleGenerate}
        disabled={loading}
        className="w-full group relative overflow-hidden rounded-xl border-2 border-dashed border-purple-500/30 bg-purple-500/5 hover:border-purple-500/60 hover:bg-purple-500/10 transition-all duration-200 p-6 text-left"
      >
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-xl bg-purple-500/20 flex items-center justify-center flex-shrink-0">
            {loading ? (
              <Loader2 className="w-5 h-5 text-purple-400 animate-spin" />
            ) : done ? (
              <Check className="w-5 h-5 text-green-400" />
            ) : (
              <Wand2 className="w-5 h-5 text-purple-400" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-semibold text-foreground text-sm">
                {done ? `${count} new inspirations added!` : 'Generate Project Inspirations'}
              </h3>
              {!loading && !done && (
                <ArrowRight className="w-3.5 h-3.5 text-purple-400 opacity-0 group-hover:opacity-100 transition-opacity -translate-x-1 group-hover:translate-x-0 duration-200" />
              )}
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {done
                ? 'Scroll down to see your new project ideas'
                : loading
                ? 'Generating ideas tailored to your curriculum and interests…'
                : 'AI generates 4 fresh project ideas based on your curriculum, interests, and learning goals'}
            </p>
            {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
          </div>
        </div>
      </button>
    </motion.div>
  )
}

// ── Create Project Card ──────────────────────────────────────────────────────

function CreateProjectCard({ tracks }: { tracks: { id: string; name: string }[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [trackId, setTrackId] = useState(tracks[0]?.id || '')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCreate() {
    if (!title.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), description: description.trim() || undefined, trackId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      refreshStudentData()
      setOpen(false)
      setTitle('')
      setDescription('')
      router.push(`/dashboard/projects/${data.project.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <motion.div variants={fadeUp}>
      <button
        onClick={() => setOpen(true)}
        className="w-full group relative overflow-hidden rounded-xl border-2 border-dashed border-primary/30 bg-primary/5 hover:border-primary/60 hover:bg-primary/10 transition-all duration-200 p-6 text-left"
      >
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center flex-shrink-0">
            <Plus className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-semibold text-foreground text-sm">Create Your Own Project</h3>
              <ArrowRight className="w-3.5 h-3.5 text-primary opacity-0 group-hover:opacity-100 transition-opacity -translate-x-1 group-hover:translate-x-0 duration-200" />
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Have your own idea? Define a custom project, link it to your curriculum, and discuss it with Bob
            </p>
          </div>
        </div>
      </button>

      {/* Create modal */}
      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
          >
            <motion.div
              className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-5"
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-foreground">Create Project</h2>
                <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1.5">Project title *</label>
                  <input
                    autoFocus
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleCreate()}
                    placeholder="e.g. Build a Caesar Cipher Visualizer"
                    className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
                  />
                </div>

                <div>
                  <label className="text-xs text-muted-foreground block mb-1.5">Description <span className="opacity-50">(optional)</span></label>
                  <textarea
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    placeholder="What do you want to build or explore?"
                    rows={3}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all resize-none"
                  />
                </div>

                {tracks.length > 1 && (
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1.5">Link to track</label>
                    <select
                      value={trackId}
                      onChange={e => setTrackId(e.target.value)}
                      className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
                    >
                      {tracks.map(t => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  </div>
                )}

                {error && <p className="text-xs text-red-400">{error}</p>}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setOpen(false)}
                  className="flex-1 px-4 py-2.5 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreate}
                  disabled={!title.trim() || submitting}
                  className="flex-1 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-40 transition-all flex items-center justify-center gap-2"
                >
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  {submitting ? 'Creating…' : 'Create Project'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function ProjectsPage() {
  const { data } = useStudentData()
  const { t: tr } = useLanguage()
  const projects = data.projects
  const tracks = (data as { tracks?: { id: string; name: string; color?: string }[] }).tracks ?? []

  // Active = in-progress or approved (status mapped to 'active')
  const activeProjects = projects.filter(p => p.status === 'active')
  // Completed
  const completedProjects = projects.filter(p => p.status === 'completed')
  // Inspirations = proposal / planning status (not yet engaged)
  const inspirationProjects = projects.filter(p => p.status === 'planning' || p.status === 'paused')

  return (
    <motion.div
      className="p-8 space-y-8 max-w-7xl"
      initial="hidden"
      animate="visible"
      variants={stagger}
    >
      {/* Header */}
      <motion.div variants={fadeUp}>
        <h1 className="text-3xl font-bold text-foreground flex items-center gap-3">
          <FolderOpen className="w-8 h-8 text-primary" />
          {tr("projects.title")}
        </h1>
        <p className="text-muted-foreground mt-1">
          {tr("projects.subtitle")}
        </p>
      </motion.div>

      {/* Action Cards — Generate Inspirations + Create Project */}
      <motion.div variants={fadeUp} className="grid md:grid-cols-2 gap-4">
        <GenerateInspirationsCard />
        <CreateProjectCard tracks={tracks} />
      </motion.div>

      {/* Section A — Active Projects */}
      {(activeProjects.length > 0 || completedProjects.length > 0) && (
        <motion.div variants={fadeUp}>
          <div className="flex items-center gap-2 mb-4">
            <Rocket className="w-4 h-4 text-green-400" />
            <h2 className="text-lg font-semibold text-foreground">Active Projects</h2>
            <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5">
              {activeProjects.length + completedProjects.length}
            </span>
          </div>

          <motion.div
            className="grid md:grid-cols-2 gap-5"
            variants={stagger}
            initial="hidden"
            animate="visible"
          >
            {activeProjects.map(project => (
              <ActiveProjectCard key={project.id} project={project} />
            ))}
            {completedProjects.map(project => (
              <ActiveProjectCard key={project.id} project={project} />
            ))}
          </motion.div>
        </motion.div>
      )}

      {/* Section B — Project Inspirations */}
      {inspirationProjects.length > 0 && (
        <motion.div variants={fadeUp}>
          <div className="flex items-center gap-2 mb-4">
            <Sparkles className="w-4 h-4 text-purple-400" />
            <h2 className="text-lg font-semibold text-foreground">Project Inspirations</h2>
            <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5">
              {inspirationProjects.length}
            </span>
          </div>

          <motion.div
            className="grid md:grid-cols-2 lg:grid-cols-3 gap-4"
            variants={stagger}
            initial="hidden"
            animate="visible"
          >
            {inspirationProjects.map(project => (
              <InspirationCard key={project.id} project={project} />
            ))}
          </motion.div>
        </motion.div>
      )}

      {/* Empty state */}
      {projects.length === 0 && (
        <motion.div variants={fadeUp} className="text-center py-16">
          <BookOpen className="w-12 h-12 text-muted-foreground mx-auto mb-3 opacity-50" />
          <p className="text-muted-foreground mb-2">No projects yet.</p>
          <p className="text-sm text-muted-foreground/70">
            Projects will appear here as your curriculum generates them.
          </p>
        </motion.div>
      )}
    </motion.div>
  )
}
