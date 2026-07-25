export const dynamic = 'force-dynamic'

/**
 * POST /api/tree/purpose-ideas { problem, lang? } — SMART DEFAULTS for the
 * session onboarding's purpose step: 3 tappable candidate purposes drafted
 * from the just-typed problem (Haiku). Fired in the background the moment
 * the student advances past the problem question; the stepper never waits
 * on it (canned localized chips render until these land).
 */
import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '@/lib/get-user-id'
import { suggestPurposeIdeas } from '@/lib/tree-engine'

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserId()
    const body = (await req.json().catch(() => ({}))) as { problem?: string; lang?: string }
    const problem = (body.problem ?? '').trim()
    if (!problem) return NextResponse.json({ ideas: null })
    const ideas = await suggestPurposeIdeas(userId, problem, body.lang)
    return NextResponse.json({ ideas })
  } catch {
    return NextResponse.json({ ideas: null })
  }
}
