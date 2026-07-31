export const dynamic = 'force-dynamic'
// A full teaching-model synthesis over every verified node's digest — slow.
export const maxDuration = 120

/**
 * THE ROOT ANSWER (FOUNDATION's missing artifact — "You need this entire
 * tree to understand the full answer to this problem"):
 *
 * GET  — the cached answer document { answer, generatedAt } (null until the
 *        tree completes or the learner generates one on demand).
 * POST — (re)generate from the verified nodes' contextSummary digests.
 *        Allowed any time at least one node is verified: a partial answer
 *        with an honest boundary beats no answer artifact at all.
 */
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getUserId } from '@/lib/get-user-id'
import { generateRootAnswer } from '@/lib/tree-engine'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const userId = await getUserId()
  const tree = await prisma.problemTree.findFirst({
    where: { id, userId },
    select: { rootAnswer: true, rootAnswerAt: true },
  })
  if (!tree) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ answer: tree.rootAnswer, generatedAt: tree.rootAnswerAt })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const userId = await getUserId()
  const body = (await req.json().catch(() => ({}))) as { lang?: string }
  const tree = await prisma.problemTree.findFirst({ where: { id, userId }, select: { id: true, language: true } })
  if (!tree) return NextResponse.json({ error: 'Not found' }, { status: 404 })

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
