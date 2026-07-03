export const dynamic = 'force-dynamic'

/**
 * PATCH /api/tree/[id]/node/[nodeId]
 *   { action: 'approve' }            — accept a pending proposed node
 *   { action: 'reject' }             — discard a pending proposed node
 *   { action: 'learning' }           — mark node as being worked on
 *   { action: 'annotate', text }     — append a user annotation to the explainer
 *   { action: 'notes', text }        — save the student's editable per-node notes
 *
 * NOTE: there is deliberately NO action to set status to 'understood' —
 * mastery is AI-verified only (see ./verify).
 */
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getUserId } from '@/lib/get-user-id'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; nodeId: string }> },
) {
  const { id, nodeId } = await params
  const userId = await getUserId()
  const body = (await req.json().catch(() => ({}))) as { action?: string; text?: string }

  // Ownership check through the tree.
  const node = await prisma.treeNode.findFirst({
    where: { id: nodeId, treeId: id, tree: { userId } },
  })
  if (!node) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  switch (body.action) {
    case 'approve': {
      if (!node.pending) return NextResponse.json({ ok: true })
      await prisma.treeNode.update({ where: { id: nodeId }, data: { pending: false } })
      return NextResponse.json({ ok: true })
    }
    case 'reject': {
      if (!node.pending) return NextResponse.json({ error: 'Only pending nodes can be rejected' }, { status: 400 })
      await prisma.treeNode.delete({ where: { id: nodeId } })
      return NextResponse.json({ ok: true })
    }
    case 'learning': {
      if (node.status === 'understood') return NextResponse.json({ ok: true })
      await prisma.treeNode.update({ where: { id: nodeId }, data: { status: 'learning' } })
      return NextResponse.json({ ok: true })
    }
    case 'notes': {
      await prisma.treeNode.update({
        where: { id: nodeId },
        data: { notes: (body.text ?? '').slice(0, 20_000) },
      })
      return NextResponse.json({ ok: true })
    }
    case 'annotate': {
      const text = (body.text ?? '').trim()
      if (!text) return NextResponse.json({ error: 'Annotation text required' }, { status: 400 })
      let annotations: Array<{ text: string; createdAt: string }> = []
      try { annotations = JSON.parse(node.annotations ?? '[]') } catch { /* fresh */ }
      annotations.push({ text: text.slice(0, 1000), createdAt: new Date().toISOString() })
      await prisma.treeNode.update({ where: { id: nodeId }, data: { annotations: JSON.stringify(annotations) } })
      return NextResponse.json({ ok: true, annotations })
    }
    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }
}
