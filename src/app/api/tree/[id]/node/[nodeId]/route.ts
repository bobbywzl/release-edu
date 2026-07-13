export const dynamic = 'force-dynamic'

/**
 * PATCH /api/tree/[id]/node/[nodeId]
 *   { action: 'approve' }            — accept a pending proposed node
 *   { action: 'reject' }             — discard a pending proposed node
 *   { action: 'learning' }           — mark node as being worked on
 *   { action: 'annotate', text }     — append a user annotation to the explainer
 *   { action: 'notes', text }        — save the student's editable per-node notes
 *   { action: 'add_child', title, summary? } — student manually adds a child node
 *   { action: 'edit', title?, summary? }     — rewrite title/summary (an approved copilot chip)
 *   { action: 'move', newParentId }  — re-parent the node, subtree follows (root immovable, cycle-guarded)
 *   { action: 'delete' }             — delete this node AND its descendants (root protected)
 *
 * NOTE: there is deliberately NO action to set status to 'understood' —
 * mastery is AI-verified only, via in-chat checkpoint answers (see ./quiz).
 */
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getUserId } from '@/lib/get-user-id'
import { collectSubtreeIds } from '@/lib/tree-engine'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; nodeId: string }> },
) {
  const { id, nodeId } = await params
  const userId = await getUserId()
  const body = (await req.json().catch(() => ({}))) as { action?: string; text?: string; title?: string; summary?: string; newParentId?: string }

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
    case 'edit': {
      // Approved reshape chip (or a manual rename): rewrite title/summary
      // only — status, mastery tally, notes and children are untouched.
      // Edits refine the SAME concept (the copilot is instructed to propose
      // delete + regrow for a different one).
      const title = typeof body.title === 'string' ? body.title.trim().slice(0, 120) : ''
      const summary = typeof body.summary === 'string' ? body.summary.trim().slice(0, 500) : ''
      if (!title && !summary) return NextResponse.json({ error: 'Nothing to edit' }, { status: 400 })
      const titleChanged = !!title && title !== node.title
      await prisma.treeNode.update({
        where: { id: nodeId },
        data: {
          ...(title ? { title } : {}),
          ...(summary ? { summary } : {}),
          // A renamed node's cached explainer opens with the OLD framing —
          // drop it so the next visit regenerates against the new wording.
          ...(titleChanged && node.explainer ? { explainer: null } : {}),
        },
      })
      // The root node IS the problem: keep ProblemTree.title (page headers,
      // the tree list, every prompt's PROBLEM line) in lock-step with a root
      // rename — a desync would put two contradictory problem statements in
      // Bob's context forever.
      if (titleChanged && !node.parentId) {
        await prisma.problemTree.update({ where: { id }, data: { title } }).catch(() => null)
      }
      return NextResponse.json({ ok: true })
    }
    case 'move': {
      const newParentId = typeof body.newParentId === 'string' ? body.newParentId : ''
      if (!newParentId) return NextResponse.json({ error: 'newParentId required' }, { status: 400 })
      if (!node.parentId) return NextResponse.json({ error: 'The root problem cannot be moved' }, { status: 400 })
      if (newParentId === nodeId) return NextResponse.json({ error: 'A node cannot be its own parent' }, { status: 400 })
      const parent = await prisma.treeNode.findFirst({ where: { id: newParentId, treeId: id } })
      if (!parent || parent.pending) return NextResponse.json({ error: 'Target parent not found' }, { status: 400 })
      // Cycle guard on live data: the new parent must not live inside the
      // moving node's own subtree (walks ALL nodes, pending included).
      const all = await prisma.treeNode.findMany({ where: { treeId: id }, select: { id: true, parentId: true } })
      if (collectSubtreeIds(all, nodeId).has(newParentId)) {
        return NextResponse.json({ error: 'Cannot move a node into its own branch' }, { status: 400 })
      }
      const siblings = await prisma.treeNode.count({ where: { parentId: newParentId } })
      await prisma.treeNode.update({ where: { id: nodeId }, data: { parentId: newParentId, order: siblings } })
      return NextResponse.json({ ok: true })
    }
    case 'delete': {
      if (!node.parentId) return NextResponse.json({ error: 'The root problem cannot be deleted' }, { status: 400 })
      // Children reference parents by id without a cascading FK — collect the
      // whole subtree and delete it in one sweep so no orphans remain.
      const all = await prisma.treeNode.findMany({ where: { treeId: id }, select: { id: true, parentId: true } })
      const toDelete = collectSubtreeIds(all, nodeId)
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
