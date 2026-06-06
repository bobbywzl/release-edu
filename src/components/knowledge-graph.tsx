'use client'
import { useCallback, useRef, useState, useEffect, useMemo } from 'react'
import dynamic from 'next/dynamic'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, Clock, BookOpen, Lock, CheckCircle, Circle, Loader2,
  Search, SlidersHorizontal, Pin, PinOff, RotateCcw, ChevronDown,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { KnowledgeNode } from '@/types'

const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), { ssr: false })

const SUBJECT_COLORS: Record<string, string> = {
  CS: '#3B82F6',
  Math: '#8B5CF6',
  Psychology: '#EC4899',
  Finance: '#F59E0B',
  General: '#10B981',
}

const STATUS_CONFIG = {
  completed: { opacity: 1.0, ring: '#22C55E', label: 'Completed' },
  'in-progress': { opacity: 1.0, ring: '#3B82F6', label: 'In Progress' },
  available: { opacity: 0.7, ring: '#94A3B8', label: 'Available' },
  locked: { opacity: 0.3, ring: '#374151', label: 'Locked' },
}

interface GraphNode {
  id: string
  name: string
  subject: string
  status: string
  description: string
  estimatedHours: number
  resources: KnowledgeNode['resources']
  val: number
  connectionCount: number
  x?: number
  y?: number
  fx?: number | null
  fy?: number | null
}

interface GraphLink {
  source: string | GraphNode
  target: string | GraphNode
}

interface Props {
  nodes: KnowledgeNode[]
}

export function KnowledgeGraph({ nodes }: Props) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const graphRef = useRef<any>(undefined)
  const containerRef = useRef<HTMLDivElement>(null)
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 })
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null)
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null)
  const [mounted, setMounted] = useState(false)
  const [activeSubjects, setActiveSubjects] = useState<Set<string>>(
    new Set(Object.keys(SUBJECT_COLORS))
  )
  const [searchQuery, setSearchQuery] = useState('')
  const [pinnedNodes, setPinnedNodes] = useState<Set<string>>(new Set())
  const [showFilters, setShowFilters] = useState(false)
  const [forcesReady, setForcesReady] = useState(false)

  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.offsetWidth,
          height: containerRef.current.offsetHeight,
        })
      }
    }
    updateSize()
    window.addEventListener('resize', updateSize)
    return () => window.removeEventListener('resize', updateSize)
  }, [])

  // Configure d3 forces once graph is mounted
  useEffect(() => {
    if (!graphRef.current || !mounted) return
    const timer = setTimeout(() => {
      const fg = graphRef.current
      if (!fg) return
      try {
        fg.d3Force('charge')?.strength(-300)
        fg.d3Force('link')?.distance(120)
        fg.d3Force('center')?.strength(0.05)
        fg.d3ReheatSimulation?.()
        setForcesReady(true)
      } catch {
        // ignore
      }
    }, 100)
    return () => clearTimeout(timer)
  }, [mounted])

  // Connection counts per node
  const connectionCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    nodes.forEach(n => {
      if (!counts[n.id]) counts[n.id] = 0
      n.prerequisites.forEach(prereqId => {
        counts[prereqId] = (counts[prereqId] || 0) + 1
        counts[n.id] = (counts[n.id] || 0) + 1
      })
    })
    return counts
  }, [nodes])

  const filteredNodes = useMemo(() =>
    nodes.filter(n => {
      const subjectMatch = activeSubjects.has(n.subject)
      const searchMatch = !searchQuery ||
        n.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
        n.description.toLowerCase().includes(searchQuery.toLowerCase())
      return subjectMatch && searchMatch
    }),
    [nodes, activeSubjects, searchQuery]
  )

  const filteredNodeIds = useMemo(() => new Set(filteredNodes.map(n => n.id)), [filteredNodes])

  const graphData = useMemo(() => ({
    nodes: filteredNodes.map(n => ({
      id: n.id,
      name: n.label,
      subject: n.subject,
      status: n.status,
      description: n.description,
      estimatedHours: n.estimatedHours,
      resources: n.resources,
      connectionCount: connectionCounts[n.id] || 0,
      // Size by connections, min 4 max 20
      val: Math.max(Math.min((connectionCounts[n.id] || 0) * 3 + 4, 20), 4),
    })),
    links: nodes.flatMap(n =>
      n.prerequisites
        .filter(p => filteredNodeIds.has(p) && filteredNodeIds.has(n.id))
        .map(p => ({ source: p, target: n.id }))
    ),
  }), [filteredNodes, filteredNodeIds, nodes, connectionCounts])

  // Connected node IDs for hover effect
  const connectedNodeIds = useMemo(() => {
    if (!hoveredNode) return null
    const ids = new Set<string>([hoveredNode.id])
    graphData.links.forEach(link => {
      const src = typeof link.source === 'object' ? (link.source as GraphNode).id : link.source
      const tgt = typeof link.target === 'object' ? (link.target as GraphNode).id : link.target
      if (src === hoveredNode.id) ids.add(tgt)
      if (tgt === hoveredNode.id) ids.add(src)
    })
    return ids
  }, [hoveredNode, graphData.links])

  const nodeCanvasObject = useCallback((
    node: GraphNode,
    ctx: CanvasRenderingContext2D,
    globalScale: number
  ) => {
    const color = SUBJECT_COLORS[node.subject] || '#94A3B8'
    const cfg = STATUS_CONFIG[node.status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.available
    const r = Math.sqrt(node.val) * 4
    const x = node.x ?? 0
    const y = node.y ?? 0

    let alpha = cfg.opacity
    if (connectedNodeIds && !connectedNodeIds.has(node.id)) {
      alpha = 0.08
    }

    ctx.globalAlpha = alpha

    // Glow for in-progress (animated via time-based pulse would need requestAnimationFrame;
    // we do a static glow here)
    if (node.status === 'in-progress') {
      const grad = ctx.createRadialGradient(x, y, r * 0.5, x, y, r + 12)
      grad.addColorStop(0, color + '66')
      grad.addColorStop(1, color + '00')
      ctx.beginPath()
      ctx.arc(x, y, r + 12, 0, 2 * Math.PI)
      ctx.fillStyle = grad
      ctx.fill()
    }

    // Soft glow for available
    if (node.status === 'available') {
      const grad = ctx.createRadialGradient(x, y, r * 0.5, x, y, r + 6)
      grad.addColorStop(0, color + '33')
      grad.addColorStop(1, color + '00')
      ctx.beginPath()
      ctx.arc(x, y, r + 6, 0, 2 * Math.PI)
      ctx.fillStyle = grad
      ctx.fill()
    }

    // Node fill
    ctx.beginPath()
    ctx.arc(x, y, r, 0, 2 * Math.PI)
    ctx.fillStyle = color
    ctx.fill()

    // Status ring
    ctx.beginPath()
    ctx.arc(x, y, r + 2, 0, 2 * Math.PI)
    ctx.strokeStyle = cfg.ring
    ctx.lineWidth = node.status === 'in-progress' ? 2.5 : 1.5
    ctx.stroke()

    // Pin indicator
    if (pinnedNodes.has(node.id)) {
      ctx.beginPath()
      ctx.arc(x + r * 0.7, y - r * 0.7, 3, 0, 2 * Math.PI)
      ctx.fillStyle = '#F59E0B'
      ctx.fill()
    }

    // Checkmark for completed
    if (node.status === 'completed') {
      ctx.fillStyle = 'rgba(255,255,255,0.95)'
      ctx.font = `bold ${Math.max(r * 0.9, 7)}px sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('✓', x, y)
    }

    // Lock for locked
    if (node.status === 'locked') {
      ctx.fillStyle = 'rgba(255,255,255,0.3)'
      ctx.font = `${Math.max(r * 0.8, 6)}px sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('🔒', x, y)
    }

    // Label
    const isHighlighted = !connectedNodeIds || connectedNodeIds.has(node.id)
    const fontSize = Math.max(12 / globalScale, 8)
    ctx.font = `${isHighlighted ? 600 : 400} ${fontSize}px Inter, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillStyle = isHighlighted
      ? cfg.opacity > 0.5 ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.5)'
      : 'rgba(255,255,255,0.2)'
    ctx.fillText(node.name, x, y + r + 3)

    ctx.globalAlpha = 1
  }, [connectedNodeIds, pinnedNodes])

  const linkCanvasObject = useCallback((link: GraphLink, ctx: CanvasRenderingContext2D) => {
    const src = link.source as GraphNode
    const tgt = link.target as GraphNode
    if (!src?.x || !tgt?.x) return

    const bothCompleted = src.status === 'completed' && tgt.status === 'completed'

    let linkAlpha = bothCompleted ? 0.55 : 0.25
    if (connectedNodeIds) {
      const srcId = src.id
      const tgtId = tgt.id
      if (connectedNodeIds.has(srcId) && connectedNodeIds.has(tgtId)) {
        linkAlpha = bothCompleted ? 0.9 : 0.7
      } else {
        linkAlpha = 0.04
      }
    }

    ctx.save()
    ctx.globalAlpha = linkAlpha

    if (!bothCompleted) {
      ctx.setLineDash([5, 4])
    }

    ctx.beginPath()
    ctx.moveTo(src.x!, src.y!)
    ctx.lineTo(tgt.x!, tgt.y!)
    ctx.strokeStyle = bothCompleted ? '#22C55E' : 'rgba(148,163,184,0.8)'
    ctx.lineWidth = bothCompleted ? 1.5 : 1
    ctx.stroke()
    ctx.setLineDash([])
    ctx.restore()
  }, [connectedNodeIds])

  const handleNodeClick = useCallback((node: GraphNode) => {
    setSelectedNode(node)
  }, [])

  const handleNodeHover = useCallback((node: GraphNode | null) => {
    setHoveredNode(node)
  }, [])

  const handleEngineStop = useCallback(() => {
    if (graphRef.current && !forcesReady) {
      graphRef.current.zoomToFit(400, 40)
    }
  }, [forcesReady])

  const toggleSubject = (subject: string) => {
    setActiveSubjects(prev => {
      const next = new Set(prev)
      if (next.has(subject) && next.size > 1) {
        next.delete(subject)
      } else {
        next.add(subject)
      }
      return next
    })
  }

  const toggleAllSubjects = () => {
    const allSubjects = new Set(Object.keys(SUBJECT_COLORS))
    if (activeSubjects.size === allSubjects.size) {
      // keep first one selected
      setActiveSubjects(new Set([Object.keys(SUBJECT_COLORS)[0]]))
    } else {
      setActiveSubjects(allSubjects)
    }
  }

  const togglePin = (nodeId: string) => {
    const gNode = graphData.nodes.find(n => n.id === nodeId) as GraphNode | undefined
    setPinnedNodes(prev => {
      const next = new Set(prev)
      if (next.has(nodeId)) {
        next.delete(nodeId)
        if (gNode) { gNode.fx = null; gNode.fy = null }
      } else {
        next.add(nodeId)
        if (gNode) { gNode.fx = gNode.x; gNode.fy = gNode.y }
      }
      return next
    })
  }

  const resetView = () => {
    graphRef.current?.zoomToFit(400, 40)
    graphRef.current?.d3ReheatSimulation?.()
  }

  if (!mounted) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    )
  }

  const searchHighlightIds = searchQuery
    ? new Set(filteredNodes.filter(n =>
        n.label.toLowerCase().includes(searchQuery.toLowerCase())
      ).map(n => n.id))
    : null

  return (
    <div ref={containerRef} className="relative w-full h-full select-none">
      <ForceGraph2D
        ref={graphRef}
        graphData={graphData}
        width={dimensions.width}
        height={dimensions.height}
        nodeCanvasObject={nodeCanvasObject as never}
        nodeCanvasObjectMode={() => 'replace'}
        linkCanvasObject={linkCanvasObject as never}
        linkCanvasObjectMode={() => 'replace'}
        linkDirectionalArrowLength={5}
        linkDirectionalArrowRelPos={0.9}
        linkDirectionalArrowColor={(link) => {
          const src = link.source as GraphNode
          const tgt = link.target as GraphNode
          return src?.status === 'completed' && tgt?.status === 'completed'
            ? '#22C55E'
            : 'rgba(148,163,184,0.5)'
        }}
        linkDirectionalParticles={(link) => {
          const src = link.source as GraphNode
          const tgt = link.target as GraphNode
          return src?.status === 'completed' && tgt?.status === 'completed' ? 2 : 0
        }}
        linkDirectionalParticleSpeed={0.003}
        linkDirectionalParticleWidth={2}
        linkDirectionalParticleColor={() => '#4ADE80'}
        onNodeClick={handleNodeClick as never}
        onNodeHover={handleNodeHover as never}
        onEngineStop={handleEngineStop}
        backgroundColor="transparent"
        cooldownTicks={150}
        d3AlphaDecay={0.02}
        d3VelocityDecay={0.3}
        nodeLabel=""
      />

      {/* Top toolbar */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-2">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search concepts…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="bg-card/95 backdrop-blur-sm border border-border rounded-lg pl-9 pr-4 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 w-48"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2"
            >
              <X className="w-3 h-3 text-muted-foreground" />
            </button>
          )}
        </div>

        {/* Filter toggle */}
        <button
          onClick={() => setShowFilters(v => !v)}
          className={`flex items-center gap-1.5 bg-card/95 backdrop-blur-sm border rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
            showFilters
              ? 'border-primary/40 text-primary'
              : 'border-border text-muted-foreground hover:text-foreground'
          }`}
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          Filter
          <ChevronDown className={`w-3 h-3 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
        </button>

        {/* Reset view */}
        <button
          onClick={resetView}
          className="flex items-center gap-1.5 bg-card/95 backdrop-blur-sm border border-border rounded-lg px-3 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
          title="Reset view"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Filter panel */}
      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="absolute top-16 left-1/2 -translate-x-1/2 bg-card/98 backdrop-blur-sm border border-border rounded-xl p-4 shadow-xl z-10"
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Filter by Subject
              </span>
              <button
                onClick={toggleAllSubjects}
                className="text-xs text-primary hover:underline"
              >
                {activeSubjects.size === Object.keys(SUBJECT_COLORS).length ? 'Deselect all' : 'Select all'}
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(SUBJECT_COLORS).map(([subj, color]) => (
                <button
                  key={subj}
                  onClick={() => toggleSubject(subj)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                    activeSubjects.has(subj)
                      ? 'border-transparent text-white'
                      : 'border-border text-muted-foreground bg-muted/30 opacity-50'
                  }`}
                  style={activeSubjects.has(subj) ? { backgroundColor: color + 'CC', borderColor: color } : {}}
                >
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                  {subj}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Legend - bottom left */}
      <div className="absolute bottom-4 left-4 bg-card/90 backdrop-blur-sm border border-border rounded-xl p-3 space-y-1.5">
        <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Legend</div>
        {Object.entries(SUBJECT_COLORS).map(([subj, color]) => (
          <div key={subj} className={`flex items-center gap-2 text-xs transition-opacity ${activeSubjects.has(subj) ? 'text-foreground' : 'text-muted-foreground opacity-40'}`}>
            <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
            {subj}
          </div>
        ))}
        <div className="pt-2 border-t border-border space-y-1.5">
          {Object.entries(STATUS_CONFIG).map(([status, cfg]) => (
            <div key={status} className="flex items-center gap-2 text-xs text-foreground">
              <div className="w-2.5 h-2.5 rounded-full border-2 flex-shrink-0" style={{ borderColor: cfg.ring, opacity: cfg.opacity }} />
              {cfg.label}
            </div>
          ))}
        </div>
        <div className="pt-2 border-t border-border space-y-1.5">
          <div className="flex items-center gap-2 text-xs text-foreground">
            <div className="w-8 border-t-2 border-green-400 flex-shrink-0" />
            Completed path
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <div className="w-8 border-t border-dashed border-slate-400 flex-shrink-0" />
            Prerequisite
          </div>
        </div>
        <div className="pt-2 border-t border-border text-[10px] text-muted-foreground leading-relaxed">
          Size = # connections
        </div>
      </div>

      {/* Search match count */}
      {searchQuery && searchHighlightIds && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 bg-card/90 backdrop-blur-sm border border-border rounded-lg px-3 py-1.5 text-xs text-muted-foreground">
          {searchHighlightIds.size === 0
            ? 'No matches'
            : `${searchHighlightIds.size} match${searchHighlightIds.size > 1 ? 'es' : ''}`}
        </div>
      )}

      {/* Node detail panel */}
      <AnimatePresence>
        {selectedNode && (
          <motion.div
            key={selectedNode.id}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="absolute top-4 right-4 w-80 bg-card/98 backdrop-blur-sm border border-border rounded-xl shadow-2xl overflow-hidden"
          >
            <div className="p-4 border-b border-border flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <div
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: SUBJECT_COLORS[selectedNode.subject] }}
                  />
                  <span className="text-xs text-muted-foreground">{selectedNode.subject}</span>
                  {selectedNode.connectionCount > 0 && (
                    <span className="text-[10px] text-muted-foreground ml-auto">
                      {selectedNode.connectionCount} connection{selectedNode.connectionCount !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
                <h3 className="font-semibold text-foreground">{selectedNode.name}</h3>
              </div>
              <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                <button
                  onClick={() => togglePin(selectedNode.id)}
                  className="p-1.5 hover:bg-accent rounded-md transition-colors"
                  title={pinnedNodes.has(selectedNode.id) ? 'Unpin' : 'Pin node'}
                >
                  {pinnedNodes.has(selectedNode.id)
                    ? <PinOff className="w-3.5 h-3.5 text-amber-400" />
                    : <Pin className="w-3.5 h-3.5 text-muted-foreground" />}
                </button>
                <button
                  onClick={() => setSelectedNode(null)}
                  className="p-1.5 hover:bg-accent rounded-md transition-colors"
                >
                  <X className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
              </div>
            </div>

            <ScrollArea className="h-72">
              <div className="p-4 space-y-4">
                <div className="flex items-center gap-2">
                  {selectedNode.status === 'completed' && <CheckCircle className="w-4 h-4 text-green-400" />}
                  {selectedNode.status === 'in-progress' && <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />}
                  {selectedNode.status === 'available' && <Circle className="w-4 h-4 text-slate-400" />}
                  {selectedNode.status === 'locked' && <Lock className="w-4 h-4 text-slate-600" />}
                  <Badge
                    variant={
                      selectedNode.status === 'completed' ? 'success'
                        : selectedNode.status === 'in-progress' ? 'default'
                        : 'outline'
                    }
                  >
                    {STATUS_CONFIG[selectedNode.status as keyof typeof STATUS_CONFIG]?.label}
                  </Badge>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground ml-auto">
                    <Clock className="w-3 h-3" />
                    {selectedNode.estimatedHours}h
                  </div>
                </div>

                <p className="text-sm text-muted-foreground leading-relaxed">
                  {selectedNode.description}
                </p>

                {selectedNode.resources.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <BookOpen className="w-4 h-4 text-primary" />
                      <span className="text-xs font-semibold text-foreground uppercase tracking-wider">
                        Resources
                      </span>
                    </div>
                    <div className="space-y-2">
                      {selectedNode.resources.map((r, i) => (
                        <div key={i} className="flex items-start gap-2 text-xs">
                          <Badge variant="outline" className="text-[10px] flex-shrink-0 mt-0.5">
                            {r.type}
                          </Badge>
                          <span className="text-foreground">{r.title}</span>
                          {r.duration && (
                            <span className="text-muted-foreground ml-auto flex-shrink-0">
                              {r.duration}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {selectedNode.status === 'available' && (
                  <div className="pt-2">
                    <button className="w-full bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 rounded-lg py-2 text-xs font-medium transition-colors">
                      Start Learning →
                    </button>
                  </div>
                )}

                {selectedNode.status === 'in-progress' && (
                  <div className="pt-2">
                    <button className="w-full bg-primary text-primary-foreground rounded-lg py-2 text-xs font-medium hover:bg-primary/90 transition-colors">
                      Continue →
                    </button>
                  </div>
                )}
              </div>
            </ScrollArea>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
