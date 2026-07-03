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
  type Node as FlowNode, type Edge as FlowEdge, type NodeProps,
} from 'reactflow'
import 'reactflow/dist/style.css'
import {
  ArrowLeft, Check, X, Sprout, MessageSquare, ShieldCheck,
  Loader2, GitBranch, CircleDashed,
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

// ── Layered tree layout — grows UPWARD like a real tree ─────────────────
// Root sits at the bottom (on the ground), branches spread up and out:
// y = -depth, x allocated by leaf slots with parents centered over children.
const Y_GAP = 220
const X_GAP = 300
const NODE_W = 280

function layoutTree(nodes: TreeNodeData[]): Map<string, { x: number; y: number }> {
  const byParent = new Map<string | null, TreeNodeData[]>()
  for (const n of nodes) {
    const k = n.parentId ?? null
    if (!byParent.has(k)) byParent.set(k, [])
    byParent.get(k)!.push(n)
  }
  byParent.forEach(list => list.sort((a: TreeNodeData, b: TreeNodeData) => (a.pending === b.pending ? 0 : a.pending ? 1 : -1)))
  const pos = new Map<string, { x: number; y: number }>()
  let nextSlot = 0
  const place = (node: TreeNodeData, depth: number): number => {
    const children = byParent.get(node.id) ?? []
    let x: number
    if (children.length === 0) {
      x = nextSlot * X_GAP
      nextSlot += 1
    } else {
      const xs = children.map(c => place(c, depth + 1))
      x = (Math.min(...xs) + Math.max(...xs)) / 2
    }
    pos.set(node.id, { x, y: -depth * Y_GAP })
    return x
  }
  for (const root of byParent.get(null) ?? []) place(root, 0)
  return pos
}

// ── Custom node ──────────────────────────────────────────────────────────

const KIND_STYLES: Record<string, string> = {
  root: 'border-primary/60 bg-primary/10',
  solution: 'border-violet-400/50 bg-violet-500/10',
  component: 'border-sky-400/40 bg-sky-500/[0.07]',
  leaf: 'border-teal-400/40 bg-teal-500/[0.07]',
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
  return (
    <div
      className={cn(
        'rounded-xl border-2 px-3.5 py-2.5 shadow-md transition-shadow',
        KIND_STYLES[n.kind] ?? KIND_STYLES.component,
        n.pending && 'border-dashed opacity-80',
        n.status === 'understood' && 'ring-1 ring-emerald-400/50',
        selected && 'shadow-[0_0_0_2px_hsl(var(--primary))]',
      )}
      style={{ width: NODE_W }}
    >
      <Handle type="target" position={Position.Bottom} className="!bg-muted-foreground/50 !w-2 !h-2" />
      <div className="flex items-center gap-2">
        {n.pending ? <CircleDashed className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" /> : <StatusDot status={n.status} />}
        <p className="text-[13px] font-bold text-foreground leading-tight truncate">{n.title}</p>
      </div>
      <p className="text-[11px] text-muted-foreground leading-snug mt-1 line-clamp-3">{n.summary}</p>
      {n.pending && (
        <div className="flex gap-1.5 mt-2">
          <button
            onClick={e => { e.stopPropagation(); data.onApprove(n.id) }}
            className="flex-1 inline-flex items-center justify-center gap-1 rounded-md bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 text-[11px] font-medium py-1 hover:bg-emerald-500/30 transition-colors"
          >
            <Check className="w-3 h-3" /> {data.approveLabel}
          </button>
          <button
            onClick={e => { e.stopPropagation(); data.onReject(n.id) }}
            className="inline-flex items-center justify-center rounded-md bg-red-500/15 border border-red-400/30 text-red-300 px-2 py-1 hover:bg-red-500/25 transition-colors"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}
      <Handle type="source" position={Position.Top} className="!bg-muted-foreground/50 !w-2 !h-2" />
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
    const pos = layoutTree(tree.nodes)
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
        animated: n.pending,
        style: { stroke: n.pending ? 'hsl(var(--muted-foreground))' : 'hsl(var(--primary))', strokeWidth: 1.5, opacity: n.pending ? 0.5 : 0.75 },
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
            onNodeClick={(_, node) => setSelectedId(node.id)}
            onPaneClick={() => setSelectedId(null)}
            fitView
            fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
            minZoom={0.2}
            proOptions={{ hideAttribution: true }}
            nodesDraggable={false}
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
