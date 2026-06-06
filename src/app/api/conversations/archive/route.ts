export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getUserId } from '@/lib/get-user-id'

// GET /api/conversations/archive?linkedType=chapter&linkedId=xxx
// Retrieves the most recent archive for a given linked entity
export async function GET(req: NextRequest) {
  const userId = await getUserId()
  const linkedType = req.nextUrl.searchParams.get('linkedType')
  const linkedId = req.nextUrl.searchParams.get('linkedId')

  if (!linkedType || !linkedId) {
    return NextResponse.json({ error: 'linkedType and linkedId required' }, { status: 400 })
  }

  const archive = await prisma.conversationArchive.findFirst({
    where: { userId, linkedType, linkedId },
    orderBy: { archivedAt: 'desc' },
  })

  if (!archive) {
    return NextResponse.json({ archive: null })
  }

  return NextResponse.json({
    archive: {
      id: archive.id,
      linkedType: archive.linkedType,
      linkedId: archive.linkedId,
      linkedTitle: archive.linkedTitle,
      messages: JSON.parse(archive.messagesJson),
      archivedAt: archive.archivedAt.toISOString(),
    },
  })
}
