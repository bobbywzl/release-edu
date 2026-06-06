import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * Cleanup cron: deletes demo user data older than 24 hours.
 * Demo users have IDs starting with "demo-".
 */
export async function GET() {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000) // 24 hours ago

  // Find demo users created more than 24 hours ago
  const demoUsers = await prisma.user.findMany({
    where: {
      id: { startsWith: 'demo-' },
      createdAt: { lt: cutoff },
    },
    select: { id: true },
  })

  if (demoUsers.length === 0) {
    return NextResponse.json({ cleaned: 0, message: 'No stale demo users found' })
  }

  const ids = demoUsers.map(u => u.id)

  // Cascade delete everything — User has onDelete: Cascade on all relations
  // But some models don't have direct User relations, so clean them explicitly
  for (const userId of ids) {
    await prisma.sessionOutcome.deleteMany({ where: { userId } })
    await prisma.conversationArchive.deleteMany({ where: { userId } })
    await prisma.curriculumBlock.deleteMany({ where: { userId } })
  }

  // Delete the users — cascades to conversations, messages, tracks, chapters, etc.
  const result = await prisma.user.deleteMany({
    where: { id: { in: ids } },
  })

  console.log(`[Demo Cleanup] Deleted ${result.count} stale demo users`)

  return NextResponse.json({ cleaned: result.count })
}
