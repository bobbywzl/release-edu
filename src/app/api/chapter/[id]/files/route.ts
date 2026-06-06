export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getUserId } from '@/lib/get-user-id'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const userId = await getUserId()
  const files = await prisma.linkedFile.findMany({
    where: { workId: id, userId },
    orderBy: { addedAt: 'desc' },
  })
  return NextResponse.json({ files })
}
