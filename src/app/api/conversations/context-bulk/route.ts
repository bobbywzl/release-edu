export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getUserId } from '@/lib/get-user-id'

// POST { conversationIds: string[] }
// Returns which convIds are linked to chapters or projects, with context for sidebar badges
export async function POST(req: NextRequest) {
  const userId = await getUserId()
  const { conversationIds } = await req.json() as { conversationIds: string[] }

  if (!conversationIds || conversationIds.length === 0) {
    return NextResponse.json({ chapters: {}, projects: {} })
  }

  // Find all chapters belonging to this user that have a sessionConvId in the list
  const chapters = await prisma.chapter.findMany({
    where: {
      sessionConvId: { in: conversationIds },
      track: { userId },
    },
    select: {
      id: true,
      title: true,
      status: true,
      sessionConvId: true,
      sessionScore: true,
      track: { select: { id: true, name: true } },
    },
  })

  // Find all projects belonging to this user that have an exploreConvId in the list
  const projects = await prisma.subjectProject.findMany({
    where: {
      exploreConvId: { in: conversationIds },
      track: { userId },
    },
    select: {
      id: true,
      title: true,
      exploreConvId: true,
      status: true,
      track: { select: { id: true, name: true } },
    },
  })

  // Build maps keyed by conversationId
  const chapterMap: Record<string, object> = {}
  for (const ch of chapters) {
    if (!ch.sessionConvId) continue
    chapterMap[ch.sessionConvId] = {
      id: ch.id,
      title: ch.title,
      status: ch.status,
      trackId: ch.track.id,
      trackName: ch.track.name,
      sessionConvId: ch.sessionConvId,
      sessionScore: ch.sessionScore ?? 0,
    }
  }

  const projectMap: Record<string, object> = {}
  for (const proj of projects) {
    if (!proj.exploreConvId) continue
    projectMap[proj.exploreConvId] = {
      id: proj.id,
      title: proj.title,
      trackId: proj.track.id,
      trackName: proj.track.name,
      projectMode: proj.status === 'proposal' ? 'explore' : 'work',
    }
  }

  return NextResponse.json({ chapters: chapterMap, projects: projectMap })
}
