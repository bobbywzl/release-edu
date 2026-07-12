export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/tree/[id]/expand { nodeId, question, lang, history?, replaceIds? }
 *
 * One turn of the grow-box CONVERSATION at a node: the student's message
 * (with the dialog so far) → Bob replies conversationally and proposes child
 * nodes, persisted as pending ghosts the student must approve before they
 * join the tree (growth only ever happens with permission). replaceIds are
 * the dialog's previous still-pending ghosts, replaced by this turn's set.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '@/lib/get-user-id'
import { proposeExpansion, type GrowTurn } from '@/lib/tree-engine'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const userId = await getUserId()
  const { nodeId, question, lang, history, replaceIds } = (await req.json().catch(() => ({}))) as {
    nodeId?: string; question?: string; lang?: string; history?: GrowTurn[]; replaceIds?: string[]
  }
  if (!nodeId || !question?.trim()) {
    return NextResponse.json({ error: 'nodeId and question are required' }, { status: 400 })
  }
  try {
    const result = await proposeExpansion(userId, id, nodeId, question.trim(), lang, {
      history: Array.isArray(history) ? history : [],
      replaceIds: Array.isArray(replaceIds) ? replaceIds : [],
    })
    return NextResponse.json(result)
  } catch (err) {
    console.error('[tree] expand failed:', err)
    return NextResponse.json({ error: 'Could not propose branches right now.' }, { status: 502 })
  }
}
