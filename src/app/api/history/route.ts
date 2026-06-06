import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '@/lib/get-user-id'
import prisma from '@/lib/prisma'

export const dynamic = 'force-dynamic'

// GET /api/history — list all curriculum blocks for the current user
export async function GET() {
  try {
    const userId = await getUserId()

    const blocks = await prisma.curriculumBlock.findMany({
      where: { userId },
      orderBy: { archivedAt: 'desc' },
    })

    return NextResponse.json({ blocks })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[History API] GET error:', message, err)
    return NextResponse.json({ blocks: [], error: message }, { status: 500 })
  }
}

// PATCH /api/history — toggle includedInPortfolio for a block
export async function PATCH(req: NextRequest) {
  const userId = await getUserId()
  const { blockId, includedInPortfolio } = await req.json() as { blockId: string; includedInPortfolio: boolean }

  const block = await prisma.curriculumBlock.findFirst({ where: { id: blockId, userId } })
  if (!block) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const updated = await prisma.curriculumBlock.update({
    where: { id: blockId },
    data: { includedInPortfolio },
  })

  return NextResponse.json({ block: updated })
}

// DELETE /api/history — permanently delete a curriculum block
export async function DELETE(req: NextRequest) {
  const userId = await getUserId()
  const { blockId } = await req.json() as { blockId: string }

  const block = await prisma.curriculumBlock.findFirst({ where: { id: blockId, userId } })
  if (!block) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.curriculumBlock.delete({ where: { id: blockId } })

  return NextResponse.json({ success: true })
}
