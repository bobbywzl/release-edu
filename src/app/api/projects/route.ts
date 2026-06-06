export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getUserId } from '@/lib/get-user-id'

// POST /api/projects — create a custom project
export async function POST(req: NextRequest) {
  const userId = await getUserId()
  const body = await req.json() as { title: string; description?: string; trackId?: string }

  if (!body.title?.trim()) {
    return NextResponse.json({ error: 'Title required' }, { status: 400 })
  }

  // Find a track to attach to — use provided trackId or first track
  let trackId = body.trackId
  if (!trackId) {
    const firstTrack = await prisma.track.findFirst({
      where: { userId },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    })
    if (!firstTrack) return NextResponse.json({ error: 'No curriculum found' }, { status: 400 })
    trackId = firstTrack.id
  }

  // Verify ownership
  const track = await prisma.track.findFirst({ where: { id: trackId, userId } })
  if (!track) return NextResponse.json({ error: 'Track not found' }, { status: 404 })

  const project = await prisma.subjectProject.create({
    data: {
      trackId,
      title: body.title.trim(),
      description: body.description?.trim() || null,
      status: 'planning',
      progress: 0,
    },
  })

  return NextResponse.json({ project }, { status: 201 })
}
