export const dynamic = 'force-dynamic'

/**
 * GET /api/tree/defaults — SMART DEFAULTS for the session onboarding: the
 * previous session's language / difficulty / personal background, so a
 * returning learner scans-and-adjusts instead of retyping. Empty object for
 * a first-time user (the stepper keeps its built-in defaults).
 */
import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getUserId } from '@/lib/get-user-id'

export async function GET() {
  try {
    const userId = await getUserId()
    const last = await prisma.problemTree.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { language: true, difficulty: true, personalContext: true },
    })
    return NextResponse.json({
      language: last?.language ?? null,
      difficulty: last?.difficulty ?? null,
      background: last?.personalContext ?? null,
    })
  } catch {
    return NextResponse.json({ language: null, difficulty: null, background: null })
  }
}
