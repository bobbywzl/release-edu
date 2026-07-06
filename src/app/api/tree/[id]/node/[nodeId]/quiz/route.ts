export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/tree/[id]/node/[nodeId]/quiz
 *   { quiz, answer, confidence?, lang }
 *
 * Judges ONE in-chat checkpoint question (the [[QUIZ]] card Bob emitted in
 * the workspace chat). MCQs are judged deterministically against the card's
 * correctIndex; short answers by Sonnet (Differentiator bar + hypercorrection).
 *
 * This is where the reward loop lands: correct → quiz XP (+ escalating combo
 * bonuses at 3/5/10 in a row); wrong → a small attempt reward. When the node's
 * tally reaches MASTERY_TARGET correct (incl. one own-words short answer),
 * the node is verified — there is no separate verification screen.
 *
 * Both sides of the exchange are persisted into the node conversation so
 * Bob's next turn (and the reflection pre-pass) see the outcome.
 */
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getUserId } from '@/lib/get-user-id'
import { dbStore } from '@/lib/db-store'
import {
  getTreeWithNodes, parseQuizState, judgeCheckpointAnswer, markNodeVerified,
  recordCheckpointStruggle, MASTERY_TARGET, MASTERY_MIN_SHORT, type XpAwardLite,
} from '@/lib/tree-engine'
import { clampText } from '@/lib/clamp'

interface QuizPayload {
  kind?: string
  question?: string
  options?: unknown
  correctIndex?: number
  explanation?: string
  rubric?: string
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; nodeId: string }> }) {
  const { id, nodeId } = await params
  const userId = await getUserId()
  const body = (await req.json().catch(() => ({}))) as {
    quiz?: QuizPayload; answer?: string | number; confidence?: 'sure' | 'unsure'; lang?: string
  }
  const quiz = body.quiz
  if (!quiz?.question || (quiz.kind !== 'mcq' && quiz.kind !== 'short')) {
    return NextResponse.json({ error: 'quiz required' }, { status: 400 })
  }

  const tree = await getTreeWithNodes(userId, id)
  const node = tree?.nodes.find(n => n.id === nodeId)
  if (!tree || !node) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const zh = (tree.language ?? body.lang) === 'zh'
  let correct = false
  let feedback = ''
  let answerText = ''

  try {
    if (quiz.kind === 'mcq') {
      const options = Array.isArray(quiz.options) ? quiz.options.map(o => String(o)) : []
      const idx = typeof body.answer === 'number' ? body.answer : parseInt(String(body.answer), 10)
      if (options.length < 2 || !Number.isInteger(idx) || idx < 0 || idx >= options.length
        || !Number.isInteger(quiz.correctIndex) || (quiz.correctIndex as number) < 0 || (quiz.correctIndex as number) >= options.length) {
        return NextResponse.json({ error: 'invalid mcq answer' }, { status: 400 })
      }
      correct = idx === quiz.correctIndex
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

  // ── Tally the node's checkpoint state ──
  const qs = parseQuizState(node.quizState)
  qs.attempts += 1
  if (correct) {
    qs.correct += 1
    qs.combo += 1
    if (quiz.kind === 'short') qs.shortCorrect += 1
  } else {
    qs.combo = 0
  }
  await prisma.treeNode.update({ where: { id: nodeId }, data: { quizState: JSON.stringify(qs) } }).catch(() => null)

  // ── XP: every answer pays something; correctness and streaks pay more ──
  const xp: XpAwardLite[] = []
  try {
    const { awardXp } = await import('@/lib/xp-engine')
    if (correct) {
      const a = await awardXp(userId, 'quiz_correct', { difficulty: quiz.kind === 'mcq' ? 0.8 : 1 })
      if (a) xp.push(a)
      if (qs.combo === 3 || qs.combo === 5 || qs.combo === 10) {
        const c = await awardXp(userId, 'combo_bonus', { combo: qs.combo })
        if (c) xp.push(c)
      }
    } else {
      const a = await awardXp(userId, 'quiz_attempt')
      if (a) xp.push(a)
    }
  } catch { /* non-critical */ }

  // ── Mastery: the in-chat tally IS the verification ──
  let verified = false
  let treeCompleted = false
  if (node.status !== 'understood' && qs.correct >= MASTERY_TARGET && qs.shortCorrect >= MASTERY_MIN_SHORT) {
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
    feedback,
    xp,
    mastery: { correct: qs.correct, target: MASTERY_TARGET, shortCorrect: qs.shortCorrect, needShort: qs.shortCorrect < MASTERY_MIN_SHORT },
    verified,
    treeCompleted,
  })
}
