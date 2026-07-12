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

  // INTEGRITY: judge ONLY against the live server-stored pending checkpoint,
  // and only when it matches the submitted card. Each checkpoint is answered
  // exactly ONCE — after the first answer the pending is consumed, so a
  // second submission (a duplicate tab, a resubmit) finds no live pending and
  // is a no-op. Re-judging a client-sent payload would let one card be
  // answered repeatedly, inflating the mastery tally past the
  // distinct-checkpoints bar. 409 → the client retires the stale card.
  const qs = parseQuizState(node.quizState)
  const sent = body.quiz
  const quiz = qs.pending
  if (!quiz?.question || (quiz.kind !== 'mcq' && quiz.kind !== 'short')) {
    return NextResponse.json({ error: 'already-answered', code: 'no-pending' }, { status: 409 })
  }
  if (sent?.question && sent.question !== quiz.question) {
    // The card the client is answering is not the one the server is waiting
    // on (a superseded checkpoint) — do not judge it against the wrong key.
    return NextResponse.json({ error: 'stale-card', code: 'mismatch' }, { status: 409 })
  }
  const isReview = quiz.review === true

  // Validate the answer SHAPE before claiming, so a malformed request never
  // consumes the pending (which would strand the card behind a 400).
  const mcqIdx = quiz.kind === 'mcq'
    ? (typeof body.answer === 'number' ? body.answer : parseInt(String(body.answer), 10))
    : -1
  if (quiz.kind === 'mcq') {
    const optLen = Array.isArray(quiz.options) ? quiz.options.length : 0
    if (optLen < 2 || !Number.isInteger(mcqIdx) || mcqIdx < 0 || mcqIdx >= optLen
      || !Number.isInteger(quiz.correctIndex) || (quiz.correctIndex as number) < 0 || (quiz.correctIndex as number) >= optLen) {
      return NextResponse.json({ error: 'invalid mcq answer' }, { status: 400 })
    }
  } else if (!String(body.answer ?? '').trim()) {
    return NextResponse.json({ error: 'answer required' }, { status: 400 })
  }

  // ── ATOMIC CLAIM (exactly-once) ──
  // Consume the pending BEFORE the slow judge, gated on the exact quizState
  // string we just read (optimistic compare-and-set). Of N concurrent
  // submissions of this card, only one wins the claim; the rest see count 0
  // and 409 out — so a card can never be judged or tallied twice, even when
  // both requests land inside the judging window. If the chat route stored a
  // NEW card in the meantime the string won't match either, which is correct:
  // this card is superseded, retire it.
  const claimed = { ...qs, pending: null }
  const claim = await prisma.treeNode.updateMany({
    where: { id: nodeId, quizState: node.quizState },
    data: { quizState: JSON.stringify(claimed) },
  }).catch(() => ({ count: 0 }))
  if (claim.count === 0) {
    return NextResponse.json({ error: 'already-answered', code: 'lost-claim' }, { status: 409 })
  }

  const zh = (tree.language ?? body.lang) === 'zh'
  let correct = false
  let feedback = ''
  let answerText = ''
  let correctIndex: number | undefined

  try {
    if (quiz.kind === 'mcq') {
      // Shape already validated pre-claim; mcqIdx and options are safe here.
      const options = (quiz.options as string[]).map(o => String(o))
      const idx = mcqIdx
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
      const answer = String(body.answer ?? '').trim() // non-empty (validated pre-claim)
      answerText = answer.slice(0, 1200)
      const j = await judgeCheckpointAnswer(userId, id, nodeId, quiz.question, quiz.rubric, answer, body.confidence, body.lang)
      correct = j.correct
      feedback = j.feedback
      if (!correct) {
        const { inBackground } = await import('@/lib/background')
        inBackground(recordCheckpointStruggle(userId, node.title, feedback, zh ? 'zh' : undefined))
      }
    }
  } catch (err) {
    console.error('[tree] quiz judge failed:', err)
    // We already claimed (consumed) the pending; judging then failed. Re-arm
    // it so a transient outage doesn't cost the student their card — restore
    // onto fresh state unless a newer card has since taken the slot.
    try {
      const cur = await prisma.treeNode.findUnique({ where: { id: nodeId }, select: { quizState: true } })
      const curQs = parseQuizState(cur?.quizState)
      if (!curQs.pending) {
        curQs.pending = quiz
        await prisma.treeNode.update({ where: { id: nodeId }, data: { quizState: JSON.stringify(curQs) } })
      }
    } catch { /* best-effort re-arm */ }
    return NextResponse.json({ error: 'Judging is unavailable right now.' }, { status: 502 })
  }

  // ── Tally the node's checkpoint state (pending consumed, review stamped) ──
  // Judging took seconds — the write is a compare-and-set on the fresh-read
  // quizState string (one retry recomputes on the newer state), so this tally
  // and a concurrent pending-card store from the chat stream on another
  // device can never erase each other.
  const applyOutcome = (tally: ReturnType<typeof parseQuizState>) => {
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
    const retestOf = quiz.retestOf
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
    return tally
  }
  let tally = applyOutcome(parseQuizState(node.quizState))
  for (let attempt = 0; attempt < 2; attempt++) {
    const freshRow = await prisma.treeNode.findUnique({ where: { id: nodeId }, select: { quizState: true } }).catch(() => null)
    const base = freshRow ? freshRow.quizState : node.quizState
    tally = applyOutcome(parseQuizState(base))
    const w = await prisma.treeNode.updateMany({
      where: { id: nodeId, quizState: base },
      data: { quizState: JSON.stringify(tally) },
    }).catch(() => null)
    if (w && w.count > 0) break
  }

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
      const r = await markNodeVerified(userId, id, nodeId, zh ? 'zh' : undefined)
      verified = true
      treeCompleted = r.treeCompleted
      xp.push(...r.xp)
    } catch { /* non-critical */ }
  }

  // ── Persist the exchange so Bob's next turn sees the outcome ──
  try {
    const store = dbStore.forUser(userId)
    const contextTag = `tree-node:${nodeId}`
    let conv = await prisma.conversation.findFirst({ where: { userId, context: contextTag }, orderBy: { createdAt: 'asc' } })
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
