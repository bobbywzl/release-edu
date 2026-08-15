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
import { parseQuizState, MASTERY_TARGET, MASTERY_MIN_SHORT, ANSWER_MAX, masteryTarget, masteryFilled, masteryMet, resolveFacetCredit, QUIZ_HISTORY_CAP, type PendingQuiz } from '@/lib/mastery'
import { evaluateAndAwardBadges, type BadgeDef } from '@/lib/badges'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; nodeId: string }> }) {
  const { id, nodeId } = await params
  const userId = await getUserId()
  const body = (await req.json().catch(() => ({}))) as {
    quiz?: Partial<PendingQuiz>; answer?: string | number; confidence?: 'sure' | 'unsure'; lang?: string
    /** For kind:'artifact' — the LinkedFile id of the evidence the student
     *  attached on the card (uploaded via /api/files/upload just before). */
    artifactFileId?: string
  }

  const tree = await getTreeWithNodes(userId, id)
  const node = tree?.nodes.find(n => n.id === nodeId)
  if (!tree || !node) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  // The root has no workspace — nothing to quiz.
  if (node.parentId === null) return NextResponse.json({ error: 'The root node has no workspace.' }, { status: 400 })

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
  if (!quiz?.question || (quiz.kind !== 'mcq' && quiz.kind !== 'short' && quiz.kind !== 'artifact')) {
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
  } else if (quiz.kind === 'artifact') {
    // The evidence file must exist, belong to this student, and be attached
    // to THIS node — validated BEFORE the claim so a bad upload never
    // consumes the card. (The optional note in body.answer may be empty.)
    if (typeof body.artifactFileId !== 'string' || !body.artifactFileId.trim()) {
      return NextResponse.json({ error: 'artifact required' }, { status: 400 })
    }
    const row = await prisma.linkedFile.findUnique({
      where: { id: body.artifactFileId },
      select: { userId: true, workId: true },
    }).catch(() => null)
    if (!row || row.userId !== userId || row.workId !== nodeId) {
      return NextResponse.json({ error: 'artifact not found' }, { status: 400 })
    }
  } else if (!String(body.answer ?? '').trim()) {
    return NextResponse.json({ error: 'answer required' }, { status: 400 })
  } else if (String(body.answer ?? '').trim().length > ANSWER_MAX) {
    // Never hand the judge a truncated answer: overflow is rejected BEFORE
    // the claim (the card stays armed), with the reason spelled out — the
    // composer enforces the same ANSWER_MAX with a live counter.
    const zhLen = (tree.language ?? body.lang) === 'zh'
    return NextResponse.json({
      error: zhLen ? `答案请控制在 ${ANSWER_MAX} 字以内。` : `Keep your answer under ${ANSWER_MAX} characters.`,
      code: 'answer-too-long',
    }, { status: 400 })
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
            const { getBackgroundModel } = await import('@/lib/model-resolver')
            const bgModel = await getBackgroundModel()
            const client = new Anthropic({ apiKey })
            const res = await client.messages.create({
              model: bgModel,
              max_tokens: 300,
              messages: [{
                role: 'user',
                content: `A student answered a checkpoint question wrong${body.confidence === 'sure' ? ' and marked themselves SURE (hypercorrection: open by directly naming and refuting the wrong belief — confident errors are the most fixable when confronted head-on)' : ''}.
Question: ${String(quiz.question).slice(0, 400)}
The option THEY chose (wrong): "${options[idx].slice(0, 200)}"
The correct option: "${options[quiz.correctIndex as number].slice(0, 200)}"
Write 1-2 sentences refuting the SPECIFIC belief inside their chosen option — why that exact choice is tempting and precisely why it fails. Do not restate the general explanation (it follows separately). ${zh ? 'Respond in Simplified Chinese (简体中文).' : 'Respond in English.'} Return ONLY the sentences.`,
              }],
            }, { timeout: 15000, maxRetries: 1 })
            try {
              const { recordAnthropicUsage } = await import('@/lib/usage')
              recordAnthropicUsage(res.usage, { userId, model: bgModel, feature: 'tree-verify' })
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
    } else if (quiz.kind === 'artifact') {
      // EVIDENCE CHECKPOINT: grade the real thing. The artifact reaches the
      // judge as its Gemini content-analysis; if the background analysis
      // pass hasn't landed yet, run it synchronously now (grading is the
      // moment that needs eyes). Text files are readable directly.
      const row = await prisma.linkedFile.findUnique({
        where: { id: String(body.artifactFileId) },
        select: { id: true, name: true, mimeType: true, content: true, analysis: true },
      })
      if (!row) throw new Error('artifact-row-missing')
      let analysis = (row.analysis ?? '').trim()
      const isMedia = /^(image|audio|video)\//.test(row.mimeType ?? '') || row.mimeType === 'application/pdf'
      if (!analysis && isMedia && (row.content ?? '').startsWith('data:')) {
        try {
          const b64 = (row.content as string).split(',', 2)[1] ?? ''
          if (b64) {
            const { analyzeImage } = await import('@/lib/gemini')
            analysis = (await analyzeImage(b64, `the student's checkpoint evidence "${row.name}" — describe exactly what it shows, including any readings, numbers, connections, or outputs visible`, row.mimeType ?? 'image/png', userId)).slice(0, 8000)
            await prisma.linkedFile.update({ where: { id: row.id }, data: { analysis } }).catch(() => null)
          }
        } catch { /* analysis unavailable — judged conservatively below */ }
      }
      if (!analysis && !isMedia && (row.content ?? '').trim() && !(row.content ?? '').startsWith('data:')) {
        analysis = `(text file contents) ${String(row.content).slice(0, 1500)}`
      }
      const note = String(body.answer ?? '').trim()
      const evidence = `ARTIFACT FILE: "${row.name}" (${row.mimeType})
CONTENT ANALYSIS: ${analysis || '(no machine analysis could be produced for this attachment — the artifact is unreadable; unless the note alone is conclusive, score below 7 and say what a clearer capture would show)'}${note ? `
STUDENT'S NOTE: ${note.slice(0, 400)}` : ''}`
      answerText = `📎 ${row.name}${note ? ` — ${note.slice(0, 300)}` : ''}`
      const j = await judgeCheckpointAnswer(userId, id, nodeId, quiz.question, quiz.rubric, evidence, body.confidence, body.lang, { artifact: true })
      correct = j.correct
      feedback = j.feedback
      if (!correct) {
        const { inBackground } = await import('@/lib/background')
        inBackground(recordCheckpointStruggle(userId, node.title, feedback, zh ? 'zh' : undefined))
      }
    } else {
      const answer = String(body.answer ?? '').trim() // non-empty + length-validated pre-claim
      answerText = answer.slice(0, ANSWER_MAX)
      const j = await judgeCheckpointAnswer(userId, id, nodeId, quiz.question, quiz.rubric, answer, body.confidence, body.lang)
      correct = j.correct
      feedback = j.feedback
      if (!correct) {
        const { inBackground } = await import('@/lib/background')
        inBackground(recordCheckpointStruggle(userId, node.title, feedback, zh ? 'zh' : undefined, id))
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
    // The 502 carries a machine-readable stage + a bounded detail string
    // (model ids + upstream statuses, no secrets) — the client renders it
    // under the retry so the NEXT report of this pins the real cause on
    // sight instead of another round of guessing.
    return NextResponse.json({
      error: 'Judging is unavailable right now.',
      code: 'judge-failed',
      detail: String((err as Error)?.message ?? err).slice(0, 300),
    }, { status: 502 })
  }

  // ── Tally the node's checkpoint state (pending consumed, review stamped) ──
  // Judging took seconds — the write is a compare-and-set on the fresh-read
  // quizState string (one retry recomputes on the newer state), so this tally
  // and a concurrent pending-card store from the chat stream on another
  // device can never erase each other.
  // Turn-scoped coverage outcome, recomputed deterministically by applyOutcome
  // from the base state each CAS attempt, so the flags match the tally that
  // actually landed.
  let coverageAdvanced = false
  let coverageOutcome: 'credit' | 'deepening' | 'unresolved' | 'nocontract' = 'nocontract'
  // This correct answer closed a facet the learner had previously MISSED —
  // the visible "hole filled" moment (rail tick + insight resolution).
  let fixedAfterStruggle = false
  const applyOutcome = (tally: ReturnType<typeof parseQuizState>) => {
    tally.attempts += 1
    if (correct) {
      tally.correct += 1
      tally.combo += 1
      tally.wrongStreak = 0
      // An artifact is a PRODUCTION, not recognition — it satisfies the
      // own-words bar at least as strongly as a typed explanation.
      if (quiz.kind === 'short' || quiz.kind === 'artifact') tally.shortCorrect += 1
      // KEEP THE LEARNER'S OWN WORDS (satisfaction audit #4): a judged-correct
      // own-words/artifact answer is their most identity-invested artifact —
      // stamped here so the victory turn quotes it, the panels show it, and
      // the portfolio cites it. Newest last, capped at 6.
      if ((quiz.kind === 'short' || quiz.kind === 'artifact') && answerText.trim()) {
        tally.provenAnswers = [
          ...(tally.provenAnswers ?? []),
          {
            ...(typeof quiz.facet === 'string' && quiz.facet.trim() ? { facet: quiz.facet.slice(0, 120) } : {}),
            answer: answerText.slice(0, 500),
            at: new Date().toISOString(),
          },
        ].slice(-6)
      }
      // Syllabus coverage — TRUTHFUL crediting: a facet flips `done` ONLY when
      // a checkpoint that actually targeted it is answered correctly. A tag on
      // an already-done facet is a deepening question (no coverage change); a
      // missing/ambiguous tag NEVER credits an unprobed facet — not even as a
      // backstop. (The old N=2 auto-flip silently certified promises no
      // question ever tested; the anti-stall job now belongs to a DIRECTIVE:
      // the chat prompt orders Bob to re-tag exactly, and the learner sees an
      // honest "coverage didn't move" note below.)
      if (Array.isArray(tally.facets) && tally.facets.length > 0) {
        const r = resolveFacetCredit(tally.facets, quiz.facet)
        coverageOutcome = r.kind
        coverageAdvanced = false
        if (r.kind === 'credit') {
          // "Failed first, then fixed": the facet was struggled before this
          // correct answer — the checkpoint rail renders it as repaired
          // learning, and matching struggle/misconception insights close.
          fixedAfterStruggle = tally.facets[r.index].struggled === true
          tally.facets[r.index].done = true
          // EVIDENCE CONTRACT paper trail: record HOW the facet was proven.
          // If an artifact checkpoint was ever issued on it but a reasoning
          // answer is what flipped it, the substitution goes on the record —
          // verified by reasoning, evidence pending (cleared when the
          // deferred capture is attached; the Deployed label needs ≥1 real
          // artifact on the tree).
          tally.facets[r.index].provenBy = quiz.kind
          const fname = tally.facets[r.index].name.trim().toLowerCase()
          const askedArtifact = (tally.artifactAsked ?? []).some(x => x.trim().toLowerCase() === fname)
          if (quiz.kind === 'artifact') {
            delete tally.facets[r.index].evidencePending
          } else if (askedArtifact) {
            tally.facets[r.index].evidencePending = true
          }
          tally.untaggedStreak = 0
          coverageAdvanced = true
        } else if (r.kind === 'deepening') {
          // Coverage MUST NOT move — the exact promise the prompt makes
          // ("questions on already-✅ facets never advance verification").
          // The tag itself was fine, so untaggedStreak is untouched.
        } else {
          tally.untaggedStreak = (tally.untaggedStreak ?? 0) + 1
        }
      }
    } else {
      tally.combo = 0
      // The app's own ground truth for wheel-spinning — read by the chat
      // route as max(reflection.streakWrong, wrongStreak) so the analogy
      // bridge / prerequisite chain / intervention switch fire from judged
      // answers, not only from typed confusion.
      tally.wrongStreak = (tally.wrongStreak ?? 0) + 1
      // The law-mandated full remediation is now a PERSISTED debt: if the
      // client's follow-up turn dies with the tab, the workspace fires
      // [NODE_REMEDIATE] on next mount and the chat route clears this.
      tally.remediationOwed = quiz.question.slice(0, 400)
      // Mark the probed facet STRUGGLED (done or not) — the "hole to fill"
      // that the checkpoint rail and the in-chat objective pills track until
      // a later correct answer on the same facet ticks it closed.
      if (Array.isArray(tally.facets) && tally.facets.length > 0) {
        const rr = resolveFacetCredit(tally.facets, quiz.facet)
        if (rr.kind === 'credit') {
          tally.facets[rr.index].struggled = true
        } else {
          const want = (quiz.facet ?? '').trim().toLowerCase()
          const i = want ? tally.facets.findIndex(f => f.name.trim().toLowerCase() === want) : -1
          if (i !== -1) tally.facets[i].struggled = true
        }
      }
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
    // PERFORMANCE RECORD (Mastery Board): append this judged attempt to the
    // node's chronological history — outcome/facet/confidence only, never key
    // material. `fix` marks the comeback moment: a correct answer that closed
    // a facet the learner had previously missed (gated on THIS application's
    // credit so CAS re-runs on fresher state stay truthful).
    tally.history = [
      ...(tally.history ?? []),
      {
        t: new Date().toISOString(), ok: correct, kind: quiz.kind,
        ...(typeof quiz.facet === 'string' && quiz.facet.trim() ? { facet: quiz.facet.trim().slice(0, 120) } : {}),
        ...(body.confidence === 'sure' || body.confidence === 'unsure' ? { conf: body.confidence } : {}),
        ...(isReview ? { review: true } : {}),
        ...(correct && coverageAdvanced && fixedAfterStruggle ? { fix: true } : {}),
      },
    ].slice(-QUIZ_HISTORY_CAP)
    return tally
  }
  // NEVER-LOSE WRITE: a silently dropped tally desynchronizes the header
  // pips from the answers the student visibly got right — the exact
  // trust-breaking mismatch this route exists to prevent. Four CAS attempts
  // (fresh read each), then a final merge write that cannot be skipped.
  let tally = applyOutcome(parseQuizState(node.quizState))
  let tallyLanded = false
  for (let attempt = 0; attempt < 4 && !tallyLanded; attempt++) {
    const freshRow = await prisma.treeNode.findUnique({ where: { id: nodeId }, select: { quizState: true } }).catch(() => null)
    const base = freshRow ? freshRow.quizState : node.quizState
    tally = applyOutcome(parseQuizState(base))
    const w = await prisma.treeNode.updateMany({
      where: { id: nodeId, quizState: base },
      data: { quizState: JSON.stringify(tally) },
    }).catch(() => null)
    if (w && w.count > 0) tallyLanded = true
  }
  if (!tallyLanded) {
    // Contended beyond all retries — merge onto the freshest state and write
    // unconditionally. The window between read and write is microseconds;
    // losing a whole correct answer is strictly worse.
    console.warn('[tree] quiz tally CAS exhausted — merge write', { nodeId })
    try {
      const freshRow = await prisma.treeNode.findUnique({ where: { id: nodeId }, select: { quizState: true } })
      tally = applyOutcome(parseQuizState(freshRow?.quizState ?? node.quizState))
      await prisma.treeNode.update({ where: { id: nodeId }, data: { quizState: JSON.stringify(tally) } })
    } catch (err) {
      console.error('[tree] quiz tally merge write failed:', err)
    }
  }

  // ── VISIBLE CLOSING (the report card becomes progress) ──
  // A correct answer that re-proves previously-missed ground — a passed
  // delayed retest, or a facet that was struggled and just flipped done —
  // RESOLVES the matching struggle/misconception insights right now, so the
  // open learner model visibly crosses them off mid-session instead of only
  // at full node verification.
  if (correct && (fixedAfterStruggle || !!quiz.retestOf)) {
    try {
      const { inBackground } = await import('@/lib/background')
      const { markStrugglesResolved } = await import('@/lib/insight-memory')
      inBackground(markStrugglesResolved(userId, node.title))
    } catch { /* non-critical */ }
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
  // Coverage-based: EVERY syllabus facet proven (or the static fallback for
  // contract-less nodes) + the own-words requirement — see masteryMet().
  // CONTRACT TRUTH: `verified` reports the coverage state itself, NOT the
  // success of the side-effect batch. If markNodeVerified hiccups (XP,
  // insight write), the student still SEES verified — and the tree-GET
  // reconciliation repairs the status column on the next read, so chat and
  // workspace can never durably disagree.
  let verified = false
  let treeCompleted = false
  // Every branch verified but the tree never grew past its seed: the trophy
  // is withheld (completion gate) and the client asks the honest question —
  // "is the problem actually answered?" — with the Copilot gap-check as CTA.
  let seedComplete = false
  // Deployable-depth twin of seedComplete: every branch verified, but the
  // session promised deployable understanding and no build evidence exists —
  // the client asks for it ("show me it running") instead of the trophy.
  let buildPending = false
  if (!isVerifiedNode && masteryMet(tally)) {
    verified = true
    try {
      const r = await markNodeVerified(userId, id, nodeId, zh ? 'zh' : undefined)
      treeCompleted = r.treeCompleted
      seedComplete = r.seedOnly ?? false
      buildPending = r.buildPending ?? false
      xp.push(...r.xp)
    } catch (err) {
      console.error('[tree] markNodeVerified failed (status will reconcile on next tree read):', err)
    }
  }

  // ── BADGES AT THE EARNING MOMENT (satisfaction audit #2) ──
  // Evaluate right here, where the metrics just moved, and ship any unlock
  // WITH the verdict — the big center-screen celebration fires in the
  // workspace at the earning act, not on some later dashboard visit.
  let newBadges: Pick<BadgeDef, 'id' | 'tier' | 'icon' | 'name' | 'desc'>[] = []
  try {
    const nb = await evaluateAndAwardBadges(userId)
    newBadges = nb.map(b => ({ id: b.id, tier: b.tier, icon: b.icon, name: b.name, desc: b.desc }))
  } catch { /* non-critical */ }

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
    // Review closure — the designed review is ONE question; its ✅ + this line
    // ARE the closure moment (no follow-up chain). verified and isReview are
    // mutually exclusive (review nodes are already understood), so these never
    // co-fire.
    const reviewNote = isReview && correct
      ? (zh ? '\n\n🌱 **复习完成** — 记忆已刷新，该节点保持已验证状态。' : '\n\n🌱 **Review complete** — memory refreshed; this node stays verified.')
      : ''
    // Coverage honesty: a correct answer that legitimately moved no pip
    // (deepening an already-proven point, or an unresolvable tag) must SAY so
    // — a silent non-move is the exact header/chat mismatch this route guards
    // against. Composed server-side per session language (client t() context
    // is unavailable for persisted messages — the sanctioned i18n path here).
    let coverageNote = ''
    const outcome: string = coverageOutcome
    if (correct && !verified && !isVerifiedNode && Array.isArray(tally.facets) && tally.facets.length > 0 && !coverageAdvanced) {
      if (outcome === 'deepening') {
        coverageNote = zh
          ? '（这是对你已证明知识点的加深提问——大纲覆盖不变；下一道检查题将针对未证明的知识点）'
          : ' (a deepening question on a point you already proved — the coverage map is unchanged; the next checkpoint targets an unproven point)'
      } else if (outcome === 'unresolved') {
        coverageNote = zh
          ? '（已记录——当检查题证明未证明的大纲知识点时，覆盖进度才会前进）'
          : ' (recorded — the coverage map advances when a checkpoint proves an unproven syllabus point)'
      }
    }
    await store.addMessage(conv.id, 'assistant', `${banner}${feedback ? ` — ${feedback}` : ''}${coverageNote}${verifiedNote}${reviewNote}`)
  } catch { /* non-critical */ }

  // Keep the node's MASTERY BOARD digest fresh: a judged checkpoint is
  // exactly the kind of event the board narrates (a proven facet, a fixed
  // hole, a wrong answer worth reading back). Backgrounded — never blocks
  // the verdict the student is waiting on.
  try {
    const { inBackground } = await import('@/lib/background')
    const { refreshNodeBoardDigest } = await import('@/lib/tree-engine')
    inBackground(refreshNodeBoardDigest(userId, id, nodeId, zh ? 'zh' : undefined))
  } catch { /* non-critical */ }

  return NextResponse.json({
    correct,
    correctIndex,
    feedback,
    xp,
    mastery: { correct: masteryFilled(tally), target: masteryTarget(tally), shortCorrect: tally.shortCorrect, needShort: tally.shortCorrect < MASTERY_MIN_SHORT },
    verified,
    // verified = newly flipped THIS answer; alreadyVerified = was verified
    // before it (the client uses this to stop soliciting cards on a node
    // that's already done — the review is ONE question, not a chain).
    alreadyVerified: isVerifiedNode,
    treeCompleted,
    seedComplete,
    buildPending,
    review: isReview,
    // The "hole filled" moment: this correct answer closed a previously
    // missed facet — the client ticks its objective pill with the animation.
    fixedFacet: fixedAfterStruggle && quiz.facet ? quiz.facet : null,
    // Badge unlocks earned by THIS answer — celebrated where it happened.
    newBadges,
  })
}
