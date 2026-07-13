export const dynamic = 'force-dynamic'
// Attachment analysis (Gemini on video/audio) + a teaching-model turn can be
// slow — without this Vercel kills the function at the plan default.
export const maxDuration = 120

/**
 * The TREE COPILOT — one chatbox on the tree page combining every tree-level
 * function: converse/teach about the whole problem, propose branches under
 * any node (pending ghosts — permission-based), refine the session purpose
 * (approval-gated), all grounded in multimodal attachments (images, voice
 * recordings, video, files → analyzed by Gemini before the turn).
 *
 * GET  — rehydrate the persisted copilot thread (context "tree-copilot:<id>")
 * POST — one turn: { message, lang?, replaceIds?, attachments?: [{name,type,content}] }
 *        content is a data: URI for media or plain text for text files.
 */
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getUserId } from '@/lib/get-user-id'
import { dbStore } from '@/lib/db-store'
import { copilotTurn, type GrowTurn } from '@/lib/tree-engine'

const CONTEXT = (treeId: string) => `tree-copilot:${treeId}`

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const userId = await getUserId()
  const conv = await prisma.conversation.findFirst({
    where: { userId, context: CONTEXT(id) },
    orderBy: { createdAt: 'asc' },
    include: { messages: { orderBy: { createdAt: 'desc' }, take: 60 } },
  })
  return NextResponse.json({
    messages: (conv?.messages ?? []).reverse().map(m => ({ id: m.id, role: m.role, content: m.content })),
  })
}

interface AttachmentIn { name?: string; type?: string; content?: string }

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const userId = await getUserId()
  const body = (await req.json().catch(() => ({}))) as {
    message?: string; lang?: string; replaceIds?: string[]; attachments?: AttachmentIn[]
  }
  const message = (body.message ?? '').trim()
  if (!message && !(body.attachments?.length)) {
    return NextResponse.json({ error: 'message or attachment required' }, { status: 400 })
  }

  // Ownership check up front (copilotTurn re-checks, but attachments are
  // analyzed before the turn — never burn Gemini calls for a foreign tree).
  const tree = await prisma.problemTree.findFirst({ where: { id, userId }, select: { id: true, title: true, purpose: true } })
  if (!tree) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // ── Analyze attachments (image / audio / video / pdf / text) ──
  const analyses: Array<{ name: string; analysis: string }> = []
  const atts = (body.attachments ?? []).slice(0, 3)
  for (const a of atts) {
    const name = (a.name ?? 'attachment').slice(0, 120)
    const content = a.content ?? ''
    if (!content) continue
    try {
      if (content.startsWith('data:')) {
        // Request bodies are capped (~4.5MB on Vercel) so this is bounded,
        // but clamp defensively anyway.
        const [head, b64] = content.split(',', 2)
        const mime = /data:([^;]+)/.exec(head)?.[1] ?? (a.type || 'image/jpeg')
        if (!b64) continue
        const { analyzeImage } = await import('@/lib/gemini')
        const analysis = await analyzeImage(b64, `The student's problem-mastery tree "${tree.title}"${tree.purpose ? ` (purpose: ${tree.purpose})` : ''}. They shared this in the tree copilot chat.`, mime)
        analyses.push({ name, analysis })
        // Keep it as tree-level evidence: small images verbatim (renderable
        // later), heavy media as their analysis text.
        const storable = mime.startsWith('image/') && content.length <= 1_000_000
          ? content
          : `[${mime} — analyzed]\n${analysis.slice(0, 8000)}`
        await prisma.linkedFile.create({
          data: { userId, workType: 'tree', workId: id, name, mimeType: mime, content: storable.slice(0, 1_500_000) },
        }).catch(() => null)
      } else {
        const text = content.slice(0, 6000)
        analyses.push({ name, analysis: `Text file content:\n${text}` })
        await prisma.linkedFile.create({
          data: { userId, workType: 'tree', workId: id, name, mimeType: a.type || 'text/plain', content: content.slice(0, 1_500_000) },
        }).catch(() => null)
      }
    } catch { /* an unanalyzable attachment must not kill the turn */ }
  }

  // ── History from the persisted thread (server-side truth) ──
  const store = dbStore.forUser(userId)
  let conv = await prisma.conversation.findFirst({
    where: { userId, context: CONTEXT(id) },
    orderBy: { createdAt: 'asc' },
    include: { messages: { orderBy: { createdAt: 'desc' }, take: 12 } },
  })
  if (!conv) {
    const created = await store.createConversation(`Copilot — ${tree.title.slice(0, 50)}`, CONTEXT(id))
    conv = { ...created, messages: [] } as typeof conv & { messages: [] }
  }
  const history: GrowTurn[] = [...(conv!.messages ?? [])].reverse()
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))

  const userRecord = atts.length > 0
    ? `${message}${message ? '\n' : ''}[${atts.map(a => `📎 ${(a.name ?? 'attachment').slice(0, 80)}`).join(' · ')}]`
    : message

  try {
    const result = await copilotTurn(userId, id, message || '(see attachments)', body.lang, {
      history,
      attachments: analyses,
      replaceIds: Array.isArray(body.replaceIds) ? body.replaceIds : [],
    })
    // Persist both sides so the thread survives reloads and devices.
    await store.addMessage(conv!.id, 'user', userRecord).catch(() => null)
    await store.addMessage(conv!.id, 'assistant', result.reply).catch(() => null)
    return NextResponse.json(result)
  } catch (err) {
    console.error('[tree] copilot turn failed:', err)
    return NextResponse.json({ error: 'Copilot is unavailable right now.' }, { status: 502 })
  }
}
