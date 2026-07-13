export const dynamic = 'force-dynamic'

/**
 * GET    /api/tree/[id]  — full tree with nodes
 * PATCH  /api/tree/[id]  — { status } (archive / reactivate)
 * DELETE /api/tree/[id]
 */
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getUserId } from '@/lib/get-user-id'
import { getTreeWithNodes } from '@/lib/tree-engine'
import { sanitizeQuizStateForClient } from '@/lib/mastery'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const userId = await getUserId()
  const tree = await getTreeWithNodes(userId, id)
  if (!tree) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  // Answer-key protection (mastery.ts invariant): the live checkpoint's
  // correctIndex/explanation/rubric live in node.quizState and must NEVER
  // reach the browser — sanitize every node's quizState before it ships.
  // The workspace pips read only tally/facet fields + a sanitized pending.
  const safeTree = {
    ...tree,
    nodes: tree.nodes.map(n => ({ ...n, quizState: sanitizeQuizStateForClient(n.quizState) })),
  }
  return NextResponse.json({ tree: safeTree })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const userId = await getUserId()
  const body = (await req.json().catch(() => ({}))) as { status?: string; action?: string; purpose?: string }

  // Copilot purpose refinement — applied only on the student's explicit
  // Approve tap (permission-based, like all tree changes).
  if (body.action === 'set_purpose') {
    const purpose = (body.purpose ?? '').trim().slice(0, 500)
    if (!purpose) return NextResponse.json({ error: 'Purpose required' }, { status: 400 })
    const updated = await prisma.problemTree.updateMany({ where: { id, userId }, data: { purpose } })
    if (updated.count === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ ok: true })
  }

  const status = body.status
  if (!status || !['active', 'completed', 'archived'].includes(status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }
  const updated = await prisma.problemTree.updateMany({ where: { id, userId }, data: { status } })
  if (updated.count === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const userId = await getUserId()
  const deleted = await prisma.problemTree.deleteMany({ where: { id, userId } })
  if (deleted.count === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
