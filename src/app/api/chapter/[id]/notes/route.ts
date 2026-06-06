export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getUserId } from '@/lib/get-user-id'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const userId = await getUserId()

  const chapter = await prisma.chapter.findUnique({
    where: { id },
    select: { id: true, title: true, notes: true, track: { select: { userId: true, name: true } } },
  })

  if (!chapter || chapter.track?.userId !== userId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json({ notes: chapter.notes || '', title: chapter.title })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { notes } = await req.json()
  const userId = await getUserId()

  const chapter = await prisma.chapter.findUnique({
    where: { id },
    select: { id: true, track: { select: { userId: true } } },
  })

  if (!chapter || chapter.track?.userId !== userId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  await prisma.chapter.update({ where: { id }, data: { notes } })
  return NextResponse.json({ success: true })
}
