'use client'
import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import {
  Shield, Users, MessageSquare, Lightbulb, Search,
  ChevronUp, ChevronDown, Settings2, Zap, Flame,
  CheckCircle2, XCircle, ArrowUpDown, Activity, DollarSign, Cpu,
  BarChart3, Trash2, Loader2,
} from 'lucide-react'
import { cn } from '@/lib/utils'

/* eslint-disable @typescript-eslint/no-explicit-any */

type SortKey = 'name' | 'email' | 'role' | 'xp' | 'streak' | 'tracks' | 'conversations' | 'insights' | 'onboarded' | 'createdAt'
type SortDir = 'asc' | 'desc'

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

function roleBadge(role: string) {
  const styles: Record<string, string> = {
    student: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    mentor: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
    admin: 'bg-red-500/10 text-red-400 border-red-500/20',
  }
  return (
    <span className={cn('text-[10px] font-medium px-1.5 py-0.5 rounded border', styles[role] || styles.student)}>
      {role}
    </span>
  )
}

interface UserUsage {
  userId: string
  name: string | null
  email: string | null
  image: string | null
  tokens: number
  inputTokens: number
  outputTokens: number
  costUsd: number
  events: number
}

interface TokenStats {
  totalEvents: number
  totalInputTokens: number
  totalOutputTokens: number
  totalCacheReadTokens: number
  totalCacheWriteTokens: number
  totalTokens: number
  totalCostUsd: number
  projectedMonthlyUsd: number
  windowDays: number
  byModel: { model: string; provider: string; tokens: number; input: number; output: number; cacheRead: number; cacheWrite: number; costUsd: number; events: number }[]
  byFeature: { feature: string; tokens: number; costUsd: number; events: number }[]
  byProvider: { provider: string; tokens: number; costUsd: number }[]
  daily: { day: string; costUsd: number; tokens: number; events: number }[]
  perUser: UserUsage[]
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toString()
}

function formatUsd(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(2)}k`
  if (n >= 1) return `$${n.toFixed(2)}`
  if (n > 0 && n < 0.01) return `<$0.01`
  return `$${n.toFixed(3)}`
}

const FEATURE_LABELS: Record<string, string> = {
  tutoring: 'Tutoring chat', chapter: 'Lesson sessions', onboarding: 'Onboarding',
  research: 'Research (Gemini)', reflection: 'Reflection blocks', insight: 'Insight extraction',
  title: 'Title generation', curriculum: 'Curriculum gen', quiz: 'Quiz eval',
  capstone: 'Capstone eval', compaction: 'Chat compaction', image: 'Image/file analysis',
  portfolio: 'Portfolio', project: 'Projects', other: 'Other',
}

export default function AdminDashboardPage() {
  const [users, setUsers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('createdAt')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [tokenStats, setTokenStats] = useState<TokenStats | null>(null)
  const [tokenStatsLoading, setTokenStatsLoading] = useState(true)
  // Per-row action state: the userId currently being mutated, and any banner msg.
  const [busyId, setBusyId] = useState<string | null>(null)
  const [actionMsg, setActionMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  async function loadUsers() {
    try {
      const r = await fetch('/api/admin/users')
      if (r.status === 401 || r.status === 403) { window.location.href = '/admin/login'; return }
      const data = await r.json()
      setUsers(data.users || [])
    } catch {
      setError('Failed to load users')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadUsers()
    fetch('/api/admin/stats')
      .then(r => { if (!r.ok) throw new Error(); return r.json() })
      .then(data => { setTokenStats(data); setTokenStatsLoading(false) })
      .catch(() => setTokenStatsLoading(false))
  }, [])

  async function changeRole(user: any, role: string) {
    if (role === user.role) return
    setBusyId(user.id); setActionMsg(null)
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_role', role }),
      })
      const data = await res.json()
      if (!res.ok) { setActionMsg({ kind: 'err', text: data.error || 'Failed to change role' }); return }
      setActionMsg({ kind: 'ok', text: `${user.name || user.email || 'User'} → ${role}` })
      await loadUsers()
    } catch {
      setActionMsg({ kind: 'err', text: 'Request failed' })
    } finally {
      setBusyId(null)
    }
  }

  async function deleteUser(user: any) {
    const label = user.name || user.email || user.id
    if (!confirm(`Permanently delete "${label}" and ALL their data (curriculum, conversations, progress)?\n\nThis cannot be undone.`)) return
    setBusyId(user.id); setActionMsg(null)
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) { setActionMsg({ kind: 'err', text: data.error || 'Failed to delete' }); return }
      setActionMsg({ kind: 'ok', text: `Deleted ${label}` })
      await loadUsers()
    } catch {
      setActionMsg({ kind: 'err', text: 'Request failed' })
    } finally {
      setBusyId(null)
    }
  }

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const filtered = useMemo(() => {
    let result = users
    if (search) {
      const q = search.toLowerCase()
      result = result.filter(u =>
        (u.name || '').toLowerCase().includes(q) ||
        (u.email || '').toLowerCase().includes(q) ||
        u.id.toLowerCase().includes(q)
      )
    }
    result = [...result].sort((a, b) => {
      let av: any, bv: any
      switch (sortKey) {
        case 'name': av = (a.name || '').toLowerCase(); bv = (b.name || '').toLowerCase(); break
        case 'email': av = (a.email || '').toLowerCase(); bv = (b.email || '').toLowerCase(); break
        case 'role': av = a.role; bv = b.role; break
        case 'xp': av = a.studentProfile?.xp || 0; bv = b.studentProfile?.xp || 0; break
        case 'streak': av = a.studentProfile?.streak || 0; bv = b.studentProfile?.streak || 0; break
        case 'tracks': av = a._count?.tracks || 0; bv = b._count?.tracks || 0; break
        case 'conversations': av = a._count?.conversations || 0; bv = b._count?.conversations || 0; break
        case 'insights': av = a._count?.insights || 0; bv = b._count?.insights || 0; break
        case 'onboarded': av = a.studentProfile?.isOnboarded ? 1 : 0; bv = b.studentProfile?.isOnboarded ? 1 : 0; break
        case 'createdAt': av = new Date(a.createdAt).getTime(); bv = new Date(b.createdAt).getTime(); break
      }
      if (av < bv) return sortDir === 'asc' ? -1 : 1
      if (av > bv) return sortDir === 'asc' ? 1 : -1
      return 0
    })
    return result
  }, [users, search, sortKey, sortDir])

  // Stats
  const totalConversations = users.reduce((s, u) => s + (u._count?.conversations || 0), 0)
  const totalInsights = users.reduce((s, u) => s + (u._count?.insights || 0), 0)
  const today = new Date().toDateString()
  const activeToday = users.filter(u =>
    u.conversations?.some((c: any) => new Date(c.updatedAt).toDateString() === today)
  ).length
  const onboardedCount = users.filter(u => u.studentProfile?.isOnboarded).length
  const onboardedPct = users.length > 0 ? Math.round((onboardedCount / users.length) * 100) : 0

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ArrowUpDown className="w-3 h-3 opacity-30" />
    return sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Shield className="w-7 h-7 text-red-400" />
          <div>
            <h1 className="text-2xl font-bold text-foreground">Admin Dashboard</h1>
            <p className="text-sm text-muted-foreground">{users.length} users · {totalConversations} conversations · {totalInsights} insights</p>
          </div>
        </div>
        <div className="flex gap-3">
          <Link
            href="/admin/ai-config"
            className="flex items-center gap-2 bg-card hover:bg-accent border border-border text-foreground rounded-lg px-4 py-2 text-sm font-medium transition-colors"
          >
            <Settings2 className="w-4 h-4" />
            AI Config
          </Link>
          <Link
            href="/admin/conversations"
            className="flex items-center gap-2 bg-card hover:bg-accent border border-border text-foreground rounded-lg px-4 py-2 text-sm font-medium transition-colors"
          >
            <MessageSquare className="w-4 h-4" />
            Conversations
          </Link>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        {[
          { icon: Users, label: 'Total Users', value: loading ? '—' : users.length, color: 'text-blue-400' },
          { icon: Zap, label: 'Active Today', value: loading ? '—' : activeToday, color: 'text-green-400' },
          { icon: MessageSquare, label: 'Total Conversations', value: loading ? '—' : totalConversations, color: 'text-purple-400' },
          { icon: Lightbulb, label: 'Total Insights', value: loading ? '—' : totalInsights, color: 'text-yellow-400' },
          { icon: CheckCircle2, label: 'Onboarded', value: loading ? '—' : `${onboardedPct}%`, color: 'text-emerald-400' },
        ].map(stat => (
          <div key={stat.label} className="bg-card border border-border rounded-xl p-4">
            <stat.icon className={cn('w-5 h-5 mb-2', stat.color)} />
            <div className="text-2xl font-bold text-foreground">{stat.value}</div>
            <div className="text-xs text-muted-foreground mt-1">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* AI Cost & Usage */}
      <div className="bg-card border border-border rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <DollarSign className="w-5 h-5 text-emerald-400" />
          <h2 className="text-lg font-semibold text-foreground">AI Cost &amp; Usage</h2>
          {tokenStats && <span className="text-xs text-muted-foreground ml-1">· last {tokenStats.windowDays}d · real $ from live telemetry</span>}
          {tokenStatsLoading && <span className="text-xs text-muted-foreground ml-2">Loading…</span>}
        </div>

        {tokenStats && tokenStats.totalEvents > 0 ? (
          <>
            {/* Headline cards */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
              {[
                { label: `Total cost (${tokenStats.windowDays}d)`, value: formatUsd(tokenStats.totalCostUsd), icon: DollarSign, color: 'text-emerald-400' },
                { label: 'Projected / month', value: formatUsd(tokenStats.projectedMonthlyUsd), icon: BarChart3, color: 'text-amber-400' },
                { label: 'Total tokens', value: formatTokens(tokenStats.totalTokens), icon: Activity, color: 'text-purple-400' },
                { label: 'Input tokens', value: formatTokens(tokenStats.totalInputTokens), icon: Cpu, color: 'text-blue-400' },
                { label: 'Output tokens', value: formatTokens(tokenStats.totalOutputTokens), icon: Cpu, color: 'text-green-400' },
                { label: 'Cache read (saved)', value: formatTokens(tokenStats.totalCacheReadTokens), icon: Activity, color: 'text-cyan-400' },
              ].map(stat => (
                <div key={stat.label} className="bg-background/50 border border-border/50 rounded-lg p-3">
                  <stat.icon className={cn('w-4 h-4 mb-1', stat.color)} />
                  <div className="text-lg font-bold text-foreground">{stat.value}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">{stat.label}</div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
              {/* By model */}
              <div>
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Cost by model</h3>
                <div className="space-y-2">
                  {tokenStats.byModel.map(m => {
                    const pct = tokenStats.totalCostUsd > 0 ? (m.costUsd / tokenStats.totalCostUsd * 100) : 0
                    return (
                      <div key={m.model} className="flex items-center gap-3">
                        <div className="w-40 text-xs font-mono text-foreground/70 truncate" title={`${m.model} (${m.provider})`}>{m.model}</div>
                        <div className="flex-1 h-2 bg-background/50 rounded-full overflow-hidden">
                          <div className="h-full bg-emerald-500/60 rounded-full" style={{ width: `${Math.max(pct, 1)}%` }} />
                        </div>
                        <div className="text-xs text-emerald-400 font-medium w-16 text-right">{formatUsd(m.costUsd)}</div>
                        <div className="text-[10px] text-muted-foreground/60 w-20 text-right">{formatTokens(m.tokens)} · {m.events}×</div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* By feature */}
              <div>
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Cost by feature</h3>
                <div className="space-y-2">
                  {tokenStats.byFeature.map(f => {
                    const pct = tokenStats.totalCostUsd > 0 ? (f.costUsd / tokenStats.totalCostUsd * 100) : 0
                    return (
                      <div key={f.feature} className="flex items-center gap-3">
                        <div className="w-36 text-xs text-foreground/70 truncate" title={f.feature}>{FEATURE_LABELS[f.feature] || f.feature}</div>
                        <div className="flex-1 h-2 bg-background/50 rounded-full overflow-hidden">
                          <div className="h-full bg-purple-500/60 rounded-full" style={{ width: `${Math.max(pct, 1)}%` }} />
                        </div>
                        <div className="text-xs text-purple-300 font-medium w-16 text-right">{formatUsd(f.costUsd)}</div>
                        <div className="text-[10px] text-muted-foreground/60 w-12 text-right">{f.events}×</div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* Daily cost */}
            {tokenStats.daily.length > 0 && (
              <div>
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Daily cost (recent)</h3>
                <div className="flex items-end gap-1 h-24">
                  {tokenStats.daily.slice(-21).map(d => {
                    const maxCost = Math.max(...tokenStats.daily.map(x => x.costUsd), 0.0001)
                    const height = (d.costUsd / maxCost) * 100
                    return (
                      <div key={d.day} className="flex-1 flex flex-col items-center gap-1">
                        <div
                          className="w-full bg-emerald-500/40 rounded-t hover:bg-emerald-500/70 transition-colors cursor-default min-h-[2px]"
                          style={{ height: `${Math.max(height, 3)}%` }}
                          title={`${d.day}: ${formatUsd(d.costUsd)} · ${formatTokens(d.tokens)} tokens · ${d.events} calls`}
                        />
                        <span className="text-[8px] text-muted-foreground/50">{d.day.slice(5)}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </>
        ) : tokenStats ? (
          <p className="text-sm text-muted-foreground/70 text-center py-6 leading-relaxed">
            No usage recorded yet. Telemetry captures every AI call (chat, onboarding, research, generation,
            background tasks) going forward — numbers appear here as soon as the app is used.
          </p>
        ) : !tokenStatsLoading ? (
          <p className="text-sm text-muted-foreground text-center py-4">Could not load usage stats.</p>
        ) : null}
      </div>

      {/* Cost by User */}
      {tokenStats && tokenStats.perUser.length > 0 && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-border flex items-center gap-2">
            <Users className="w-5 h-5 text-blue-400" />
            <h2 className="text-lg font-semibold text-foreground">Cost by User</h2>
            <span className="text-xs text-muted-foreground ml-auto">{tokenStats.perUser.length} with usage</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-4 py-3 font-medium">User</th>
                  <th className="px-4 py-3 font-medium text-right">Calls</th>
                  <th className="px-4 py-3 font-medium text-right">Input</th>
                  <th className="px-4 py-3 font-medium text-right">Output</th>
                  <th className="px-4 py-3 font-medium text-right">Total tokens</th>
                  <th className="px-4 py-3 font-medium text-right">Cost</th>
                  <th className="px-4 py-3 font-medium w-32">Share</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {tokenStats.perUser.map(u => {
                  const pct = tokenStats.totalCostUsd > 0 ? (u.costUsd / tokenStats.totalCostUsd * 100) : 0
                  return (
                    <tr key={u.userId} className="hover:bg-accent/50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          {u.image ? (
                            <img src={u.image} alt="" className="w-6 h-6 rounded-full" />
                          ) : (
                            <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-semibold text-primary">
                              {(u.name || u.email || '?')[0].toUpperCase()}
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="font-medium text-foreground text-xs truncate">{u.name || 'Unnamed'}</div>
                            <div className="text-[10px] text-muted-foreground/60 truncate">{u.email || '—'}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right text-muted-foreground tabular-nums">{u.events}</td>
                      <td className="px-4 py-3 text-right text-muted-foreground tabular-nums">{formatTokens(u.inputTokens)}</td>
                      <td className="px-4 py-3 text-right text-muted-foreground tabular-nums">{formatTokens(u.outputTokens)}</td>
                      <td className="px-4 py-3 text-right font-medium text-foreground tabular-nums">{formatTokens(u.tokens)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        <span className={cn('font-medium', u.costUsd >= 1 ? 'text-amber-400' : 'text-emerald-400')}>{formatUsd(u.costUsd)}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-background/50 rounded-full overflow-hidden">
                            <div className="h-full bg-emerald-500/50 rounded-full" style={{ width: `${Math.max(pct, 2)}%` }} />
                          </div>
                          <span className="text-[10px] text-muted-foreground/60 w-8 text-right">{pct.toFixed(0)}%</span>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search by name, email, or ID…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full bg-card border border-border rounded-lg pl-10 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </div>

      {/* Action result banner */}
      {actionMsg && (
        <div className={cn(
          'rounded-lg border px-4 py-2.5 text-sm flex items-center justify-between',
          actionMsg.kind === 'ok'
            ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
            : 'bg-red-500/10 border-red-500/20 text-red-300'
        )}>
          <span>{actionMsg.text}</span>
          <button onClick={() => setActionMsg(null)} className="text-xs opacity-60 hover:opacity-100">Dismiss</button>
        </div>
      )}

      {/* User Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-muted-foreground text-sm">Loading users…</div>
        ) : error ? (
          <div className="p-12 text-center text-destructive text-sm">{error}</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground text-sm">
            {search ? 'No users match your search.' : 'No users found.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  {([
                    ['name', 'User'],
                    ['email', 'Email'],
                    ['role', 'Role'],
                    ['xp', 'XP'],
                    ['streak', 'Streak'],
                    ['tracks', 'Tracks'],
                    ['conversations', 'Convos'],
                    ['insights', 'Insights'],
                    ['onboarded', 'Onboarded'],
                    ['createdAt', 'Joined'],
                  ] as [SortKey, string][]).map(([key, label]) => (
                    <th
                      key={key}
                      className="px-4 py-3 font-medium cursor-pointer hover:text-foreground transition-colors select-none"
                      onClick={() => toggleSort(key)}
                    >
                      <div className="flex items-center gap-1">
                        {label}
                        <SortIcon col={key} />
                      </div>
                    </th>
                  ))}
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((user: any) => (
                  <tr
                    key={user.id}
                    className="hover:bg-accent/50 transition-colors cursor-pointer"
                    onClick={() => window.location.href = `/admin/students/${user.id}`}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {user.image ? (
                          <img src={user.image} alt="" className="w-7 h-7 rounded-full" />
                        ) : (
                          <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary">
                            {(user.name || user.email || '?')[0].toUpperCase()}
                          </div>
                        )}
                        <div>
                          <div className="font-medium text-foreground">{user.name || 'Unnamed'}</div>
                          <div className="text-[10px] text-muted-foreground/60 font-mono">{user.id}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{user.email}</td>
                    <td className="px-4 py-3">{roleBadge(user.role)}</td>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-1">
                        <Zap className="w-3 h-3 text-yellow-400" />
                        {(user.studentProfile?.xp || 0).toLocaleString()}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-1">
                        <Flame className="w-3 h-3 text-orange-400" />
                        {user.studentProfile?.streak || 0}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        {user.tracks?.slice(0, 3).map((t: any) => (
                          <div
                            key={t.id}
                            className="w-2.5 h-2.5 rounded-full"
                            style={{ backgroundColor: t.color }}
                            title={t.name}
                          />
                        ))}
                        <span className="text-muted-foreground ml-1">{user._count?.tracks || 0}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{user._count?.conversations || 0}</td>
                    <td className="px-4 py-3 text-muted-foreground">{user._count?.insights || 0}</td>
                    <td className="px-4 py-3">
                      {user.studentProfile?.isOnboarded ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <XCircle className="w-4 h-4 text-muted-foreground/40" />
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{timeAgo(user.createdAt)}</td>
                    <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-2">
                        {busyId === user.id ? (
                          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                        ) : (
                          <>
                            <select
                              value={user.role}
                              onChange={e => changeRole(user, e.target.value)}
                              className="bg-background border border-border rounded-md px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40 cursor-pointer"
                              title="Change role / access"
                            >
                              <option value="student">student</option>
                              <option value="mentor">mentor</option>
                              <option value="admin">admin</option>
                            </select>
                            <button
                              onClick={() => deleteUser(user)}
                              className="p-1.5 rounded-md text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
                              title="Delete account (permanent)"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
