export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/tree/[id]/expand { nodeId, question, lang }
 * The student asked a question at a node — Bob proposes child nodes,
 * persisted as pending ghosts the student must approve before they join
 * the tree (growth only ever happens with permission).
 */
import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '@/lib/get-user-id'
import { proposeExpansion } from '@/lib/tree-engine'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const userId = await getUserId()
  const { nodeId, question, lang } = (await req.json().catch(() => ({}))) as { nodeId?: string; question?: string; lang?: string }
  if (!nodeId || !question?.trim()) {
    return NextResponse.json({ error: 'nodeId and question are required' }, { status: 400 })
  }
  try {
    const result = await proposeExpansion(userId, id, nodeId, question.trim(), lang)
    return NextResponse.json(result)
  } catch (err) {
    console.error('[tree] expand failed:', err)
    return NextResponse.json({ error: 'Could not propose branches right now.' }, { status: 502 })
  }
}
