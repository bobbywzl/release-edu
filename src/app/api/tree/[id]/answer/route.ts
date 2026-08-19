export const dynamic = 'force-dynamic'
// A full teaching-model synthesis over every verified node's digest — slow.
export const maxDuration = 120

/**
 * THE ROOT ANSWER (FOUNDATION's missing artifact — "You need this entire
 * tree to understand the full answer to this problem"):
 *
 * GET  — the cached answer document { answer, generatedAt, assembling }.
 *        `assembling` = tree completion just fired the background synthesis
 *        and no fresh document has landed yet; clients show a live
 *        "assembling…" state and poll instead of a generate button.
 * POST — (re)generate from the verified nodes' contextSummary digests.
 *        Allowed any time at least one node is verified: a partial answer
 *        with an honest boundary beats no answer artifact at all.
 *        Guarded: while the completion synthesis is in flight it answers
 *        202 { assembling } instead of running a duplicate 20-120s job, and
 *        a document fresher than a minute is returned as-is (double-click).
 */
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getUserId } from '@/lib/get-user-id'
import { generateRootAnswer } from '@/lib/tree-engine'

// Covers the background job's full 120s budget with margin; after this the
// clients' manual generate button returns (assembly presumed dead). Completion
// bumps the tree's updatedAt (status flip or stale-stamp), so "recently
// completed with no stamped answer" is exactly "assembly in flight".
const ASSEMBLING_WINDOW_MS = 3 * 60_000

function isAssembling(tree: { rootAnswerAt: Date | null; status: string | null; updatedAt: Date }): boolean {
  return !tree.rootAnswerAt && tree.status === 'completed'
    && Date.now() - tree.updatedAt.getTime() < ASSEMBLING_WINDOW_MS
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const userId = await getUserId()
  const tree = await prisma.problemTree.findFirst({
    where: { id, userId },
    select: { rootAnswer: true, rootAnswerAt: true, status: true, updatedAt: true },
  })
  if (!tree) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({
    answer: tree.rootAnswer,
    generatedAt: tree.rootAnswerAt,
    assembling: isAssembling(tree),
  })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const userId = await getUserId()
  const body = (await req.json().catch(() => ({}))) as { lang?: string }
  const tree = await prisma.problemTree.findFirst({
    where: { id, userId },
    select: { id: true, language: true, rootAnswer: true, rootAnswerAt: true, status: true, updatedAt: true },
  })
  if (!tree) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // A document fresher than a minute IS the answer to this request —
  // absorb double-clicks instead of paying a second synthesis.
  if (tree.rootAnswer && tree.rootAnswerAt && Date.now() - tree.rootAnswerAt.getTime() < 60_000) {
    return NextResponse.json({ answer: tree.rootAnswer, generatedAt: tree.rootAnswerAt })
  }
  // Completion's background synthesis is still running — don't race it with
  // a duplicate; the client keeps polling GET until it lands.
  if (isAssembling(tree)) {
    return NextResponse.json({ assembling: true }, { status: 202 })
  }

  // Same daily-budget gate as the other expensive doors; fail-open.
  try {
    const { checkDailyBudget, budgetMessage } = await import('@/lib/ai-budget')
    const budget = await checkDailyBudget(userId)
    if (!budget.ok) {
      return NextResponse.json({ error: budgetMessage((tree.language ?? body.lang) === 'zh') }, { status: 429 })
    }
  } catch { /* fail-open */ }

  const answer = await generateRootAnswer(userId, id, body.lang)
  if (!answer) {
    return NextResponse.json({ error: 'No verified nodes to assemble from yet.' }, { status: 400 })
  }
  return NextResponse.json({ answer, generatedAt: new Date().toISOString() })
}
