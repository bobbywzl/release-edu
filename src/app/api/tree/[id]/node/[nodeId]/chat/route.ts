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
import {
  getTreeWithNodes, sketchTree, nodePath, sessionDirectives, ANSWER_STANDARD,
  parseQuizState, MASTERY_TARGET, MASTERY_MIN_SHORT, type XpAwardLite,
} from '@/lib/tree-engine'
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
 "misconception": <ONLY if the student expressed a SYSTEMATIC wrong belief (stated as their model of how things work, or the same wrong idea as before — NOT a one-off slip): "the wrong belief, stated precisely" — otherwise null>}`,
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
  const conv = await prisma.conversation.findFirst({
    where: { userId, context: `tree-node:${nodeId}` },
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

  // One conversation per node, found by context tag.
  const contextTag = `tree-node:${nodeId}`
  let conv = await prisma.conversation.findFirst({
    where: { userId, context: contextTag },
    include: { messages: { orderBy: { createdAt: 'asc' }, take: 40 } },
  })
  if (!conv) {
    const created = await store.createConversation(node.title.slice(0, 60), contextTag)
    conv = { ...created, messages: [] } as typeof conv & { messages: [] }
  }

  // [NODE_INTRO] is the client's first-open trigger, not a student message —
  // Bob opens the workspace with a condensed syllabus-style hook. Nothing is
  // persisted for the trigger itself; only Bob's opener is saved.
  const isIntro = message.trim() === '[NODE_INTRO]'
  if (!isIntro) await store.addMessage(conv!.id, 'user', message.trim())

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
  if (!isIntro) {
    const prior = safeParse<{ lastReflection?: Reflection }>(conv!.summary, {}).lastReflection ?? null
    const lastBob = [...(conv!.messages ?? [])].reverse().find(m => m.role === 'assistant')?.content ?? ''
    const recentUserMsgs = (conv!.messages ?? []).filter(m => m.role === 'user').map(m => m.content)
    const r = await haikuReflect(apiKey, node.title, nodeId, sketchTree(tree.nodes), recentUserMsgs, lastBob, message.trim(), prior)
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
        try {
          const { extractInsightsBackground: _ } = await import('@/lib/insight-extraction')
          const { clampText } = await import('@/lib/clamp')
          void prisma.insight.create({
            data: {
              userId, type: 'misconception',
              content: `${clampText(r.misconception, 250)} (at "${node.title}")`,
              confidence: 0.7, importance: 0.6, source: 'reflection',
            },
          }).catch(() => null)
        } catch { /* non-critical */ }
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

  const path = nodePath(tree.nodes, nodeId)
  const quizStateNow = parseQuizState(node.quizState)
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
  ? '- This node is already VERIFIED. Checkpoints are optional deepening now — focus on connections onward to the root problem.'
  : `- Mastery state: ${quizStateNow.correct}/${MASTERY_TARGET} checkpoint answers correct so far${quizStateNow.shortCorrect < MASTERY_MIN_SHORT ? ' — the own-words short-answer requirement is NOT yet met' : ' — own-words requirement met'}. At ${MASTERY_TARGET} correct (incl. ${MASTERY_MIN_SHORT} short answer) the node verifies automatically and the student is told in the feedback.`}
- VERIFICATION INTEGRITY (trust-critical): you NEVER declare this node verified — only the checkpoint system announces verification, in the feedback after a passing answer. Until the mastery state above says otherwise, the node is NOT verified, no matter how well the conversation is going. The three pips in the workspace header always display this node's correct-checkpoint tally (e.g. 2/3) — if the student asks about them, say exactly that; never invent UI meanings.
- To check understanding — after teaching a chunk, when the student sounds ready, or when they ask to be quizzed — end your message with EXACTLY ONE checkpoint block as the very last line:
[[QUIZ]]{"kind":"mcq","question":"...","options":["...","...","...","..."],"correctIndex":0,"explanation":"1-2 sentences: the science of why the right answer is right and why the tempting distractor fails"}
or
[[QUIZ]]{"kind":"short","question":"...","rubric":"what a truly-understanding answer must contain (never shown to the student)"}
- Every checkpoint obeys the Differentiator Principle: transfer to an UNSEEN context, a why/what-if, or an edge case where the memorized rule breaks — never answerable by reciting the explainer. MCQ distractors are the tempting misconceptions, not filler.
- "short" (own-words) carries the mastery weight — use it for the WHY/transfer probes${node.status !== 'understood' && quizStateNow.shortCorrect < MASTERY_MIN_SHORT ? ' (the student still needs one)' : ''}; "mcq" for quick discrimination checks. Vary the formats.
- At most one checkpoint per message. Never in your opening hook. Skip it on turns where the contextual read says SUPPORT FIRST — and NEVER staple a checkpoint to a turn where the student just expressed confusion or you are clarifying a misunderstanding they voiced. Quizzing a lost student converts live confusion into a recorded failure; teach first, checkpoint only once they've re-explained or responded confidently (saying "no quiz yet — tell me back in your own words first" is itself good teaching).
- The chat UI renders the block as an interactive card — introduce it naturally in prose ("Quick check:"), but do NOT repeat the question or options in your prose, and NEVER mention the JSON or the marker.
- Question, options, explanation and rubric all follow the session's language.
- There is NO "Verify understanding" button — never mention one. When the node verifies, congratulate briefly and point to the next unverified node in service of the root problem.

## VISUAL EXPLANATIONS (a diagram where words strain)
- Use a visual when the student explicitly asks for one, OR when the concept is inherently visual — structure, spatial layout, flow/sequence, timelines/waterfalls, comparisons, geometry — and prose alone is straining. Place EXACTLY this block at the point in your explanation where the diagram belongs:
\`\`\`image
one-sentence description of the diagram to draw — name every part and label explicitly, textbook-diagram style
\`\`\`
- The UI turns the block into a generated diagram in place. Never mention the block or that an image is being generated — just continue teaching around it.
- Labels inside the diagram follow the session's language. At most ONE per message. The Answer Standard applies to visuals too: a diagram must carry mechanism, never decoration.
${sessionDirectives(tree, lang)}
${isIntro ? `
## THIS TURN: YOUR OPENING HOOK (the student just arrived at this node)
Open the workspace yourself — the student has not spoken. Write a CONDENSED, syllabus-style hook (under ~150 words), formatted exactly like this:
1. A bold one-line header naming the concept.
2. **What this is** — 1-2 tight sentences introducing the core concept.
3. **Where it sits** — one sentence locating it in the tree: name the branch path (${path.map(n => `"${n.title}"`).join(' → ')}) and how understanding it moves the student toward answering the ROOT problem ("${tree.title}").
4. **You'll be able to** — 2-3 crisp bullet objectives (what they can do once this node is understood).
5. End with ONE engaging question that pulls them in (a conversational question in prose — do NOT emit a [[QUIZ]] block in this opening hook).
No filler, no welcome-to-the-platform talk — straight into the concept.` : ''}${reflectionBlock}`

  const history = (conv!.messages ?? [])
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .slice(-20)
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))

  const encoder = new TextEncoder()
  const convId = conv!.id
  const stream = new ReadableStream({
    async start(controller) {
      let full = ''
      // Bob always speaks with the newest teaching model (resolver: latest
      // Opus release, pinned fallback) — upgrades land without a deploy.
      const model = await getTeachingModel()
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
            controller.enqueue(encoder.encode(event.delta.text))
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
        if (!full) controller.enqueue(encoder.encode("I'm having trouble connecting right now. Please try again in a moment."))
      }

      // Discovery card — sent to the client as a trailing machine marker,
      // never persisted as message content. One CTA per turn: if Bob asked a
      // checkpoint this turn, the card yields (it can resurface next turn).
      if (suggestion && !full.includes('[[QUIZ]]')) {
        try { controller.enqueue(encoder.encode(`\n\n[[TREE_SUGGEST]]${JSON.stringify(suggestion)}`)) } catch { /* closed */ }
      }
      // XP earned during this turn (perseverance) — trailing marker, the
      // client toasts it; never persisted as message content.
      if (turnXp.length > 0) {
        try { controller.enqueue(encoder.encode(`\n\n[[XP]]${JSON.stringify(turnXp)}`)) } catch { /* closed */ }
      }

      if (full) {
        await store.addMessage(convId, 'assistant', full).catch(() => null)
        // Keep the insight moat: background extraction every ~5th message.
        try {
          const count = await prisma.message.count({ where: { conversationId: convId } })
          if (count % 5 === 0) {
            const { extractInsightsBackground } = await import('@/lib/insight-extraction')
            void extractInsightsBackground(apiKey, message.trim(), full, userId)
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
