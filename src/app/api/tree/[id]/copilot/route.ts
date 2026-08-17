export const dynamic = 'force-dynamic'
// Attachment analysis (Gemini on video/audio) + a teaching-model turn can be
// slow — without this Vercel kills the function at the plan default.
export const maxDuration = 120

/**
 * The TREE COPILOT — one conversation on the tree page combining every
 * tree-level function: converse/teach about the whole problem, propose
 * branches under any node (pending ghosts — permission-based), refine the
 * session purpose (approval-gated), and REWIRE the tree (a validated plan of
 * add/edit/move/delete/merge/reorder/split/rebalance/spinoff ops the student
 * applies with ONE tap via /api/tree/[id]/rewire — atomic, undo-snapshotted),
 * all grounded in multimodal attachments (images, voice recordings, video,
 * files → analyzed by Gemini before the turn).
 *
 * GET  — rehydrate the persisted copilot thread (context "tree-copilot:<id>")
 * POST — one turn: { message, lang?, replaceIds?, attachments?: [{name,type,content}] }
 *        content is a data: URI for media or plain text for text files.
 *        Returns { reply, proposals, purposeUpdate?, plan } — the plan is an
 *        approval card, never applied server-side here.
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
  const tree = await prisma.problemTree.findFirst({ where: { id, userId }, select: { id: true, title: true, purpose: true, language: true } })
  if (!tree) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // PER-USER DAILY BUDGET — same gate as the node chat (the two expensive
  // doors). Fail-open on telemetry errors.
  try {
    const { checkDailyBudget, budgetMessage } = await import('@/lib/ai-budget')
    const budget = await checkDailyBudget(userId)
    if (!budget.ok) {
      return NextResponse.json({ error: budgetMessage((tree.language ?? body.lang) === 'zh') }, { status: 429 })
    }
  } catch { /* fail-open */ }

  // ── Analyze attachments (image / audio / video / pdf / text) ──
  // Shared pipeline with the node workspace chat (src/lib/attachments.ts):
  // Gemini analysis in parallel + tree-level LinkedFile evidence.
  const { analyzeAndPersistAttachments, attachmentRecordLabel } = await import('@/lib/attachments')
  const atts = (Array.isArray(body.attachments) ? body.attachments : []).slice(0, 3)
  const { analyses } = await analyzeAndPersistAttachments(userId, atts, {
    context: `The student's problem-mastery tree "${tree.title}"${tree.purpose ? ` (purpose: ${tree.purpose})` : ''}. They shared this in the tree copilot chat.`,
    workType: 'tree',
    workId: id,
  })

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

  const userRecord = attachmentRecordLabel(message, atts)

  // Attachments arrived but nothing could be read/analyzed → tell Bob so,
  // instead of pointing "(see attachments)" at a phantom.
  const attachmentsForTurn = analyses.length > 0
    ? analyses
    : atts.length > 0
      ? [{
          name: atts.map(a => (a.name ?? 'attachment').slice(0, 80)).join(', '),
          analysis: 'The attachment content could not be read or analyzed this turn — say so briefly and ask the student to describe it or re-send it. Do NOT pretend to have seen it.',
        }]
      : []

  try {
    const result = await copilotTurn(userId, id, message || '(see attachments)', body.lang, {
      history,
      attachments: attachmentsForTurn,
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
