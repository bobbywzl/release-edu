/**
 * REWIRE PLAN — the shared shape of tree-structure operations. Client-safe
 * (no prisma): the copilot (server) emits a plan, the tree page and copilot
 * UI render it as ONE approval card, and the rewire route executes it
 * atomically. `simulateRewire` is the ONE structural validator, run both at
 * propose time (copilotTurn) and at apply time (rewire route) — a plan that
 * validated can only fail later on live drift, and the apply path restores
 * a snapshot when that happens, so approval means "exactly this, or nothing".
 */

export type RewireOpKind =
  | 'add' | 'edit' | 'move' | 'delete' | 'merge' | 'reorder' | 'split' | 'rebalance' | 'spinoff'

/** Hard cap per plan — enough to rewire a whole tree in one tap. */
export const REWIRE_MAX_OPS = 30

/** Plan-local id of a node an `add` op creates: `new:<ref>`. */
export const NEW_PREFIX = 'new:'

export interface RewireOp {
  op: RewireOpKind
  /** Target node id — a real node id, or `new:<ref>` for a node an earlier
   *  `add` in this plan creates. `add` itself has no target. */
  nodeId?: string
  /** add: the parent (real id or `new:<ref>`). */
  parentId?: string
  /** add: the plan-local handle later ops reference as `new:<ref>`. */
  ref?: string
  /** add/split/rebalance: new node title; edit: replacement title. */
  title?: string
  summary?: string
  /** move: the destination parent (real id or `new:<ref>`). */
  newParentId?: string
  /** merge: the surviving node (existing nodes only). */
  intoId?: string
  /** reorder: the target's children in learning order (real or `new:<ref>`). */
  childIds?: string[]
  /** split: how many trailing workspace messages move (2-30). */
  moveTail?: number
  /** rebalance: exact UNPROVEN facet names moving to the new child. */
  facets?: string[]
  // Display-only fields (approval card copy) — executors ignore them.
  /** Current title of the target (or the new node's title for `add`). */
  label?: string
  /** The other node in the sentence: destination / merge target / new child. */
  toLabel?: string
  /** reorder: child titles in the proposed order. */
  childLabels?: string[]
}

export interface RewirePlan {
  /** One line: what the whole rewire does. */
  summary: string
  ops: RewireOp[]
}

export interface SimNode { id: string; parentId: string | null }

export type SimResult = { ok: true } | { ok: false; index: number; reason: string }

/**
 * Replay the ops over an in-memory copy of the tree and return the first
 * violation. Pure and side-effect free — safe on client and server.
 */
export function simulateRewire(nodes: SimNode[], ops: RewireOp[]): SimResult {
  const parentOf = new Map<string, string | null>()
  for (const n of nodes) parentOf.set(n.id, n.parentId)
  const gone = new Set<string>()
  const err = (index: number, reason: string): SimResult => ({ ok: false, index, reason })

  const exists = (id: string | undefined): id is string => !!id && parentOf.has(id) && !gone.has(id)
  const isRoot = (id: string) => parentOf.get(id) === null
  const isNew = (id: string) => id.startsWith(NEW_PREFIX)
  const subtree = (rootId: string): Set<string> => {
    const kids = new Map<string, string[]>()
    parentOf.forEach((p, id) => {
      if (!p || gone.has(id)) return
      if (!kids.has(p)) kids.set(p, [])
      kids.get(p)!.push(id)
    })
    const out = new Set([rootId])
    const q = [rootId]
    while (q.length) for (const k of kids.get(q.shift()!) ?? []) if (!out.has(k)) { out.add(k); q.push(k) }
    return out
  }

  if (ops.length === 0) return err(0, 'the plan has no ops')
  if (ops.length > REWIRE_MAX_OPS) return err(REWIRE_MAX_OPS, `too many ops (max ${REWIRE_MAX_OPS})`)

  for (let i = 0; i < ops.length; i++) {
    const o = ops[i]
    switch (o.op) {
      case 'add': {
        if (!o.title?.trim()) return err(i, 'add needs a title')
        if (!o.ref?.trim()) return err(i, 'add needs a ref')
        const newId = NEW_PREFIX + o.ref.trim()
        if (parentOf.has(newId)) return err(i, `ref "${o.ref}" is already used`)
        if (!exists(o.parentId)) return err(i, 'add parent is not in the tree')
        parentOf.set(newId, o.parentId)
        break
      }
      case 'edit': {
        if (!exists(o.nodeId)) return err(i, 'edit target is not in the tree')
        if (!o.title?.trim() && !o.summary?.trim()) return err(i, 'edit changes nothing')
        break
      }
      case 'move': {
        if (!exists(o.nodeId)) return err(i, 'move target is not in the tree')
        if (isRoot(o.nodeId)) return err(i, 'the root cannot move')
        if (!exists(o.newParentId)) return err(i, 'move destination is not in the tree')
        if (o.newParentId === o.nodeId) return err(i, 'a node cannot be its own parent')
        if (subtree(o.nodeId).has(o.newParentId)) return err(i, 'destination is inside the moved branch')
        parentOf.set(o.nodeId, o.newParentId)
        break
      }
      case 'delete': {
        if (!exists(o.nodeId)) return err(i, 'delete target is not in the tree')
        if (isRoot(o.nodeId)) return err(i, 'the root cannot be deleted')
        subtree(o.nodeId).forEach(id => gone.add(id))
        break
      }
      case 'merge': {
        if (!exists(o.nodeId)) return err(i, 'merge source is not in the tree')
        if (isRoot(o.nodeId)) return err(i, 'the root cannot be merged away')
        if (isNew(o.nodeId)) return err(i, 'a node this plan just created has nothing to merge')
        if (!o.intoId || isNew(o.intoId)) return err(i, 'merge target must be an existing node')
        if (!exists(o.intoId)) return err(i, 'merge target is not in the tree')
        if (isRoot(o.intoId)) return err(i, 'cannot merge into the root')
        if (o.intoId === o.nodeId) return err(i, 'cannot merge a node into itself')
        if (subtree(o.nodeId).has(o.intoId)) return err(i, 'merge target is inside the merged branch')
        const src = o.nodeId
        const dst = o.intoId
        parentOf.forEach((p, id) => { if (p === src && !gone.has(id)) parentOf.set(id, dst) })
        gone.add(src)
        break
      }
      case 'reorder': {
        if (!exists(o.nodeId)) return err(i, 'reorder target is not in the tree')
        const kidsNow = (o.childIds ?? []).filter(exists).filter(id => parentOf.get(id) === o.nodeId)
        if (kidsNow.length < 2) return err(i, 'reorder needs at least two current children of the target')
        break
      }
      case 'split': {
        if (!exists(o.nodeId)) return err(i, 'split target is not in the tree')
        if (isRoot(o.nodeId)) return err(i, 'the root has no workspace to split')
        if (isNew(o.nodeId)) return err(i, 'a node this plan just created has no conversation to split')
        if (!o.title?.trim()) return err(i, 'split needs a title for the new child')
        // Register the created child under an unrefable key so later subtree
        // walks see it (`#` can never collide with a model-declared ref).
        parentOf.set(`${NEW_PREFIX}#split:${i}`, o.nodeId)
        break
      }
      case 'rebalance': {
        if (!exists(o.nodeId)) return err(i, 'rebalance target is not in the tree')
        if (isRoot(o.nodeId)) return err(i, 'the root cannot rebalance')
        if (isNew(o.nodeId)) return err(i, 'a node this plan just created has no facets to rebalance')
        if (!o.title?.trim()) return err(i, 'rebalance needs a title for the new child')
        if ((o.facets ?? []).length === 0) return err(i, 'rebalance needs facet names')
        parentOf.set(`${NEW_PREFIX}#rebalance:${i}`, o.nodeId)
        break
      }
      case 'spinoff': {
        if (!exists(o.nodeId)) return err(i, 'spinoff target is not in the tree')
        if (isRoot(o.nodeId)) return err(i, 'the root cannot spin off')
        if (isNew(o.nodeId)) return err(i, 'a node this plan just created has nothing to spin off')
        subtree(o.nodeId).forEach(id => gone.add(id))
        break
      }
      default:
        return err(i, `unknown op "${String((o as { op?: unknown }).op)}"`)
    }
  }
  return { ok: true }
}
