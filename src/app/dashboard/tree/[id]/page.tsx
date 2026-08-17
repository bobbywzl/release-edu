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
  Pencil, RotateCcw,
} from 'lucide-react'
import { MarkdownRenderer } from '@/components/markdown-renderer'
import { TreeCopilot } from '@/components/tree-copilot'
import { emitBadgeEvents } from '@/components/xp-toast'
import { useLanguage } from '@/lib/i18n'
import { parseQuizState, masteryFilled, masteryTarget } from '@/lib/mastery'
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
  // Sibling learning-path position (copilot reorder writes it).
  order?: number
  // Sanitized checkpoint tally (facets / pending question / missed — no
  // answer keys) — powers the side panel's progress + resume card.
  quizState?: string | null
  // The node's distilled learning digest (Haiku-refreshed) — the "so far
  // here" narrative on the side panel.
  contextSummary?: string | null
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

/**
 * THE LEARNING PATH — the one ordering for canvas numbers AND the list
 * view: a deterministic pre-order walk (parent before children — the
 * redundancy law's direction), siblings by copilot-set `order`. The list
 * used to sort alphabetically within depth, which buried "Start here #1"
 * fifth; both surfaces now read the identical sequence.
 */
function learningPath(nodes: TreeNodeData[]): {
  sequence: Array<{ node: TreeNodeData; depth: number; index: number | null }>
  nextId: string | null
} {
  const real = nodes.filter(n => !n.pending)
  const root = real.find(n => n.parentId === null)
  if (!root) return { sequence: [], nextId: null }
  const kids = new Map<string, TreeNodeData[]>()
  for (const n of real) {
    if (!n.parentId) continue
    if (!kids.has(n.parentId)) kids.set(n.parentId, [])
    kids.get(n.parentId)!.push(n)
  }
  kids.forEach(list => list.sort((a, b) =>
    (a.order ?? 0) - (b.order ?? 0) || (a.createdAt ?? '').localeCompare(b.createdAt ?? '')))
  const sequence: Array<{ node: TreeNodeData; depth: number; index: number | null }> = [{ node: root, depth: 0, index: null }]
  let i = 0
  const walk = (id: string, depth: number) => {
    for (const c of kids.get(id) ?? []) {
      sequence.push({ node: c, depth, index: ++i })
      walk(c.id, depth + 1)
    }
  }
  walk(root.id, 1)
  let nextId: string | null = null
  for (const s of sequence) {
    if (s.index !== null && s.node.status !== 'understood') { nextId = s.node.id; break }
  }
  return { sequence, nextId }
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
  /** Learning path: 1-based position in the recommended walk; null = root. */
  pathIndex?: number | null
  /** The single recommended next stop — gets the "start here" pill. */
  isNext?: boolean
  /** Collapse support (visual decluttering — nothing is deleted). */
  childCount?: number
  collapsed?: boolean
  collapsedCount?: number
  onToggleCollapse?: (id: string) => void
  /** EDIT MODE: per-node handles (edit / add / delete) + drag-to-reparent. */
  editMode?: boolean
  /** Drag-to-reparent: this node is the current legal drop candidate. */
  isDropTarget?: boolean
  onEditNode?: (id: string) => void
  onAddUnder?: (id: string) => void
  onDeleteNode?: (id: string) => void
}

function PainPointNode({ data, selected }: NodeProps<FlowNodeData>) {
  const { t } = useLanguage()
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
    <div className="relative flex flex-col items-center" style={{ width: NODE_W }}>
      <Handle type="source" position={Position.Top} className="!opacity-0 !pointer-events-none !w-1 !h-1" style={{ top: 10 }} />
      <Handle type="target" position={Position.Bottom} className="!opacity-0 !pointer-events-none !w-1 !h-1" style={{ top: 14, bottom: 'auto' }} />

      {/* Collapse toggle — fold/unfold this branch (view only, per tree). */}
      {!n.pending && (data.childCount ?? 0) > 0 && (
        <button
          onClick={e => { e.stopPropagation(); data.onToggleCollapse?.(n.id) }}
          title={data.collapsed ? t('tree.expandBranch') : t('tree.collapseBranch')}
          className="absolute right-6 top-0.5 min-w-5 h-5 px-1 rounded-full bg-card/85 border border-border/60 text-[9px] text-muted-foreground hover:text-foreground hover:border-foreground/30 flex items-center justify-center z-10"
        >
          {data.collapsed ? `+${data.collapsedCount ?? ''}` : '−'}
        </button>
      )}

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
            data.isDropTarget && 'scale-125 ring-2 ring-emerald-400/90 ring-offset-2 ring-offset-background',
          )}
          style={n.status === 'understood' && !n.pending ? undefined : { animationDelay: breatheDelay, animationDuration: breatheDur }}
        />
      </div>

      {/* Learning path: numbered stop, and THE next recommended node.
          Verified nodes keep their (dimmer) number too — the copilot cites
          nodes by these exact #labels, so every real node must wear one. */}
      {!n.pending && n.parentId !== null && data.pathIndex != null && (
        data.isNext ? (
          <span className="mt-0.5 px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-400/50 text-emerald-300 text-[9px] font-bold animate-pulse whitespace-nowrap">
            ▶ {t('tree.startHere')} · #{data.pathIndex}
          </span>
        ) : (
          <span className={cn('mt-0.5 text-[9px] font-semibold', n.status === 'understood' ? 'text-emerald-400/60' : 'text-muted-foreground/70')}>#{data.pathIndex}</span>
        )
      )}

      {/* Drag-to-reparent: the live candidate announces what release does. */}
      {data.isDropTarget && (
        <span className="mt-0.5 px-2 py-0.5 rounded-full bg-emerald-500/25 border border-emerald-400/60 text-emerald-200 text-[9px] font-bold whitespace-nowrap">
          ⤵ {t('tree.dropToMove')}
        </span>
      )}

      {/* Title only — the summary lives in the side panel on click, so the
          canvas stays a clean map of concepts, not a wall of captions. */}
      <div className="mt-1 text-center select-none">
        <p className={cn('text-[12px] font-bold leading-tight', n.pending ? 'text-muted-foreground italic' : 'text-foreground')}>
          {n.title}
        </p>
      </div>

      {/* EDIT MODE handles — edit / add child / delete (root keeps edit+add;
          `nodrag` so a tap never starts a node drag). */}
      {data.editMode && !n.pending && (
        <div className="flex items-center gap-1 mt-1">
          <button
            onClick={e => { e.stopPropagation(); data.onEditNode?.(n.id) }}
            title={t('tree.renameNode')}
            className="nodrag p-1 rounded-full bg-card/90 border border-border text-sky-300 hover:bg-sky-500/15 transition-colors"
          >
            <Pencil className="w-3 h-3" />
          </button>
          <button
            onClick={e => { e.stopPropagation(); data.onAddUnder?.(n.id) }}
            title={t('tree.addChild')}
            className="nodrag p-1 rounded-full bg-card/90 border border-border text-emerald-300 hover:bg-emerald-500/15 transition-colors"
          >
            <Plus className="w-3 h-3" />
          </button>
          {n.parentId !== null && (
            <button
              onClick={e => { e.stopPropagation(); data.onDeleteNode?.(n.id) }}
              title={t('tree.deleteNode')}
              className="nodrag p-1 rounded-full bg-card/90 border border-border text-red-300 hover:bg-red-500/15 transition-colors"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>
      )}

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

  const { sequence: ordered, nextId } = useMemo(() => learningPath(tree.nodes), [tree.nodes])
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
      const res = await fetch(`/api/tree/${tree.id}/node/${nodeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      }).catch(() => null)
      // Growth badges celebrate at the approval tap (server returns each
      // unlock exactly once — discarding it would swallow the ceremony).
      try {
        const body = res ? await res.json() : null
        if (Array.isArray(body?.newBadges) && body.newBadges.length > 0) emitBadgeEvents(body.newBadges)
      } catch { /* non-critical */ }
      onChanged()
    } finally {
      setGhostBusy(null)
    }
  }
  const q = query.trim().toLowerCase()
  const filtered = (q
    ? ordered.filter(({ node }) =>
        node.title.toLowerCase().includes(q)
        || node.summary.toLowerCase().includes(q)
        || (node.notes ?? '').toLowerCase().includes(q))
    : ordered)

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

  return (
    <div className="h-full overflow-y-auto">
      {/* pt clears the copilot pill floating over the viewport's top-left —
          the search box and first rows must never start underneath it. */}
      <div className="max-w-3xl mx-auto p-4 lg:p-6 pt-20 lg:pt-20 space-y-3">
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

        {filtered.map(({ node, depth, index }) => {
          const isOpen = expanded.has(node.id)
          const rec = records[node.id]
          const annotations = parseArr<{ text: string; createdAt: string }>(node.annotations)
          const progress = parseArr<{ text: string; source: string; createdAt: string }>(node.progressLog)
          const rails = q ? 0 : Math.min(depth, 6)
          return (
            /* Learning-path order + UNMISTAKABLE depth: each ancestor level
               draws a faint vertical rail and the row's own level an emerald
               elbow into the card — the hierarchy reads like a file tree, not
               a 14px nudge. (Search results stay flat: rank beats shape.) */
            <div key={node.id} className="flex items-stretch">
              {rails > 0 && (
                <div className="flex flex-shrink-0" aria-hidden>
                  {Array.from({ length: rails }).map((_, li) => (
                    <div key={li} className="w-7 relative">
                      {li === rails - 1 ? (
                        <div className="absolute left-3 top-0 h-[26px] w-3.5 border-l-2 border-b-2 border-primary/40 rounded-bl-lg" />
                      ) : (
                        <div className="absolute left-3 inset-y-0 border-l-2 border-primary/15" />
                      )}
                    </div>
                  ))}
                </div>
              )}
              <div className="flex-1 min-w-0">
              <div className="border border-border rounded-xl bg-card overflow-hidden">
                <button
                  onClick={() => toggle(node.id)}
                  className="w-full flex items-center gap-2.5 px-3.5 py-3 text-left hover:bg-accent/50 transition-colors"
                >
                  {isOpen ? <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
                  <StatusDot status={node.status} />
                  {index !== null && (
                    node.id === nextId ? (
                      <span className="flex-shrink-0 px-1.5 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-400/50 text-emerald-300 text-[9px] font-bold whitespace-nowrap">
                        ▶ {t('tree.startHere')} · #{index}
                      </span>
                    ) : (
                      <span className="flex-shrink-0 text-[10px] text-muted-foreground/70 font-semibold tabular-nums">#{index}</span>
                    )
                  )}
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
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── NODE PROGRESS + RESUME (side panel) ─────────────────────────────────
// One glance answers "how far am I here, and where did I leave off?" — the
// motivation read before opening the workspace. Built entirely from data the
// tree GET already ships (sanitized quizState + contextSummary): zero AI
// calls, zero extra fetches.

function timeAgoLabel(iso: string | undefined, t: (k: string) => string): string | null {
  if (!iso) return null
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return null
  const min = Math.floor(ms / 60_000)
  if (min < 2) return t('time.justNow')
  if (min < 60) return t('time.minAgo').replace('{n}', String(min))
  const h = Math.floor(min / 60)
  if (h < 24) return t('time.hourAgo').replace('{n}', String(h))
  const d = Math.floor(h / 24)
  if (d <= 14) return t('time.dayAgo').replace('{n}', String(d))
  return new Date(iso).toLocaleDateString()
}

function NodeProgressCard({ node }: { node: TreeNodeData }) {
  const { t } = useLanguage()
  const qs = parseQuizState(node.quizState)
  const target = masteryTarget(qs)
  const filled = Math.min(masteryFilled(qs), target)
  const verified = node.status === 'understood'
  const lastProven = qs.provenAnswers?.length ? qs.provenAnswers[qs.provenAnswers.length - 1] : null
  // A VERIFIED node's card is its trophy: the learner's own judged-correct
  // explanation, standing (satisfaction audit #4 — own words never vanish).
  if (verified) {
    if (!lastProven) return null
    return (
      <div className="border border-emerald-400/30 bg-emerald-500/[0.05] rounded-xl p-3 space-y-1">
        <p className="text-[10px] font-bold text-emerald-300 uppercase tracking-wider">{t('workspace.inYourWords')}</p>
        <p className="text-[12px] text-foreground/90 leading-snug italic">“{lastProven.answer.slice(0, 220)}{lastProven.answer.length > 220 ? '…' : ''}”</p>
      </div>
    )
  }
  // Goal gradient: a completely untouched node shows NOTHING here — the
  // first proven point makes the card appear, already partly full.
  const touched = qs.attempts > 0 || (qs.facets?.some(f => f.done) ?? false) || !!node.contextSummary
  if (!touched) return null

  // The resume line — the most actionable "where you left off", in priority:
  // an unanswered card > a queued walkthrough > a miss awaiting retest > the
  // next unproven point.
  const nextFacet = qs.facets?.find(f => !f.done)?.name
  const lastMissed = qs.missed.length > 0 ? qs.missed[qs.missed.length - 1].question : null
  const resume = qs.pending?.question
    ? { label: t('tree.leftOffPending'), detail: qs.pending.question }
    : qs.remediationOwed
      ? { label: t('tree.leftOffRemediation'), detail: qs.remediationOwed }
      : lastMissed
        ? { label: t('tree.leftOffMissed'), detail: lastMissed }
        : nextFacet
          ? { label: t('tree.leftOffNext'), detail: nextFacet }
          : null

  // The narrative "so far here" — the node's distilled digest, de-markdowned
  // and clamped to a glance.
  const soFar = (node.contextSummary ?? '').replace(/[#*_`>-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)
  const when = timeAgoLabel(node.updatedAt, t)

  return (
    <div className="border border-primary/25 bg-primary/[0.04] rounded-xl p-3 space-y-2">
      <div className="flex items-center gap-2">
        <p className="text-[11px] font-bold text-foreground uppercase tracking-wider flex-1">{t('tree.progressTitle')}</p>
        {when && <span className="text-[10px] text-muted-foreground/70">{t('tree.lastTouched').replace('{when}', when)}</span>}
      </div>
      {/* Coverage bar — the at-a-glance read. */}
      {filled > 0 && (
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
            <div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${(filled / Math.max(1, target)) * 100}%` }} />
          </div>
          <span className="text-[11px] tabular-nums text-emerald-300 font-semibold">{filled}/{target}</span>
        </div>
      )}
      {/* Facet pips — which promises are already proven. */}
      {qs.facets && qs.facets.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {qs.facets.map((f, i) => (
            <span
              key={i}
              title={f.name}
              className={cn(
                'max-w-full truncate px-1.5 py-0.5 rounded-md text-[10px] border',
                f.done ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-300' : 'border-border text-muted-foreground/80',
              )}
            >
              {f.done ? '✓ ' : ''}{f.name}
            </span>
          ))}
        </div>
      )}
      {/* Where you left off — the hook back in. */}
      {resume && (
        <div className="border-l-2 border-primary/50 pl-2">
          <p className="text-[10px] font-bold text-primary uppercase tracking-wider">{t('tree.leftOffTitle')}</p>
          <p className="text-[11px] text-foreground/90 leading-snug mt-0.5">
            {resume.label} <span className="text-muted-foreground">“{resume.detail.slice(0, 110)}{resume.detail.length > 110 ? '…' : ''}”</span>
          </p>
        </div>
      )}
      {/* So far here — what's already banked (loss-aversion works FOR us). */}
      {soFar && (
        <div>
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">{t('tree.soFarTitle')}</p>
          <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">{soFar}{(node.contextSummary ?? '').length > 200 ? '…' : ''}</p>
        </div>
      )}
    </div>
  )
}

// ── THE ROOT ANSWER (side-panel doc on the root node) ───────────────────
// The assembled resolution of the root problem, built from the verified
// nodes' digests — generated automatically on tree completion, and on
// demand from here once anything is verified. Claim tags name the node
// that proved each point; an honest-boundary section covers the rest.

function RootAnswerPanel({ treeId, hasVerified }: { treeId: string; hasVerified: boolean }) {
  const { t, language } = useLanguage()
  const [answer, setAnswer] = useState<string | null>(null)
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/tree/${treeId}/answer`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (cancelled || !d) return
        setAnswer(typeof d.answer === 'string' && d.answer.trim() ? d.answer : null)
        setGeneratedAt(d.generatedAt ?? null)
      })
      .catch(() => { /* panel just shows the generate button */ })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [treeId])

  async function generate() {
    if (generating) return
    setGenerating(true); setNote(null)
    try {
      const res = await fetch(`/api/tree/${treeId}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lang: language }),
      })
      const body = await res.json().catch(() => ({}))
      if (res.ok && typeof body.answer === 'string') {
        setAnswer(body.answer)
        setGeneratedAt(body.generatedAt ?? new Date().toISOString())
      } else {
        setNote(typeof body.error === 'string' ? body.error : t('tree.actionFailed'))
      }
    } catch {
      setNote(t('tree.actionFailed'))
    } finally {
      setGenerating(false)
    }
  }

  if (loading) return <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
  if (!answer && !hasVerified) return null
  return (
    <div className="border border-amber-400/30 rounded-xl p-3 space-y-2 bg-amber-500/[0.04]">
      <p className="text-xs font-bold text-amber-300 uppercase tracking-wider flex items-center gap-1.5">
        <FileText className="w-3.5 h-3.5" /> {t('tree.rootAnswerTitle')}
      </p>
      {answer ? (
        <>
          <div className="text-[13px] leading-relaxed overflow-hidden relative max-h-48">
            <MarkdownRenderer content={answer} />
            <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-card to-transparent" />
          </div>
          {/* The document deserves a real reading surface — the full-width
              reader route, never an inline scroll in this narrow panel. */}
          <Link
            href={`/dashboard/tree/${treeId}/answer`}
            className="block w-full text-center rounded-lg bg-amber-500/15 border border-amber-400/40 text-amber-300 text-xs font-medium py-1.5 hover:bg-amber-500/25 transition-colors"
          >
            {t('tree.rootAnswerExpand')}
          </Link>
          <div className="flex items-center gap-2">
            {generatedAt ? (
              <span className="text-[10px] text-muted-foreground/70 flex-1">
                {new Date(generatedAt).toLocaleString()}
              </span>
            ) : (
              /* Stale-stamped: the tree just re-completed and the document
                 is being reassembled — never present the old version as new. */
              <span className="text-[10px] text-amber-300/90 flex-1 inline-flex items-center gap-1">
                <Loader2 className="w-2.5 h-2.5 animate-spin" /> {t('tree.answerReassembling')}
              </span>
            )}
            <button
              onClick={generate}
              disabled={generating}
              className="inline-flex items-center gap-1 rounded-lg border border-amber-400/40 text-amber-300 text-[11px] px-2 py-1 hover:bg-amber-500/15 transition-colors disabled:opacity-50"
            >
              {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : null} {t('tree.rootAnswerRegen')}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="text-[11px] text-muted-foreground leading-snug">{t('tree.rootAnswerHint')}</p>
          <button
            onClick={generate}
            disabled={generating}
            className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-amber-500/15 border border-amber-400/40 text-amber-300 text-xs font-medium py-2 hover:bg-amber-500/25 transition-colors disabled:opacity-50"
          >
            {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
            {generating ? t('tree.rootAnswerGenerating') : t('tree.rootAnswerGenerate')}
          </button>
        </>
      )}
      {note && <p className="text-[11px] text-amber-400">{note}</p>}
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
  // ── EDIT MODE (manual tree editing) ──
  const [editMode, setEditMode] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editSummary, setEditSummary] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  // Which panel form a node-handle tap wants focused (edit vs add-child).
  const [panelFocus, setPanelFocus] = useState<'edit' | 'add' | null>(null)
  const editTitleRef = useRef<HTMLInputElement>(null)
  const addTitleRef = useRef<HTMLInputElement>(null)
  // Drag-to-reparent: the current legal drop candidate while dragging.
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)
  const dropTargetRef = useRef<string | null>(null)
  // Undo pill (structure snapshots) — availability rides the tree GET.
  const [undo, setUndo] = useState<{ count: number; label: string; at: string } | null>(null)
  const [undoBusy, setUndoBusy] = useState(false)
  // Transient status pill (moved / saved / undone) floating over the canvas.
  const [topNote, setTopNote] = useState<string | null>(null)
  const topNoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showTopNote = useCallback((text: string) => {
    setTopNote(text)
    if (topNoteTimer.current) clearTimeout(topNoteTimer.current)
    topNoteTimer.current = setTimeout(() => setTopNote(null), 3500)
  }, [])
  const [settling, setSettling] = useState(true)
  const settledRef = useRef(false)
  const draggedPos = useRef<Map<string, { x: number; y: number }>>(new Map())
  // Parent/children maps for the drag constraint below.
  const relRef = useRef<{ parent: Map<string, string | null>; children: Map<string, string[]> }>({ parent: new Map(), children: new Map() })

  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNodeData>([])
  // COLLAPSE (visual decluttering): ids of folded branch roots — their
  // descendants leave the canvas, nothing is deleted. Persisted per tree.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  useEffect(() => {
    try {
      const raw = localStorage.getItem(`tree-collapsed:${params.id}`)
      if (raw) setCollapsed(new Set((JSON.parse(raw) as string[]).filter(x => typeof x === 'string')))
    } catch { /* fresh */ }
  }, [params.id])
  const toggleCollapse = useCallback((id: string) => {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      try { localStorage.setItem(`tree-collapsed:${params.id}`, JSON.stringify(Array.from(next))) } catch { /* non-critical */ }
      return next
    })
  }, [params.id])
  // Descendants of collapsed roots — hidden from canvas + edges.
  const hiddenByCollapse = useMemo(() => {
    const hidden = new Set<string>()
    if (!tree || collapsed.size === 0) return hidden
    const kids = new Map<string, string[]>()
    for (const n of tree.nodes) {
      if (!n.parentId) continue
      if (!kids.has(n.parentId)) kids.set(n.parentId, [])
      kids.get(n.parentId)!.push(n.id)
    }
    const mark = (id: string) => { for (const c of kids.get(id) ?? []) { hidden.add(c); mark(c) } }
    collapsed.forEach(id => { if (tree.nodes.some(n => n.id === id && !hidden.has(id))) mark(id) })
    return hidden
  }, [tree, collapsed])
  // LEARNING PATH: the shared pre-order walk (learningPath — same sequence
  // the list view renders). The first unverified stop wears the pill.
  const { pathIndex, nextOnPath } = useMemo(() => {
    const { sequence, nextId } = learningPath(tree?.nodes ?? [])
    const idx = new Map<string, number>()
    for (const s of sequence) if (s.index !== null) idx.set(s.node.id, s.index)
    return { pathIndex: idx, nextOnPath: nextId }
  }, [tree])

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/tree/${params.id}`, { cache: 'no-store' })
      if (res.status === 404) { router.push('/dashboard/tree'); return }
      if (res.ok) {
        const body = await res.json()
        setTree(body.tree)
        setUndo(body.undo ?? null)
      }
    } catch { /* transient */ }
  }, [params.id, router])
  useEffect(() => { load() }, [load])
  // Clear the panel note when the selection changes.
  useEffect(() => { setPanelNote(null) }, [selectedId])
  // Prefill the edit form when the SELECTION changes — never on background
  // tree refreshes (a copilot turn mid-typing must not wipe the draft).
  const prefilledFor = useRef<string | null>(null)
  useEffect(() => {
    if (selectedId === prefilledFor.current) return
    prefilledFor.current = selectedId
    const sel = tree?.nodes.find(n => n.id === selectedId)
    setEditTitle(sel?.title ?? '')
    setEditSummary(sel?.summary ?? '')
  }, [selectedId, tree])
  // A node-handle tap opens the panel with the matching form focused.
  useEffect(() => {
    if (!panelFocus || !selectedId) return
    const tmr = setTimeout(() => {
      (panelFocus === 'edit' ? editTitleRef : addTitleRef).current?.focus()
    }, 120)
    return () => clearTimeout(tmr)
  }, [panelFocus, selectedId])

  const act = useCallback(async (nodeId: string, action: 'approve' | 'reject') => {
    const res = await fetch(`/api/tree/${params.id}/node/${nodeId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    }).catch(() => null)
    // Surface failure instead of a ghost silently vanishing on reload — a
    // 404 means the proposal was already replaced/handled elsewhere.
    if (!res || !res.ok) setPanelNote(t('tree.actionFailed'))
    // Growth badges unlock at the approval tap — celebrate here, not on a
    // later dashboard visit (the server returns each unlock exactly once).
    try {
      const body = res ? await res.json() : null
      if (Array.isArray(body?.newBadges) && body.newBadges.length > 0) emitBadgeEvents(body.newBadges)
    } catch { /* non-critical */ }
    load()
  }, [params.id, load, t])

  // Delete from anywhere (panel button or the edit-mode node handle) — the
  // server snapshots first, so the toolbar Undo can bring the branch back.
  const deleteNodeById = useCallback(async (nodeId: string) => {
    const target = tree?.nodes.find(n => n.id === nodeId)
    if (!target || target.parentId === null) return
    if (!confirm(t('tree.deleteNodeConfirm'))) return
    const res = await fetch(`/api/tree/${params.id}/node/${nodeId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete' }),
    }).catch(() => null)
    showTopNote(res?.ok ? t('tree.deleted') : t('tree.actionFailed'))
    setSelectedId(prev => (prev === nodeId ? null : prev))
    await load()
  }, [tree, params.id, t, load, showTopNote])

  // Snapshot labels are stored as raw keys ('delete', 'rewire', …) — show
  // the localized name, falling back to the raw label for unknown ones.
  const undoLabelText = useCallback((label: string) => {
    const key = `tree.undoLabel.${label}`
    const val = t(key)
    return val === key ? label : val
  }, [t])

  const doUndo = useCallback(async () => {
    if (undoBusy || !undo) return
    if (!confirm(t('tree.undoConfirm').replace('{label}', undoLabelText(undo.label)))) return
    setUndoBusy(true)
    try {
      const res = await fetch(`/api/tree/${params.id}/undo`, { method: 'POST' }).catch(() => null)
      if (res?.ok) {
        // The restored structure replaces any hand-dragged layout memory.
        draggedPos.current.clear()
        showTopNote(t('tree.undoDone'))
      } else {
        showTopNote(t('tree.actionFailed'))
      }
      await load()
    } finally {
      setUndoBusy(false)
    }
  }, [undo, undoBusy, params.id, t, load, showTopNote, undoLabelText])

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

  // O(1) node lookup for the per-pointer-move drop-candidate scan.
  const nodeById = useMemo(() => new Map((tree?.nodes ?? []).map(n => [n.id, n])), [tree])
  // The dragged node's banned set (itself + its subtree), frozen at drag
  // start — recomputing it per pointer-move event was O(n²) on big trees.
  const dragBannedRef = useRef<Set<string> | null>(null)

  // EDIT MODE — drag-to-reparent: while dragging, the nearest legal node
  // under the dragged bud lights up as the drop candidate (never itself, its
  // own subtree, its current parent, or a pending ghost). Release moves it.
  const onNodeDrag = useCallback((_: unknown, node: FlowNode) => {
    if (!editMode) return
    if (relRef.current.parent.get(node.id) === null) return // the root never re-parents
    const all = flow.getNodes()
    const me = all.find(n => n.id === node.id)
    if (!me) return
    const cx = me.position.x + NODE_W / 2
    const cy = me.position.y + 20
    if (!dragBannedRef.current) {
      dragBannedRef.current = new Set([node.id, ...collectDescendants(node.id)])
    }
    const banned = dragBannedRef.current
    const parentId = relRef.current.parent.get(node.id) ?? null
    let best: { id: string; d: number } | null = null
    for (const other of all) {
      if (banned.has(other.id) || other.id === parentId) continue
      const tn = nodeById.get(other.id)
      if (!tn || tn.pending) continue
      const d = Math.hypot(cx - (other.position.x + NODE_W / 2), cy - (other.position.y + 20))
      if (d < 110 && (!best || d < best.d)) best = { id: other.id, d }
    }
    const next = best?.id ?? null
    if (dropTargetRef.current !== next) {
      dropTargetRef.current = next
      setDropTargetId(next)
    }
  }, [editMode, flow, collectDescendants, nodeById])

  const onNodeDragStop = useCallback(() => {
    const ctx = dragCtx.current
    dragCtx.current = null
    dragBannedRef.current = null
    const target = dropTargetRef.current
    dropTargetRef.current = null
    setDropTargetId(null)
    if (!ctx) return
    // EDIT MODE: released over a legal candidate → re-parent (the server
    // re-validates root/cycle and snapshots first, so Undo can revert it).
    if (editMode && target) {
      const moving = ctx.id
      void (async () => {
        const res = await fetch(`/api/tree/${params.id}/node/${moving}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'move', newParentId: target }),
        }).catch(() => null)
        if (res?.ok) {
          // Let the fresh layout place the moved subtree under its new
          // parent instead of freezing it at the drop position.
          draggedPos.current.delete(moving)
          for (const d of collectDescendants(moving)) draggedPos.current.delete(d)
          showTopNote(t('tree.moved'))
        } else {
          showTopNote(t('tree.actionFailed'))
        }
        await load()
      })()
      return
    }
    // Snap the trailing subtree onto its exact rigid targets so the shape
    // lands perfectly translated.
    const positions = new Map(flow.getNodes().map(n => [n.id, n.position]))
    const base = positions.get(ctx.id)
    if (!base) return
    setNodes(nds => nds.map(n => {
      const off = ctx.offsets.get(n.id)
      if (!off) return n
      const target2 = { x: base.x + off.dx, y: base.y + off.dy }
      draggedPos.current.set(n.id, target2)
      return { ...n, position: target2 }
    }))
  }, [flow, setNodes, editMode, params.id, collectDescendants, load, showTopNote, t])

  const handleNodesChange: typeof onNodesChange = useCallback(changes => {
    const current = new Map(flow.getNodes().map(n => [n.id, { ...n.position }]))
    const extraMoves = new Map<string, { x: number; y: number }>()

    for (const c of changes) {
      if (c.type === 'position' && c.position) {
        // The dragged node strains against its parent's string — except in
        // EDIT MODE, where a reparent drag must be able to reach ANY node.
        const pid = relRef.current.parent.get(c.id)
        const pp = pid ? current.get(pid) : undefined
        if (pp && !editMode) {
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
  }, [flow, onNodesChange, setNodes, editMode])

  // Build flow nodes from the tree. First load: float in scattered, then
  // settle into place (CSS transition while `settling`).
  useEffect(() => {
    if (!tree) return
    const visible = tree.nodes.filter(n => !hiddenByCollapse.has(n.id))
    const childCounts = new Map<string, number>()
    for (const n of tree.nodes) {
      if (n.parentId && !n.pending) childCounts.set(n.parentId, (childCounts.get(n.parentId) ?? 0) + 1)
    }
    const hiddenCounts = new Map<string, number>()
    collapsed.forEach(cid => {
      const kids = new Map<string, string[]>()
      for (const n of tree.nodes) {
        if (!n.parentId) continue
        if (!kids.has(n.parentId)) kids.set(n.parentId, [])
        kids.get(n.parentId)!.push(n.id)
      }
      let count = 0
      const walkC = (x: string) => { for (const c of kids.get(x) ?? []) { count++; walkC(c) } }
      walkC(cid)
      hiddenCounts.set(cid, count)
    })
    const { pos, depth } = layoutTree(visible)
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
        pathIndex: pathIndex.get(n.id) ?? null,
        isNext: n.id === nextOnPath,
        childCount: childCounts.get(n.id) ?? 0,
        collapsed: collapsed.has(n.id),
        collapsedCount: hiddenCounts.get(n.id) ?? 0,
        onToggleCollapse: toggleCollapse,
        editMode,
        isDropTarget: n.id === dropTargetId,
        onEditNode: (id: string) => { setSelectedId(id); setPanelFocus('edit') },
        onAddUnder: (id: string) => { setSelectedId(id); setPanelFocus('add') },
        onDeleteNode: deleteNodeById,
      },
    })

    if (!settledRef.current) {
      settledRef.current = true
      // Scatter → settle. The scatter is deterministic so replays feel alive
      // but never chaotic.
      setNodes(visible.map(n => mk(n, {
        x: (pos.get(n.id)?.x ?? 0) + jitter(n.id, 21) * 340,
        y: (pos.get(n.id)?.y ?? 0) + jitter(n.id, 33) * 260,
      })))
      setTimeout(() => {
        setNodes(visible.map(n => mk(n, target(n))))
        setTimeout(() => {
          setSettling(false)
          // Mount-time fitView ran before the organic layout settled, which
          // left first-run trees as a tiny corner cluster — refit now so the
          // tree greets the user centered and readable. Generous padding +
          // capped zoom so the ROOT's title never clips at the bottom edge.
          setTimeout(() => { try { flow.fitView({ padding: 0.28, maxZoom: 1.2, duration: 500 }) } catch { /* non-critical */ } }, 30)
        }, 950)
      }, 60)
    } else {
      setNodes(visible.map(n => mk(n, target(n))))
    }
    void depth
  }, [tree, act, t, setNodes, hiddenByCollapse, collapsed, pathIndex, nextOnPath, toggleCollapse, editMode, dropTargetId, deleteNodeById])

  const flowEdges = useMemo(() => {
    if (!tree) return [] as FlowEdge[]
    const visible = tree.nodes.filter(n => !hiddenByCollapse.has(n.id))
    const { depth } = layoutTree(visible)
    return visible
      .filter(n => n.parentId && !hiddenByCollapse.has(n.parentId))
      .map(n => ({
        id: `e-${n.parentId}-${n.id}`,
        source: n.parentId!,
        target: n.id,
        type: 'branch',
        data: { depth: depth.get(n.id) ?? 2, pending: n.pending },
        style: { stroke: n.pending ? 'hsl(var(--muted-foreground))' : 'hsl(var(--primary))' },
      }))
  }, [tree, hiddenByCollapse])

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
    if (!selected) return
    await deleteNodeById(selected.id)
  }

  async function saveEdit() {
    if (!selected || savingEdit) return
    const title = editTitle.trim()
    const summary = editSummary.trim()
    if (!title && !summary) return
    setSavingEdit(true)
    try {
      const res = await fetch(`/api/tree/${params.id}/node/${selected.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'edit', title, summary }),
      }).catch(() => null)
      if (res?.ok) showTopNote(t('tree.editSaved'))
      else setPanelNote(t('tree.actionFailed'))
      await load()
    } finally {
      setSavingEdit(false)
    }
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
        {/* THE ANSWER — once the tree completes, its payoff document is one
            obvious tap away (full-width reader), never buried behind
            root-click → expand. A floating twin sits top-center over the
            canvas on wide screens. */}
        {tree.status === 'completed' && (
          <Link
            href={`/dashboard/tree/${tree.id}/answer`}
            className="inline-flex items-center gap-1.5 flex-shrink-0 px-3 py-1.5 rounded-full border border-amber-400/50 bg-amber-500/15 text-amber-300 text-xs font-bold hover:bg-amber-500/25 transition-colors"
          >
            <FileText className="w-3.5 h-3.5" /> <span className="hidden sm:inline">{t('tree.answerReadyPill')}</span>
          </Link>
        )}
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
        {/* EDIT MODE — free manual editing: every node grows edit / add /
            delete handles, and dragging a node onto another moves it there. */}
        <button
          onClick={() => { setEditMode(m => !m); setSelectedId(null); setPanelFocus(null) }}
          title={t('tree.editModeTitle')}
          className={cn(
            'flex-shrink-0 px-2.5 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-1.5 transition-colors',
            editMode
              ? 'border-sky-400/60 bg-sky-500/15 text-sky-300'
              : 'border-border text-muted-foreground hover:text-foreground hover:bg-accent',
          )}
        >
          <Pencil className="w-3.5 h-3.5" /> <span className="hidden sm:inline">{editMode ? t('tree.editDone') : t('tree.editMode')}</span>
        </button>
        {/* UNDO — one tap restores the tree to before the last destructive
            change (snapshots survive reloads; tapping again toggles back). */}
        {undo && undo.count > 0 && (
          <button
            onClick={doUndo}
            disabled={undoBusy}
            title={t('tree.undoHint').replace('{label}', undoLabelText(undo.label))}
            className="flex-shrink-0 px-2.5 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent flex items-center gap-1.5 transition-colors disabled:opacity-50"
          >
            {undoBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{t('tree.undo')}</span>
          </button>
        )}
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
              onNodeDrag={onNodeDrag}
              onNodeDragStop={onNodeDragStop}
              onNodeClick={(_, node) => {
                // EDIT MODE: clicks select (the side panel holds the edit and
                // add-child forms) — no workspace navigation mid-restructure.
                if (editMode) { setSelectedId(node.id); return }
                // ONE CLICK INTO THE WORKSPACE (efficiency law): a real node
                // opens its workspace directly — no select-then-confirm, no
                // camera choreography. The side panel stays for the root
                // (The Answer) and pending ghosts (approve/dismiss).
                const tn = tree?.nodes.find(n => n.id === node.id)
                if (tn && !tn.pending && tn.parentId !== null) {
                  router.push(`/dashboard/workspace?tree=${tree.id}&node=${tn.id}`)
                } else {
                  setSelectedId(node.id)
                }
              }}
              onPaneClick={() => setSelectedId(null)}
              fitView
              fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
              // FLUID NAVIGATION (the canvas is the signature surface — it
              // must never feel stuck): drag empty space to pan, trackpad
              // two-finger scroll pans (Figma-style), pinch or Ctrl/Cmd+wheel
              // zooms. Double-click zoom off — it fires on accidental
              // double-taps of nodes.
              panOnDrag
              panOnScroll
              zoomOnPinch
              zoomOnScroll={false}
              zoomActivationKeyCode={['Meta', 'Control']}
              zoomOnDoubleClick={false}
              minZoom={0.1}
              maxZoom={2.5}
              proOptions={{ hideAttribution: true }}
              nodesDraggable
              nodesConnectable={false}
            >
              <Background gap={24} size={1} />
              {/* The fit button must actually FIT: generous padding, capped
                  zoom, and a smooth glide instead of a teleport. */}
              <Controls showInteractive={false} fitViewOptions={{ padding: 0.28, maxZoom: 1.2, duration: 400 }} />
            </ReactFlow>
            {/* The ground the tree grows from */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-emerald-500/[0.08] to-transparent" />
            {/* THE ANSWER — floating twin of the header pill, top-center
                over the completed tree (below the copilot's row). */}
            {tree.status === 'completed' && (
              <Link
                href={`/dashboard/tree/${tree.id}/answer`}
                className="hidden lg:inline-flex absolute top-8 left-1/2 -translate-x-1/2 z-10 items-center gap-2 rounded-full border border-amber-400/50 bg-card/85 backdrop-blur-md px-4 py-2 text-amber-300 text-xs font-bold shadow-lg shadow-amber-500/10 hover:bg-amber-500/15 transition-colors"
              >
                <FileText className="w-4 h-4" /> {t('tree.answerReadyLong')}
              </Link>
            )}
            {/* EDIT MODE hint + transient status notes (moved/saved/undone) */}
            {(topNote || editMode) && (
              <div className="pointer-events-none absolute inset-x-0 bottom-6 z-20 flex justify-center px-4">
                <div className={cn(
                  'px-4 py-2 rounded-full border bg-card/95 backdrop-blur text-xs shadow-lg text-center',
                  topNote ? 'border-emerald-400/50 text-emerald-300' : 'border-sky-400/50 text-sky-200',
                )}>
                  {topNote ?? t('tree.editHint')}
                </div>
              </div>
            )}
            {/* First-run guidance — nothing else on this screen says what a
                node IS or what to do; disappears once any node is verified. */}
            {!editMode && !topNote && tree && tree.nodes.some(n => !n.pending) && tree.nodes.filter(n => !n.pending).every(n => n.status !== 'understood') && (
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
                  {/* EDIT MODE — rewrite this node's wording (root included:
                      that reframes the problem; the tree title follows
                      server-side). Same-concept edits only — a different
                      concept is delete + add. */}
                  {editMode && (
                    <div className="border border-sky-400/40 rounded-xl p-3 space-y-2 bg-sky-500/[0.05]">
                      <p className="text-xs font-bold text-sky-300 flex items-center gap-1.5">
                        <Pencil className="w-3.5 h-3.5" /> {t('tree.renameNode')}
                      </p>
                      <input
                        ref={editTitleRef}
                        value={editTitle}
                        onChange={e => setEditTitle(e.target.value)}
                        placeholder={t('tree.addChildTitle')}
                        className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-sky-400/50"
                      />
                      <textarea
                        value={editSummary}
                        onChange={e => setEditSummary(e.target.value)}
                        rows={2}
                        placeholder={t('tree.addChildSummary')}
                        className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-1 focus:ring-sky-400/50"
                      />
                      <button
                        onClick={saveEdit}
                        disabled={savingEdit || !editTitle.trim() || (editTitle.trim() === selected.title && editSummary.trim() === selected.summary)}
                        className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-sky-500/15 border border-sky-400/40 text-sky-300 text-xs font-medium py-2 hover:bg-sky-500/25 transition-colors disabled:opacity-40"
                      >
                        {savingEdit ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                        {t('tree.editSave')}
                      </button>
                    </div>
                  )}
                  {selected.parentId === null ? (
                    /* THE ROOT ANSWER — the root has no workspace by law, but
                       it now carries the tree's payoff artifact: the assembled
                       resolution of the problem, built from every verified
                       node's digest. */
                    <RootAnswerPanel treeId={tree.id} hasVerified={understood > 0} />
                  ) : (
                  <>
                  {/* Glanceable progress + "where you left off" — the
                      motivation read BEFORE the button. */}
                  <NodeProgressCard node={selected} />
                  <button
                    onClick={() => router.push(`/dashboard/workspace?tree=${tree.id}&node=${selected.id}`)}
                    className="flex items-center justify-center gap-2 w-full rounded-xl bg-primary text-primary-foreground text-sm font-medium py-2.5 hover:bg-primary/90 transition-colors"
                  >
                    <MessageSquare className="w-4 h-4" />
                    {/* An in-progress node invites CONTINUING, not opening. */}
                    {selected.status !== 'understood' && parseQuizState(selected.quizState).attempts > 0
                      ? t('tree.continueWorkspace')
                      : t('tree.openWorkspace')}
                  </button>
                  </>
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
                      ref={addTitleRef}
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
        listMode={view === 'list'}
        stats={{ verified: understood, total }}
        // LIVE pending set — approvals/rejections anywhere (canvas, list,
        // grow box) retire the copilot's ghost chips and status line.
        pendingIds={new Set(tree.nodes.filter(n => n.pending).map(n => n.id))}
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
