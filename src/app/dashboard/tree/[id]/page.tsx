'use client'
/**
 * The interactive problem tree.
 *
 * GRAPH VIEW — a living, hand-drawn tree: root on the ground, cursive
 * branches sweeping upward, bud nodes that breathe. Nodes float in and
 * settle on first load, and can be dragged freely (branches follow live,
 * Obsidian-style). Pending (AI-proposed) nodes are dashed ghosts with
 * approve/reject — the tree only grows with the student's permission.
 *
 * LIST VIEW — the same tree as a searchable, collapsible list ordered by
 * distance from the root; each item lazily loads the node's full workspace
 * record: conversation, notes, annotations, files, and project-progress
 * flags.
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import ReactFlow, {
  Background, Controls, Handle, Position, ReactFlowProvider, useReactFlow, useNodesState,
  type Node as FlowNode, type Edge as FlowEdge, type NodeProps, type EdgeProps,
} from 'reactflow'
import 'reactflow/dist/style.css'
import {
  ArrowLeft, Check, X, Sprout, MessageSquare, ShieldCheck, Loader2, Bot,
  Search, ChevronDown, ChevronRight, Trash2, Plus, FileText, Flag, List, Network,
} from 'lucide-react'
import { MarkdownRenderer } from '@/components/markdown-renderer'
import { TreeCopilot } from '@/components/tree-copilot'
import { useLanguage } from '@/lib/i18n'
import { cn } from '@/lib/utils'

interface TreeNodeData {
  id: string
  parentId: string | null
  kind: string
  title: string
  summary: string
  status: string
  pending: boolean
  explainer: string | null
  notes: string | null
  annotations: string | null
  progressLog: string | null
  // IKEA-effect attribution: 'seed' | 'copilot' | 'question' | 'manual'
  // (null on nodes predating the column).
  origin?: string | null
  createdAt?: string
  updatedAt?: string
  // Ghost adoption plan (insert-a-layer): JSON {adopt: [ids]}.
  pendingPlan?: string | null
}

interface TreeData {
  id: string
  title: string
  displayTitle?: string | null
  framing: string | null
  status: string
  nodes: TreeNodeData[]
}

function parseArr<T>(str: string | null | undefined): T[] {
  if (!str) return []
  try { const v = JSON.parse(str); return Array.isArray(v) ? v : [] } catch { return [] }
}

// ── Organic tree layout — grows UPWARD, hand-drawn feel ─────────────────
// Vertical and branching: tight horizontal packing, tall levels, and
// depth-scaled scatter so levels never read as flat rows.
const Y_GAP = 235
const X_GAP = 185
const NODE_W = 190

// Deterministic pseudo-random in [-1, 1] from a string.
function jitter(id: string, salt: number): number {
  let h = salt
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  return ((h % 1000) / 1000) * 2 - (h % 2 === 0 ? 1 : 0.9)
}

function layoutTree(nodes: TreeNodeData[]): { pos: Map<string, { x: number; y: number }>; depth: Map<string, number> } {
  const byParent = new Map<string | null, TreeNodeData[]>()
  for (const n of nodes) {
    const k = n.parentId ?? null
    if (!byParent.has(k)) byParent.set(k, [])
    byParent.get(k)!.push(n)
  }
  byParent.forEach(list => list.sort((a: TreeNodeData, b: TreeNodeData) => (a.pending === b.pending ? 0 : a.pending ? 1 : -1)))
  const pos = new Map<string, { x: number; y: number }>()
  const depthMap = new Map<string, number>()
  let nextSlot = 0
  const place = (node: TreeNodeData, depth: number): number => {
    depthMap.set(node.id, depth)
    const children = byParent.get(node.id) ?? []
    let x: number
    if (children.length === 0) {
      x = nextSlot * X_GAP
      nextSlot += 1
    } else {
      const xs = children.map(c => place(c, depth + 1))
      x = (Math.min(...xs) + Math.max(...xs)) / 2
    }
    // Organic drift, growing with depth — branches wander like real wood.
    const dx = depth === 0 ? 0 : jitter(node.id, 7) * (26 + depth * 10)
    const dy = depth === 0 ? 0 : jitter(node.id, 13) * (18 + depth * 22)
    pos.set(node.id, { x: x + dx, y: -depth * Y_GAP + dy })
    return x
  }
  for (const root of byParent.get(null) ?? []) place(root, 0)
  return { pos, depth: depthMap }
}

/** BFS depth order for the list view. */
function depthOrder(nodes: TreeNodeData[]): Array<{ node: TreeNodeData; depth: number }> {
  const { depth } = layoutTree(nodes)
  return nodes
    .map(node => ({ node, depth: depth.get(node.id) ?? 0 }))
    .sort((a, b) => a.depth - b.depth || a.node.title.localeCompare(b.node.title))
}

// ── Cursive branch edge — a swept cubic curve, thick at the trunk ───────
function BranchEdge({ id, sourceX, sourceY, targetX, targetY, data, style }: EdgeProps<{ depth?: number; pending?: boolean }>) {
  const depth = data?.depth ?? 2
  const bow = jitter(id, 3) * 55 + (targetX - sourceX) * 0.22
  const midY = (sourceY + targetY) / 2
  const path = `M ${sourceX} ${sourceY} C ${sourceX + bow} ${midY + 22}, ${targetX - bow * 0.55} ${midY - 22}, ${targetX} ${targetY}`
  const width = Math.max(1.4, 5.5 - depth * 1.3)
  return (
    <path
      d={path}
      fill="none"
      stroke={style?.stroke as string ?? 'hsl(var(--primary))'}
      strokeWidth={width}
      strokeLinecap="round"
      strokeDasharray={data?.pending ? '6 7' : undefined}
      opacity={data?.pending ? 0.45 : 0.7}
      className={data?.pending ? 'branch-pending' : undefined}
    />
  )
}

const edgeTypes = { branch: BranchEdge }

// ── Custom node — a living bud on the branch tip, label beneath ─────────

const DOT_FILL: Record<string, string> = {
  root: 'bg-primary shadow-[0_0_18px_hsl(var(--primary)/0.55)]',
  solution: 'bg-violet-400 shadow-[0_0_14px_rgba(167,139,250,0.5)]',
  component: 'bg-sky-400 shadow-[0_0_12px_rgba(56,189,248,0.45)]',
  leaf: 'bg-teal-300 shadow-[0_0_12px_rgba(94,234,212,0.45)]',
}
const DOT_SIZE: Record<string, string> = {
  root: 'w-7 h-7',
  solution: 'w-5 h-5',
  component: 'w-4 h-4',
  leaf: 'w-3.5 h-3.5',
}

function StatusDot({ status }: { status: string }) {
  const { t } = useLanguage()
  if (status === 'understood') return <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 flex-shrink-0" title={t('status.understood')} />
  if (status === 'learning') return <span className="w-2.5 h-2.5 rounded-full bg-amber-400 flex-shrink-0" title={t('status.learning')} />
  return <span className="w-2.5 h-2.5 rounded-full bg-muted-foreground/40 flex-shrink-0" title={t('status.notUnderstood')} />
}

interface FlowNodeData {
  node: TreeNodeData
  onApprove: (id: string) => void
  onReject: (id: string) => void
  approveLabel: string
}

function PainPointNode({ data, selected }: NodeProps<FlowNodeData>) {
  const n = data.node
  const breatheDelay = `${(Math.abs(jitter(n.id, 5)) * 3).toFixed(2)}s`
  const breatheDur = `${(3 + Math.abs(jitter(n.id, 9)) * 2).toFixed(2)}s`
  // Insert-a-layer ghosts announce their adoption: approving re-parents
  // this many existing branches under them.
  const adoptCount = (() => {
    if (!n.pending || !n.pendingPlan) return 0
    try {
      const plan = JSON.parse(n.pendingPlan) as { adopt?: unknown[] }
      return Array.isArray(plan?.adopt) ? plan.adopt.length : 0
    } catch { return 0 }
  })()
  return (
    <div className="flex flex-col items-center" style={{ width: NODE_W }}>
      <Handle type="source" position={Position.Top} className="!opacity-0 !pointer-events-none !w-1 !h-1" style={{ top: 10 }} />
      <Handle type="target" position={Position.Bottom} className="!opacity-0 !pointer-events-none !w-1 !h-1" style={{ top: 14, bottom: 'auto' }} />

      <div className="h-7 flex items-center justify-center">
        <span
          className={cn(
            'rounded-full transition-transform',
            DOT_SIZE[n.kind] ?? DOT_SIZE.component,
            // VERIFIED reads as SETTLED: solid fill, firm border, no glow, no
            // breathing — done, at rest. Everything unfinished stays alive
            // (glow + breathe): the living tips of the tree still calling for
            // work. The contrast is the at-a-glance progress read.
            n.pending
              ? 'node-breathe bg-transparent border-2 border-dashed border-muted-foreground/70 shadow-none'
              : n.status === 'understood'
                ? 'bg-emerald-500 border-2 border-emerald-300/70 shadow-none'
                : n.status === 'learning'
                  ? 'node-breathe bg-amber-400 shadow-[0_0_14px_rgba(251,191,36,0.55)]'
                  : cn('node-breathe', DOT_FILL[n.kind] ?? DOT_FILL.component),
            selected && 'scale-125 ring-2 ring-foreground/70 ring-offset-2 ring-offset-background',
          )}
          style={n.status === 'understood' && !n.pending ? undefined : { animationDelay: breatheDelay, animationDuration: breatheDur }}
        />
      </div>

      <div className="mt-1 text-center select-none">
        <p className={cn('text-[12px] font-bold leading-tight', n.pending ? 'text-muted-foreground italic' : 'text-foreground')}>
          {n.title}
        </p>
        <p className="text-[10px] text-muted-foreground/80 leading-snug line-clamp-2 mt-0.5 max-w-[180px] mx-auto">
          {n.summary}
        </p>
      </div>

      {n.pending && (
        /* Effort anchor (contrast effect): a ghost is a ~15-minute add, not
           an unbounded commitment — approving reads as a small step. */
        <div className="flex flex-col items-center gap-1 mt-1.5">
          {adoptCount > 0 && (
            <span className="text-[9px] text-emerald-300/90 font-medium">
              {`⤵ ${adoptCount}`}
            </span>
          )}
          <div className="flex items-center gap-1.5">
          <span className="text-[9px] text-muted-foreground/80">≈15 min</span>
          <button
            onClick={e => { e.stopPropagation(); data.onApprove(n.id) }}
            className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 text-[10px] font-medium px-2.5 py-0.5 hover:bg-emerald-500/30 transition-colors"
          >
            <Check className="w-3 h-3" /> {data.approveLabel}
          </button>
          <button
            onClick={e => { e.stopPropagation(); data.onReject(n.id) }}
            className="inline-flex items-center justify-center rounded-full bg-red-500/15 border border-red-400/30 text-red-300 px-2 py-0.5 hover:bg-red-500/25 transition-colors"
          >
            <X className="w-3 h-3" />
          </button>
          </div>
        </div>
      )}
    </div>
  )
}

const nodeTypes = { painPoint: PainPointNode }

// ── List view — the tree as a searchable, depth-ordered record ──────────

interface NodeRecord {
  messages?: Array<{ id: string; role: string; content: string }>
  files?: Array<{ id: string; name: string }>
  loading: boolean
}

function ListView({ tree, onChanged }: { tree: TreeData; onChanged: () => void }) {
  const { t } = useLanguage()
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [records, setRecords] = useState<Record<string, NodeRecord>>({})
  const [ghostBusy, setGhostBusy] = useState<string | null>(null)

  const ordered = useMemo(() => depthOrder(tree.nodes.filter(n => !n.pending)), [tree.nodes])
  // Proposals must be visible and actionable HERE too — the list is the
  // tree's only workable view on a phone, and invisible ghosts read as
  // "growing did nothing".
  const pendingByParent = useMemo(() => {
    const m = new Map<string, TreeData['nodes']>()
    for (const n of tree.nodes) {
      if (n.pending && n.parentId) {
        if (!m.has(n.parentId)) m.set(n.parentId, [])
        m.get(n.parentId)!.push(n)
      }
    }
    return m
  }, [tree.nodes])

  async function actGhost(nodeId: string, action: 'approve' | 'reject') {
    if (ghostBusy) return
    setGhostBusy(nodeId)
    try {
      await fetch(`/api/tree/${tree.id}/node/${nodeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      }).catch(() => null)
      onChanged()
    } finally {
      setGhostBusy(null)
    }
  }
  const q = query.trim().toLowerCase()
  const filtered = q
    ? ordered.filter(({ node }) =>
        node.title.toLowerCase().includes(q)
        || node.summary.toLowerCase().includes(q)
        || (node.notes ?? '').toLowerCase().includes(q))
    : ordered

  async function toggle(nodeId: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(nodeId)) { next.delete(nodeId); return next }
      next.add(nodeId)
      return next
    })
    if (!records[nodeId] && !expanded.has(nodeId)) {
      setRecords(prev => ({ ...prev, [nodeId]: { loading: true } }))
      const [chat, files] = await Promise.all([
        fetch(`/api/tree/${tree.id}/node/${nodeId}/chat`, { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).catch(() => null),
        fetch(`/api/files/upload?workType=tree-node&workId=${nodeId}`, { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).catch(() => null),
      ])
      setRecords(prev => ({
        ...prev,
        [nodeId]: { loading: false, messages: chat?.messages ?? [], files: files?.files ?? [] },
      }))
    }
  }

  let lastDepth = -1

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto p-4 lg:p-6 space-y-3">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t('tree.searchPlaceholder')}
            className="w-full bg-background border border-border rounded-xl pl-9 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>

        {filtered.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">{t('tree.searchEmpty')}</p>
        )}

        {filtered.map(({ node, depth }) => {
          const showHeader = depth !== lastDepth
          lastDepth = depth
          const isOpen = expanded.has(node.id)
          const rec = records[node.id]
          const annotations = parseArr<{ text: string; createdAt: string }>(node.annotations)
          const progress = parseArr<{ text: string; source: string; createdAt: string }>(node.progressLog)
          return (
            <div key={node.id}>
              {showHeader && !q && (
                <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mt-4 mb-2">
                  {depth === 0 ? t('tree.levelRoot') : `${t('tree.levelLabel')} ${depth}`}
                </p>
              )}
              <div className="border border-border rounded-xl bg-card overflow-hidden">
                <button
                  onClick={() => toggle(node.id)}
                  className="w-full flex items-center gap-2.5 px-3.5 py-3 text-left hover:bg-accent/50 transition-colors"
                >
                  {isOpen ? <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
                  <StatusDot status={node.status} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-foreground truncate">{node.title}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{node.summary}</p>
                  </div>
                  {progress.length > 0 && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-emerald-300 flex-shrink-0" title={t('tree.progressFlags')}>
                      <Flag className="w-3 h-3" /> {progress.length}
                    </span>
                  )}
                  <span className="text-[10px] text-muted-foreground/60 uppercase flex-shrink-0">{node.kind}</span>
                </button>

                {isOpen && (
                  <div className="border-t border-border px-4 py-3 space-y-4 bg-background/40">
                    {node.parentId === null ? null : (
                      <Link
                        href={`/dashboard/workspace?tree=${tree.id}&node=${node.id}`}
                        className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
                      >
                        <MessageSquare className="w-3.5 h-3.5" /> {t('tree.openWorkspace')}
                      </Link>
                    )}

                    {/* Project progress flags */}
                    {progress.length > 0 && (
                      <div>
                        <p className="text-[11px] font-bold text-emerald-300 uppercase tracking-wider mb-1.5 flex items-center gap-1"><Flag className="w-3 h-3" /> {t('tree.progressFlags')}</p>
                        <div className="space-y-1">
                          {progress.map((p, i) => (
                            <p key={i} className="text-xs text-foreground/90 border-l-2 border-emerald-400/60 bg-emerald-400/[0.06] rounded-r-md px-2.5 py-1.5">
                              {p.text}
                              <span className="block text-[10px] text-muted-foreground/60 mt-0.5">{new Date(p.createdAt).toLocaleDateString()} · {p.source}</span>
                            </p>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Notes */}
                    {node.notes && (
                      <div>
                        <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">{t('workspace.tabNotes')}</p>
                        <div className="text-xs border border-border rounded-lg p-2.5 bg-card/60"><MarkdownRenderer content={node.notes} /></div>
                      </div>
                    )}

                    {/* Annotations */}
                    {annotations.length > 0 && (
                      <div>
                        <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">{t('workspace.annotations')}</p>
                        <div className="space-y-1">
                          {annotations.map((a, i) => (
                            <p key={i} className="text-xs text-foreground/90 border-l-2 border-amber-400/60 bg-amber-400/[0.06] rounded-r-md px-2.5 py-1.5">{a.text}</p>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Files */}
                    {rec?.files && rec.files.length > 0 && (
                      <div>
                        <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">{t('workspace.files')}</p>
                        <div className="space-y-1">
                          {rec.files.map(f => (
                            <p key={f.id} className="text-xs text-foreground flex items-center gap-1.5">
                              <FileText className="w-3.5 h-3.5 text-muted-foreground" /> {f.name}
                            </p>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Full conversation */}
                    <div>
                      <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">{t('tree.listConversation')}</p>
                      {rec?.loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
                      {!rec?.loading && (!rec?.messages || rec.messages.length === 0) && (
                        <p className="text-xs text-muted-foreground">{t('tree.listNoConversation')}</p>
                      )}
                      <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                        {rec?.messages?.map(m => (
                          <div
                            key={m.id}
                            className={cn(
                              'rounded-xl px-3 py-2 text-[13px]',
                              m.role === 'user' ? 'bg-primary/10 border border-primary/20 ml-6' : 'bg-card border border-border mr-6',
                            )}
                          >
                            {m.role === 'user'
                              ? <p className="whitespace-pre-wrap text-foreground/90">{m.content}</p>
                              : <MarkdownRenderer content={m.content} />}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Pending proposals under this node — approve/dismiss inline */}
              {(pendingByParent.get(node.id) ?? []).map(ghost => (
                <div key={ghost.id} className="mt-1.5 ml-6 border border-dashed border-primary/40 rounded-xl bg-primary/[0.04] px-3.5 py-2.5 flex items-center gap-2.5">
                  <Sprout className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-foreground truncate">
                      {ghost.title} <span className="text-[10px] font-normal text-primary">· {t('tree.awaitingApproval')}</span>
                    </p>
                    <p className="text-[11px] text-muted-foreground truncate">{ghost.summary}</p>
                  </div>
                  {ghostBusy === ghost.id ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground flex-shrink-0" />
                  ) : (
                    <>
                      <button
                        onClick={() => actGhost(ghost.id, 'approve')}
                        className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors flex-shrink-0"
                      >
                        <Check className="w-3 h-3" /> {t('tree.addToTree')}
                      </button>
                      <button
                        onClick={() => actGhost(ghost.id, 'reject')}
                        className="p-1 rounded-md text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors flex-shrink-0"
                        title={t('common.dismiss')}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────

function TreeCanvasInner() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const { t, language } = useLanguage()
  const flow = useReactFlow()
  const [tree, setTree] = useState<TreeData | null>(null)
  const [view, setView] = useState<'graph' | 'list'>('graph')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Panel-level failure note (approve/reject/add-child) — growth conversations
  // themselves live ONLY in the Tree Copilot now.
  const [panelNote, setPanelNote] = useState<string | null>(null)
  const [addingChild, setAddingChild] = useState(false)
  const [childTitle, setChildTitle] = useState('')
  const [childSummary, setChildSummary] = useState('')
  const [settling, setSettling] = useState(true)
  const settledRef = useRef(false)
  const draggedPos = useRef<Map<string, { x: number; y: number }>>(new Map())
  // Parent/children maps for the drag constraint below.
  const relRef = useRef<{ parent: Map<string, string | null>; children: Map<string, string[]> }>({ parent: new Map(), children: new Map() })

  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNodeData>([])

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/tree/${params.id}`, { cache: 'no-store' })
      if (res.status === 404) { router.push('/dashboard/tree'); return }
      if (res.ok) setTree((await res.json()).tree)
    } catch { /* transient */ }
  }, [params.id, router])
  useEffect(() => { load() }, [load])
  // Clear the panel note when the selection changes.
  useEffect(() => { setPanelNote(null) }, [selectedId])

  const act = useCallback(async (nodeId: string, action: 'approve' | 'reject') => {
    const res = await fetch(`/api/tree/${params.id}/node/${nodeId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    }).catch(() => null)
    // Surface failure instead of a ghost silently vanishing on reload — a
    // 404 means the proposal was already replaced/handled elsewhere.
    if (!res || !res.ok) setPanelNote(t('tree.actionFailed'))
    load()
  }, [params.id, load, t])

  useEffect(() => {
    if (!tree) return
    const parent = new Map<string, string | null>()
    const children = new Map<string, string[]>()
    for (const n of tree.nodes) {
      parent.set(n.id, n.parentId)
      if (n.parentId) {
        if (!children.has(n.parentId)) children.set(n.parentId, [])
        children.get(n.parentId)!.push(n.id)
      }
    }
    relRef.current = { parent, children }
  }, [tree])

  // Branch physics while dragging:
  // - HIERARCHY is inviolable: the dragged node stays above its parent.
  // - STRING TENSION: the dragged node strains against its parent's string
  //   (max length) and cannot be pulled further.
  // - SHAPE-PRESERVING FOLLOW: at drag start we freeze each descendant's
  //   offset relative to the dragged node; while dragging, the whole
  //   subtree glides to keep those offsets (with a soft lag for a natural,
  //   flexible feel). The subtree's internal shape never collapses.
  const MIN_LEVEL_GAP = 110
  const MAX_STRING = 400
  const FOLLOW = 0.5 // per-event blend toward the rigid target (the lag)
  const dragCtx = useRef<{ id: string; offsets: Map<string, { dx: number; dy: number }> } | null>(null)

  const collectDescendants = useCallback((rootId: string): string[] => {
    const out: string[] = []
    const queue = [rootId]
    while (queue.length) {
      const cur = queue.shift()!
      for (const kid of relRef.current.children.get(cur) ?? []) {
        out.push(kid)
        queue.push(kid)
      }
    }
    return out
  }, [])

  const onNodeDragStart = useCallback((_: unknown, node: FlowNode) => {
    const positions = new Map(flow.getNodes().map(n => [n.id, n.position]))
    const base = positions.get(node.id)
    if (!base) return
    const offsets = new Map<string, { dx: number; dy: number }>()
    for (const d of collectDescendants(node.id)) {
      const p = positions.get(d)
      if (p) offsets.set(d, { dx: p.x - base.x, dy: p.y - base.y })
    }
    dragCtx.current = { id: node.id, offsets }
  }, [flow, collectDescendants])

  const onNodeDragStop = useCallback(() => {
    // Snap the trailing subtree onto its exact rigid targets so the shape
    // lands perfectly translated.
    const ctx = dragCtx.current
    dragCtx.current = null
    if (!ctx) return
    const positions = new Map(flow.getNodes().map(n => [n.id, n.position]))
    const base = positions.get(ctx.id)
    if (!base) return
    setNodes(nds => nds.map(n => {
      const off = ctx.offsets.get(n.id)
      if (!off) return n
      const target = { x: base.x + off.dx, y: base.y + off.dy }
      draggedPos.current.set(n.id, target)
      return { ...n, position: target }
    }))
  }, [flow, setNodes])

  const handleNodesChange: typeof onNodesChange = useCallback(changes => {
    const current = new Map(flow.getNodes().map(n => [n.id, { ...n.position }]))
    const extraMoves = new Map<string, { x: number; y: number }>()

    for (const c of changes) {
      if (c.type === 'position' && c.position) {
        // The dragged node strains against its parent's string.
        const pid = relRef.current.parent.get(c.id)
        const pp = pid ? current.get(pid) : undefined
        if (pp) {
          c.position.y = Math.min(c.position.y, pp.y - MIN_LEVEL_GAP)
          const dx = c.position.x - pp.x
          const dy = c.position.y - pp.y
          const dist = Math.hypot(dx, dy)
          if (dist > MAX_STRING) {
            const k = MAX_STRING / dist
            c.position.x = pp.x + dx * k
            c.position.y = Math.min(pp.y + dy * k, pp.y - MIN_LEVEL_GAP)
          }
        }
        draggedPos.current.set(c.id, c.position)

        // Shape-preserving follow: every descendant eases toward
        // (dragged position + its frozen offset).
        const ctx = dragCtx.current
        if (ctx && ctx.id === c.id) {
          ctx.offsets.forEach((off, id) => {
            const cur = current.get(id)
            if (!cur) return
            const target = { x: c.position!.x + off.dx, y: c.position!.y + off.dy }
            const next = {
              x: cur.x + (target.x - cur.x) * FOLLOW,
              y: cur.y + (target.y - cur.y) * FOLLOW,
            }
            current.set(id, next)
            extraMoves.set(id, next)
            draggedPos.current.set(id, next)
          })
        }
      }
    }
    onNodesChange(changes)
    if (extraMoves.size > 0) {
      setNodes(nds => nds.map(n => (extraMoves.has(n.id) ? { ...n, position: extraMoves.get(n.id)! } : n)))
    }
  }, [flow, onNodesChange, setNodes])

  // Build flow nodes from the tree. First load: float in scattered, then
  // settle into place (CSS transition while `settling`).
  useEffect(() => {
    if (!tree) return
    const { pos, depth } = layoutTree(tree.nodes)
    const target = (n: TreeNodeData) => draggedPos.current.get(n.id) ?? pos.get(n.id) ?? { x: 0, y: 0 }
    const mk = (n: TreeNodeData, p: { x: number; y: number }): FlowNode<FlowNodeData> => ({
      id: n.id,
      type: 'painPoint',
      position: p,
      data: {
        node: n,
        onApprove: id => act(id, 'approve'),
        onReject: id => act(id, 'reject'),
        approveLabel: t('tree.addToTree'),
      },
    })

    if (!settledRef.current) {
      settledRef.current = true
      // Scatter → settle. The scatter is deterministic so replays feel alive
      // but never chaotic.
      setNodes(tree.nodes.map(n => mk(n, {
        x: (pos.get(n.id)?.x ?? 0) + jitter(n.id, 21) * 340,
        y: (pos.get(n.id)?.y ?? 0) + jitter(n.id, 33) * 260,
      })))
      setTimeout(() => {
        setNodes(tree.nodes.map(n => mk(n, target(n))))
        setTimeout(() => {
          setSettling(false)
          // Mount-time fitView ran before the organic layout settled, which
          // left first-run trees as a tiny corner cluster — refit now so the
          // tree greets the user centered and readable.
          setTimeout(() => { try { flow.fitView({ padding: 0.25, maxZoom: 1.5, duration: 500 }) } catch { /* non-critical */ } }, 30)
        }, 950)
      }, 60)
    } else {
      setNodes(tree.nodes.map(n => mk(n, target(n))))
    }
    void depth
  }, [tree, act, t, setNodes])

  const flowEdges = useMemo(() => {
    if (!tree) return [] as FlowEdge[]
    const { depth } = layoutTree(tree.nodes)
    return tree.nodes
      .filter(n => n.parentId)
      .map(n => ({
        id: `e-${n.parentId}-${n.id}`,
        source: n.parentId!,
        target: n.id,
        type: 'branch',
        data: { depth: depth.get(n.id) ?? 2, pending: n.pending },
        style: { stroke: n.pending ? 'hsl(var(--muted-foreground))' : 'hsl(var(--primary))' },
      }))
  }, [tree])

  const selected = tree?.nodes.find(n => n.id === selectedId) ?? null
  const selectedProgress = parseArr<{ text: string; createdAt: string }>(selected?.progressLog)
  // Root (the problem statement) is excluded — progress measures the
  // branches a learner can actually verify, so 100% is reachable.
  const understood = tree?.nodes.filter(n => !n.pending && n.parentId !== null && n.status === 'understood').length ?? 0
  const total = tree?.nodes.filter(n => !n.pending && n.parentId !== null).length ?? 0

  async function addChild() {
    if (!selected || !childTitle.trim() || addingChild) return
    setAddingChild(true)
    try {
      const res = await fetch(`/api/tree/${params.id}/node/${selected.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add_child', title: childTitle.trim(), summary: childSummary.trim() }),
      }).catch(() => null)
      if (!res || !res.ok) {
        // Keep the typed title/summary for retry — clearing on failure
        // silently loses the student's content.
        setPanelNote(t('tree.actionFailed'))
        return
      }
      setChildTitle('')
      setChildSummary('')
      await load()
    } finally {
      setAddingChild(false)
    }
  }

  async function deleteNode() {
    if (!selected || selected.parentId === null) return
    if (!confirm(t('tree.deleteNodeConfirm'))) return
    await fetch(`/api/tree/${params.id}/node/${selected.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete' }),
    }).catch(() => {})
    setSelectedId(null)
    await load()
  }

  if (!tree) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-primary animate-spin" />
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border bg-card/50 backdrop-blur-sm">
        <Link href="/dashboard/tree" className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <Sprout className="w-4 h-4 text-emerald-400 flex-shrink-0" />
        <h1 title={tree.title} className="text-sm font-bold text-foreground truncate flex-1">{tree.displayTitle || tree.title}</h1>
        {/* View toggle */}
        <div className="flex rounded-lg border border-border overflow-hidden flex-shrink-0">
          <button
            onClick={() => setView('graph')}
            className={cn('px-2.5 py-1.5 text-xs font-medium flex items-center gap-1.5 transition-colors', view === 'graph' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground')}
          >
            <Network className="w-3.5 h-3.5" /> {t('tree.viewGraph')}
          </button>
          <button
            onClick={() => setView('list')}
            className={cn('px-2.5 py-1.5 text-xs font-medium flex items-center gap-1.5 transition-colors', view === 'list' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground')}
          >
            <List className="w-3.5 h-3.5" /> {t('tree.viewList')}
          </button>
        </div>
        {/* Memory-decay nudge (honest loss aversion): a verified node
            untouched for 7+ days is genuinely fading — retrieval decays.
            One tap opens its workspace in review mode. */}
        {(() => {
          const fading = (tree?.nodes ?? [])
            .filter(n => !n.pending && n.parentId !== null && n.status === 'understood' && n.updatedAt
              && Date.now() - new Date(n.updatedAt).getTime() > 7 * 86_400_000)
            .sort((a, b) => new Date(a.updatedAt!).getTime() - new Date(b.updatedAt!).getTime())[0]
          return fading && tree ? (
            <button
              onClick={() => router.push(`/dashboard/workspace?tree=${tree.id}&node=${fading.id}&review=1`)}
              className="hidden md:inline-flex items-center gap-1.5 max-w-[260px] px-2.5 py-1.5 rounded-lg border border-amber-400/40 bg-amber-500/10 text-amber-300 text-[11px] font-medium hover:bg-amber-500/20 transition-colors"
              title={t('tree.fadingHint')}
            >
              <span className="truncate">{t('tree.fadingNudge').replace('{title}', fading.title)}</span>
            </button>
          ) : null
        })()}
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Goal gradient: no zero bar — the meter appears with the first
              verified node instead of announcing "you haven't started". */}
          {understood > 0 ? (
            <>
              <div className="w-28 h-1.5 rounded-full bg-muted overflow-hidden">
                <div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: total ? `${(understood / total) * 100}%` : '0%' }} />
              </div>
              <span className="text-[11px] text-muted-foreground tabular-nums">{understood}/{total}</span>
            </>
          ) : (
            <span className="text-[11px] text-muted-foreground tabular-nums">{total > 0 ? t('tree.nodesReady').replace('{n}', String(total)) : ''}</span>
          )}
        </div>
      </div>

      {view === 'list' ? (
        <div className="flex-1 min-h-0">
          <ListView tree={tree} onChanged={load} />
        </div>
      ) : (
        <div className="flex-1 flex min-h-0">
          <div className={cn('flex-1 min-w-0 relative', settling && 'tree-settling')}>
            <ReactFlow
              nodes={nodes}
              edges={flowEdges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodesChange={handleNodesChange}
              onNodeDragStart={onNodeDragStart}
              onNodeDragStop={onNodeDragStop}
              onNodeClick={(_, node) => setSelectedId(node.id)}
              onPaneClick={() => setSelectedId(null)}
              fitView
              fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
              minZoom={0.15}
              proOptions={{ hideAttribution: true }}
              nodesDraggable
              nodesConnectable={false}
            >
              <Background gap={24} size={1} />
              <Controls showInteractive={false} />
            </ReactFlow>
            {/* The ground the tree grows from */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-emerald-500/[0.08] to-transparent" />
            {/* First-run guidance — nothing else on this screen says what a
                node IS or what to do; disappears once any node is verified. */}
            {tree && tree.nodes.some(n => !n.pending) && tree.nodes.filter(n => !n.pending).every(n => n.status !== 'understood') && (
              <div className="pointer-events-none absolute inset-x-0 bottom-6 z-10 flex justify-center px-4">
                <div className="px-4 py-2 rounded-full border border-primary/40 bg-card/95 backdrop-blur text-xs text-foreground shadow-lg text-center">
                  {t('tree.firstRunHint')}
                </div>
              </div>
            )}
          </div>

          {/* Node side panel — an overlay on phones (an inline 320px column
              would squeeze the canvas to a sliver; same fix as the workspace
              notes panel), a static column on desktop. */}
          {selected && (
            <div className="fixed inset-y-0 right-0 z-40 w-full max-w-sm shadow-2xl lg:shadow-none lg:static lg:z-auto lg:w-80 flex-shrink-0 border-l border-border bg-card/95 lg:bg-card/60 backdrop-blur-sm p-4 overflow-y-auto space-y-4">
              <button
                onClick={() => setSelectedId(null)}
                className="lg:hidden absolute top-3 right-3 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                aria-label={t('common.dismiss')}
              >
                <X className="w-4 h-4" />
              </button>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <StatusDot status={selected.pending ? '' : selected.status} />
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{selected.kind}{selected.pending ? ` · ${t('tree.pendingLabel')}` : ''}</span>
                  {!selected.pending && selected.parentId !== null && (
                    <button
                      onClick={deleteNode}
                      title={t('tree.deleteNode')}
                      className="ml-auto p-1.5 rounded-md text-muted-foreground/50 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <h2 className="text-base font-bold text-foreground leading-snug">{selected.title}</h2>
                <p className="text-xs text-muted-foreground leading-relaxed mt-1.5">{selected.summary}</p>
              </div>

              {!selected.pending && (
                <>
                  {selected.parentId === null ? null : (
                  <button
                    onClick={() => {
                      try {
                        flow.fitView({ nodes: [{ id: selected.id }], duration: 550, maxZoom: 1.75 })
                      } catch { /* instance not ready — just navigate */ }
                      setTimeout(() => router.push(`/dashboard/workspace?tree=${tree.id}&node=${selected.id}`), 560)
                    }}
                    className="flex items-center justify-center gap-2 w-full rounded-xl bg-primary text-primary-foreground text-sm font-medium py-2.5 hover:bg-primary/90 transition-colors"
                  >
                    <MessageSquare className="w-4 h-4" />
                    {t('tree.openWorkspace')}
                  </button>
                  )}
                  {selected.status === 'understood' && (
                    <p className="text-xs text-emerald-400 flex items-center gap-1.5">
                      <ShieldCheck className="w-3.5 h-3.5" /> {t('tree.verified')}
                    </p>
                  )}
                  {/* IKEA-effect attribution: this node exists because THEY
                      asked/added — the tree is a record of their curiosity. */}
                  {(selected.origin === 'copilot' || selected.origin === 'question' || selected.origin === 'manual') && (
                    <p className="text-[11px] text-emerald-300/80 flex items-center gap-1.5">
                      <Sprout className="w-3 h-3 flex-shrink-0" />
                      {t(selected.origin === 'manual' ? 'tree.grewManual' : 'tree.grewFromYou')}
                      {selected.createdAt ? ` · ${new Date(selected.createdAt).toLocaleDateString()}` : ''}
                    </p>
                  )}
                  {panelNote && <p className="text-[11px] text-amber-400">{panelNote}</p>}

                  {/* Project progress flags */}
                  {selectedProgress.length > 0 && (
                    <div className="border border-emerald-400/30 rounded-xl p-3">
                      <p className="text-xs font-bold text-emerald-300 flex items-center gap-1.5 mb-1.5">
                        <Flag className="w-3.5 h-3.5" /> {t('tree.progressFlags')}
                      </p>
                      <div className="space-y-1">
                        {selectedProgress.slice(-4).map((p, i) => (
                          <p key={i} className="text-[11px] text-foreground/90 leading-snug">• {p.text}</p>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Manual add child */}
                  <div className="border border-border rounded-xl p-3 space-y-2">
                    <p className="text-xs font-bold text-foreground flex items-center gap-1.5">
                      <Plus className="w-3.5 h-3.5 text-primary" /> {t('tree.addChild')}
                    </p>
                    <input
                      value={childTitle}
                      onChange={e => setChildTitle(e.target.value)}
                      placeholder={t('tree.addChildTitle')}
                      className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
                    />
                    <input
                      value={childSummary}
                      onChange={e => setChildSummary(e.target.value)}
                      placeholder={t('tree.addChildSummary')}
                      className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
                    />
                    <button
                      onClick={addChild}
                      disabled={!childTitle.trim() || addingChild}
                      className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary/10 border border-primary/40 text-primary text-xs font-medium py-2 hover:bg-primary/20 transition-colors disabled:opacity-40"
                    >
                      {addingChild ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                      {t('tree.addChildSave')}
                    </button>
                  </div>
                </>
              )}
              {selected.pending && (
                <div className="flex gap-2">
                  <button
                    onClick={() => act(selected.id, 'approve')}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 text-sm font-medium py-2.5 hover:bg-emerald-500/30 transition-colors"
                  >
                    <Check className="w-4 h-4" /> {t('tree.addToTree')}
                  </button>
                  <button
                    onClick={() => { act(selected.id, 'reject'); setSelectedId(null) }}
                    className="inline-flex items-center justify-center rounded-xl bg-red-500/15 border border-red-400/30 text-red-300 px-4 hover:bg-red-500/25 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Tree Copilot — a floating bubble that expands into a fullscreen
          conversation with every tree-level power (teach, grow, reshape) */}
      <TreeCopilot
        tree={tree}
        onChanged={load}
        stats={{ verified: understood, total }}
        // REACTIVE VIEW ADJUSTER (law: the copilot must never block the tree
        // or a ghost popping up): after each copilot turn the canvas re-fits
        // into the region BELOW the ambient cloud. Exact viewport math: fit
        // the whole canvas first, then scale by k = (H - occlude)/H and
        // translate so the content sits centered in the unobstructed band.
        fit={(occludeTopPx = 0) => {
          try {
            flow.fitView({ padding: 0.15, duration: 350 })
            if (occludeTopPx > 0) {
              setTimeout(() => {
                try {
                  const el = document.querySelector('.react-flow') as HTMLElement | null
                  const H = el?.clientHeight ?? window.innerHeight
                  const W = el?.clientWidth ?? window.innerWidth
                  const k = Math.max(0.45, (H - occludeTopPx) / H)
                  const vp = flow.getViewport()
                  flow.setViewport(
                    { x: vp.x * k + (W * (1 - k)) / 2, y: vp.y * k + occludeTopPx, zoom: vp.zoom * k },
                    { duration: 250 },
                  )
                } catch { /* non-critical */ }
              }, 380)
            }
          } catch { /* non-critical */ }
        }}
      />
    </div>
  )
}

export default function TreeCanvasPage() {
  return (
    <ReactFlowProvider>
      <TreeCanvasInner />
    </ReactFlowProvider>
  )
}
