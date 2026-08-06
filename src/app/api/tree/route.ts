export const dynamic = 'force-dynamic'
// Seeding calls Opus once — give it headroom on Vercel.
export const maxDuration = 120

/**
 * GET  /api/tree            — list the student's problem trees
 * POST /api/tree {problem}  — create + seed a new tree (root + solutions + 1 level)
 */
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getUserId } from '@/lib/get-user-id'
import { seedTree, generateTreeDisplayTitle } from '@/lib/tree-engine'

// Per-instance guard so a burst of list GETs doesn't fire duplicate Haiku
// backfills for the same tree while the first write is still in flight.
const titleBackfillInflight = new Set<string>()

export async function GET() {
  const userId = await getUserId()
  const trees = await prisma.problemTree.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    include: { nodes: { select: { id: true, status: true, pending: true, parentId: true, progressLog: true } } },
  }).catch(() => [])

  // Lazy backfill: trees created before displayTitle existed get a Haiku
  // headline in the background (≤3 per request, non-blocking) — the next
  // list load shows it. New trees get theirs at seed time.
  try {
    const missing = trees.filter(t => !t.displayTitle && !titleBackfillInflight.has(t.id)).slice(0, 3)
    if (missing.length > 0) {
      const { inBackground } = await import('@/lib/background')
      for (const t of missing) {
        titleBackfillInflight.add(t.id)
        inBackground((async () => {
          try {
            const dt = await generateTreeDisplayTitle(userId, t.title, t.language ?? undefined)
            if (dt) await prisma.problemTree.update({ where: { id: t.id }, data: { displayTitle: dt } })
          } finally {
            titleBackfillInflight.delete(t.id)
          }
        })())
      }
    }
  } catch { /* non-critical — cards fall back to the verbatim title */ }

  // Explained vs Deployed (qa-findings-4 №2): a completed tree is DEPLOYED
  // when real build evidence exists — a non-empty build log on any node, or
  // an uploaded artifact (per-node or tree-level). One grouped query for the
  // completed trees only; everything else it needs is already in `trees`.
  const evidenceWorkIds = new Set<string>()
  try {
    const done = trees.filter(t => t.status === 'completed')
    const ids = [...done.map(t => t.id), ...done.flatMap(t => t.nodes.map(n => n.id))]
    if (ids.length > 0) {
      const rows = await prisma.linkedFile.findMany({
        where: { workType: { in: ['tree-node', 'tree'] }, workId: { in: ids } },
        select: { workId: true },
      })
      for (const r of rows) if (r.workId) evidenceWorkIds.add(r.workId)
    }
  } catch { /* non-critical — cards fall back to the Explained label */ }
  const hasBuildLog = (log: string | null) => {
    try { const l = JSON.parse(log ?? '[]'); return Array.isArray(l) && l.length > 0 } catch { return false }
  }

  return NextResponse.json({
    trees: trees.map(t => {
      // The root (the problem statement) is not a masterable node — progress
      // counts the branches only, so 100% is actually reachable.
      const real = t.nodes.filter(n => !n.pending && n.parentId !== null)
      const deployed = t.status === 'completed' && (
        evidenceWorkIds.has(t.id) ||
        t.nodes.some(n => evidenceWorkIds.has(n.id) || hasBuildLog(n.progressLog))
      )
      return {
        id: t.id,
        title: t.title,
        displayTitle: t.displayTitle,
        framing: t.framing,
        status: t.status,
        deployed,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        nodeCount: real.length,
        understoodCount: real.filter(n => n.status === 'understood').length,
        // Goal-gradient head start + endowment accent for the cards.
        hasPurpose: !!(t.purpose && t.purpose.trim()),
        accentColor: t.accentColor ?? null,
      }
    }),
  })
}

export async function POST(req: NextRequest) {
  const userId = await getUserId()
  const { problem, lang, difficulty, personalContext, purpose } = (await req.json().catch(() => ({}))) as {
    problem?: string; lang?: string; difficulty?: string; personalContext?: string; purpose?: string
  }
  if (!problem?.trim()) {
    return NextResponse.json({ error: 'A problem statement is required' }, { status: 400 })
  }
  try {
    const treeId = await seedTree(userId, problem.trim(), { lang, difficulty, personalContext, purpose })
    // The "make it yours" screen needs the Haiku headline as its editable
    // default — return it so the client never re-fetches mid-celebration.
    const created = await prisma.problemTree.findUnique({ where: { id: treeId }, select: { displayTitle: true } }).catch(() => null)
    return NextResponse.json({ id: treeId, displayTitle: created?.displayTitle ?? null }, { status: 201 })
  } catch (err) {
    console.error('[tree] seed failed:', err)
    return NextResponse.json({ error: 'Could not grow the tree right now. Try again in a moment.' }, { status: 502 })
  }
}
