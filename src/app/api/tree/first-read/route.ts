export const dynamic = 'force-dynamic'

/**
 * POST /api/tree/first-read { problem, lang? } — the RECIPROCITY gift of the
 * session onboarding: Bob's genuinely useful 2-3 sentence read on the
 * just-typed problem, delivered while the learner answers the remaining
 * setup questions (value received before anything else is asked of them).
 */
import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '@/lib/get-user-id'
import { firstProblemRead } from '@/lib/tree-engine'

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserId()
    const body = (await req.json().catch(() => ({}))) as { problem?: string; lang?: string }
    const problem = (body.problem ?? '').trim()
    if (!problem) return NextResponse.json({ read: null })
    const read = await firstProblemRead(userId, problem, body.lang)
    return NextResponse.json({ read })
  } catch {
    return NextResponse.json({ read: null })
  }
}
