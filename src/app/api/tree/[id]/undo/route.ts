export const dynamic = 'force-dynamic'

/**
 * POST /api/tree/[id]/undo — restore the latest structure snapshot.
 *
 * Snapshots are written by destructive structural changes (manual
 * delete/merge/move/edit, copilot rewire plans). Restore recreates the node
 * rows with their ORIGINAL ids, so workspace conversations, files and
 * highlights re-attach; the restored-over state is itself snapshotted
 * (label "undo") so another tap toggles back. The undo pill's availability
 * data rides the tree GET (`undo` field).
 */
import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '@/lib/get-user-id'
import { restoreLatestSnapshot, undoState, TreeOpError } from '@/lib/tree-ops'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const userId = await getUserId()
  try {
    const { label } = await restoreLatestSnapshot(userId, id)
    return NextResponse.json({ ok: true, label, undo: await undoState(id) })
  } catch (e) {
    if (e instanceof TreeOpError) return NextResponse.json({ error: e.message }, { status: 400 })
    console.error('[tree] undo failed:', e)
    return NextResponse.json({ error: 'Undo failed' }, { status: 500 })
  }
}
