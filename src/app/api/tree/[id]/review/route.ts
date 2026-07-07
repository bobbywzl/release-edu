export const dynamic = 'force-dynamic'

/**
 * POST /api/tree/[id]/review — pick the review target for this tree.
 *
 * Retention loop: verified knowledge fades, so completed trees carry a
 * Review action. The target is the verified node whose retention is most
 * stale — never reviewed first, then oldest reviewedAt (stamped by the quiz
 * route when a review checkpoint is answered). The client opens the
 * workspace in review mode ([NODE_REVIEW]) on the returned node.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '@/lib/get-user-id'
import { getTreeWithNodes } from '@/lib/tree-engine'
import { parseQuizState } from '@/lib/mastery'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const userId = await getUserId()
  const tree = await getTreeWithNodes(userId, id)
  if (!tree) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const verified = tree.nodes.filter(n => !n.pending && n.status === 'understood')
  if (verified.length === 0) {
    return NextResponse.json({ error: 'No verified nodes to review yet.' }, { status: 404 })
  }

  const staleness = (n: (typeof verified)[number]) => parseQuizState(n.quizState).reviewedAt ?? ''
  const target = [...verified].sort((a, b) => {
    const cmp = staleness(a).localeCompare(staleness(b)) // '' (never reviewed) sorts first
    return cmp !== 0 ? cmp : a.updatedAt.getTime() - b.updatedAt.getTime()
  })[0]

  return NextResponse.json({ nodeId: target.id, title: target.title })
}
