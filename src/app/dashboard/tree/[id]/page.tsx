'use client'
/**
 * The interactive problem tree — a summative logic diagram.
 *
 * Root (the problem) on the left, solutions branching right, components and
 * leaves beyond. Every node carries its own simplified description. Pending
 * (AI-proposed) nodes render as dashed ghosts with approve/reject — the tree
 * only grows with the student's permission. Clicking a node opens a side
 * panel; deep work happens in the Workspace (Bob chat + notes + files).
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import ReactFlow, {
  Background, Controls, Handle, Position, ReactFlowProvider, useReactFlow,
  type Node as FlowNode, type Edge as FlowEdge, type NodeProps, type EdgeProps,
} from 'reactflow'
import 'reactflow/dist/style.css'
import {
  ArrowLeft, Check, X, Sprout, MessageSquare, ShieldCheck,
  Loader2, GitBranch,
} from 'lucide-react'
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
}

interface TreeData {
  id: string
  title: string
  framing: string | null
  status: string
  nodes: TreeNodeData[]
}

// ── Organic tree layout — grows UPWARD, hand-drawn feel ─────────────────
// Root sits on the ground, branches sweep up and out. A deterministic
// per-node jitter (hashed from the id) breaks the grid so the tree reads
// as sketched, not plotted — same node always lands in the same place.
const Y_GAP = 190
const X_GAP = 230
const NODE_W = 200

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
    // Organic drift: deeper branches wander more; the root stays grounded.
    const dx = depth === 0 ? 0 : jitter(node.id, 7) * 46
    const dy = depth === 0 ? 0 : jitter(node.id, 13) * 34
    pos.set(node.id, { x: x + dx, y: -depth * Y_GAP + dy })
    return x
  }
  for (const root of byParent.get(null) ?? []) place(root, 0)
  return { pos, depth: depthMap }
}

// ── Cursive branch edge — a swept cubic curve, thick at the trunk ───────
function BranchEdge({ id, sourceX, sourceY, targetX, targetY, data, style }: EdgeProps<{ depth?: number; pending?: boolean }>) {
  const depth = data?.depth ?? 2
  const bow = jitter(id, 3) * 55 + (targetX - sourceX) * 0.22
  const midY = (sourceY + targetY) / 2
  // Sweep out sideways near the parent, curl back in toward the child —
  // the cursive stroke of a hand-drawn branch.
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

// ── Custom node — a living dot on the branch tip, label beneath ─────────
// Like the sketch: the tree is drawn by its branches; nodes are small
// glowing buds at the junctions, not boxes on a grid.

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
  if (status === 'understood') return <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 flex-shrink-0" title="Understood" />
  if (status === 'learning') return <span className="w-2.5 h-2.5 rounded-full bg-amber-400 flex-shrink-0" title="Learning" />
  return <span className="w-2.5 h-2.5 rounded-full bg-muted-foreground/40 flex-shrink-0" title="Not understood" />
}

interface FlowNodeData {
  node: TreeNodeData
  onApprove: (id: string) => void
  onReject: (id: string) => void
  approveLabel: string
}

function PainPointNode({ data, selected }: NodeProps<FlowNodeData>) {
  const n = data.node
  // Each bud breathes on its own rhythm — deterministic per node.
  const breatheDelay = `${(Math.abs(jitter(n.id, 5)) * 3).toFixed(2)}s`
  const breatheDur = `${(3 + Math.abs(jitter(n.id, 9)) * 2).toFixed(2)}s`
  return (
    <div className="flex flex-col items-center" style={{ width: NODE_W }}>
      {/* Handles sit invisibly at the bud's center so branches meet the dot */}
      <Handle type="source" position={Position.Top} className="!opacity-0 !pointer-events-none !w-1 !h-1" style={{ top: 10 }} />
      <Handle type="target" position={Position.Bottom} className="!opacity-0 !pointer-events-none !w-1 !h-1" style={{ top: 14, bottom: 'auto' }} />

      {/* The bud */}
      <div className="h-7 flex items-center justify-center">
        <span
          className={cn(
            'rounded-full node-breathe transition-transform',
            DOT_SIZE[n.kind] ?? DOT_SIZE.component,
            n.pending
              ? 'bg-transparent border-2 border-dashed border-muted-foreground/70 shadow-none'
              : n.status === 'understood'
                ? 'bg-emerald-400 shadow-[0_0_16px_rgba(52,211,153,0.6)]'
                : n.status === 'learning'
                  ? 'bg-amber-400 shadow-[0_0_14px_rgba(251,191,36,0.55)]'
                  : DOT_FILL[n.kind] ?? DOT_FILL.component,
            selected && 'scale-125 ring-2 ring-foreground/70 ring-offset-2 ring-offset-background',
          )}
          style={{ animationDelay: breatheDelay, animationDuration: breatheDur }}
        />
      </div>

      {/* Label — title + one whispered line of summary */}
      <div className="mt-1 text-center select-none">
        <p className={cn('text-[12px] font-bold leading-tight', n.pending ? 'text-muted-foreground italic' : 'text-foreground')}>
          {n.title}
        </p>
        <p className="text-[10px] text-muted-foreground/80 leading-snug line-clamp-2 mt-0.5 max-w-[190px] mx-auto">
          {n.summary}
        </p>
      </div>

      {n.pending && (
        <div className="flex gap-1.5 mt-1.5">
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
      )}
    </div>
  )
}

const nodeTypes = { painPoint: PainPointNode }

// ── Page ─────────────────────────────────────────────────────────────────

function TreeCanvasInner() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const { t, language } = useLanguage()
  const flow = useReactFlow()
  const [tree, setTree] = useState<TreeData | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [growQuestion, setGrowQuestion] = useState('')
  const [growing, setGrowing] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/tree/${params.id}`, { cache: 'no-store' })
      if (res.status === 404) { router.push('/dashboard/tree'); return }
      if (res.ok) setTree((await res.json()).tree)
    } catch { /* transient */ }
  }, [params.id, router])
  useEffect(() => { load() }, [load])

  const act = useCallback(async (nodeId: string, action: 'approve' | 'reject') => {
    await fetch(`/api/tree/${params.id}/node/${nodeId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    }).catch(() => {})
    load()
  }, [params.id, load])

  const { flowNodes, flowEdges } = useMemo(() => {
    if (!tree) return { flowNodes: [] as FlowNode<FlowNodeData>[], flowEdges: [] as FlowEdge[] }
    const { pos, depth } = layoutTree(tree.nodes)
    const flowNodes: FlowNode<FlowNodeData>[] = tree.nodes.map(n => ({
      id: n.id,
      type: 'painPoint',
      position: pos.get(n.id) ?? { x: 0, y: 0 },
      data: {
        node: n,
        onApprove: id => act(id, 'approve'),
        onReject: id => act(id, 'reject'),
        approveLabel: t('tree.addToTree'),
      },
    }))
    const flowEdges: FlowEdge[] = tree.nodes
      .filter(n => n.parentId)
      .map(n => ({
        id: `e-${n.parentId}-${n.id}`,
        source: n.parentId!,
        target: n.id,
        type: 'branch',
        data: { depth: depth.get(n.id) ?? 2, pending: n.pending },
        style: { stroke: n.pending ? 'hsl(var(--muted-foreground))' : 'hsl(var(--primary))' },
      }))
    return { flowNodes, flowEdges }
  }, [tree, act, t])

  const selected = tree?.nodes.find(n => n.id === selectedId) ?? null
  const understood = tree?.nodes.filter(n => !n.pending && n.status === 'understood').length ?? 0
  const total = tree?.nodes.filter(n => !n.pending).length ?? 0

  async function grow() {
    if (!selected || !growQuestion.trim() || growing) return
    setGrowing(true)
    try {
      await fetch(`/api/tree/${params.id}/expand`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId: selected.id, question: growQuestion.trim(), lang: language }),
      })
      setGrowQuestion('')
      await load()
    } finally {
      setGrowing(false)
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
        <h1 className="text-sm font-bold text-foreground truncate flex-1">{tree.title}</h1>
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="w-28 h-1.5 rounded-full bg-muted overflow-hidden">
            <div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: total ? `${(understood / total) * 100}%` : '0%' }} />
          </div>
          <span className="text-[11px] text-muted-foreground tabular-nums">{understood}/{total}</span>
        </div>
      </div>

      {/* Canvas + panel */}
      <div className="flex-1 flex min-h-0">
        <div className="flex-1 min-w-0 relative">
          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodeClick={(_, node) => setSelectedId(node.id)}
            onPaneClick={() => setSelectedId(null)}
            fitView
            fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
            minZoom={0.2}
            proOptions={{ hideAttribution: true }}
            nodesDraggable
            nodesConnectable={false}
          >
            <Background gap={24} size={1} />
            <Controls showInteractive={false} />
          </ReactFlow>
          {/* The ground the tree grows from */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-emerald-500/[0.08] to-transparent" />
        </div>

        {/* Node side panel */}
        {selected && (
          <div className="w-80 flex-shrink-0 border-l border-border bg-card/60 backdrop-blur-sm p-4 overflow-y-auto space-y-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <StatusDot status={selected.pending ? '' : selected.status} />
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{selected.kind}{selected.pending ? ` · ${t('tree.pendingLabel')}` : ''}</span>
              </div>
              <h2 className="text-base font-bold text-foreground leading-snug">{selected.title}</h2>
              <p className="text-xs text-muted-foreground leading-relaxed mt-1.5">{selected.summary}</p>
            </div>

            {!selected.pending && (
              <>
                <button
                  onClick={() => {
                    // Smooth zoom into the node, then hand off to the Workspace.
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
                {selected.status === 'understood' && (
                  <p className="text-xs text-emerald-400 flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5" /> {t('tree.verified')}
                  </p>
                )}

                {/* Grow: ask a question → AI proposes child nodes as ghosts */}
                <div className="border border-border rounded-xl p-3 space-y-2">
                  <p className="text-xs font-bold text-foreground flex items-center gap-1.5">
                    <GitBranch className="w-3.5 h-3.5 text-emerald-400" />
                    {t('tree.growBranch')}
                  </p>
                  <p className="text-[11px] text-muted-foreground leading-snug">{t('tree.growHint')}</p>
                  <textarea
                    value={growQuestion}
                    onChange={e => setGrowQuestion(e.target.value)}
                    placeholder={t('tree.growPlaceholder')}
                    rows={2}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary/40"
                  />
                  <button
                    onClick={grow}
                    disabled={!growQuestion.trim() || growing}
                    className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-500/15 border border-emerald-400/40 text-emerald-300 text-xs font-medium py-2 hover:bg-emerald-500/25 transition-colors disabled:opacity-40"
                  >
                    {growing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sprout className="w-3.5 h-3.5" />}
                    {growing ? t('tree.proposing') : t('tree.propose')}
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
