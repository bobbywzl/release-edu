'use client'
import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  ArrowLeft, Zap, Flame, BookOpen, Target, MessageSquare,
  Shield, Copy, Check, ChevronDown, ChevronRight,
  Lightbulb, FileText, FolderKanban, Award, Activity,
  User as UserIcon, Brain, ClipboardList, LockOpen, Loader2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { parseQuizState } from '@/lib/mastery'

/* eslint-disable @typescript-eslint/no-explicit-any */

function timeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return 'Never'
  const date = new Date(dateStr)
  const diff = Date.now() - date.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return date.toLocaleDateString()
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleString()
}

function parseJsonField(val: string | null | undefined): string[] {
  if (!val) return []
  try { return JSON.parse(val) } catch { return [] }
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const copy = useCallback(() => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [text])
  return (
    <button onClick={copy} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors" title="Copy">
      {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
    </button>
  )
}

function Section({ title, icon: Icon, defaultOpen = true, children }: {
  title: string; icon: any; defaultOpen?: boolean; children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <button
        className="w-full flex items-center gap-3 p-4 text-left hover:bg-accent/50 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <Icon className="w-4 h-4 text-primary flex-shrink-0" />
        <span className="font-semibold text-foreground text-sm flex-1">{title}</span>
        {open ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
      </button>
      {open && <div className="px-4 pb-4 border-t border-border pt-4">{children}</div>}
    </div>
  )
}

function InfoRow({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex justify-between items-start py-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn('text-xs text-foreground text-right max-w-[60%]', mono && 'font-mono')}>{value || '—'}</span>
    </div>
  )
}

function TagList({ items, color = 'primary' }: { items: string[]; color?: string }) {
  if (items.length === 0) return <span className="text-xs text-muted-foreground">None</span>
  const colorMap: Record<string, string> = {
    primary: 'bg-primary/10 text-primary',
    orange: 'bg-orange-400/10 text-orange-400',
    green: 'bg-emerald-400/10 text-emerald-400',
    purple: 'bg-purple-400/10 text-purple-400',
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map(i => (
        <span key={i} className={cn('text-[11px] px-2 py-0.5 rounded-full', colorMap[color] || colorMap.primary)}>{i}</span>
      ))}
    </div>
  )
}

export default function UserDetailPage() {
  const params = useParams()
  const router = useRouter()
  const userId = params.id as string

  const [user, setUser] = useState<any>(null)
  const [xpSummary, setXpSummary] = useState<any>(null)
  const [usage, setUsage] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedConvos, setExpandedConvos] = useState<Set<string>>(new Set())
  const [expandedTrees, setExpandedTrees] = useState<Set<string>>(new Set())
  useEffect(() => {
    fetch(`/api/admin/users/${userId}`)
      .then(r => {
        if (r.status === 401) { window.location.href = '/admin/login'; return null }
        return r.json()
      })
      .then(data => {
        if (!data) return
        if (data.error) { setError(data.error); setLoading(false); return }
        setUser(data.user)
        setXpSummary(data.xpSummary || null)
        setUsage(data.usage || null)
        setLoading(false)
      })
      .catch(() => { setError('Failed to load user'); setLoading(false) })
  }, [userId])

  const toggleConvo = (id: string) => {
    setExpandedConvos(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const toggleTree = (id: string) => {
    setExpandedTrees(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  if (loading) {
    return <div className="p-6 flex items-center justify-center h-64"><div className="text-muted-foreground text-sm">Loading…</div></div>
  }

  if (error || !user) {
    return (
      <div className="p-6 max-w-5xl mx-auto space-y-4">
        <button onClick={() => router.push('/admin')} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> Back to dashboard
        </button>
        <div className="text-destructive text-sm">{error || 'User not found'}</div>
      </div>
    )
  }

  const profile = user.studentProfile
  const interests = parseJsonField(profile?.interests)
  const strengths = parseJsonField(profile?.strengths)
  const weaknesses = parseJsonField(profile?.weaknesses)

  // Group insights by type
  const insightsByType: Record<string, any[]> = {}
  for (const ins of user.insights || []) {
    if (!insightsByType[ins.type]) insightsByType[ins.type] = []
    insightsByType[ins.type].push(ins)
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Back */}
      <button
        onClick={() => router.push('/admin')}
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to admin dashboard
      </button>

      {/* User Info Card */}
      <div className="bg-card border border-border rounded-xl p-6">
        <div className="flex items-start gap-4">
          {user.image ? (
            <img src={user.image} alt="" className="w-14 h-14 rounded-full" />
          ) : (
            <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center text-xl font-bold text-primary flex-shrink-0">
              {(user.name || user.email || '?')[0].toUpperCase()}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold text-foreground">{user.name || 'Unnamed'}</h1>
              <span className={cn(
                'text-[11px] font-medium px-2 py-0.5 rounded border',
                user.role === 'admin' ? 'bg-red-500/10 text-red-400 border-red-500/20' :
                user.role === 'mentor' ? 'bg-purple-500/10 text-purple-400 border-purple-500/20' :
                'bg-blue-500/10 text-blue-400 border-blue-500/20'
              )}>
                {user.role}
              </span>
            </div>
            <div className="text-sm text-muted-foreground mt-0.5">{user.email}</div>
            <div className="flex items-center gap-2 mt-1.5 text-xs text-muted-foreground font-mono">
              <span>ID: {user.id}</span>
              <CopyButton text={user.id} />
            </div>
            <div className="flex items-center gap-4 mt-3 flex-wrap">
              {xpSummary?.rank && (
                <span
                  className="flex items-center gap-1.5 text-sm px-2.5 py-1 rounded-full border"
                  style={{ color: xpSummary.rank.color, borderColor: `${xpSummary.rank.color}55`, background: `${xpSummary.rank.color}14` }}
                  title={`${xpSummary.rank.zh} · Level ${xpSummary.level}`}
                >
                  <span>{xpSummary.rank.emblem}</span>
                  <span className="font-semibold">{xpSummary.rank.en}</span>
                  <span className="text-xs opacity-80">Lv {xpSummary.level}</span>
                </span>
              )}
              {profile && (
                <>
                  <span className="flex items-center gap-1.5 text-sm">
                    <Zap className="w-4 h-4 text-yellow-400" />
                    <span className="font-semibold text-foreground">{(profile.xp || 0).toLocaleString()}</span>
                    <span className="text-muted-foreground">XP</span>
                  </span>
                  <span className="flex items-center gap-1.5 text-sm">
                    <Flame className="w-4 h-4 text-orange-400" />
                    <span className="font-semibold text-foreground">{profile.streak || 0}</span>
                    <span className="text-muted-foreground">day streak</span>
                  </span>
                  {xpSummary && (
                    <span className="flex items-center gap-1.5 text-sm" title={`Daily goal ring · day ${xpSummary.lastCheckinDay || '—'}`}>
                      <Target className="w-4 h-4 text-emerald-400" />
                      <span className="font-semibold text-foreground">{xpSummary.dailyXp}/{xpSummary.dailyGoal}</span>
                      <span className="text-muted-foreground">today</span>
                    </span>
                  )}
                </>
              )}
            </div>
          </div>
          <div className="text-right text-xs text-muted-foreground space-y-1">
            <div>Created: {formatDate(user.createdAt)}</div>
            {user.conversations?.[0] && <div>Last active: {timeAgo(user.conversations[0].updatedAt)}</div>}
          </div>
        </div>
      </div>

      {/* XP progress + learning profile (Tree EDU: rank/streak/daily goal — no legacy stage/style fields) */}
      {profile && (
        <Section title="XP Progress & Profile" icon={UserIcon}>
          <div className="grid grid-cols-2 gap-x-8 gap-y-0">
            <InfoRow label="XP" value={(profile.xp || 0).toLocaleString()} />
            <InfoRow label="Level / Rank" value={xpSummary ? `Lv ${xpSummary.level} · ${xpSummary.rank?.emblem} ${xpSummary.rank?.en}（${xpSummary.rank?.zh}）` : '—'} />
            <InfoRow label="Today's XP" value={xpSummary ? `${xpSummary.dailyXp} / ${xpSummary.dailyGoal} daily goal` : '—'} />
            <InfoRow label="Checked in today" value={xpSummary ? (xpSummary.activeToday ? '✅ Yes' : '—') : '—'} />
            <InfoRow label="Streak" value={`${profile.streak} days (best ${xpSummary?.longestStreak ?? profile.longestStreak ?? profile.streak})`} />
            <InfoRow label="Last check-in" value={xpSummary?.lastCheckinDay ? `${xpSummary.lastCheckinDay}${xpSummary.timeZone ? ` (${xpSummary.timeZone})` : ''}` : 'Never'} />
            <InfoRow label="Onboarded" value={profile.isOnboarded ? '✅ Yes' : '❌ No'} />
            <InfoRow label="Updated" value={formatDate(profile.updatedAt)} />
          </div>

          <div className="mt-4 space-y-3">
            <div>
              <span className="text-xs text-muted-foreground block mb-1.5">Interests</span>
              <TagList items={interests} />
            </div>
            <div>
              <span className="text-xs text-muted-foreground block mb-1.5">Strengths</span>
              <TagList items={strengths} color="green" />
            </div>
            <div>
              <span className="text-xs text-muted-foreground block mb-1.5">Weaknesses</span>
              <TagList items={weaknesses} color="orange" />
            </div>
          </div>
        </Section>
      )}

      {/* Badges */}
      {user.badges?.length > 0 && (
        <Section title={`Badges (${user.badges.length})`} icon={Award}>
          <div className="flex flex-wrap gap-2">
            {user.badges.map((b: any) => (
              <span
                key={b.id}
                className={cn(
                  'inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border',
                  b.tier === 'legendary' ? 'border-amber-400/40 bg-amber-400/10 text-amber-300' :
                  b.tier === 'gold' ? 'border-yellow-500/30 bg-yellow-500/10 text-yellow-300' :
                  b.tier === 'silver' ? 'border-slate-400/30 bg-slate-400/10 text-slate-300' :
                  'border-orange-800/40 bg-orange-800/10 text-orange-300'
                )}
                title={`${b.nameZh} · earned ${formatDate(b.earnedAt)}`}
              >
                <span>{b.icon}</span>
                <span className="font-medium">{b.name}</span>
                {b.featured && <span title="Featured on portfolio">★</span>}
              </span>
            ))}
          </div>
        </Section>
      )}

      {/* AI usage & cost for this user */}
      {usage && usage.events > 0 && (
        <Section title={`AI Usage (last ${usage.windowDays}d · $${usage.costUsd} · ${usage.events} calls)`} icon={Activity} defaultOpen={false}>
          <div className="space-y-2">
            {usage.byFeature.map((f: any) => (
              <div key={f.feature} className="flex items-center gap-3">
                <div className="w-44 text-xs text-foreground/70 truncate">{f.feature}</div>
                <div className="flex-1 h-2 bg-background/50 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500/60 rounded-full" style={{ width: `${Math.max(usage.costUsd > 0 ? (f.costUsd / usage.costUsd) * 100 : 0, 2)}%` }} />
                </div>
                <div className="text-xs text-emerald-400 font-medium w-16 text-right">${f.costUsd}</div>
                <div className="text-[10px] text-muted-foreground/60 w-14 text-right">{f.events}×</div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Problem Trees — the student's learning sessions */}
      {user.problemTrees?.length > 0 && (
        <Section title={`Problem Trees (${user.problemTrees.length})`} icon={FolderKanban}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {user.problemTrees.map((tree: any) => {
              const real = (tree.nodes || []).filter((n: any) => !n.pending)
              // Root is the problem statement — verification counts branches only.
              const branches = real.filter((n: any) => n.parentId)
              const understood = branches.filter((n: any) => n.status === 'understood').length
              const pending = (tree.nodes || []).length - real.length
              const cs = tree.checkpointStats
              const expanded = expandedTrees.has(tree.id)
              return (
                <div key={tree.id} className="bg-background border border-border rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className={`w-3 h-3 rounded-full flex-shrink-0 ${tree.status === 'completed' ? 'bg-emerald-400' : 'bg-primary'}`} />
                    <span className="font-medium text-foreground text-sm line-clamp-1">{tree.title}</span>
                    <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded ml-auto flex-shrink-0">{tree.status}</span>
                  </div>
                  {tree.purpose && <p className="text-xs text-emerald-300/80 mb-1 line-clamp-2">🎯 {tree.purpose}</p>}
                  {tree.framing && <p className="text-xs text-muted-foreground mb-2 line-clamp-2">{tree.framing}</p>}
                  <div className="flex gap-3 text-[11px] text-muted-foreground flex-wrap">
                    <span>{understood}/{branches.length} nodes verified</span>
                    {cs && cs.attempts > 0 && <span>checkpoints: {cs.correct}✓/{cs.attempts}</span>}
                    {pending > 0 && <span>{pending} pending approval</span>}
                    {tree.difficulty && <span>level: {tree.difficulty}</span>}
                    {tree.language && <span>lang: {tree.language}</span>}
                    {tree.hasDigest && <span>📋 digest</span>}
                  </div>
                  <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className={`h-full rounded-full ${understood === branches.length && branches.length > 0 ? 'bg-emerald-400' : 'bg-primary'}`} style={{ width: branches.length ? `${(understood / branches.length) * 100}%` : '0%' }} />
                  </div>
                  <div className="mt-1.5 flex items-center justify-between">
                    <div className="text-[10px] text-muted-foreground/60 font-mono flex items-center gap-1">
                      {tree.id} <CopyButton text={tree.id} />
                    </div>
                    <button
                      onClick={() => toggleTree(tree.id)}
                      className="text-[11px] text-primary hover:underline"
                    >
                      {expanded ? 'Hide nodes' : `Show ${(tree.nodes || []).length} nodes`}
                    </button>
                  </div>
                  {expanded && (
                    <div className="mt-2 border-t border-border pt-2 space-y-1 max-h-72 overflow-y-auto">
                      {(tree.nodes || []).map((n: any) => {
                        const qs = parseQuizState(n.quizState)
                        return (
                          <div key={n.id} className="flex items-center gap-2 text-[11px] py-0.5">
                            <span className={cn(
                              'w-2 h-2 rounded-full flex-shrink-0',
                              n.pending ? 'bg-muted-foreground/40 border border-dashed border-muted-foreground' :
                              n.status === 'understood' ? 'bg-emerald-400' :
                              qs.attempts > 0 ? 'bg-amber-400' : 'bg-muted-foreground/40'
                            )} />
                            <span className={cn('flex-1 truncate', n.pending ? 'italic text-muted-foreground' : 'text-foreground/80')}>
                              {!n.parentId && '👑 '}{n.title}
                            </span>
                            <span className="text-muted-foreground/60 flex-shrink-0">{n.kind}</span>
                            {n.pending
                              ? <span className="text-muted-foreground/60 flex-shrink-0">pending</span>
                              : qs.attempts > 0 && (
                                <span className="text-muted-foreground flex-shrink-0" title={`${qs.correct} correct / ${qs.attempts} attempts · ${qs.shortCorrect} own-words${qs.sureWrong ? ` · sure-wrong ×${qs.sureWrong}` : ''}`}>
                                  {qs.correct}✓/{qs.attempts}
                                </span>
                              )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </Section>
      )}

      {/* Conversations */}
      {user.conversations?.length > 0 && (
        <Section title={`Conversations (${user.conversations.length})`} icon={MessageSquare}>
          <div className="space-y-2">
            {user.conversations.map((conv: any) => (
              <div key={conv.id} className="border border-border rounded-lg overflow-hidden">
                <button
                  className="w-full flex items-center gap-3 p-3 text-left hover:bg-accent/50 transition-colors"
                  onClick={() => toggleConvo(conv.id)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm text-foreground">{conv.title}</span>
                      <span className="text-[10px] text-muted-foreground">{conv.messages?.length || 0} msgs</span>
                      {conv.workspace ? (
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 truncate max-w-[280px]"
                          title={`Workspace chat · tree "${conv.workspace.treeTitle}" · node "${conv.workspace.nodeTitle}"`}
                        >
                          🌳 {conv.workspace.treeTitle} › {conv.workspace.nodeTitle}
                        </span>
                      ) : conv.context ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground truncate max-w-[200px]" title={conv.context}>
                          {conv.context}
                        </span>
                      ) : null}
                    </div>
                    <div className="text-[10px] text-muted-foreground/60 font-mono flex items-center gap-1 mt-0.5">
                      {conv.id} <CopyButton text={conv.id} />
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground flex-shrink-0">{timeAgo(conv.updatedAt)}</span>
                  {expandedConvos.has(conv.id)
                    ? <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    : <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  }
                </button>
                {expandedConvos.has(conv.id) && conv.messages?.length > 0 && (
                  <div className="border-t border-border p-3 space-y-2 max-h-96 overflow-y-auto bg-background">
                    {conv.messages.map((msg: any) => (
                      <div
                        key={msg.id}
                        className={cn(
                          'rounded-lg px-3 py-2 text-xs',
                          msg.role === 'user' ? 'bg-blue-500/10 text-blue-200 ml-8' :
                          msg.role === 'assistant' ? 'bg-emerald-500/10 text-emerald-200 mr-8' :
                          'bg-muted text-muted-foreground mx-4 text-center italic'
                        )}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold text-[10px] uppercase">{msg.role}</span>
                          <span className="text-[9px] text-muted-foreground">{formatDate(msg.createdAt)}</span>
                        </div>
                        <div className="whitespace-pre-wrap break-words">{msg.content}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Insights */}
      {user.insights?.length > 0 && (
        <Section title={`Insights (${user.insights.length})`} icon={Lightbulb}>
          <div className="space-y-4">
            {Object.entries(insightsByType).map(([type, insights]) => (
              <div key={type}>
                <h4 className="text-xs font-semibold text-foreground uppercase tracking-wider mb-2 flex items-center gap-2">
                  <Brain className="w-3 h-3 text-primary" />
                  {type}
                  <span className="text-muted-foreground font-normal">({insights.length})</span>
                </h4>
                <div className="space-y-1.5">
                  {insights.map((ins: any) => (
                    <div key={ins.id} className="bg-background border border-border rounded-lg px-3 py-2 flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-foreground">{ins.content}</p>
                        <div className="flex gap-3 mt-1 text-[10px] text-muted-foreground">
                          <span>Confidence: {Math.round(ins.confidence * 100)}%</span>
                          <span>Source: {ins.source}</span>
                          <span>{timeAgo(ins.createdAt)}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Files */}
      {user.files?.length > 0 && (
        <Section title={`Files (${user.files.length})`} icon={FileText} defaultOpen={false}>
          <div className="space-y-2">
            {user.files.map((file: any) => (
              <div key={file.id} className="bg-background border border-border rounded-lg px-3 py-2 flex items-center gap-3">
                <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-foreground font-medium truncate">{file.name}</div>
                  <div className="flex gap-3 text-[10px] text-muted-foreground">
                    {file.mimeType && <span>{file.mimeType}</span>}
                    {file.workType && <span>{file.workType}</span>}
                    <span>{timeAgo(file.addedAt)}</span>
                  </div>
                </div>
                {file.url && (
                  <a href={file.url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline flex-shrink-0">
                    Open
                  </a>
                )}
                <div className="text-[9px] text-muted-foreground/60 font-mono flex items-center gap-1">
                  {file.id} <CopyButton text={file.id} />
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  )
}
