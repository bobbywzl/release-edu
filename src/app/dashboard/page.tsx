'use client'
import { useState } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import {
  ChevronRight, BookOpen, Wrench, FolderOpen, Award,
  Flame, Star, CheckCircle2, TrendingUp, BarChart3,
  Users, MessageSquare, GraduationCap, Mail, IdCard,
} from 'lucide-react'
import { Progress } from '@/components/ui/progress'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useStudentData } from '@/lib/student-data'
import { useLanguage } from '@/lib/i18n'
import { useCompletionStats } from '@/lib/completion-stats'
import { StartupGuide } from '@/components/startup-guide'
import { XpPanel } from '@/components/xp-panel'
import { STAGE_DESCRIPTIONS, getXPToNextLevel } from '@/lib/utils'

const fadeUp = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.18, ease: 'easeOut' as const } },
}
const stagger = { visible: { transition: { staggerChildren: 0.04 } } }

export default function DashboardPage() {
  const { data, loading } = useStudentData()
  const { t } = useLanguage()
  const { student: mockStudent, knowledgeNodes: mockKnowledgeNodes, projectModules: mockProjectModules, coreModules: mockCoreModules, projects: mockProjects, isOnboarded } = data
  const [showGuide, setShowGuide] = useState(true)

  // Redirect logic lives in dashboard/layout.tsx (single source of truth).
  const { stats: completionStats, loading: statsLoading } = useCompletionStats()
  const xpProgress = getXPToNextLevel(mockStudent.xp)

  // Curriculum progress
  // Foundation = core/foundation tracks; Project-Based = interest/project tracks
  // Use completionStats (DB-backed, same source as top-level 7% stat)
  const foundationTracks = completionStats?.foundationTracks ?? []
  const interestTracks2 = completionStats?.interestTracks ?? []

  const coreCompleted = foundationTracks.reduce((s, t) => s + t.completed, 0)
  const coreTotal = foundationTracks.reduce((s, t) => s + t.total, 0)
  const coreProgress = coreTotal > 0
    ? Math.round(foundationTracks.reduce((s, t) => s + t.progress * t.total, 0) / coreTotal)
    : 0

  const projectCompleted = interestTracks2.reduce((s, t) => s + t.completed, 0)
  const projectTotal = interestTracks2.reduce((s, t) => s + t.total, 0)
  const projectProgress = projectTotal > 0
    ? Math.round(interestTracks2.reduce((s, t) => s + t.progress * t.total, 0) / projectTotal)
    : 0

  // Active projects
  const activeProjects = mockProjects.filter(p => p.status === 'active')

  // Progress stats
  const overallProgress = completionStats?.overall.progress ?? 0
  const completedChapters = completionStats?.overall.completed ?? 0
  const totalChapters = completionStats?.overall.total ?? 0
  const completedProjects = completionStats?.overall.completedProjects ?? 0
  const totalProjects = completionStats?.overall.totalProjects ?? 0

  // XP + streak moved into the richer XpPanel above the stats row.
  const stats = [
    {
      label: t('dashboard.progress'),
      value: `${overallProgress}%`,
      sub: `${completedChapters} / ${totalChapters} ${t('dashboard.chaptersComplete')}`,
      href: '/dashboard/curriculum',
    },
    {
      label: t('dashboard.projectsLabel'),
      value: `${completedProjects}/${totalProjects}`,
      sub: t('dashboard.projectsComplete'),
      href: '/dashboard/projects',
    },
    {
      label: t('common.level'),
      value: String(mockStudent.level),
      sub: `${(xpProgress.needed - xpProgress.current).toLocaleString()} ${t('dashboard.toNext')}`,
      href: '/dashboard',
    },
  ]

  // Time-of-day greeting
  const hour = typeof window !== 'undefined' ? new Date().getHours() : 12
  const greeting = hour < 12 ? t('dashboard.goodMorning') : hour < 18 ? t('dashboard.goodAfternoon') : t('dashboard.goodEvening')
  const firstName = mockStudent.name?.split(' ')[0] || ''
  const showSkeletonHeader = loading && !firstName

  return (
    <motion.div
      className="p-8 lg:p-12 max-w-3xl space-y-10"
      initial="hidden"
      animate="visible"
      variants={stagger}
    >
      {/* Welcome */}
      <motion.div variants={fadeUp} className="space-y-1">
        {showSkeletonHeader ? (
          <>
            <div className="h-9 w-72 bg-muted/40 rounded animate-pulse" />
            <div className="h-4 w-96 max-w-full bg-muted/30 rounded mt-2 animate-pulse" />
          </>
        ) : (
          <>
            <h1 className="text-3xl font-bold text-foreground">
              {firstName ? `${greeting}, ${firstName}` : `${greeting}`}
            </h1>
            <p className="text-muted-foreground">{STAGE_DESCRIPTIONS[mockStudent.stage]}</p>
          </>
        )}
      </motion.div>

      {/* Startup guide for new users */}
      {!isOnboarded && showGuide && (
        <StartupGuide onDismiss={() => setShowGuide(false)} />
      )}

      {/* XP / streak / daily-goal / badges — the daily-return loop */}
      <motion.div variants={fadeUp}>
        <XpPanel />
      </motion.div>

      {/* Core stats */}
      <motion.div variants={fadeUp} className="grid grid-cols-3 gap-4">
        {showSkeletonHeader
          ? [0, 1, 2].map(i => (
              <div key={i} className="border border-border/50 rounded-lg p-5 space-y-2">
                <div className="h-7 w-16 bg-muted/40 rounded animate-pulse" />
                <div className="h-3 w-20 bg-muted/30 rounded animate-pulse" />
                <div className="h-3 w-32 bg-muted/20 rounded animate-pulse" />
              </div>
            ))
          : stats.map(stat => (
              <Link key={stat.label} href={stat.href} className="block">
                <div className="border border-border/50 rounded-lg p-5 hover:border-border transition-colors">
                  <div className="text-2xl font-bold text-foreground leading-none">{stat.value}</div>
                  <div className="text-xs text-muted-foreground mt-2">{stat.label}</div>
                  <div className="text-[11px] text-muted-foreground/60 mt-0.5">{stat.sub}</div>
                </div>
              </Link>
            ))}
      </motion.div>

      {/* Curriculum Progress */}
      <motion.div variants={fadeUp}>
        <Link href="/dashboard/curriculum" className="block">
          <div className="border border-border/50 rounded-lg p-5 hover:border-border transition-colors space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">{t("dashboard.curriculumProgress")}</h2>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </div>

            {/* Foundation / Core (20%) */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <BookOpen className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-xs text-foreground">{t("dashboard.foundation")}</span>
                  <span className="text-[10px] text-muted-foreground">· mandated curriculum (20%)</span>
                </div>
                <span className="text-xs font-medium text-foreground">{coreProgress}%</span>
              </div>
              <Progress value={coreProgress} className="h-2" />
              <p className="text-[10px] text-muted-foreground">{coreCompleted} of {coreTotal} chapters complete</p>
            </div>

            {/* Project-Based (80%) */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Wrench className="w-3.5 h-3.5 text-blue-400" />
                  <span className="text-xs text-foreground">{t("dashboard.projectBased")}</span>
                  <span className="text-[10px] text-muted-foreground">· applied learning (80%)</span>
                </div>
                <span className="text-xs font-medium text-foreground">{projectProgress}%</span>
              </div>
              <Progress value={projectProgress} className="h-2" />
              <p className="text-[10px] text-muted-foreground">{projectCompleted} of {projectTotal} chapters complete</p>
            </div>
          </div>
        </Link>
      </motion.div>

      {/* Active Projects */}
      {activeProjects.length > 0 && (
        <motion.div variants={fadeUp} className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <FolderOpen className="w-4 h-4 text-muted-foreground" />
              Active Projects
            </h2>
            <Link href="/dashboard/projects" className="text-[11px] text-muted-foreground hover:text-foreground transition-colors">
              View all →
            </Link>
          </div>
          <div className="space-y-2">
            {activeProjects.slice(0, 3).map(p => (
              <Link key={p.id} href={`/dashboard/projects/${p.id}`} className="block">
                <div className="border border-border/50 rounded-lg p-4 hover:border-border transition-colors">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-foreground">{p.title}</span>
                    <span className="text-xs text-muted-foreground">{p.progress}%</span>
                  </div>
                  <Progress value={p.progress} className="h-1.5" />
                </div>
              </Link>
            ))}
          </div>
        </motion.div>
      )}

      {/* Portfolio Card */}
      <motion.div variants={fadeUp}>
        <Link href="/dashboard/portfolio" className="block">
          <div className="border border-border/50 rounded-lg p-5 hover:border-border transition-colors">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Award className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-foreground">{t("dashboard.aiPortfolio")}</h2>
                  <p className="text-[11px] text-muted-foreground">Generate a professional profile for universities & employers</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </div>
          </div>
        </Link>
      </motion.div>

      {/* Primary CTA */}
      <motion.div variants={fadeUp}>
        <Link href="/dashboard/chat">
          <button className="flex items-center gap-2 bg-primary text-primary-foreground rounded-lg px-6 py-3 text-sm font-medium hover:bg-primary/90 transition-colors">
            {t("dashboard.continueLearning")}
            <ChevronRight className="w-4 h-4" />
          </button>
        </Link>
      </motion.div>

      {/* ── Progress Section ── */}
      <motion.div variants={fadeUp} className="pt-4 border-t border-border space-y-6">
        {/* Section header */}
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-primary" />
              {t("dashboard.yourProgress")}
            </h2>
            <p className="text-muted-foreground text-sm mt-0.5">
              Competency-based mastery across all learning domains
            </p>
          </div>
          <div className="flex items-center gap-2 bg-orange-500/10 border border-orange-500/20 rounded-xl px-4 py-2">
            <Flame className="w-5 h-5 text-orange-400" />
            <span className="font-bold text-orange-400">{mockStudent.streak}</span>
            <span className="text-sm text-orange-400/80">day streak</span>
          </div>
        </div>

        {/* Overall progress + milestones row */}
        <div className="grid md:grid-cols-2 gap-4">
          {/* Overall progress */}
          <Card className="bg-card border-border">
            <CardContent className="p-5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-foreground">{t("dashboard.overallProgress")}</span>
                <span className="text-2xl font-bold text-primary">{overallProgress}%</span>
              </div>
              <Progress value={overallProgress} className="h-3" />
              <p className="text-xs text-muted-foreground">
                {completedChapters} of {totalChapters} chapters
                {totalProjects > 0 && ` · ${completedProjects} of ${totalProjects} project${totalProjects > 1 ? 's' : ''}`} completed
              </p>
            </CardContent>
          </Card>

          {/* Next milestones */}
          <Card className="bg-card border-border">
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp className="w-4 h-4 text-green-400" />
                <span className="text-sm font-semibold text-foreground">{t("dashboard.nextMilestones")}</span>
              </div>
              <div className="space-y-2">
                {totalChapters > 0 && completedChapters < totalChapters && (
                  <div className="flex items-start gap-2">
                    <Star className="w-3.5 h-3.5 text-primary mt-0.5 flex-shrink-0" />
                    <div>
                      <div className="text-xs font-medium text-foreground">
                        {completedChapters === 0 ? 'Complete your first chapter' : `Complete ${Math.min(completedChapters + 5, totalChapters)} chapters`}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {totalChapters - completedChapters} remaining
                      </div>
                    </div>
                  </div>
                )}
                {mockStudent.streak < 7 && (
                  <div className="flex items-start gap-2">
                    <Star className="w-3.5 h-3.5 text-amber-400 mt-0.5 flex-shrink-0" />
                    <div>
                      <div className="text-xs font-medium text-foreground">7-Day Streak</div>
                      <div className="text-[10px] text-muted-foreground">{7 - mockStudent.streak} more days</div>
                    </div>
                  </div>
                )}
                {mockStudent.streak >= 7 && mockStudent.streak < 30 && (
                  <div className="flex items-start gap-2">
                    <Star className="w-3.5 h-3.5 text-amber-400 mt-0.5 flex-shrink-0" />
                    <div>
                      <div className="text-xs font-medium text-foreground">30-Day Streak</div>
                      <div className="text-[10px] text-muted-foreground">{30 - mockStudent.streak} more days</div>
                    </div>
                  </div>
                )}
                {completedChapters >= totalChapters && totalChapters > 0 && (
                  <div className="flex items-start gap-2">
                    <Star className="w-3.5 h-3.5 text-emerald-400 mt-0.5 flex-shrink-0" />
                    <div>
                      <div className="text-xs font-medium text-emerald-400">All chapters complete! 🎉</div>
                      <div className="text-[10px] text-muted-foreground">Ask Bob in Logistics & Curriculum mode for new courses</div>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Course Mastery */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              {t("dashboard.courseMastery")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {statsLoading && (
              <div className="space-y-3 animate-pulse">
                {[1, 2, 3].map(i => <div key={i} className="h-8 bg-muted rounded" />)}
              </div>
            )}
            {!statsLoading && (!completionStats || completionStats.tracks.length === 0) && (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No courses yet.{' '}
                <Link href="/dashboard/curriculum" className="text-primary hover:underline">
                  Set up your curriculum
                </Link>
                {' '}to see progress here.
              </p>
            )}

            {/* Interest-Based Courses */}
            {completionStats && completionStats.interestTracks.length > 0 && (
              <div className="space-y-3">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Interest-Based</h4>
                {completionStats.interestTracks.map(track => (
                  <div key={track.trackId}>
                    <div className="flex justify-between items-center mb-1.5">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: track.trackColor }} />
                        <span className="text-sm font-medium text-foreground">{track.trackName}</span>
                      </div>
                      <div className="flex items-center gap-3 text-sm">
                        <span className="text-muted-foreground">
                          {track.completed}/{track.total} ch
                          {(track as { hasProject?: boolean; projectCompleted?: boolean }).hasProject && (
                            <span className={`ml-1.5 text-[10px] px-1 py-0.5 rounded ${(track as { projectCompleted?: boolean }).projectCompleted ? 'bg-emerald-500/15 text-emerald-400' : 'bg-muted text-muted-foreground'}`}>
                              {(track as { projectCompleted?: boolean }).projectCompleted ? '✓ project' : 'project pending'}
                            </span>
                          )}
                        </span>
                        <span className="font-semibold text-foreground w-10 text-right">{track.progress}%</span>
                      </div>
                    </div>
                    <Progress
                      value={track.progress}
                      className="h-2.5"
                      // @ts-ignore
                      indicatorStyle={{ backgroundColor: track.trackColor }}
                    />
                  </div>
                ))}
              </div>
            )}

            {/* Foundation Courses */}
            {completionStats && completionStats.foundationTracks.length > 0 && (
              <div className="space-y-3">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t("dashboard.foundation")}</h4>
                {completionStats.foundationTracks.map(track => (
                  <div key={track.trackId}>
                    <div className="flex justify-between items-center mb-1.5">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: track.trackColor }} />
                        <span className="text-sm font-medium text-foreground">{track.trackName}</span>
                      </div>
                      <div className="flex items-center gap-3 text-sm">
                        <span className="text-muted-foreground">{track.completed}/{track.total} chapters</span>
                        <span className="font-semibold text-foreground w-10 text-right">{track.progress}%</span>
                      </div>
                    </div>
                    <Progress
                      value={track.progress}
                      className="h-2.5"
                      // @ts-ignore
                      indicatorStyle={{ backgroundColor: track.trackColor }}
                    />
                  </div>
                ))}
              </div>
            )}

            {/* Completed Chapters */}
            {completionStats && completionStats.completedChapters.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-border">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Completed Chapters</h4>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {completionStats.completedChapters.map(ch => (
                    <div key={ch.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                      <CheckCircle2 className="w-3 h-3 text-emerald-400 flex-shrink-0" />
                      <span className="text-foreground">{ch.title}</span>
                      <span className="text-muted-foreground/60">· {ch.trackName}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* ── People & Feedback Section ── */}
      <motion.div variants={fadeUp} className="pt-4 border-t border-border space-y-6">
        {/* Section header */}
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Users className="w-5 h-5 text-primary" />
            People &amp; Feedback
          </h2>
          <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
            Coming Soon
          </span>
        </div>

        {/* Mentor & Parent cards */}
        <div className="grid md:grid-cols-2 gap-4">
          {/* Mentor card */}
          <Card className="bg-card border-border">
            <CardContent className="p-5">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-purple-500/20 flex items-center justify-center text-purple-400 font-bold text-sm flex-shrink-0">
                  {((mockStudent as any).mentorName || 'M')[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-foreground">{(mockStudent as any).mentorName || 'No mentor assigned'}</span>
                    <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400 border border-purple-500/20">
                      Mentor
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-1">
                    <Mail className="w-3 h-3 text-muted-foreground/60 flex-shrink-0" />
                    <span className="text-xs text-muted-foreground/60 truncate">{(mockStudent as any).mentorEmail || '—'}</span>
                  </div>
                  <p className="text-xs text-muted-foreground/50 mt-2 italic">No messages yet.</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Parent card */}
          <Card className="bg-card border-border">
            <CardContent className="p-5">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-500/40 font-bold text-sm flex-shrink-0 border border-dashed border-emerald-500/20">
                  ?
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-muted-foreground">{(mockStudent as any).parentName || 'Parent not connected'}</span>
                    <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-500/50 border border-emerald-500/20">
                      Parent
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-1">
                    <Mail className="w-3 h-3 text-muted-foreground/30 flex-shrink-0" />
                    <span className="text-xs text-muted-foreground/30">—</span>
                  </div>
                  <p className="text-xs text-muted-foreground/40 mt-2 italic">Invite a parent to connect.</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Class Information */}
        <Card className="bg-card border-border">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-4">
              <GraduationCap className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-semibold text-foreground">Class Information</span>
            </div>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground/60 uppercase tracking-wider">Class</div>
                <div className="text-sm font-medium text-muted-foreground">—</div>
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-center gap-1">
                  <IdCard className="w-3 h-3 text-muted-foreground/60" />
                  <span className="text-xs text-muted-foreground/60 uppercase tracking-wider">Student ID</span>
                </div>
                <div className="text-sm font-medium text-foreground font-mono">{mockStudent.id ? mockStudent.id.slice(-8).toUpperCase() : 'RE-00001'}</div>
              </div>
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground/60 uppercase tracking-wider">Enrolled</div>
                <div className="text-sm font-medium text-muted-foreground">—</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Communications feed */}
        <Card className="bg-card border-border">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-4">
              <MessageSquare className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-semibold text-foreground">Messages</span>
              <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground ml-1">
                Read-only
              </span>
            </div>

            {/* Empty state */}
            <div className="rounded-lg border border-dashed border-border/60 bg-muted/20 px-6 py-10 text-center space-y-2">
              <MessageSquare className="w-6 h-6 text-muted-foreground/30 mx-auto" />
              <p className="text-sm text-muted-foreground/60">No messages yet.</p>
              <p className="text-xs text-muted-foreground/40 max-w-xs mx-auto">
                Your Mentor and Parent will be able to send you feedback here. Mentor messages will appear in{' '}
                <span className="text-purple-400/70">purple</span>, Parent messages in{' '}
                <span className="text-emerald-400/70">green</span>.
              </p>
            </div>

            {/* Example message skeletons (visual preview) */}
            <div className="mt-4 space-y-3 opacity-30 pointer-events-none select-none" aria-hidden>
              {/* Mentor sample */}
              <div className="flex items-start gap-2.5">
                <div className="w-6 h-6 rounded-full bg-purple-500/30 flex items-center justify-center text-[10px] font-bold text-purple-400 flex-shrink-0 mt-0.5">R</div>
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-purple-400">{(mockStudent as any).mentorName || 'Mentor'}</span>
                    <span className="text-[10px] px-1.5 py-px rounded bg-purple-500/15 text-purple-400 border border-purple-500/20">Mentor</span>
                    <span className="text-[10px] text-muted-foreground/40">just now</span>
                  </div>
                  <div className="bg-purple-500/5 border border-purple-500/10 rounded-lg px-3 py-2">
                    <div className="h-2.5 bg-purple-500/20 rounded w-3/4 mb-1.5" />
                    <div className="h-2.5 bg-purple-500/20 rounded w-1/2" />
                  </div>
                </div>
              </div>
              {/* Parent sample */}
              <div className="flex items-start gap-2.5">
                <div className="w-6 h-6 rounded-full bg-emerald-500/30 flex items-center justify-center text-[10px] font-bold text-emerald-400 flex-shrink-0 mt-0.5">P</div>
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-emerald-400">Parent</span>
                    <span className="text-[10px] px-1.5 py-px rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">Parent</span>
                    <span className="text-[10px] text-muted-foreground/40">yesterday</span>
                  </div>
                  <div className="bg-emerald-500/5 border border-emerald-500/10 rounded-lg px-3 py-2">
                    <div className="h-2.5 bg-emerald-500/20 rounded w-2/3" />
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  )
}
