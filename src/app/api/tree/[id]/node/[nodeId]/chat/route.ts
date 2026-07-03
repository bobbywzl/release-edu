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
import { getTreeWithNodes, sketchTree, nodePath, sessionDirectives } from '@/lib/tree-engine'

const OPUS = 'claude-opus-4-8'

interface Reflection {
  state: string          // one-line read of where the student is
  gapDepth: 'none' | 'partial' | 'deep'
  streakWrong: number    // consecutive confused/incorrect turns
  directive: string      // Bob's next move
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
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: `Fast tutoring read. Concept under study: "${nodeTitle}".
Tutor's last message (context): "${lastBobMsg.slice(0, 500)}"
Student's new message: "${studentMsg.slice(0, 500)}"
Prior wrong-streak: ${prior?.streakWrong ?? 0}

Assess and return ONLY JSON:
{"state": "one-line read of where the student is right now", "gapDepth": "none|partial|deep", "streakWrong": <prior+1 if this message shows confusion/an incorrect idea, else 0>, "directive": "one sentence: the tutor's best next move (re-explain from a new angle / Socratic probe / concrete example / advance)"}`,
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
  // conversation so the wrong-streak survives across turns.
  let reflectionBlock = ''
  if (!isIntro) {
    const prior = safeParse<{ lastReflection?: Reflection }>(conv!.summary, {}).lastReflection ?? null
    const lastBob = [...(conv!.messages ?? [])].reverse().find(m => m.role === 'assistant')?.content ?? ''
    const r = await haikuReflect(apiKey, node.title, lastBob, message.trim(), prior)
    if (r) {
      reflectionBlock = `

## CONTEXTUAL READ (your silent pre-pass — act on it, never mention it)
- Where the student is: ${r.state}
- Gap depth: ${r.gapDepth} · consecutive confused turns: ${r.streakWrong}
- Your next move: ${r.directive}
${r.streakWrong >= 2 ? '- SUPPORT FIRST: two or more confused turns in a row — open with genuine, specific reassurance, then teach from a COMPLETELY different angle. No quiz this turn. Struggling IS the learning here.' : ''}
${r.gapDepth === 'none' && r.streakWrong === 0 ? '- The student is tracking well — a Socratic probe ("why do you think that works?") beats another explanation.' : ''}`
      void prisma.conversation.update({
        where: { id: conv!.id },
        data: { summary: JSON.stringify({ lastReflection: r }) },
      }).catch(() => null)
    }
  }

  const path = nodePath(tree.nodes, nodeId)
  const systemPrompt = `You are Bob, the student's expert mentor inside Release EDU's problem-mastery tree.

## THE TREE (the student's whole learning world right now)
PROBLEM (root): "${tree.title}"
${tree.framing ? `FRAMING: ${tree.framing}` : ''}
FULL TREE:
${sketchTree(tree.nodes)}

## WHERE YOU ARE
The student is working on the node: "${node.title}" — ${node.summary}
Path from root: ${path.map(n => `"${n.title}"`).join(' → ')}
${node.explainer ? `\nThe node's explainer (already shown to the student):\n${node.explainer.slice(0, 2500)}` : ''}

## HOW TO TEACH HERE
- Everything you say serves ONE goal: this student genuinely understanding THIS node in service of the root problem.
- Dense, precise, zero praise-padding. Concrete examples over abstractions.
- **Be Socratic where it earns its place**: when the student is tracking well, probe ("why would that break if…?") instead of explaining more. When they're lost, teach directly — Socratic questioning of a confused student is theatre, not teaching.
- Connect answers back to the root problem and this node's branch whenever natural.

## FORMAT EVERY TEACHING RESPONSE FOR READING (like a well-set textbook page)
- Open substantial responses with a short bold or \`##\` title naming what this turn covers; use \`###\` subtitles to break distinct sections.
- Body text in full sentences and short paragraphs; **bold** the key terms where they're defined.
- Use numbered/bulleted lists for sequences and enumerations; > blockquotes for the one takeaway worth remembering; KaTeX ($...$) for any math.
- Short conversational replies (a quick answer, a Socratic probe) need no headers — never decorate a one-liner.
- If their question opens genuinely NEW ground that this node cannot teach (a distinct concept deserving its own branch), answer briefly, then tell them: press the "Grow branch" button with that question so the tree can propose new nodes — the tree only grows with their permission. Do not pretend to add nodes yourself.
- When they seem ready, remind them they can prove mastery with the "Verify understanding" check.
${sessionDirectives(tree, lang)}
${isIntro ? `
## THIS TURN: YOUR OPENING HOOK (the student just arrived at this node)
Open the workspace yourself — the student has not spoken. Write a CONDENSED, syllabus-style hook (under ~150 words), formatted exactly like this:
1. A bold one-line header naming the concept.
2. **What this is** — 1-2 tight sentences introducing the core concept.
3. **Where it sits** — one sentence locating it in the tree: name the branch path (${path.map(n => `"${n.title}"`).join(' → ')}) and how understanding it moves the student toward answering the ROOT problem ("${tree.title}").
4. **You'll be able to** — 2-3 crisp bullet objectives (what they can do once this node is understood).
5. End with ONE engaging question that pulls them in.
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
      try {
        const Anthropic = (await import('@anthropic-ai/sdk')).default
        const client = new Anthropic({ apiKey })
        const response = client.messages.stream({
          model: OPUS,
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
          recordAnthropicUsage(final.usage, { userId, model: OPUS, feature: 'node-chat' })
        } catch { /* non-critical */ }
      } catch (err) {
        console.error('[tree] node chat failed:', err)
        if (!full) controller.enqueue(encoder.encode("I'm having trouble connecting right now. Please try again in a moment."))
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
