export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getUserId } from '@/lib/get-user-id'

// PATCH /api/highlights/[id]
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getUserId()
  const { id } = await params
  const body = await req.json()

  // Verify ownership
  const existing = await prisma.messageHighlight.findFirst({
    where: { id, userId },
  })
  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const updated = await prisma.messageHighlight.update({
    where: { id },
    data: {
      ...(body.comment !== undefined ? { comment: body.comment || null } : {}),
      ...(body.color ? { color: body.color } : {}),
    },
  })

  return NextResponse.json({ highlight: updated })
}

// DELETE /api/highlights/[id]
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getUserId()
  const { id } = await params

  // Verify ownership
  const existing = await prisma.messageHighlight.findFirst({
    where: { id, userId },
  })
  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  await prisma.messageHighlight.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
