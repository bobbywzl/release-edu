export const dynamic = 'force-dynamic'

/**
 * GET /api/curriculum/status
 *
 * Lightweight poll target for the curriculum page. Reports whether a
 * chat-requested (L&C mode) curriculum reconstruction is currently being
 * applied in the background (CurriculumPlan.rebuildingAt), so the page can
 * show a "Bob is reconstructing your curriculum" banner and refresh itself
 * the moment the rebuild lands.
 */
import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getUserId } from '@/lib/get-user-id'

// A rebuild is a short background job (one extraction call + DB writes). If
// the flag is older than this, treat it as stale — e.g. a crashed job —
// rather than showing a banner forever.
const STALE_MS = 3 * 60_000

export async function GET() {
  const userId = await getUserId()

  let rebuildingAt: Date | null = null
  let lockedAt: Date | null = null
  try {
    const plan = await prisma.curriculumPlan.findUnique({
      where: { userId },
      select: { rebuildingAt: true, lockedAt: true },
    })
    rebuildingAt = plan?.rebuildingAt ?? null
    lockedAt = plan?.lockedAt ?? null
  } catch {
    // Schema lag (rebuildingAt not pushed yet) or no plan — report idle.
    return NextResponse.json({ rebuilding: false, lockedAt: null })
  }

  const rebuilding = !!rebuildingAt && Date.now() - new Date(rebuildingAt).getTime() < STALE_MS
  return NextResponse.json({ rebuilding, lockedAt })
}
