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

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const userId = await getUserId()
  const tree = await getTreeWithNodes(userId, id)
  if (!tree) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ tree })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const userId = await getUserId()
  const { status } = (await req.json().catch(() => ({}))) as { status?: string }
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
