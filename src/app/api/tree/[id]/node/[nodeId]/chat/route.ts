export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * POST /api/tree/[id]/node/[nodeId]/chat { message, lang }
 *
 * Bob inside the node workspace: a streaming tutoring chat grounded in the
 * problem tree, the node's lineage, and its explainer. One persistent
 * conversation per node (Conversation.context = "tree-node:<nodeId>").
 *
 * If the student's question opens genuinely NEW ground (not teachable within
 * this node), Bob points them to the Grow button instead of silently
 * expanding the tree — growth stays permission-based.
 */
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getUserId } from '@/lib/get-user-id'
import { dbStore } from '@/lib/db-store'
import { getTreeWithNodes, sketchTree, nodePath, sessionDirectives, ANSWER_STANDARD, evidenceLocker, type XpAwardLite } from '@/lib/tree-engine'
import { parseQuizState, MASTERY_TARGET, MASTERY_MIN_SHORT, type PendingQuiz } from '@/lib/mastery'
import { getTeachingModel } from '@/lib/model-resolver'

interface Reflection {
  state: string          // one-line read of where the student is
  gapDepth: 'none' | 'partial' | 'deep'
  streakWrong: number    // consecutive confused/incorrect turns
  directive: string      // Bob's next move
  // Discovery: repeated questions circling a field the tree doesn't cover
  // yet → suggest a new node (the student approves via a button in chat).
  suggestNode?: { title: string; summary: string } | null
  // The discussion actually belongs to a different existing node.
  moveToNodeId?: string | null
  moveToTitle?: string | null
  // Concrete real-world execution progress detected in the student's message.
  projectProgress?: string | null
  // A SYSTEMATIC wrong belief (same wrong idea expressed as their model of
  // the world) — needs direct refutation, not more practice (repair theory).
  misconception?: string | null
}

function safeParse<T>(str: string | null | undefined, fallback: T): T {
  if (!str) return fallback
  try { return JSON.parse(str) as T } catch { return fallback }
}

/**
 * Contextual thinking (Haiku pre-pass) — the fast read of the student's
 * latest message against the exchange, handing Bob an adaptive directive
 * before he speaks. Same ideology as Release EDU's reflection engine:
 * detect the gap, track the wrong-streak, choose re-explain vs Socratic
 * probe vs advance — and stay supportive when the student is struggling.
 */
async function haikuReflect(
  apiKey: string,
  nodeTitle: string,
  nodeId: string,
  treeSketch: string,
  recentUserMsgs: string[],
  lastBobMsg: string,
  studentMsg: string,
  prior: Reflection | null,
  sessionLang?: string,
): Promise<Reflection | null> {
  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const client = new Anthropic({ apiKey })
    const { pickBackgroundModel } = await import('@/lib/chat-model-router')
    const result = await client.messages.create({
      model: pickBackgroundModel(),
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `Fast tutoring read. Concept under study: "${nodeTitle}" (node id ${nodeId}).

THE FULL TREE (every node has an id-less sketch; titles are unique enough to reference):
${treeSketch.slice(0, 2500)}

Student's recent questions in this node (oldest first):
${recentUserMsgs.slice(-4).map(m => `- "${m.slice(0, 200)}"`).join('\n') || '(first question)'}
Tutor's last message (context): "${lastBobMsg.slice(0, 400)}"
Student's NEW message: "${studentMsg.slice(0, 500)}"
Prior wrong-streak: ${prior?.streakWrong ?? 0}

Assess and return ONLY JSON:
{"state": "one-line read of where the student is right now",
 "gapDepth": "none|partial|deep",
 "streakWrong": <prior+1 if this message shows confusion/an incorrect idea, else 0>,
 "directive": "one sentence: the tutor's best next move (re-explain from a new angle / Socratic probe / concrete example / advance)",
 "suggestNode": <ONLY if the student's questions have REPEATEDLY (2+ times) circled a coherent field/pain-point that NO existing tree node covers: {"title": "2-6 words", "summary": "1-2 plain sentences"} — otherwise null. Be conservative: most turns warrant null.>,
 "moveToTitle": <ONLY if the discussion clearly belongs to a DIFFERENT existing node in the sketch: that node's exact title — otherwise null>,
 "projectProgress": <ONLY if the student's message shows CONCRETE execution progress on building the product / solving the root problem in the real world (ran an experiment, wrote code, built something, measured results — not just asking questions): "one line describing the progress made" — otherwise null>,
 "misconception": <ONLY if the student expressed a SYSTEMATIC wrong belief (stated as their model of how things work, or the same wrong idea as before — NOT a one-off slip): "the wrong belief, stated precisely" — otherwise null>}
Write the human-readable strings — suggestNode's "title" and "summary", "projectProgress", and "misconception" — entirely in ${sessionLang === 'zh' ? 'Simplified Chinese (简体中文)' : 'English'} (the session language; these are persisted and shown to the student, e.g. an approved suggestNode becomes a real tree node).`,
      }],
    })
    try {
      const { recordAnthropicUsage } = await import('@/lib/usage')
      recordAnthropicUsage(result.usage, { userId: null, model: pickBackgroundModel(), feature: 'reflection' })
    } catch { /* non-critical */ }
    const text = (result.content[0] as { text?: string })?.text ?? ''
    const match = text.match(/\{[\s\S]*\}/)
    return match ? (JSON.parse(match[0]) as Reflection) : null
  } catch {
    return null
  }
}

/** GET — the node's persisted conversation history (for the Workspace). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ nodeId: string }> }) {
  const { nodeId } = await params
  const userId = await getUserId()
  // orderBy pins every reader/writer to the OLDEST row if a concurrent
  // first-open ever created duplicates for this context tag.
  const conv = await prisma.conversation.findFirst({
    where: { userId, context: `tree-node:${nodeId}` },
    orderBy: { createdAt: 'asc' },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  })
  return NextResponse.json({
    conversationId: conv?.id ?? null,
    messages: (conv?.messages ?? []).map(m => ({
      id: m.id, role: m.role, content: m.content, createdAt: m.createdAt,
    })),
  })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; nodeId: string }> }) {
  const { id, nodeId } = await params
  const userId = await getUserId()
  const store = dbStore.forUser(userId)
  const { message, lang } = (await req.json().catch(() => ({}))) as { message?: string; lang?: string }
  if (!message?.trim()) return new Response('Message required', { status: 400 })

  const tree = await getTreeWithNodes(userId, id)
  const node = tree?.nodes.find(n => n.id === nodeId)
  if (!tree || !node) return new Response('Not found', { status: 404 })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return new Response('Not configured', { status: 503 })

  // One conversation per node, found by context tag. The window must be the
  // LATEST 40 messages (desc + reverse to chronological) — an ascending take
  // would pin Bob's context and the return-visit gate to the conversation's
  // ancient head once it grows past 40 messages.
  const contextTag = `tree-node:${nodeId}`
  let conv = await prisma.conversation.findFirst({
    where: { userId, context: contextTag },
    orderBy: { createdAt: 'asc' },
    include: { messages: { orderBy: { createdAt: 'desc' }, take: 40 } },
  })
  if (conv) conv.messages.reverse()
  if (!conv) {
    const created = await store.createConversation(node.title.slice(0, 60), contextTag)
    conv = { ...created, messages: [] } as typeof conv & { messages: [] }
  }

  // Client triggers, not student messages — nothing is persisted for the
  // trigger itself; only Bob's reply is saved.
  //   [NODE_INTRO]  — first open: condensed syllabus-style hook.
  //   [NODE_REVIEW] — retention review of a verified node: reactivate the
  //                   idea, then one fresh checkpoint (full XP).
  const isIntro = message.trim() === '[NODE_INTRO]'
  const isReview = message.trim() === '[NODE_REVIEW]'
  // [NODE_CHECKPOINT] — the client fires this after each answered checkpoint
  // while the node is still unverified, so questions keep coming (with a brief
  // clarify if they just missed) until the node is complete.
  const isCheckpoint = message.trim() === '[NODE_CHECKPOINT]'
  const isTrigger = isIntro || isReview || isCheckpoint
  if (!isTrigger) await store.addMessage(conv!.id, 'user', message.trim())

  // Contextual thinking (Haiku) before Bob speaks — persisted on the
  // conversation so the wrong-streak survives across turns. The same pass
  // watches for DISCOVERY: repeated questions circling an uncovered field
  // (→ suggest a new node) or a discussion that belongs to another node
  // (→ recommend moving). Suggestions render as approve buttons in chat.
  let reflectionBlock = ''
  let suggestion: { type: 'add'; title: string; summary: string } | { type: 'move'; nodeId: string; title: string } | null = null
  // XP earned server-side during this turn (perseverance tiers) — appended to
  // the stream as a [[XP]] marker so the client can toast it.
  const turnXp: XpAwardLite[] = []
  if (!isTrigger) {
    const prior = safeParse<{ lastReflection?: Reflection }>(conv!.summary, {}).lastReflection ?? null
    const lastBob = [...(conv!.messages ?? [])].reverse().find(m => m.role === 'assistant')?.content ?? ''
    const recentUserMsgs = (conv!.messages ?? []).filter(m => m.role === 'user').map(m => m.content)
    const r = await haikuReflect(apiKey, node.title, nodeId, sketchTree(tree.nodes), recentUserMsgs, lastBob, message.trim(), prior, tree.language ?? lang)
    if (r) {
      // ── ANALOGY BRIDGE (the insight moat at work) ──
      // 2+ confused turns → stop re-explaining in the abstract. Pull the
      // student's verified ACQUIRED KNOWLEDGE and strengths from memory and
      // hand Bob the raw material to teach THIS concept as an explicit
      // analogy from something they already demonstrably understand.
      let analogyBlock = ''
      if (r.streakWrong >= 2) {
        try {
          const { getTopInsights } = await import('@/lib/insight-memory')
          const anchors = await getTopInsights(userId, { limit: 8, types: ['knowledge', 'strength', 'interest'] })
          if (anchors.length > 0) {
            analogyBlock = `\n- ANALOGY BRIDGE: the student verifiably knows / is strong in:\n${anchors.map(a => `    · [${a.type}] ${a.content}`).join('\n')}\n  Build your re-explanation as an EXPLICIT analogy: map the structure of one of these onto "${node.title}" step by step ("you already know X — this works the same way, except…"). Anchor the new concept to their existing knowledge, then show where the analogy breaks.`
          }
        } catch { /* non-critical */ }
      }

      // ── PREREQUISITE BACKWARD-CHAIN ──
      // Research: when a learner keeps failing a skill, the deficit is often
      // UPSTREAM. Surface unverified ancestors so Bob can check foundations
      // instead of drilling the same wall.
      let prereqBlock = ''
      if (r.streakWrong >= 2) {
        const ancestors = nodePath(tree.nodes, nodeId).slice(0, -1).filter(a => a.parentId !== null && a.status !== 'understood')
        if (ancestors.length > 0) {
          prereqBlock = `\n- PREREQUISITE CHECK: these upstream nodes are NOT yet verified: ${ancestors.map(a => `"${a.title}"`).join(', ')}. The real gap may live there — probe one prerequisite briefly; if confirmed, recommend moving to that node.`
        }
      }

      // Systematic misconception → direct refutation + remembered.
      let misconceptionBlock = ''
      if (r.misconception) {
        misconceptionBlock = `\n- MISCONCEPTION DETECTED: "${r.misconception}" — this is a systematic wrong model, not a slip. Refute it DIRECTLY and memorably (name the belief, show precisely why it fails, replace it), per repair theory. More examples alone will not fix it.`
        // Reinforce-over-duplicate: haikuReflect emits a misconception when it
        // RECURS, so an unconditional create would stack near-identical rows
        // (the same bug fixed for struggles). Bump the existing one instead.
        const zhSession = (tree.language ?? lang) === 'zh'
        void (async () => {
          try {
            const { clampText } = await import('@/lib/clamp')
            // Localized wrapper (no English scaffolding in a 中文 panel); dedup
            // matches on the BARE title so it works across both quote styles.
            const tag = zhSession ? `（出现在「${node.title}」）` : `(at "${node.title}")`
            const existing = await prisma.insight.findFirst({
              where: {
                userId, type: 'misconception', status: 'active',
                OR: [{ content: { contains: `"${node.title}"` } }, { content: { contains: `「${node.title}」` } }],
              },
              orderBy: { lastConfirmedAt: 'desc' },
            })
            if (existing) {
              await prisma.insight.update({
                where: { id: existing.id },
                data: {
                  timesObserved: { increment: 1 },
                  lastConfirmedAt: new Date(),
                  confidence: Math.min(1, (existing.confidence ?? 0.5) + 0.05),
                },
              })
            } else {
              await prisma.insight.create({
                data: {
                  userId, type: 'misconception',
                  content: `${clampText(r.misconception!, 250)} ${tag}`,
                  confidence: 0.7, importance: 0.6, source: 'reflection',
                },
              })
            }
          } catch { /* non-critical */ }
        })()
      }

      // Perseverance XP: struggle that keeps going is visibly rewarded —
      // awarded once per tier crossing (2 → 3 → 4 confused turns).
      if (r.streakWrong >= 2 && r.streakWrong <= 4 && r.streakWrong > (prior?.streakWrong ?? 0)) {
        try {
          const { awardXp } = await import('@/lib/xp-engine')
          const a = await awardXp(userId, 'perseverance', { streakWrong: r.streakWrong })
          if (a) turnXp.push(a)
        } catch { /* non-critical */ }
      }

      // Wheel-spinning: research says ~10 failed opportunities almost never
      // self-resolve — and it's predictable by 3-5. Change the intervention.
      const wheelBlock = r.streakWrong >= 4
        ? `\n- WHEEL-SPINNING: ${r.streakWrong} confused turns. More of the same teaching will NOT work. Switch intervention entirely: a fully worked example start-to-finish, OR a different representation (visual/concrete/numeric), OR the prerequisite route above. Say openly that you're changing approach.`
        : ''

      if (r.projectProgress) {
        // Flag real execution progress on this node — shown in the list
        // view and node panel as the project's build log.
        void (async () => {
          try {
            const row = await prisma.treeNode.findUnique({ where: { id: nodeId }, select: { progressLog: true } })
            const log = safeParse<Array<{ text: string; source: string; createdAt: string }>>(row?.progressLog, [])
            log.push({ text: r.projectProgress!.slice(0, 300), source: 'chat', createdAt: new Date().toISOString() })
            await prisma.treeNode.update({ where: { id: nodeId }, data: { progressLog: JSON.stringify(log.slice(-30)) } })
          } catch { /* non-critical */ }
        })()
      }
      // Discovery cards are gated for timing (simulation findings):
      // never two turns in a row (card fatigue at peak cognitive load), no
      // add-cards while the student is confused (competing CTAs mid-struggle),
      // and no move-cards while this node's mastery tally is in progress
      // (don't invite abandoning a nearly-done node).
      const suggestedLastTurn = !!prior?.suggestNode || !!prior?.moveToTitle
      if (r.suggestNode?.title && !suggestedLastTurn && r.streakWrong < 2) {
        suggestion = { type: 'add', title: r.suggestNode.title.slice(0, 120), summary: (r.suggestNode.summary ?? '').slice(0, 300) }
      } else if (r.moveToTitle && !suggestedLastTurn) {
        const qs = parseQuizState(node.quizState)
        const midTally = node.status !== 'understood' && qs.correct > 0
        if (!midTally) {
          const target = tree.nodes.find(n => !n.pending && n.id !== nodeId && n.title.toLowerCase() === r.moveToTitle!.toLowerCase())
            ?? tree.nodes.find(n => !n.pending && n.id !== nodeId && n.title.toLowerCase().includes(r.moveToTitle!.toLowerCase()))
          if (target) suggestion = { type: 'move', nodeId: target.id, title: target.title }
        }
      }
      reflectionBlock = `

## CONTEXTUAL READ (your silent pre-pass — act on it, never mention it)
- Where the student is: ${r.state}
- Gap depth: ${r.gapDepth} · consecutive confused turns: ${r.streakWrong}
- Your next move: ${r.directive}
${r.streakWrong >= 2 ? '- SUPPORT FIRST: two or more confused turns in a row — open with genuine, specific reassurance, then teach from a COMPLETELY different angle. No checkpoint question this turn. Struggling IS the learning here.' : ''}
${r.gapDepth === 'none' && r.streakWrong === 0 ? '- The student is tracking well — a Socratic probe ("why do you think that works?") beats another explanation.' : ''}${analogyBlock}${prereqBlock}${misconceptionBlock}${wheelBlock}`
      void prisma.conversation.update({
        where: { id: conv!.id },
        data: { summary: JSON.stringify({ lastReflection: r }) },
      }).catch(() => null)
    }
  }

  // The student's uploaded evidence for this node — Bob reads actual file
  // content (text files excerpted; images/binaries listed by name).
  let filesBlock = ''
  try {
    const nodeFiles = await prisma.linkedFile.findMany({
      where: { userId, workType: 'tree-node', workId: nodeId },
      select: { name: true, mimeType: true, content: true },
      orderBy: { addedAt: 'desc' },
      take: 5,
    })
    if (nodeFiles.length > 0) {
      filesBlock = `\n## THE STUDENT'S FILES ON THIS NODE (their real work — read and reference it)\n` + nodeFiles.map(f => {
        const isText = !(f.content ?? '').startsWith('data:')
        return isText
          ? `### ${f.name}\n${(f.content ?? '').slice(0, 2000)}${(f.content ?? '').length > 2000 ? '\n…(truncated)' : ''}`
          : `### ${f.name} (binary/image — content not inlined)`
      }).join('\n\n')
    }
  } catch { /* non-critical */ }

  // Evidence locker: real artifacts uploaded anywhere on the tree (this
  // node's files are already shown in full above) — Bob grounds numbers in
  // these instead of inventing plausible examples.
  const lockerBlock = await evidenceLocker(userId, tree.nodes, nodeId)

  const path = nodePath(tree.nodes, nodeId)
  const quizStateNow = parseQuizState(node.quizState)

  // ── Delayed retest (memory needs the gap) ──
  // When the student RETURNS to this node after hours away and a checkpoint
  // was missed last time, Bob re-probes that exact gap from a new angle —
  // a re-ask five minutes later only tests short-term memory.
  const RETEST_GAP_MS = 3 * 60 * 60 * 1000
  let retestTarget: string | null = null
  if (!isTrigger && quizStateNow.missed.length > 0) {
    // conv.messages was fetched BEFORE this turn's user message was
    // persisted, so the last entry is genuinely the previous visit's tail.
    const msgs = conv!.messages ?? []
    const lastMsgAt = msgs.length > 0 ? new Date(msgs[msgs.length - 1].createdAt).getTime() : 0
    const returning = lastMsgAt > 0 && Date.now() - lastMsgAt >= RETEST_GAP_MS
    if (returning) {
      const due = quizStateNow.missed.find(m => Date.now() - new Date(m.missedAt).getTime() >= RETEST_GAP_MS)
      if (due) retestTarget = due.question
    }
  }

  const systemPrompt = `You are Bob, the student's expert mentor inside the Tree EDU problem-mastery tree.

## THE TREE (the student's whole learning world right now)
PROBLEM (root): "${tree.title}"
${tree.framing ? `FRAMING: ${tree.framing}` : ''}
FULL TREE:
${sketchTree(tree.nodes)}

## WHERE YOU ARE
The student is working on the node: "${node.title}" — ${node.summary}
Path from root: ${path.map(n => `"${n.title}"`).join(' → ')}
${node.explainer ? `\nThe node's explainer (already shown to the student):\n${node.explainer.slice(0, 2500)}` : ''}
${filesBlock}
${lockerBlock}

## HOW TO TEACH HERE
- Everything you say serves ONE goal: this student genuinely understanding THIS node in service of the root problem.
- Dense, precise, zero praise-padding. Concrete examples over abstractions.
- **Be Socratic where it earns its place**: when the student is tracking well, probe ("why would that break if…?") instead of explaining more. When they're lost, teach directly — Socratic questioning of a confused student is theatre, not teaching.
- Connect answers back to the root problem and this node's branch whenever natural.
- Nodes marked PENDING in the tree are unapproved proposals — they do NOT exist for the student. Never cite them as siblings they've learned from, completed context, or promised destinations. If one genuinely holds the answer, say it's waiting as a proposal on their tree for them to approve or dismiss.
- Stay CONSISTENT with the node's explainer shown above. If you must simplify or correct it, say so explicitly ("the explainer simplifies here — the fuller picture is…") — never silently contradict it; the student reads both.
- You do not know facts about the student's real project (stack, files, configs) unless they told you or their uploaded files show it — never assert such facts; ask or hedge.

${ANSWER_STANDARD}

## FORMAT EVERY TEACHING RESPONSE FOR READING (like a well-set textbook page)
- Open substantial responses with a short bold or \`##\` title naming what this turn covers; use \`###\` subtitles to break distinct sections.
- Body text in full sentences and short paragraphs; **bold** the key terms where they're defined.
- Use numbered/bulleted lists for sequences and enumerations; > blockquotes for the one takeaway worth remembering; KaTeX ($...$) for any math.
- Short conversational replies (a quick answer, a Socratic probe) need no headers — never decorate a one-liner.
- If their question opens genuinely NEW ground that this node cannot teach (a distinct concept deserving its own branch), answer briefly, then tell them: press the "Grow branch" button with that question so the tree can propose new nodes — the tree only grows with their permission. Do not pretend to add nodes yourself.

## CHECKPOINT QUESTIONS (mastery is proven HERE in chat — there is no separate test)
${node.status === 'understood'
  ? '- This node is already VERIFIED. Checkpoints are optional deepening now (exception: on a RETENTION REVIEW turn you MUST ask one) — focus on connections onward to the root problem.'
  : `- Mastery state: ${quizStateNow.correct}/${MASTERY_TARGET} checkpoint answers correct so far${quizStateNow.shortCorrect < MASTERY_MIN_SHORT ? ' — the own-words short-answer requirement is NOT yet met' : ' — own-words requirement met'}. At ${MASTERY_TARGET} correct (incl. ${MASTERY_MIN_SHORT} short answer) the node verifies automatically and the student is told in the feedback.`}
- VERIFICATION INTEGRITY (trust-critical): you NEVER declare this node verified — only the checkpoint system announces verification, in the feedback after a passing answer. Until the mastery state above says otherwise, the node is NOT verified, no matter how well the conversation is going. The three pips in the workspace header always display this node's correct-checkpoint tally (e.g. 2/3) — if the student asks about them, say exactly that; never invent UI meanings.
- To check understanding — after teaching a chunk, when the student sounds ready, or when they ask to be quizzed — end your message with EXACTLY ONE checkpoint block as the very last line:
[[QUIZ]]{"kind":"mcq","question":"...","options":["...","...","...","..."],"correctIndex":0,"explanation":"1-2 sentences: the science of why the right answer is right and why the tempting distractor fails"}
or
[[QUIZ]]{"kind":"short","question":"...","rubric":"what a truly-understanding answer must contain (never shown to the student)"}
- Every checkpoint obeys the Differentiator Principle: transfer to an UNSEEN context, a why/what-if, or an edge case where the memorized rule breaks — never answerable by reciting the explainer. MCQ distractors are the tempting misconceptions, not filler.
- SCOPE — test ONLY what THIS node ("${node.title}") teaches, using its explainer and this conversation as the whole-node content. Use the FULL TREE above to see the BOUNDARIES: concepts owned by OTHER nodes (siblings, children, other branches) are out of scope, and a correct answer here must NEVER require the student to explain another node's mechanism. Example of the trap to avoid: if this node is about the genetic/variety ceiling, do NOT make passing depend on naming a soil/watering/sunlight mechanism — that is a different node's material; ask instead about THIS node's own claim (e.g. why care alone can't beat the variety's ceiling). Cover the WHOLE of this node's material, and stay strictly inside it.
- "short" (own-words) carries the mastery weight — use it for the WHY/transfer probes${node.status !== 'understood' && quizStateNow.shortCorrect < MASTERY_MIN_SHORT ? ' (the student still needs one)' : ''}; "mcq" for quick discrimination checks. Vary the formats.
- At most one checkpoint per message. Never in your opening hook. Skip it on turns where the contextual read says SUPPORT FIRST — and NEVER staple a checkpoint to a turn where the student just expressed confusion or you are clarifying a misunderstanding they voiced. Quizzing a lost student converts live confusion into a recorded failure; teach first, checkpoint only once they've re-explained or responded confidently (saying "no quiz yet — tell me back in your own words first" is itself good teaching).
- The chat UI renders the block as an interactive card — introduce it naturally in prose ("Quick check:"), but do NOT repeat the question or options in your prose, and NEVER mention the JSON or the marker.
- Question, options, explanation and rubric all follow the session's language.
- There is NO "Verify understanding" button — never mention one. When the node verifies, congratulate briefly and point to the next unverified node in service of the root problem.
${quizStateNow.sureWrong >= 2 && quizStateNow.sureWrong > quizStateNow.sureRight ? `- CONFIDENCE CALIBRATION: the student has been confidently wrong ${quizStateNow.sureWrong} times on this node (vs ${quizStateNow.sureRight} confidently right) — a real blind-spot pattern, not a slip. Aim checkpoints at exactly the claims they were sure-but-wrong about, and weight a confident tone in their answers as weak evidence until their calibration recovers.` : ''}
${retestTarget ? `- DELAYED RETEST DUE: on their last visit the student MISSED this checkpoint: "${retestTarget.slice(0, 300)}". After addressing their current message, re-probe that exact gap THIS TURN with a checkpoint block asking it from a NEW angle (different scenario and wording — never reuse the old question), and include "retest": true inside that checkpoint's JSON so the system links it to the missed one (omit the flag on any unrelated checkpoint). If the contextual read says SUPPORT FIRST, teach now and retest on the next calm turn instead.` : ''}

## VISUAL EXPLANATIONS (a diagram where words strain)
- Use a visual when the student explicitly asks for one, OR when the concept is inherently visual — structure, spatial layout, flow/sequence, timelines/waterfalls, comparisons, geometry — and prose alone is straining. Place EXACTLY this block at the point in your explanation where the diagram belongs:
\`\`\`image
one-sentence description of the diagram to draw — name every part and label explicitly, textbook-diagram style
\`\`\`
- The UI turns the block into a generated diagram in place. Never mention the block or that an image is being generated — just continue teaching around it.
- Labels inside the diagram follow the session's language. At most ONE per message. The Answer Standard applies to visuals too: a diagram must carry mechanism, never decoration.
${sessionDirectives(tree, lang)}
${isIntro ? `
## THIS TURN: THE NODE SYLLABUS (the student just arrived; they have NOT spoken)
Open the workspace yourself with a proper SYLLABUS that frames this whole node — a well-structured chapter-syllabus, NOT a one-liner. It must be SPECIFIC to "${node.title}" (name the real mechanisms, choices, quantities, terms this node actually involves — never generic placeholders), comprehensive over the node's scope, and calibrated in depth/examples to the session's level, background, and PURPOSE. Use EXACTLY this markdown structure (\`##\`/\`###\` headers, short paragraphs, tight bullets):

## <name the concept as a title>
**The big idea** — 2-3 sentences: what this node is really about and the single most important thing it establishes.
**Why it matters here** — 1-2 sentences connecting it along the branch path (${path.map(n => `"${n.title}"`).join(' → ')}) and stating how mastering it moves the student toward the ROOT problem ("${tree.title}") and their stated purpose.

### What you'll cover
A roadmap of the 3-5 specific sub-points this node contains — each a **bolded term** + one concrete sentence. If this node already has child nodes in the tree above, use those as the sub-points; otherwise lay out the facets an expert would break this into. This is the node's table of contents — make it genuinely cover the node's scope.

### You'll be able to
3-4 concrete, checkable objectives ("<action verb> <specific skill>") — what the student will be able to DO, phrased for THIS problem, not vague ("understand X").

### The trap to avoid
The single most common misconception or failure mode on this concept, in 1-2 sentences — the mistake this node exists to prevent.

Close with ONE line noting the full explainer is a click away (the "Generate the explainer" button) and that mastery is proven by answering the checkpoint questions right here in chat — then ONE engaging question that pulls them straight into the first sub-point (conversational prose; do NOT emit a [[QUIZ]] block in this opener).
Dense and specific throughout — every line about THIS node, zero platform/welcome filler.` : ''}${isReview ? `
## THIS TURN: RETENTION REVIEW (the student clicked Review on this verified node — they have not spoken)
Memory fades; this visit exists to interrupt that.
1. In 2-4 sentences, reactivate the core idea as a recall cue — what it is and why it mattered to the ROOT problem ("${tree.title}"). No full re-lecture.
2. END with exactly ONE [[QUIZ]] checkpoint (prefer "short") that probes the concept from an angle NOT used earlier in this conversation. Reviews pay full XP — make it a genuine transfer question.` : ''}${isCheckpoint ? `
## THIS TURN: NEXT CHECKPOINT (keep going until the node verifies)
The student just answered a checkpoint and this node is NOT yet verified (${quizStateNow.correct}/${MASTERY_TARGET} correct${quizStateNow.shortCorrect < MASTERY_MIN_SHORT ? `, and still needs ${MASTERY_MIN_SHORT} own-words short answer` : ''}). Keep the momentum:
1. Glance at their last answer in the conversation. If it was wrong or shaky, give ONE tight sentence of clarification (no lecture); if it was correct, a 3-6 word "Good — next:" bridge is enough.
2. Then END with exactly ONE NEW [[QUIZ]] checkpoint — different from every question already asked, scoped strictly to THIS node${quizStateNow.shortCorrect < MASTERY_MIN_SHORT ? ', and make it a "short" own-words probe (the node still needs one to verify)' : ' (vary MCQ / short)'}.
Output nothing after the checkpoint block.` : ''}${reflectionBlock}`

  const history = (conv!.messages ?? [])
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .slice(-20)
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))

  const encoder = new TextEncoder()
  const convId = conv!.id
  const QUIZ_MARK = '[[QUIZ]]'
  const stream = new ReadableStream({
    async start(controller) {
      let full = ''
      // Bob always speaks with the newest teaching model (resolver: latest
      // Opus release, pinned fallback) — upgrades land without a deploy.
      const model = await getTeachingModel()
      // Answer-key protection: the [[QUIZ]] JSON must never stream to the
      // client (it carries correctIndex/rubric). We forward text with a
      // holdback the length of the marker, so no byte at or past a possible
      // marker start ever leaves before we know whether it IS the marker.
      let sentLen = 0
      const forwardSafe = () => {
        const qIdx = full.indexOf(QUIZ_MARK)
        const safeLen = qIdx !== -1 ? qIdx : Math.max(sentLen, full.length - QUIZ_MARK.length)
        if (safeLen > sentLen) {
          try { controller.enqueue(encoder.encode(full.slice(sentLen, safeLen))) } catch { /* closed */ }
          sentLen = safeLen
        }
      }
      try {
        const Anthropic = (await import('@anthropic-ai/sdk')).default
        const client = new Anthropic({ apiKey })
        const response = client.messages.stream({
          model,
          max_tokens: 2000,
          system: systemPrompt,
          messages: [...history, { role: 'user' as const, content: message.trim() }],
        })
        for await (const event of response) {
          if (event.type === 'content_block_delta' && 'text' in event.delta) {
            full += event.delta.text
            forwardSafe()
          }
        }
        // Cost telemetry for the streamed turn.
        try {
          const final = await response.finalMessage()
          const { recordAnthropicUsage } = await import('@/lib/usage')
          recordAnthropicUsage(final.usage, { userId, model, feature: 'node-chat' })
        } catch { /* non-critical */ }
      } catch (err) {
        console.error('[tree] node chat failed:', err)
        // The stream returns HTTP 200, so the client's localized catch never
        // fires — this fallback IS what the student reads, so it must obey the
        // session language (no English leaking into a 中文 session).
        if (!full) {
          const zhSession = (tree.language ?? lang) === 'zh'
          controller.enqueue(encoder.encode(zhSession
            ? '现在连接有些问题，请稍后再试。'
            : "I'm having trouble connecting right now. Please try again in a moment."))
        }
      }

      // ── Checkpoint capture ──
      // The full quiz (with answer key) is stored server-side on the node;
      // the client — stream AND persisted message — gets only a sanitized
      // {kind, question, options} marker to render the card from.
      let persistContent = full
      let quizShipped = false
      const qIdx = full.indexOf(QUIZ_MARK)
      if (qIdx !== -1) {
        const prose = full.slice(0, qIdx).trimEnd()
        if (qIdx > sentLen) {
          try { controller.enqueue(encoder.encode(full.slice(sentLen, qIdx))) } catch { /* closed */ }
          sentLen = qIdx
        }
        persistContent = prose
        try {
          const parsed = JSON.parse(full.slice(qIdx + QUIZ_MARK.length).trim()) as PendingQuiz
          const validMcq = parsed.kind === 'mcq'
            && Array.isArray(parsed.options) && parsed.options.length >= 2
            && Number.isInteger(parsed.correctIndex)
            && (parsed.correctIndex as number) >= 0 && (parsed.correctIndex as number) < parsed.options.length
          const validShort = parsed.kind === 'short'
          if (typeof parsed.question === 'string' && parsed.question.trim() && (validMcq || validShort)) {
            // ── DIFFERENTIATOR LINT ──
            // A checkpoint answerable by copying from Bob's own text tests
            // recall, not understanding — auto-reject it (the Differentiator
            // Principle enforced mechanically). Strict-only and fail-open:
            // lint errors never block a checkpoint.
            let recitable = false
            try {
              const Anthropic = (await import('@anthropic-ai/sdk')).default
              const { pickBackgroundModel } = await import('@/lib/chat-model-router')
              const lintClient = new Anthropic({ apiKey })
              const prevBob = [...(conv!.messages ?? [])].reverse().find(m => m.role === 'assistant')?.content ?? ''
              const lint = await lintClient.messages.create({
                model: pickBackgroundModel(),
                max_tokens: 60,
                messages: [{
                  role: 'user',
                  content: `Quality lint for a tutoring checkpoint (the Differentiator Principle: it must separate understanding from recall).

TUTOR'S CURRENT MESSAGE (the checkpoint follows it):
"${prose.slice(-1200)}"
TUTOR'S PREVIOUS MESSAGE:
"${prevBob.slice(0, 800)}"

CHECKPOINT QUESTION: "${parsed.question.slice(0, 400)}"
${validMcq ? `OPTIONS: ${(parsed.options as string[]).map(o => String(o)).join(' | ').slice(0, 400)}` : ''}

Could a student answer this correctly PURELY by copying or recalling sentences from the two tutor messages above, without understanding (the answer is stated or strongly implied verbatim in the text)? Be strict only when it is clearly recitable — transfer questions that merely share vocabulary are fine.
Return ONLY JSON: {"recitable": true|false}`,
                }],
              })
              try {
                const { recordAnthropicUsage } = await import('@/lib/usage')
                recordAnthropicUsage(lint.usage, { userId, model: pickBackgroundModel(), feature: 'tree-verify' })
              } catch { /* non-critical */ }
              recitable = /"recitable"\s*:\s*true/.test((lint.content[0] as { text?: string })?.text ?? '')
            } catch { /* lint unavailable — fail open, keep the checkpoint */ }

            if (!recitable) {
              // retestOf links this card to the missed checkpoint ONLY when
              // Bob marked it as the retest — an unrelated checkpoint on a
              // retest turn must not clear the queue (if he forgets the
              // flag, the entry just stays queued: the safe direction).
              const pendingCard = {
                ...parsed,
                review: isReview || undefined,
                retestOf: parsed.retest && retestTarget ? retestTarget : undefined,
                askedAt: new Date().toISOString(),
              }
              // Compare-and-set on the quizState string (fresh read each try):
              // the request-start copy is seconds stale by stream end, and a
              // blind write could erase a tally the student just earned from
              // another device — or be erased by it.
              for (let attempt = 0; attempt < 2; attempt++) {
                const freshRow = await prisma.treeNode.findUnique({ where: { id: nodeId }, select: { quizState: true } }).catch(() => null)
                const base = freshRow ? freshRow.quizState : node.quizState
                const qs = parseQuizState(base)
                qs.pending = pendingCard
                const w = await prisma.treeNode.updateMany({
                  where: { id: nodeId, quizState: base },
                  data: { quizState: JSON.stringify(qs) },
                }).catch(() => null)
                if (w && w.count > 0) break
              }
              const sanitized = JSON.stringify({ kind: parsed.kind, question: parsed.question, ...(validMcq ? { options: parsed.options } : {}) })
              try { controller.enqueue(encoder.encode(`\n\n${QUIZ_MARK}${sanitized}`)) } catch { /* closed */ }
              persistContent = `${prose}\n\n${QUIZ_MARK}${sanitized}`
              quizShipped = true
            }
            // Linted-out checkpoints are silently dropped (prose stays; a
            // dangling "Quick check:" lead-in is rare and self-corrects).
          }
        } catch { /* malformed quiz JSON — drop the marker, keep the prose */ }
      } else {
        forwardSafe()
        if (full.length > sentLen) {
          // Flush the final holdback window.
          try { controller.enqueue(encoder.encode(full.slice(sentLen))) } catch { /* closed */ }
          sentLen = full.length
        }
      }

      // ── ATTENTION ARBITER: at most ONE interactive card per turn ──
      // Priority: checkpoint card > discovery/move card. XP toasts are
      // ambient (not CTAs) and exempt. A yielded discovery card resurfaces
      // on a later turn via the reflection pass if it still matters.
      if (suggestion && !quizShipped) {
        try { controller.enqueue(encoder.encode(`\n\n[[TREE_SUGGEST]]${JSON.stringify(suggestion)}`)) } catch { /* closed */ }
      }
      // XP earned during this turn (perseverance) — trailing marker, the
      // client toasts it; never persisted as message content.
      if (turnXp.length > 0) {
        try { controller.enqueue(encoder.encode(`\n\n[[XP]]${JSON.stringify(turnXp)}`)) } catch { /* closed */ }
      }

      if (persistContent) {
        await store.addMessage(convId, 'assistant', persistContent).catch(() => null)
        // Keep the insight moat: background extraction every ~5th message.
        // Skip trigger turns ([NODE_INTRO]/[NODE_REVIEW]) — the control token
        // is not a student utterance, and feeding it as the "student message"
        // alongside Bob's topic-rich reply is exactly the tutor→student
        // mis-attribution shape the anti-hallucination rule guards against.
        try {
          const count = await prisma.message.count({ where: { conversationId: convId } })
          if (!isTrigger && count % 5 === 0) {
            const { extractInsightsBackground } = await import('@/lib/insight-extraction')
            const { inBackground } = await import('@/lib/background')
            // waitUntil-wrapped: the stream closes right after this, and a
            // frozen lambda would silently starve the insight moat.
            inBackground(extractInsightsBackground(apiKey, message.trim(), persistContent, userId))
          }
        } catch { /* non-critical */ }
      }
      try { controller.close() } catch { /* already closed */ }
    },
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Conversation-Id': convId },
  })
}
