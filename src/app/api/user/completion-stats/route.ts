export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getUserCompletionStats } from '@/lib/status-cascade'
import { getUserId } from '@/lib/get-user-id'

export async function GET() {
  const userId = await getUserId()
  // Same guard as /api/curriculum-overview: a transient session failure must
  // surface as 401, not as a 200 with all-zero stats the client trusts.
  if (userId === 'anonymous' || userId === 'unknown') {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const stats = await getUserCompletionStats(userId)
  return NextResponse.json(stats)
}
