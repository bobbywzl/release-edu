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
import { getTreeWithNodes, sketchTree, nodePath } from '@/lib/tree-engine'

const OPUS = 'claude-opus-4-8'

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
  await store.addMessage(conv!.id, 'user', message.trim())

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
- Dense, precise, zero praise-padding. Concrete examples over abstractions. Socratic probes occasionally, not as theatre.
- Connect answers back to the root problem and this node's branch whenever natural.
- If their question opens genuinely NEW ground that this node cannot teach (a distinct concept deserving its own branch), answer briefly, then tell them: press the "Grow branch" button with that question so the tree can propose new nodes — the tree only grows with their permission. Do not pretend to add nodes yourself.
- When they seem ready, remind them they can prove mastery with the "Verify understanding" check.
- ${lang === 'zh' ? 'Respond entirely in Simplified Chinese (简体中文).' : 'Respond in English.'}`

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
