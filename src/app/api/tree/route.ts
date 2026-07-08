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
import { seedTree } from '@/lib/tree-engine'

export async function GET() {
  const userId = await getUserId()
  const trees = await prisma.problemTree.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    include: { nodes: { select: { id: true, status: true, pending: true } } },
  }).catch(() => [])
  return NextResponse.json({
    trees: trees.map(t => {
      const real = t.nodes.filter(n => !n.pending)
      return {
        id: t.id,
        title: t.title,
        framing: t.framing,
        status: t.status,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        nodeCount: real.length,
        understoodCount: real.filter(n => n.status === 'understood').length,
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
    return NextResponse.json({ id: treeId }, { status: 201 })
  } catch (err) {
    console.error('[tree] seed failed:', err)
    return NextResponse.json({ error: 'Could not grow the tree right now. Try again in a moment.' }, { status: 502 })
  }
}
