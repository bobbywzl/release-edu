export const dynamic = 'force-dynamic'

/**
 * PATCH /api/tree/[id]/node/[nodeId]
 *   { action: 'approve' }            — accept a pending proposed node
 *   { action: 'reject' }             — discard a pending proposed node
 *   { action: 'learning' }           — mark node as being worked on
 *   { action: 'annotate', text }     — append a user annotation to the explainer
 *   { action: 'notes', text }        — save the student's editable per-node notes
 *   { action: 'add_child', title, summary? } — student manually adds a child node
 *   { action: 'edit', title?, summary? }     — rewrite title/summary (an approved copilot chip)
 *   { action: 'move', newParentId }  — re-parent the node, subtree follows (root immovable, cycle-guarded)
 *   { action: 'delete' }             — delete this node AND its descendants (root protected)
 *
 * NOTE: there is deliberately NO action to set status to 'understood' —
 * mastery is AI-verified only, via in-chat checkpoint answers (see ./quiz).
 */
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getUserId } from '@/lib/get-user-id'
import { collectSubtreeIds, normalizeTreeKinds } from '@/lib/tree-engine'
import { parseQuizState, masteryMet, QUIZ_HISTORY_CAP, type QuizState, type SyllabusFacet } from '@/lib/mastery'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; nodeId: string }> },
) {
  const { id, nodeId } = await params
  const userId = await getUserId()
  const body = (await req.json().catch(() => ({}))) as {
    action?: string; text?: string; title?: string; summary?: string; newParentId?: string
    moveTail?: number; intoNodeId?: string; facets?: string[]; childIds?: string[]; facet?: string
    fileId?: string
  }

  // Ownership check through the tree.
  const node = await prisma.treeNode.findFirst({
    where: { id: nodeId, treeId: id, tree: { userId } },
  })
  if (!node) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  switch (body.action) {
    case 'approve': {
      if (!node.pending) return NextResponse.json({ ok: true })
      await prisma.treeNode.update({ where: { id: nodeId }, data: { pending: false, pendingPlan: null } })
      // INSERT-A-LAYER: the ghost carried an adoption plan — the approval tap
      // IS the permission for the whole insert, so re-parent the listed
      // nodes (each with its subtree) under the newly approved node.
      // Re-validated on live data: same tree, never the root, never an
      // ancestor of this node (cycle), never itself.
      try {
        const plan = node.pendingPlan ? (JSON.parse(node.pendingPlan) as { adopt?: unknown }) : null
        const wanted = Array.isArray(plan?.adopt) ? (plan!.adopt as unknown[]).filter((x): x is string => typeof x === 'string') : []
        if (wanted.length > 0) {
          const all = await prisma.treeNode.findMany({ where: { treeId: id }, select: { id: true, parentId: true } })
          const parentOf = new Map(all.map(n2 => [n2.id, n2.parentId]))
          const ancestors = new Set<string>()
          let cur = parentOf.get(nodeId) ?? null
          while (cur) { ancestors.add(cur); cur = parentOf.get(cur) ?? null }
          const valid = wanted.filter(cid =>
            cid !== nodeId && parentOf.has(cid) && parentOf.get(cid) !== null && !ancestors.has(cid))
          if (valid.length > 0) {
            await prisma.treeNode.updateMany({ where: { id: { in: valid }, treeId: id }, data: { parentId: nodeId } })
          }
        }
      } catch { /* malformed plan — the plain approval stands */ }
      // KIND = DEPTH (small-to-big law): an insert-a-layer adoption shifts
      // whole subtrees one level down — re-derive every kind from live depth.
      await normalizeTreeKinds(id)
      // Growth badges (self-grown-node rungs) unlock at THIS moment — the
      // approval tap IS the earning act; the client celebrates on response.
      let newBadges: Array<Record<string, unknown>> = []
      try {
        const { evaluateAndAwardBadges } = await import('@/lib/badges')
        const nb = await evaluateAndAwardBadges(userId)
        newBadges = nb.map(b => ({ id: b.id, tier: b.tier, icon: b.icon, name: b.name, desc: b.desc }))
      } catch { /* non-critical */ }
      return NextResponse.json({ ok: true, newBadges })
    }
    case 'split': {
      // RESTRUCTURE DRIFT (copilot chip, tap = permission): extract the
      // drifted tail of this node's workspace conversation into a NEW CHILD
      // node — the tree stays the honest map of what is being learned.
      if (node.pending) return NextResponse.json({ error: 'Approve the node first' }, { status: 400 })
      if (node.parentId === null) return NextResponse.json({ error: 'The root has no workspace to split' }, { status: 400 })
      const title = (body.title ?? '').trim().slice(0, 120)
      if (!title) return NextResponse.json({ error: 'Title required' }, { status: 400 })
      const moveTail = Math.max(2, Math.min(30, Math.round(Number(body.moveTail)) || 8))
      const siblings = await prisma.treeNode.count({ where: { parentId: nodeId } })
      const created = await prisma.treeNode.create({
        data: {
          treeId: id, parentId: nodeId, kind: 'component',
          title, summary: (body.summary ?? '').trim().slice(0, 500),
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
      await normalizeTreeKinds(id)
      return NextResponse.json({ ok: true, node: created })
    }
    case 'merge': {
      // Fold THIS node into another (copilot chip, tap = permission): children,
      // conversation, highlights, files, notes, annotations, progress and the
      // syllabus contract all transfer; the source is removed. VERIFICATION
      // HONESTY: the target stays 'understood' only if the COMBINED contract
      // is already fully proven — otherwise it drops to 'learning' to re-prove.
      if (node.pending || node.parentId === null) return NextResponse.json({ error: 'Invalid merge source' }, { status: 400 })
      const into = typeof body.intoNodeId === 'string' && body.intoNodeId
        ? await prisma.treeNode.findFirst({ where: { id: body.intoNodeId, treeId: id, pending: false } })
        : null
      if (!into || into.parentId === null || into.id === nodeId) {
        return NextResponse.json({ error: 'Invalid merge target' }, { status: 400 })
      }
      const all = await prisma.treeNode.findMany({ where: { treeId: id }, select: { id: true, parentId: true } })
      if (collectSubtreeIds(all, nodeId).has(into.id)) {
        return NextResponse.json({ error: 'Target is inside the merged branch' }, { status: 400 })
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
      // Facet union keeps the EVIDENCE-CONTRACT memory too (qa-findings-4
      // №9): provenBy / evidencePending used to die in the merge. The entry
      // that actually PROVED the facet owns that record.
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
      // judged own-words answers, attempt record, and artifact-contract
      // memory transfer instead of dying with the row.
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
      // The merged node's children re-parented under the target — re-derive kinds.
      await normalizeTreeKinds(id)
      return NextResponse.json({ ok: true })
    }
    case 'spinoff': {
      // Detach this node + its whole subtree into a NEW problem tree — the
      // goal-necessity escape hatch that preserves valuable off-goal work.
      // Conversations/files/verification key on node ids, so they travel free.
      if (node.pending || node.parentId === null) return NextResponse.json({ error: 'Invalid spin-off source' }, { status: 400 })
      const srcTree = await prisma.problemTree.findFirst({
        where: { id, userId },
        select: { language: true, difficulty: true, personalContext: true },
      })
      const all = await prisma.treeNode.findMany({ where: { treeId: id }, select: { id: true, parentId: true } })
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
      await prisma.treeNode.updateMany({ where: { id: { in: subtree }, treeId: id }, data: { treeId: newTree.id } })
      await prisma.treeNode.update({ where: { id: nodeId }, data: { parentId: null, kind: 'root' } })
      // The spun-off subtree's depths all shifted up — re-derive its kinds.
      await normalizeTreeKinds(newTree.id)
      return NextResponse.json({ ok: true, newTreeId: newTree.id })
    }
    case 'rebalance': {
      // Move some of this node's UNPROVEN syllabus facets into a new child —
      // narrowing an overloaded contract without ever touching proven facets.
      if (node.pending || node.parentId === null) return NextResponse.json({ error: 'Invalid rebalance source' }, { status: 400 })
      const title = (body.title ?? '').trim().slice(0, 120)
      if (!title) return NextResponse.json({ error: 'Title required' }, { status: 400 })
      const wanted = (Array.isArray(body.facets) ? body.facets : []).filter((f): f is string => typeof f === 'string')
      const qs = parseQuizState(node.quizState)
      const have = qs.facets ?? []
      const moving = have.filter(f => !f.done && wanted.includes(f.name))
      const remaining = have.filter(f => !moving.some(m => m.name === f.name))
      if (moving.length === 0 || remaining.length === 0) {
        return NextResponse.json({ error: 'Facets no longer movable' }, { status: 400 })
      }
      const siblings = await prisma.treeNode.count({ where: { parentId: nodeId } })
      const childQs: QuizState = {
        correct: 0, attempts: 0, combo: 0, shortCorrect: 0, sureWrong: 0, sureRight: 0,
        missed: [], reviewedAt: null, pending: null, untaggedStreak: 0,
        facets: moving.map(f => ({ name: f.name, done: false })),
      }
      const created = await prisma.treeNode.create({
        data: {
          treeId: id, parentId: nodeId, kind: 'component',
          title, summary: (body.summary ?? '').trim().slice(0, 500),
          pending: false, order: siblings, origin: 'copilot',
          quizState: JSON.stringify(childQs),
        },
      })
      await prisma.treeNode.update({
        where: { id: nodeId },
        data: { quizState: JSON.stringify({ ...qs, facets: remaining }) },
      })
      await normalizeTreeKinds(id)
      return NextResponse.json({ ok: true, node: created })
    }
    case 'reorder': {
      // Set the recommended learning order of this node's children (the
      // canvas renders the numbered path from sibling `order`).
      const ids = (Array.isArray(body.childIds) ? body.childIds : []).filter((x): x is string => typeof x === 'string')
      if (ids.length < 2) return NextResponse.json({ error: 'Need at least two children' }, { status: 400 })
      const kids = await prisma.treeNode.findMany({ where: { parentId: nodeId, treeId: id }, select: { id: true } })
      const kidIds = new Set(kids.map(k => k.id))
      const valid = ids.filter(cid => kidIds.has(cid))
      if (valid.length < 2) return NextResponse.json({ error: 'Children no longer match' }, { status: 400 })
      for (let i = 0; i < valid.length; i++) {
        await prisma.treeNode.update({ where: { id: valid[i] }, data: { order: i } })
      }
      // Unlisted children keep their relative order, after the listed ones.
      const others = kids.filter(k => !valid.includes(k.id))
      for (let i = 0; i < others.length; i++) {
        await prisma.treeNode.update({ where: { id: others[i].id }, data: { order: valid.length + i } })
      }
      return NextResponse.json({ ok: true })
    }
    case 'reject': {
      if (!node.pending) return NextResponse.json({ error: 'Only pending nodes can be rejected' }, { status: 400 })
      await prisma.treeNode.delete({ where: { id: nodeId } })
      return NextResponse.json({ ok: true })
    }
    case 'learning': {
      if (node.status === 'understood') return NextResponse.json({ ok: true })
      await prisma.treeNode.update({ where: { id: nodeId }, data: { status: 'learning' } })
      return NextResponse.json({ ok: true })
    }
    case 'add_child': {
      const title = (body.title ?? '').trim()
      if (!title) return NextResponse.json({ error: 'Title required' }, { status: 400 })
      const siblings = await prisma.treeNode.count({ where: { parentId: nodeId } })
      const created = await prisma.treeNode.create({
        data: {
          treeId: id, parentId: nodeId, kind: 'component',
          title: title.slice(0, 120), summary: (body.summary ?? '').trim().slice(0, 500),
          pending: false, order: siblings, origin: 'manual',
        },
      })
      await normalizeTreeKinds(id)
      return NextResponse.json({ ok: true, node: created })
    }
    case 'edit': {
      // Approved reshape chip (or a manual rename): rewrite title/summary
      // only — status, mastery tally, notes and children are untouched.
      // Edits refine the SAME concept (the copilot is instructed to propose
      // delete + regrow for a different one).
      const title = typeof body.title === 'string' ? body.title.trim().slice(0, 120) : ''
      const summary = typeof body.summary === 'string' ? body.summary.trim().slice(0, 500) : ''
      if (!title && !summary) return NextResponse.json({ error: 'Nothing to edit' }, { status: 400 })
      const titleChanged = !!title && title !== node.title
      await prisma.treeNode.update({
        where: { id: nodeId },
        data: {
          ...(title ? { title } : {}),
          ...(summary ? { summary } : {}),
          // A renamed node's cached explainer opens with the OLD framing —
          // drop it so the next visit regenerates against the new wording.
          ...(titleChanged && node.explainer ? { explainer: null } : {}),
        },
      })
      // The root node IS the problem: keep ProblemTree.title (page headers,
      // the tree list, every prompt's PROBLEM line) in lock-step with a root
      // rename — a desync would put two contradictory problem statements in
      // Bob's context forever.
      if (titleChanged && !node.parentId) {
        await prisma.problemTree.update({ where: { id }, data: { title } }).catch(() => null)
      }
      return NextResponse.json({ ok: true })
    }
    case 'move': {
      const newParentId = typeof body.newParentId === 'string' ? body.newParentId : ''
      if (!newParentId) return NextResponse.json({ error: 'newParentId required' }, { status: 400 })
      if (!node.parentId) return NextResponse.json({ error: 'The root problem cannot be moved' }, { status: 400 })
      if (newParentId === nodeId) return NextResponse.json({ error: 'A node cannot be its own parent' }, { status: 400 })
      const parent = await prisma.treeNode.findFirst({ where: { id: newParentId, treeId: id } })
      if (!parent || parent.pending) return NextResponse.json({ error: 'Target parent not found' }, { status: 400 })
      // Cycle guard on live data: the new parent must not live inside the
      // moving node's own subtree (walks ALL nodes, pending included).
      const all = await prisma.treeNode.findMany({ where: { treeId: id }, select: { id: true, parentId: true } })
      if (collectSubtreeIds(all, nodeId).has(newParentId)) {
        return NextResponse.json({ error: 'Cannot move a node into its own branch' }, { status: 400 })
      }
      const siblings = await prisma.treeNode.count({ where: { parentId: newParentId } })
      await prisma.treeNode.update({ where: { id: nodeId }, data: { parentId: newParentId, order: siblings } })
      // The whole moved subtree changed depth — re-derive kinds.
      await normalizeTreeKinds(id)
      return NextResponse.json({ ok: true })
    }
    case 'delete': {
      if (!node.parentId) return NextResponse.json({ error: 'The root problem cannot be deleted' }, { status: 400 })
      // Children reference parents by id without a cascading FK — collect the
      // whole subtree and delete it in one sweep so no orphans remain.
      const all = await prisma.treeNode.findMany({ where: { treeId: id }, select: { id: true, parentId: true } })
      const toDelete = collectSubtreeIds(all, nodeId)
      await prisma.treeNode.deleteMany({ where: { id: { in: Array.from(toDelete) } } })
      return NextResponse.json({ ok: true, deleted: toDelete.size })
    }
    case 'notes': {
      await prisma.treeNode.update({
        where: { id: nodeId },
        data: { notes: (body.text ?? '').slice(0, 20_000) },
      })
      return NextResponse.json({ ok: true })
    }
    case 'facet_evidence': {
      // "Attach the capture later" — the deferred evidence landed. The flag
      // clears ONLY for the SPECIFIC file just uploaded for it, and only
      // after a judge pass confirms the artifact actually shows the facet —
      // any pre-existing file on the node used to satisfy this unjudged
      // (qa-findings-4 №1). provenBy stays untouched as the honest record of
      // how the facet originally verified.
      const facetName = String(body.facet ?? '').trim().toLowerCase()
      if (!facetName) return NextResponse.json({ error: 'facet required' }, { status: 400 })
      const facetLabel = String(body.facet ?? '').trim().slice(0, 120)
      if (typeof body.fileId !== 'string' || !body.fileId.trim()) {
        return NextResponse.json({ error: 'fileId required — attach the capture first' }, { status: 400 })
      }
      const file = await prisma.linkedFile.findUnique({
        where: { id: body.fileId },
        select: { id: true, userId: true, workId: true, name: true, mimeType: true, content: true, analysis: true, addedAt: true },
      }).catch(() => null)
      if (!file || file.userId !== userId || file.workId !== nodeId) {
        return NextResponse.json({ error: 'file not found on this node' }, { status: 400 })
      }
      // Post-flag contract: the clearing evidence is the capture uploaded
      // for THIS chip tap, not something that predated the flag.
      if (Date.now() - file.addedAt.getTime() > 10 * 60 * 1000) {
        return NextResponse.json({ error: 'stale file — attach a fresh capture' }, { status: 400 })
      }
      // Resolve legible content, then JUDGE it against the facet.
      let analysis = (file.analysis ?? '').trim()
      const isMedia = /^(image|audio|video)\//.test(file.mimeType ?? '') || file.mimeType === 'application/pdf'
      const content = file.content ?? ''
      if (!analysis && isMedia && content.startsWith('data:')) {
        try {
          const b64 = content.split(',', 2)[1] ?? ''
          if (b64) {
            const { analyzeImage } = await import('@/lib/gemini')
            analysis = (await analyzeImage(b64, `the student's deferred evidence "${file.name}" for the syllabus point "${facetLabel}" — describe exactly what it shows`, file.mimeType ?? 'image/png', userId)).slice(0, 8000)
            await prisma.linkedFile.update({ where: { id: file.id }, data: { analysis } }).catch(() => null)
          }
        } catch { /* unreadable → rejected below */ }
      }
      if (!analysis && !isMedia) {
        const { decodeDataUriText } = await import('@/lib/text-artifact')
        const text = content.startsWith('data:') ? decodeDataUriText(content) : content.trim() ? content : null
        if (text?.trim()) analysis = `(text file contents) ${text.slice(0, 2000)}`
      }
      if (!analysis) {
        return NextResponse.json({ error: 'unreadable evidence — re-capture and try again', code: 'artifact-unreadable' }, { status: 422 })
      }
      let cleared = false
      let feedback = ''
      try {
        const { judgeCheckpointAnswer } = await import('@/lib/tree-engine')
        const j = await judgeCheckpointAnswer(
          userId, id, nodeId,
          `Attach a real artifact that demonstrates the syllabus point: "${facetLabel}"`,
          `The artifact must itself visibly show real work demonstrating "${facetLabel}" on this node — not merely something related to it.`,
          `ARTIFACT FILE: "${file.name}" (${file.mimeType})\nCONTENT ANALYSIS: ${analysis}`,
          undefined, undefined, { artifact: true },
        )
        cleared = j.correct
        feedback = j.feedback
      } catch {
        return NextResponse.json({ error: 'judging unavailable — try again', code: 'judge-failed' }, { status: 502 })
      }
      if (cleared) {
        for (let attempt = 0; attempt < 3; attempt++) {
          const fresh = await prisma.treeNode.findUnique({ where: { id: nodeId }, select: { quizState: true } })
          if (!fresh) break
          const qs = parseQuizState(fresh.quizState)
          const i = (qs.facets ?? []).findIndex(f => f.name.trim().toLowerCase() === facetName)
          if (i === -1 || !qs.facets![i].evidencePending) break
          delete qs.facets![i].evidencePending
          const w = await prisma.treeNode.updateMany({
            where: { id: nodeId, quizState: fresh.quizState },
            data: { quizState: JSON.stringify(qs) },
          }).catch(() => null)
          if (w && w.count > 0) break
        }
      }
      return NextResponse.json({ ok: true, cleared, feedback })
    }
    case 'annotate': {
      const text = (body.text ?? '').trim()
      if (!text) return NextResponse.json({ error: 'Annotation text required' }, { status: 400 })
      // Compare-and-set append (fresh read each try): two concurrent
      // annotates from separate tabs must not last-writer-win each other.
      let annotations: Array<{ text: string; createdAt: string }> = []
      for (let attempt = 0; attempt < 2; attempt++) {
        const row = attempt === 0 ? node : await prisma.treeNode.findUnique({ where: { id: nodeId }, select: { annotations: true } })
        const base = row?.annotations ?? null
        annotations = []
        try { annotations = JSON.parse(base ?? '[]') } catch { /* fresh */ }
        if (!Array.isArray(annotations)) annotations = []
        annotations.push({ text: text.slice(0, 1000), createdAt: new Date().toISOString() })
        const w = await prisma.treeNode.updateMany({
          where: { id: nodeId, annotations: base },
          data: { annotations: JSON.stringify(annotations) },
        }).catch(() => null)
        if (w && w.count > 0) break
      }
      return NextResponse.json({ ok: true, annotations })
    }
    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }
}
