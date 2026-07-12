export const dynamic = 'force-dynamic'

/**
 * PATCH /api/tree/[id]/node/[nodeId]
 *   { action: 'approve' }            — accept a pending proposed node
 *   { action: 'reject' }             — discard a pending proposed node
 *   { action: 'learning' }           — mark node as being worked on
 *   { action: 'annotate', text }     — append a user annotation to the explainer
 *   { action: 'notes', text }        — save the student's editable per-node notes
 *   { action: 'add_child', title, summary? } — student manually adds a child node
 *   { action: 'delete' }             — delete this node AND its descendants (root protected)
 *
 * NOTE: there is deliberately NO action to set status to 'understood' —
 * mastery is AI-verified only, via in-chat checkpoint answers (see ./quiz).
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
  const body = (await req.json().catch(() => ({}))) as { action?: string; text?: string; title?: string; summary?: string }

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
    case 'add_child': {
      const title = (body.title ?? '').trim()
      if (!title) return NextResponse.json({ error: 'Title required' }, { status: 400 })
      const siblings = await prisma.treeNode.count({ where: { parentId: nodeId } })
      const created = await prisma.treeNode.create({
        data: {
          treeId: id, parentId: nodeId, kind: 'component',
          title: title.slice(0, 120), summary: (body.summary ?? '').trim().slice(0, 500),
          pending: false, order: siblings,
        },
      })
      return NextResponse.json({ ok: true, node: created })
    }
    case 'delete': {
      if (!node.parentId) return NextResponse.json({ error: 'The root problem cannot be deleted' }, { status: 400 })
      // Children reference parents by id without a cascading FK — collect the
      // whole subtree and delete it in one sweep so no orphans remain.
      const all = await prisma.treeNode.findMany({ where: { treeId: id }, select: { id: true, parentId: true } })
      const toDelete = new Set<string>([nodeId])
      let grew = true
      while (grew) {
        grew = false
        for (const n of all) {
          if (n.parentId && toDelete.has(n.parentId) && !toDelete.has(n.id)) {
            toDelete.add(n.id)
            grew = true
          }
        }
      }
      await prisma.treeNode.deleteMany({ where: { id: { in: Array.from(toDelete) } } })
      return NextResponse.json({ ok: true, deleted: toDelete.size })
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
      // Compare-and-set append (fresh read each try): two concurrent
      // annotates from separate tabs must not last-writer-win each other.
      let annotations: Array<{ text: string; createdAt: string }> = []
      for (let attempt = 0; attempt < 2; attempt++) {
        const row = attempt === 0 ? node : await prisma.treeNode.findUnique({ where: { id: nodeId }, select: { annotations: true } })
        const base = row?.annotations ?? null
        annotations = []
        try { annotations = JSON.parse(base ?? '[]') } catch { /* fresh */ }
        if (!Array.isArray(annotations)) annotations = []
        annotations.push({ text: text.slice(0, 1000), createdAt: new Date().toISOString() })
        const w = await prisma.treeNode.updateMany({
          where: { id: nodeId, annotations: base },
          data: { annotations: JSON.stringify(annotations) },
        }).catch(() => null)
        if (w && w.count > 0) break
      }
      return NextResponse.json({ ok: true, annotations })
    }
    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }
}
