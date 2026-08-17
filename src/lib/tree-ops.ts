/**
 * TREE OPS — the single server-side implementation of every structural
 * mutation on a problem tree, shared by:
 *   - the node PATCH route (manual edit mode + single-op applies)
 *   - the rewire route (the copilot's one-tap plan, executed atomically)
 * plus the SNAPSHOT/UNDO layer: destructive changes snapshot the whole node
 * set first, and restore recreates rows with the SAME ids — workspace
 * conversations, files and highlights all key on node ids, so a delete →
 * undo round trip resurrects them intact.
 *
 * Ops validate then write (a TreeOpError means nothing was written), and
 * NONE of them calls normalizeTreeKinds — callers do, once per user action.
 */
import prisma from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { collectSubtreeIds } from '@/lib/tree-engine'
import { parseQuizState, masteryMet, QUIZ_HISTORY_CAP, type QuizState, type SyllabusFacet } from '@/lib/mastery'
import { NEW_PREFIX, REWIRE_MAX_OPS, simulateRewire, type RewireOp } from '@/lib/rewire'

/** Invalid op — nothing was written; the message is safe to surface. */
export class TreeOpError extends Error {}

const SNAPSHOT_KEEP = 12

// ── Snapshots (undo) ─────────────────────────────────────────────────────

interface SnapNode {
  id: string; parentId: string | null; kind?: string; title?: string; summary?: string
  explainer?: string | null; status?: string; pending?: boolean; pendingPlan?: string | null
  origin?: string | null; annotations?: string | null; notes?: string | null
  progressLog?: string | null; quizState?: string | null; contextSummary?: string | null
  contextSummaryAt?: string | null; boardDigest?: string | null; boardDigestAt?: string | null
  order?: number; createdAt?: string
}

/**
 * Store the tree's full structural state. Returns the snapshot id, or null
 * when it could not be taken — callers that RELY on it for rollback
 * (executeRewirePlan) must abort on null; best-effort callers proceed.
 */
export async function snapshotTree(userId: string, treeId: string, label: string): Promise<string | null> {
  try {
    const tree = await prisma.problemTree.findFirst({
      where: { id: treeId, userId },
      select: { title: true, displayTitle: true },
    })
    if (!tree) return null
    const nodes = await prisma.treeNode.findMany({ where: { treeId } })
    const data = JSON.stringify({
      v: 1,
      tree: { title: tree.title, displayTitle: tree.displayTitle },
      nodes: nodes.map(n => ({
        id: n.id, parentId: n.parentId, kind: n.kind, title: n.title, summary: n.summary,
        explainer: n.explainer, status: n.status, pending: n.pending, pendingPlan: n.pendingPlan,
        origin: n.origin, annotations: n.annotations, notes: n.notes, progressLog: n.progressLog,
        quizState: n.quizState, contextSummary: n.contextSummary,
        contextSummaryAt: n.contextSummaryAt?.toISOString() ?? null,
        boardDigest: n.boardDigest, boardDigestAt: n.boardDigestAt?.toISOString() ?? null,
        order: n.order, createdAt: n.createdAt.toISOString(),
      })),
    })
    const created = await prisma.treeSnapshot.create({ data: { treeId, userId, label, data }, select: { id: true } })
    // Cap the stack — the oldest fall off.
    const extras = await prisma.treeSnapshot.findMany({
      where: { treeId }, orderBy: { createdAt: 'desc' }, skip: SNAPSHOT_KEEP, select: { id: true },
    })
    if (extras.length > 0) {
      await prisma.treeSnapshot.deleteMany({ where: { id: { in: extras.map(x => x.id) } } })
    }
    return created.id
  } catch {
    return null
  }
}

/** Drop a snapshot (an op it was taken for turned out to be a no-op). */
export async function discardSnapshot(snapshotId: string | null): Promise<void> {
  if (!snapshotId) return
  await prisma.treeSnapshot.delete({ where: { id: snapshotId } }).catch(() => null)
}

/** The undo pill's data: how many snapshots exist and what the latest was. */
export async function undoState(treeId: string): Promise<{ count: number; label: string; at: string } | null> {
  try {
    const [count, latest] = await Promise.all([
      prisma.treeSnapshot.count({ where: { treeId } }),
      prisma.treeSnapshot.findFirst({
        where: { treeId }, orderBy: { createdAt: 'desc' }, select: { label: true, createdAt: true },
      }),
    ])
    if (!count || !latest) return null
    return { count, label: latest.label, at: latest.createdAt.toISOString() }
  } catch {
    return null
  }
}

async function restoreSnapshotRow(
  userId: string, treeId: string,
  snap: { id: string; label: string; data: string },
  opts: { keepRedo?: boolean } = {},
): Promise<{ label: string }> {
  let parsed: { tree?: { title?: string; displayTitle?: string | null }; nodes?: SnapNode[] } = {}
  try { parsed = JSON.parse(snap.data) as typeof parsed } catch { /* handled below */ }
  const rows = Array.isArray(parsed.nodes) ? parsed.nodes.filter(n => n && typeof n.id === 'string') : []
  if (rows.length === 0) {
    // A corrupt/empty snapshot can never be applied — drop it so the next
    // undo tap falls through to the previous one.
    await discardSnapshot(snap.id)
    throw new TreeOpError('Snapshot unreadable — it was discarded')
  }
  // The current state becomes a snapshot itself (label "undo"), so a
  // mistaken undo is undoable — tapping again toggles back. Skipped during
  // plan rollback (the half-applied state must never enter the stack).
  if (opts.keepRedo !== false) await snapshotTree(userId, treeId, 'undo')
  // RE-HOME workspace records of nodes this restore removes (e.g. a split
  // child created after the snapshot): their messages, highlights and files
  // move to the nearest ancestor that survives the restore instead of
  // orphaning invisibly. Best-effort — the structure restore still runs.
  try {
    const current = await prisma.treeNode.findMany({ where: { treeId }, select: { id: true, parentId: true } })
    const keep = new Set(rows.map(r => r.id))
    const titleByKeptId = new Map(rows.map(r => [r.id, r.title ?? '']))
    const parentOf = new Map(current.map(n => [n.id, n.parentId]))
    const vanishing = current.filter(n => !keep.has(n.id))
    if (vanishing.length > 0) {
      const survivor = (nodeId: string): string | null => {
        let cur = parentOf.get(nodeId) ?? null
        let hops = 0
        while (cur && !keep.has(cur) && hops < 50) { cur = parentOf.get(cur) ?? null; hops++ }
        return cur && keep.has(cur) ? cur : null
      }
      const convs = await prisma.conversation.findMany({
        where: { userId, context: { in: vanishing.map(n => `tree-node:${n.id}`) } },
        select: { id: true, context: true },
      })
      for (const conv of convs) {
        const nodeId = (conv.context ?? '').slice('tree-node:'.length)
        const dstNode = survivor(nodeId)
        if (!dstNode) continue
        const msgCount = await prisma.message.count({ where: { conversationId: conv.id } })
        if (msgCount === 0) { await prisma.conversation.delete({ where: { id: conv.id } }).catch(() => null); continue }
        const dstCtx = `tree-node:${dstNode}`
        const dst = await prisma.conversation.findFirst({ where: { userId, context: dstCtx }, select: { id: true } })
          ?? await prisma.conversation.create({
            data: { userId, title: `Workspace — ${(titleByKeptId.get(dstNode) ?? '').slice(0, 50)}`, context: dstCtx },
            select: { id: true },
          })
        // Messages keep their createdAt, so they interleave correctly — a
        // split undo effectively returns the moved tail to its source chat.
        await prisma.message.updateMany({ where: { conversationId: conv.id }, data: { conversationId: dst.id } })
        await prisma.messageHighlight.updateMany({ where: { conversationId: conv.id }, data: { conversationId: dst.id } }).catch(() => null)
        await prisma.conversation.delete({ where: { id: conv.id } }).catch(() => null)
      }
      for (const gone of vanishing) {
        const dstNode = survivor(gone.id)
        if (!dstNode) continue
        await prisma.linkedFile.updateMany({
          where: { userId, workType: 'tree-node', workId: gone.id },
          data: { workId: dstNode },
        }).catch(() => null)
      }
    }
  } catch { /* best-effort — never block the restore */ }
  const asDate = (v: string | null | undefined): Date | null => {
    if (!v) return null
    const d = new Date(v)
    return isNaN(d.getTime()) ? null : d
  }
  // ONE transaction for wipe + recreate (+ title): a failure mid-way must
  // never leave the tree empty — it rolls back whole, snapshot row intact.
  // skipDuplicates: after a spinoff, the spun-off rows live in ANOTHER tree
  // under the same ids — those stay there (the spinoff persists); everything
  // else restores. Without it one collision would fail the whole restore.
  const txOps: Prisma.PrismaPromise<unknown>[] = [
    prisma.treeNode.deleteMany({ where: { treeId } }),
    prisma.treeNode.createMany({
      skipDuplicates: true,
      data: rows.map(n => ({
        id: n.id, treeId, parentId: n.parentId ?? null, kind: n.kind ?? 'component',
        title: n.title ?? '', summary: n.summary ?? '', explainer: n.explainer ?? null,
        status: n.status ?? 'not-understood', pending: !!n.pending, pendingPlan: n.pendingPlan ?? null,
        origin: n.origin ?? null, annotations: n.annotations ?? null, notes: n.notes ?? null,
        progressLog: n.progressLog ?? null, quizState: n.quizState ?? null,
        contextSummary: n.contextSummary ?? null,
        contextSummaryAt: asDate(n.contextSummaryAt),
        boardDigest: n.boardDigest ?? null,
        boardDigestAt: asDate(n.boardDigestAt),
        order: Number.isFinite(n.order) ? (n.order as number) : 0,
        ...(asDate(n.createdAt) ? { createdAt: asDate(n.createdAt)! } : {}),
      })),
    }),
  ]
  if (parsed.tree?.title) {
    txOps.push(prisma.problemTree.update({
      where: { id: treeId },
      data: { title: parsed.tree.title, displayTitle: parsed.tree.displayTitle ?? null },
    }))
  }
  await prisma.$transaction(txOps)
  await discardSnapshot(snap.id)
  return { label: snap.label }
}

/** Restore the latest snapshot (the undo tap). Throws when there is none. */
export async function restoreLatestSnapshot(userId: string, treeId: string): Promise<{ label: string }> {
  const tree = await prisma.problemTree.findFirst({ where: { id: treeId, userId }, select: { id: true } })
  if (!tree) throw new TreeOpError('Tree not found')
  const snap = await prisma.treeSnapshot.findFirst({
    where: { treeId, userId }, orderBy: { createdAt: 'desc' },
    select: { id: true, label: true, data: true },
  })
  if (!snap) throw new TreeOpError('Nothing to undo')
  return restoreSnapshotRow(userId, treeId, snap)
}

// ── Single ops (validate, then write) ────────────────────────────────────

/** Route bodies lie about types — coerce unknown-ish inputs to trimmed strings. */
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

async function getNode(treeId: string, nodeId: string) {
  const node = await prisma.treeNode.findFirst({ where: { id: nodeId, treeId } })
  if (!node) throw new TreeOpError('Node not found')
  return node
}

/**
 * Rewrite title/summary only — status, mastery tally, notes and children are
 * untouched. Edits refine the SAME concept (a different concept is delete +
 * regrow — its checkpoint history would lie otherwise).
 */
export async function opEdit(treeId: string, nodeId: string, patch: { title?: string; summary?: string }): Promise<void> {
  const node = await getNode(treeId, nodeId)
  const title = str(patch.title).slice(0, 120)
  const summary = str(patch.summary).slice(0, 500)
  if (!title && !summary) throw new TreeOpError('Nothing to edit')
  const titleChanged = !!title && title !== node.title
  await prisma.treeNode.update({
    where: { id: nodeId },
    data: {
      ...(title ? { title } : {}),
      ...(summary ? { summary } : {}),
      // A renamed node's cached explainer opens with the OLD framing — drop
      // it so the next visit regenerates against the new wording.
      ...(titleChanged && node.explainer ? { explainer: null } : {}),
    },
  })
  // The root node IS the problem: keep ProblemTree.title in lock-step with a
  // root rename — a desync would put two contradictory problem statements in
  // Bob's context forever.
  if (titleChanged && !node.parentId) {
    await prisma.problemTree.update({ where: { id: treeId }, data: { title } }).catch(() => null)
  }
}

/** Re-parent a node; its whole subtree follows. Root immovable, cycle-guarded. */
export async function opMove(treeId: string, nodeId: string, newParentId: string): Promise<void> {
  const node = await getNode(treeId, nodeId)
  if (typeof newParentId !== 'string' || !newParentId) throw new TreeOpError('newParentId required')
  if (!node.parentId) throw new TreeOpError('The root problem cannot be moved')
  if (newParentId === nodeId) throw new TreeOpError('A node cannot be its own parent')
  if (newParentId === node.parentId) return // already there — a no-op, not an error
  const parent = await prisma.treeNode.findFirst({ where: { id: newParentId, treeId } })
  if (!parent || parent.pending) throw new TreeOpError('Target parent not found')
  // Cycle guard on live data: the new parent must not live inside the moving
  // node's own subtree (walks ALL nodes, pending included).
  const all = await prisma.treeNode.findMany({ where: { treeId }, select: { id: true, parentId: true } })
  if (collectSubtreeIds(all, nodeId).has(newParentId)) {
    throw new TreeOpError('Cannot move a node into its own branch')
  }
  const siblings = await prisma.treeNode.count({ where: { parentId: newParentId } })
  await prisma.treeNode.update({ where: { id: nodeId }, data: { parentId: newParentId, order: siblings } })
}

/** Delete a node AND its descendants (root protected). Returns the count. */
export async function opDelete(treeId: string, nodeId: string): Promise<number> {
  const node = await getNode(treeId, nodeId)
  if (!node.parentId) throw new TreeOpError('The root problem cannot be deleted')
  // Children reference parents by id without a cascading FK — collect the
  // whole subtree and delete it in one sweep so no orphans remain.
  const all = await prisma.treeNode.findMany({ where: { treeId }, select: { id: true, parentId: true } })
  const toDelete = collectSubtreeIds(all, nodeId)
  await prisma.treeNode.deleteMany({ where: { id: { in: Array.from(toDelete) } } })
  return toDelete.size
}

/** Create a child node (already approved — the caller's tap/plan IS the permission). */
export async function opAddChild(
  treeId: string, parentId: string,
  input: { title: string; summary?: string; origin: 'manual' | 'copilot' },
) {
  const parent = await getNode(treeId, parentId)
  if (parent.pending) throw new TreeOpError('Cannot add under a pending node')
  const title = str(input.title)
  if (!title) throw new TreeOpError('Title required')
  const siblings = await prisma.treeNode.count({ where: { parentId } })
  return prisma.treeNode.create({
    data: {
      treeId, parentId, kind: 'component',
      title: title.slice(0, 120), summary: str(input.summary).slice(0, 500),
      pending: false, order: siblings, origin: input.origin,
    },
  })
}

/**
 * Fold a node into another: children, conversation, highlights, files,
 * notes, annotations, progress and the syllabus contract all transfer; the
 * source is removed. VERIFICATION HONESTY: the target stays 'understood'
 * only if the COMBINED contract is already fully proven — otherwise it drops
 * to 'learning' to re-prove.
 */
export async function opMerge(userId: string, treeId: string, nodeId: string, intoNodeId: string): Promise<void> {
  const node = await getNode(treeId, nodeId)
  if (node.pending || node.parentId === null) throw new TreeOpError('Invalid merge source')
  const into = typeof intoNodeId === 'string' && intoNodeId
    ? await prisma.treeNode.findFirst({ where: { id: intoNodeId, treeId, pending: false } })
    : null
  if (!into || into.parentId === null || into.id === nodeId) throw new TreeOpError('Invalid merge target')
  const all = await prisma.treeNode.findMany({ where: { treeId }, select: { id: true, parentId: true } })
  if (collectSubtreeIds(all, nodeId).has(into.id)) {
    throw new TreeOpError('Target is inside the merged branch')
  }
  await prisma.treeNode.updateMany({ where: { parentId: nodeId }, data: { parentId: into.id } })
  try {
    const [srcConv, dstConv0] = await Promise.all([
      prisma.conversation.findFirst({ where: { userId, context: `tree-node:${nodeId}` }, select: { id: true } }),
      prisma.conversation.findFirst({ where: { userId, context: `tree-node:${into.id}` }, select: { id: true } }),
    ])
    if (srcConv) {
      const dstConv = dstConv0 ?? await prisma.conversation.create({
        data: { userId, title: `Workspace — ${into.title.slice(0, 50)}`, context: `tree-node:${into.id}` },
      })
      await prisma.message.updateMany({ where: { conversationId: srcConv.id }, data: { conversationId: dstConv.id } })
      await prisma.messageHighlight.updateMany({ where: { conversationId: srcConv.id }, data: { conversationId: dstConv.id } }).catch(() => null)
      await prisma.conversation.delete({ where: { id: srcConv.id } }).catch(() => null)
    }
  } catch { /* conversation transfer is best-effort */ }
  await prisma.linkedFile.updateMany({ where: { userId, workType: 'tree-node', workId: nodeId }, data: { workId: into.id } }).catch(() => null)
  const arr = (raw: string | null) => { try { const v = JSON.parse(raw ?? '[]'); return Array.isArray(v) ? v : [] } catch { return [] } }
  const srcQs = parseQuizState(node.quizState)
  const dstQs = parseQuizState(into.quizState)
  // Facet union keeps the EVIDENCE-CONTRACT memory too (qa-findings-4 №9):
  // provenBy / evidencePending used to die in the merge. The entry that
  // actually PROVED the facet owns that record.
  const facetMap = new Map<string, SyllabusFacet>()
  for (const f of [...(dstQs.facets ?? []), ...(srcQs.facets ?? [])]) {
    const prev = facetMap.get(f.name)
    if (!prev) { facetMap.set(f.name, { ...f }); continue }
    const winner = prev.done ? prev : f.done ? f : prev
    facetMap.set(f.name, {
      name: f.name,
      done: prev.done || f.done,
      struggled: prev.struggled === true || f.struggled === true,
      ...(winner.provenBy ? { provenBy: winner.provenBy } : {}),
      ...(winner.evidencePending === true ? { evidencePending: true } : {}),
    })
  }
  // Chronological unions, same caps as live writes — the source node's
  // judged own-words answers, attempt record, and artifact-contract memory
  // transfer instead of dying with the row.
  const byTime = <T,>(list: T[], key: (x: T) => string) =>
    [...list].sort((a, b) => key(a).localeCompare(key(b)))
  const mergedQs: QuizState = {
    ...dstQs,
    correct: dstQs.correct + srcQs.correct,
    attempts: dstQs.attempts + srcQs.attempts,
    combo: 0,
    shortCorrect: dstQs.shortCorrect + srcQs.shortCorrect,
    sureWrong: dstQs.sureWrong + srcQs.sureWrong,
    sureRight: dstQs.sureRight + srcQs.sureRight,
    missed: [...dstQs.missed, ...srcQs.missed].slice(-5),
    reviewedAt: dstQs.reviewedAt ?? srcQs.reviewedAt,
    facets: facetMap.size > 0 ? Array.from(facetMap.values()) : null,
    provenAnswers: byTime([...(dstQs.provenAnswers ?? []), ...(srcQs.provenAnswers ?? [])], a => a.at).slice(-6),
    history: byTime([...(dstQs.history ?? []), ...(srcQs.history ?? [])], h => h.t).slice(-QUIZ_HISTORY_CAP),
    artifactAsked: Array.from(
      new Map([...(dstQs.artifactAsked ?? []), ...(srcQs.artifactAsked ?? [])].map(x => [x.trim().toLowerCase(), x])).values(),
    ).slice(-6),
  }
  const met = masteryMet(mergedQs)
  const ann = [...arr(into.annotations), ...arr(node.annotations)]
  const prog = [...arr(into.progressLog), ...arr(node.progressLog)]
  const combinedNotes = [into.notes, node.notes].filter(x => x && x.trim()).join('\n\n---\n\n')
  await prisma.treeNode.update({
    where: { id: into.id },
    data: {
      ...(combinedNotes ? { notes: combinedNotes.slice(0, 20000) } : {}),
      ...(ann.length > 0 ? { annotations: JSON.stringify(ann.slice(-40)) } : {}),
      ...(prog.length > 0 ? { progressLog: JSON.stringify(prog.slice(-40)) } : {}),
      quizState: JSON.stringify(mergedQs),
      status: met ? 'understood' : (into.status === 'understood' || node.status === 'understood' ? 'learning' : into.status),
      // stale after the merge — the background pass rebuilds it
      contextSummary: null, contextSummaryAt: null,
    },
  })
  await prisma.treeNode.delete({ where: { id: nodeId } })
}

/** Set the recommended learning order of a node's children. */
export async function opReorder(treeId: string, nodeId: string, childIds: string[]): Promise<void> {
  await getNode(treeId, nodeId)
  const ids = childIds.filter((x): x is string => typeof x === 'string')
  if (ids.length < 2) throw new TreeOpError('Need at least two children')
  const kids = await prisma.treeNode.findMany({ where: { parentId: nodeId, treeId }, select: { id: true } })
  const kidIds = new Set(kids.map(k => k.id))
  const valid = ids.filter(cid => kidIds.has(cid))
  if (valid.length < 2) throw new TreeOpError('Children no longer match')
  for (let i = 0; i < valid.length; i++) {
    await prisma.treeNode.update({ where: { id: valid[i] }, data: { order: i } })
  }
  // Unlisted children keep their relative order, after the listed ones.
  const others = kids.filter(k => !valid.includes(k.id))
  for (let i = 0; i < others.length; i++) {
    await prisma.treeNode.update({ where: { id: others[i].id }, data: { order: valid.length + i } })
  }
}

/**
 * RESTRUCTURE DRIFT: extract the drifted tail of a node's workspace
 * conversation into a NEW CHILD node — the tree stays the honest map of what
 * is being learned.
 */
export async function opSplit(
  userId: string, treeId: string, nodeId: string,
  input: { title: string; summary?: string; moveTail?: number },
) {
  const node = await getNode(treeId, nodeId)
  if (node.pending) throw new TreeOpError('Approve the node first')
  if (node.parentId === null) throw new TreeOpError('The root has no workspace to split')
  const title = str(input.title).slice(0, 120)
  if (!title) throw new TreeOpError('Title required')
  const moveTail = Math.max(2, Math.min(30, Math.round(Number(input.moveTail)) || 8))
  const siblings = await prisma.treeNode.count({ where: { parentId: nodeId } })
  const created = await prisma.treeNode.create({
    data: {
      treeId, parentId: nodeId, kind: 'component',
      title, summary: str(input.summary).slice(0, 500),
      pending: false, order: siblings, origin: 'copilot',
    },
  })
  // Move the last N messages (and their highlights) into the new node's
  // workspace. Best-effort: the node exists even if the move fails.
  try {
    const conv = await prisma.conversation.findFirst({
      where: { userId, context: `tree-node:${nodeId}` },
      select: { id: true },
    })
    if (conv) {
      const tail = await prisma.message.findMany({
        where: { conversationId: conv.id },
        orderBy: { createdAt: 'desc' },
        take: moveTail,
        select: { id: true },
      })
      if (tail.length > 0) {
        const newConv = await prisma.conversation.create({
          data: { userId, title: `Workspace — ${title.slice(0, 50)}`, context: `tree-node:${created.id}` },
        })
        const ids = tail.map(m => m.id)
        await prisma.message.updateMany({ where: { id: { in: ids } }, data: { conversationId: newConv.id } })
        await prisma.messageHighlight.updateMany({ where: { messageId: { in: ids } }, data: { conversationId: newConv.id } }).catch(() => null)
      }
    }
  } catch { /* non-critical — conversation move is best-effort */ }
  return created
}

/**
 * Move some of a node's UNPROVEN syllabus facets into a new child —
 * narrowing an overloaded contract without ever touching proven facets.
 */
export async function opRebalance(
  treeId: string, nodeId: string,
  input: { title: string; summary?: string; facets: string[] },
) {
  const node = await getNode(treeId, nodeId)
  if (node.pending || node.parentId === null) throw new TreeOpError('Invalid rebalance source')
  const title = str(input.title).slice(0, 120)
  if (!title) throw new TreeOpError('Title required')
  const wanted = (Array.isArray(input.facets) ? input.facets : []).filter((f): f is string => typeof f === 'string')
  const qs = parseQuizState(node.quizState)
  const have = qs.facets ?? []
  const moving = have.filter(f => !f.done && wanted.includes(f.name))
  const remaining = have.filter(f => !moving.some(m => m.name === f.name))
  if (moving.length === 0 || remaining.length === 0) throw new TreeOpError('Facets no longer movable')
  const siblings = await prisma.treeNode.count({ where: { parentId: nodeId } })
  const childQs: QuizState = {
    correct: 0, attempts: 0, combo: 0, shortCorrect: 0, sureWrong: 0, sureRight: 0,
    missed: [], reviewedAt: null, pending: null, untaggedStreak: 0,
    facets: moving.map(f => ({ name: f.name, done: false })),
  }
  const created = await prisma.treeNode.create({
    data: {
      treeId, parentId: nodeId, kind: 'component',
      title, summary: str(input.summary).slice(0, 500),
      pending: false, order: siblings, origin: 'copilot',
      quizState: JSON.stringify(childQs),
    },
  })
  await prisma.treeNode.update({
    where: { id: nodeId },
    data: { quizState: JSON.stringify({ ...qs, facets: remaining }) },
  })
  return created
}

/**
 * Detach a node + its whole subtree into a NEW problem tree — the
 * goal-necessity escape hatch that preserves valuable off-goal work.
 * Conversations/files/verification key on node ids, so they travel free.
 */
export async function opSpinoff(userId: string, treeId: string, nodeId: string): Promise<{ newTreeId: string }> {
  const node = await getNode(treeId, nodeId)
  if (node.pending || node.parentId === null) throw new TreeOpError('Invalid spin-off source')
  const srcTree = await prisma.problemTree.findFirst({
    where: { id: treeId, userId },
    select: { language: true, difficulty: true, personalContext: true },
  })
  const all = await prisma.treeNode.findMany({ where: { treeId }, select: { id: true, parentId: true } })
  const subtree = Array.from(collectSubtreeIds(all, nodeId))
  const newTree = await prisma.problemTree.create({
    data: {
      userId,
      title: node.title,
      displayTitle: node.title.slice(0, 80),
      framing: node.summary || null,
      language: srcTree?.language ?? null,
      difficulty: srcTree?.difficulty ?? null,
      personalContext: srcTree?.personalContext ?? null,
    },
  })
  await prisma.treeNode.updateMany({ where: { id: { in: subtree }, treeId }, data: { treeId: newTree.id } })
  await prisma.treeNode.update({ where: { id: nodeId }, data: { parentId: null, kind: 'root' } })
  return { newTreeId: newTree.id }
}

// ── The atomic plan executor (the copilot's one-tap rewire) ──────────────

/**
 * Validate, snapshot, then execute a whole rewire plan in order. ANY failure
 * restores the snapshot — approval meant "exactly this plan", never a
 * half-applied rewire. Ops reference plan-created nodes as `new:<ref>`.
 * The caller runs normalizeTreeKinds afterwards (this tree + returned
 * newTreeIds).
 */
export async function executeRewirePlan(
  userId: string, treeId: string, rawOps: RewireOp[],
): Promise<{ applied: number; newTreeIds: string[] }> {
  const tree = await prisma.problemTree.findFirst({ where: { id: treeId, userId }, select: { id: true } })
  if (!tree) throw new TreeOpError('Tree not found')
  const ops = rawOps.slice(0, REWIRE_MAX_OPS)
  const nodes = await prisma.treeNode.findMany({ where: { treeId }, select: { id: true, parentId: true } })
  const sim = simulateRewire(nodes, ops)
  if (!sim.ok) {
    throw new TreeOpError(`The plan no longer fits the tree (step ${sim.index + 1}: ${sim.reason})`)
  }

  const snapId = await snapshotTree(userId, treeId, 'rewire')
  if (!snapId) throw new TreeOpError('Could not save the undo snapshot — nothing was changed')

  // Resolve `new:<ref>` placeholders as adds execute.
  const createdByRef = new Map<string, string>()
  const resolve = (id: string | undefined): string => {
    if (!id) throw new TreeOpError('Missing node reference')
    if (id.startsWith(NEW_PREFIX)) {
      const real = createdByRef.get(id)
      if (!real) throw new TreeOpError(`Unresolved reference ${id}`)
      return real
    }
    return id
  }

  const newTreeIds: string[] = []
  let applied = 0
  try {
    for (const o of ops) {
      switch (o.op) {
        case 'add': {
          const created = await opAddChild(treeId, resolve(o.parentId), {
            title: o.title ?? '', summary: o.summary, origin: 'copilot',
          })
          if (o.ref?.trim()) createdByRef.set(NEW_PREFIX + o.ref.trim(), created.id)
          break
        }
        case 'edit':
          await opEdit(treeId, resolve(o.nodeId), { title: o.title, summary: o.summary })
          break
        case 'move':
          await opMove(treeId, resolve(o.nodeId), resolve(o.newParentId))
          break
        case 'delete':
          await opDelete(treeId, resolve(o.nodeId))
          break
        case 'merge':
          await opMerge(userId, treeId, resolve(o.nodeId), resolve(o.intoId))
          break
        case 'reorder':
          await opReorder(treeId, resolve(o.nodeId), (o.childIds ?? []).map(resolve))
          break
        case 'split':
          await opSplit(userId, treeId, resolve(o.nodeId), { title: o.title ?? '', summary: o.summary, moveTail: o.moveTail })
          break
        case 'rebalance':
          await opRebalance(treeId, resolve(o.nodeId), { title: o.title ?? '', summary: o.summary, facets: o.facets ?? [] })
          break
        case 'spinoff': {
          const r = await opSpinoff(userId, treeId, resolve(o.nodeId))
          newTreeIds.push(r.newTreeId)
          break
        }
        default:
          throw new TreeOpError(`Unknown op "${String((o as { op?: unknown }).op)}"`)
      }
      applied++
    }
  } catch (e) {
    // ATOMICITY: roll the whole tree back to the snapshot. Spin-off trees
    // created mid-plan are deleted first so their nodes (same ids) can be
    // recreated here by the restore.
    try {
      for (const tid of newTreeIds) {
        await prisma.problemTree.delete({ where: { id: tid } }).catch(() => null)
      }
      const snap = await prisma.treeSnapshot.findUnique({
        where: { id: snapId }, select: { id: true, label: true, data: true },
      })
      if (snap) await restoreSnapshotRow(userId, treeId, snap, { keepRedo: false })
    } catch { /* restore failed — the snapshot row remains for a manual undo */ }
    throw e instanceof TreeOpError
      ? new TreeOpError(`Step ${applied + 1} failed: ${e.message}. The tree was restored unchanged.`)
      : e
  }
  return { applied, newTreeIds }
}
