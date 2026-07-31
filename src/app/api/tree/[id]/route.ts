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
import { sanitizeQuizStateForClient, parseQuizState, masteryMet } from '@/lib/mastery'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const userId = await getUserId()
  const tree = await getTreeWithNodes(userId, id)
  if (!tree) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // ── VERIFICATION RECONCILIATION (dead-lock consistency) ──
  // The coverage tally in quizState is the CONTRACT truth of verification;
  // the status column is its projection. If a verify-time side effect ever
  // failed between the two writes, a node could sit with every syllabus facet
  // proven but status stuck unverified — chat celebrating "Verified" while
  // the workspace shows otherwise. Repair that drift HERE, on every read, so
  // the two can never disagree for longer than one load. One-directional by
  // design: coverage-met promotes; nothing ever demotes.
  for (const n of tree.nodes) {
    if (n.pending || n.parentId === null || n.status === 'understood') continue
    try {
      if (masteryMet(parseQuizState(n.quizState))) {
        await prisma.treeNode.update({ where: { id: n.id }, data: { status: 'understood' } })
        n.status = 'understood'
        console.warn('[tree] reconciled stranded verification', { nodeId: n.id })
      }
    } catch { /* repair is best-effort; next read retries */ }
  }

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
  const body = (await req.json().catch(() => ({}))) as { status?: string; action?: string; purpose?: string; displayTitle?: string; accentColor?: string }

  // Copilot purpose refinement — applied only on the student's explicit
  // Approve tap (permission-based, like all tree changes).
  if (body.action === 'set_purpose') {
    const purpose = (body.purpose ?? '').trim().slice(0, 500)
    if (!purpose) return NextResponse.json({ error: 'Purpose required' }, { status: 400 })
    const updated = await prisma.problemTree.updateMany({ where: { id, userId }, data: { purpose } })
    if (updated.count === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ ok: true })
  }

  // "Make it yours" (endowment): rename the tree and/or pick its accent.
  if (body.action === 'set_meta') {
    const ACCENTS = ['#34D399', '#38BDF8', '#A78BFA', '#FBBF24', '#FB7185', '#2DD4BF']
    const displayTitle = typeof body.displayTitle === 'string' ? body.displayTitle.trim().slice(0, 80) : ''
    const accentColor = typeof body.accentColor === 'string' && ACCENTS.includes(body.accentColor) ? body.accentColor : null
    if (!displayTitle && !accentColor) return NextResponse.json({ error: 'Nothing to set' }, { status: 400 })
    const updated = await prisma.problemTree.updateMany({
      where: { id, userId },
      data: { ...(displayTitle ? { displayTitle } : {}), ...(accentColor ? { accentColor } : {}) },
    })
    if (updated.count === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ ok: true })
  }

  // 'completed' is NOT settable here (user decision, Jul 2026): mastery is
  // AI-verified only — the engine flips a tree to completed exactly when its
  // root verifies (markNodeVerified). Manual status changes cover archiving
  // and reactivation only; a reactivated completed tree returns to 'active'.
  const status = body.status
  if (!status || !['active', 'archived'].includes(status)) {
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
