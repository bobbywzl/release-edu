export const dynamic = 'force-dynamic'
// A 30-op plan runs many sequential queries (merge moves conversations) —
// never let the plan die to the platform default mid-write.
export const maxDuration = 60

/**
 * POST /api/tree/[id]/rewire — apply a whole REWIRE PLAN in one tap.
 *   { ops: RewireOp[] }  (the plan card's selected ops — resolved node ids,
 *                         plan-created nodes as "new:<ref>")
 *
 * The executor snapshots the tree first and restores it on ANY failure —
 * approval means "exactly this plan", never a half-applied rewire. Every op
 * here is something the student could do by hand through the node PATCH
 * route; the plan just makes them one atomic tap. → { ok, applied,
 * newTreeIds } or 409 with an honest error (tree left unchanged).
 */
import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '@/lib/get-user-id'
import { normalizeTreeKinds } from '@/lib/tree-engine'
import { executeRewirePlan, TreeOpError } from '@/lib/tree-ops'
import { REWIRE_MAX_OPS, type RewireOp, type RewireOpKind } from '@/lib/rewire'

const OP_KINDS = new Set<RewireOpKind>(['add', 'edit', 'move', 'delete', 'merge', 'reorder', 'split', 'rebalance', 'spinoff'])

const str = (v: unknown, max: number): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined

/** Whitelist-sanitize one client op (display fields dropped). */
function cleanOp(raw: unknown): RewireOp | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const op = o.op as RewireOpKind
  if (!OP_KINDS.has(op)) return null
  return {
    op,
    nodeId: str(o.nodeId, 200),
    parentId: str(o.parentId, 200),
    ref: str(o.ref, 40),
    title: str(o.title, 120),
    summary: str(o.summary, 500),
    newParentId: str(o.newParentId, 200),
    intoId: str(o.intoId, 200),
    childIds: Array.isArray(o.childIds)
      ? o.childIds.filter((x): x is string => typeof x === 'string' && !!x.trim()).slice(0, 40)
      : undefined,
    moveTail: Number.isFinite(o.moveTail as number)
      ? Math.max(2, Math.min(30, Math.round(o.moveTail as number)))
      : undefined,
    facets: Array.isArray(o.facets)
      ? o.facets.filter((x): x is string => typeof x === 'string' && !!x.trim()).map(x => x.trim().slice(0, 200)).slice(0, 8)
      : undefined,
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const userId = await getUserId()
  const body = (await req.json().catch(() => ({}))) as { ops?: unknown[] }
  const ops = (Array.isArray(body.ops) ? body.ops : []).map(cleanOp).filter((x): x is RewireOp => !!x)
  if (ops.length === 0) return NextResponse.json({ error: 'No valid ops' }, { status: 400 })
  if (ops.length > REWIRE_MAX_OPS) return NextResponse.json({ error: `Too many ops (max ${REWIRE_MAX_OPS})` }, { status: 400 })

  try {
    const result = await executeRewirePlan(userId, id, ops)
    await normalizeTreeKinds(id)
    for (const tid of result.newTreeIds) await normalizeTreeKinds(tid)
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    if (e instanceof TreeOpError) {
      // 409: the plan didn't fit the live tree (or a step failed) — the tree
      // was restored unchanged; the client shows the honest failure line.
      return NextResponse.json({ error: e.message }, { status: 409 })
    }
    console.error('[tree] rewire failed:', e)
    return NextResponse.json({ error: 'Rewire failed' }, { status: 500 })
  }
}
