export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/tree/[id]/node/[nodeId]/quiz
 *   { quiz, answer, confidence?, lang }
 *
 * Judges ONE in-chat checkpoint question (the [[QUIZ]] card Bob emitted in
 * the workspace chat). The authoritative quiz — answer key included — lives
 * server-side in TreeNode.quizState.pending (clients only ever receive the
 * sanitized {kind, question, options}); we judge against that stored copy.
 * MCQs judge deterministically, short answers via Sonnet (Differentiator
 * bar + hypercorrection).
 *
 * Reward rules:
 *   - unverified node: correct → quiz XP (+ combo bonuses at 3/5/10);
 *     wrong → small attempt reward.
 *   - verified node, retention review: full XP (reviews must stay worth it),
 *     and the node's reviewedAt is stamped so Review picks the stalest next.
 *   - verified node, plain grinding: correct pays ~25%, wrong pays nothing —
 *     no farming the daily goal on material already mastered.
 *
 * Both sides of the exchange are persisted into the node conversation so
 * Bob's next turn (and the reflection pre-pass) see the outcome.
 */
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getUserId } from '@/lib/get-user-id'
import { dbStore } from '@/lib/db-store'
import {
  getTreeWithNodes, judgeCheckpointAnswer, markNodeVerified,
  recordCheckpointStruggle, type XpAwardLite,
} from '@/lib/tree-engine'
import { clampText } from '@/lib/clamp'
import { parseQuizState, MASTERY_TARGET, MASTERY_MIN_SHORT, type PendingQuiz } from '@/lib/mastery'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; nodeId: string }> }) {
  const { id, nodeId } = await params
  const userId = await getUserId()
  const body = (await req.json().catch(() => ({}))) as {
    quiz?: Partial<PendingQuiz>; answer?: string | number; confidence?: 'sure' | 'unsure'; lang?: string
  }

  const tree = await getTreeWithNodes(userId, id)
  const node = tree?.nodes.find(n => n.id === nodeId)
  if (!tree || !node) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // The judged quiz is the server-stored pending one. Fallback to the
  // client-sent payload only for legacy cards persisted before answer keys
  // moved server-side (their markers still carry correctIndex/rubric).
  const qs = parseQuizState(node.quizState)
  const sent = body.quiz
  const usePending = !!qs.pending && (!sent?.question || sent.question === qs.pending.question)
  const quiz = usePending ? qs.pending! : (sent as PendingQuiz | undefined)
  if (!quiz?.question || (quiz.kind !== 'mcq' && quiz.kind !== 'short')) {
    return NextResponse.json({ error: 'quiz required' }, { status: 400 })
  }
  const isReview = usePending && quiz.review === true

  const zh = (tree.language ?? body.lang) === 'zh'
  let correct = false
  let feedback = ''
  let answerText = ''
  let correctIndex: number | undefined

  try {
    if (quiz.kind === 'mcq') {
      const options = Array.isArray(quiz.options) ? quiz.options.map(o => String(o)) : []
      const idx = typeof body.answer === 'number' ? body.answer : parseInt(String(body.answer), 10)
      if (options.length < 2 || !Number.isInteger(idx) || idx < 0 || idx >= options.length
        || !Number.isInteger(quiz.correctIndex) || (quiz.correctIndex as number) < 0 || (quiz.correctIndex as number) >= options.length) {
        return NextResponse.json({ error: 'invalid mcq answer' }, { status: 400 })
      }
      correctIndex = quiz.correctIndex as number
      correct = idx === correctIndex
      answerText = `${String.fromCharCode(65 + idx)}) ${options[idx].slice(0, 300)}`
      // Bob authored the explanation in the session's language already.
      const explanation = (quiz.explanation ?? '').slice(0, 600)
      feedback = explanation
      if (!correct) {
        // Distractor-aware refutation (the moat at its sharpest moment):
        // the distractor the student chose usually encodes THEIR specific
        // misconception — a fast pass names why that exact option tempts and
        // fails, instead of the same canned explanation every wrong-chooser
        // gets. Falls back to the canned text on any error.
        let refutation = ''
        try {
          const Anthropic = (await import('@anthropic-ai/sdk')).default
          const apiKey = process.env.ANTHROPIC_API_KEY
          if (apiKey) {
            const { pickBackgroundModel } = await import('@/lib/chat-model-router')
            const client = new Anthropic({ apiKey })
            const res = await client.messages.create({
              model: pickBackgroundModel(),
              max_tokens: 300,
              messages: [{
                role: 'user',
                content: `A student answered a checkpoint question wrong${body.confidence === 'sure' ? ' and marked themselves SURE (hypercorrection: open by directly naming and refuting the wrong belief — confident errors are the most fixable when confronted head-on)' : ''}.
Question: ${String(quiz.question).slice(0, 400)}
The option THEY chose (wrong): "${options[idx].slice(0, 200)}"
The correct option: "${options[quiz.correctIndex as number].slice(0, 200)}"
Write 1-2 sentences refuting the SPECIFIC belief inside their chosen option — why that exact choice is tempting and precisely why it fails. Do not restate the general explanation (it follows separately). ${zh ? 'Respond in Simplified Chinese (简体中文).' : 'Respond in English.'} Return ONLY the sentences.`,
              }],
            })
            try {
              const { recordAnthropicUsage } = await import('@/lib/usage')
              recordAnthropicUsage(res.usage, { userId, model: pickBackgroundModel(), feature: 'tree-verify' })
            } catch { /* non-critical */ }
            refutation = clampText(((res.content[0] as { text?: string })?.text ?? ''), 400)
          }
        } catch { /* non-critical — canned explanation still lands */ }
        feedback = refutation ? `${refutation}${explanation ? `\n\n${explanation}` : ''}` : (
          body.confidence === 'sure'
            ? `${zh ? '你答得很确定——所以这一点最值得当场纠正：' : 'You were sure — so this is the one to fix right now: '}${explanation}`
            : explanation
        )
      }
    } else {
      const answer = String(body.answer ?? '').trim()
      if (!answer) return NextResponse.json({ error: 'answer required' }, { status: 400 })
      answerText = answer.slice(0, 1200)
      const j = await judgeCheckpointAnswer(userId, id, nodeId, quiz.question, quiz.rubric, answer, body.confidence, body.lang)
      correct = j.correct
      feedback = j.feedback
      if (!correct) void recordCheckpointStruggle(userId, node.title, feedback)
    }
  } catch (err) {
    console.error('[tree] quiz judge failed:', err)
    return NextResponse.json({ error: 'Judging is unavailable right now.' }, { status: 502 })
  }

  // ── Tally the node's checkpoint state (pending consumed, review stamped) ──
  // Judging took seconds — re-read fresh state before the write so we never
  // clobber anything stored in the meantime (e.g. a new pending card).
  const freshRow = await prisma.treeNode.findUnique({ where: { id: nodeId }, select: { quizState: true } }).catch(() => null)
  const tally = parseQuizState(freshRow?.quizState ?? node.quizState)
  tally.attempts += 1
  if (correct) {
    tally.correct += 1
    tally.combo += 1
    if (quiz.kind === 'short') tally.shortCorrect += 1
  } else {
    tally.combo = 0
  }
  // Confidence calibration: sure-but-wrong is the node's blind spot (future
  // checkpoints target it); sure-and-right is healthy calibration.
  if (body.confidence === 'sure') {
    if (correct) tally.sureRight += 1
    else tally.sureWrong += 1
  }
  // Delayed-retest bookkeeping: a correct retest clears the missed entry, a
  // wrong retest re-arms it for the next return visit, and a fresh miss
  // queues for retest hours later (cap 5, newest kept).
  const retestOf = usePending ? quiz.retestOf : undefined
  if (retestOf) {
    tally.missed = correct
      ? tally.missed.filter(m => m.question !== retestOf)
      : tally.missed.map(m => (m.question === retestOf ? { ...m, missedAt: new Date().toISOString() } : m))
  } else if (!correct) {
    tally.missed = [
      ...tally.missed.filter(m => m.question !== quiz.question),
      { question: quiz.question.slice(0, 300), missedAt: new Date().toISOString() },
    ].slice(-5)
  }
  // Consume the pending only if it's still the card we judged — never wipe
  // a newer card Bob stored while we were judging.
  if (tally.pending?.question === quiz.question) tally.pending = null
  if (isReview) tally.reviewedAt = new Date().toISOString()
  await prisma.treeNode.update({ where: { id: nodeId }, data: { quizState: JSON.stringify(tally) } }).catch(() => null)

  // ── XP: every meaningful answer pays; mastered material can't be farmed ──
  const isVerifiedNode = node.status === 'understood'
  const xp: XpAwardLite[] = []
  try {
    const { awardXp } = await import('@/lib/xp-engine')
    if (correct) {
      const baseDifficulty = quiz.kind === 'mcq' ? 0.8 : 1
      const difficulty = isVerifiedNode && !isReview ? baseDifficulty * 0.25 : baseDifficulty
      const a = await awardXp(userId, 'quiz_correct', { difficulty })
      if (a) xp.push(a)
      if (!isVerifiedNode && (tally.combo === 3 || tally.combo === 5 || tally.combo === 10)) {
        const c = await awardXp(userId, 'combo_bonus', { combo: tally.combo })
        if (c) xp.push(c)
      }
    } else if (!isVerifiedNode || isReview) {
      const a = await awardXp(userId, 'quiz_attempt')
      if (a) xp.push(a)
    }
  } catch { /* non-critical */ }

  // ── Mastery: the in-chat tally IS the verification ──
  let verified = false
  let treeCompleted = false
  if (!isVerifiedNode && tally.correct >= MASTERY_TARGET && tally.shortCorrect >= MASTERY_MIN_SHORT) {
    try {
      const r = await markNodeVerified(userId, id, nodeId)
      verified = true
      treeCompleted = r.treeCompleted
      xp.push(...r.xp)
    } catch { /* non-critical */ }
  }

  // ── Persist the exchange so Bob's next turn sees the outcome ──
  try {
    const store = dbStore.forUser(userId)
    const contextTag = `tree-node:${nodeId}`
    let conv = await prisma.conversation.findFirst({ where: { userId, context: contextTag } })
    if (!conv) conv = await store.createConversation(node.title.slice(0, 60), contextTag)
    await store.addMessage(conv.id, 'user', answerText)
    const banner = correct ? (zh ? '✅ **答对了**' : '✅ **Correct**') : (zh ? '❌ **还不对**' : '❌ **Not quite**')
    const verifiedNote = verified
      ? (zh ? '\n\n🎉 **该节点已验证** — 你已通过检查题证明了真正的理解。' : '\n\n🎉 **Node verified** — you proved genuine understanding through checkpoints.')
      : ''
    await store.addMessage(conv.id, 'assistant', `${banner}${feedback ? ` — ${feedback}` : ''}${verifiedNote}`)
  } catch { /* non-critical */ }

  return NextResponse.json({
    correct,
    correctIndex,
    feedback,
    xp,
    mastery: { correct: tally.correct, target: MASTERY_TARGET, shortCorrect: tally.shortCorrect, needShort: tally.shortCorrect < MASTERY_MIN_SHORT },
    verified,
    treeCompleted,
    review: isReview,
  })
}
