/**
 * TREE CONTEXT — the copilot's index of, and on-demand access to, EVERYTHING
 * stored for one tree.
 *
 * Two halves, mirroring how the copilot is told to work:
 *
 * 1. buildContextCatalog() — a token-LIGHT inventory (one line per node,
 *    counts and names only, no content) that rides along on EVERY copilot
 *    turn. It tells the model what exists and where: workspace chats, student
 *    notes, attached files (with Gemini analyses), chat highlights, explainer
 *    annotations, project-progress logs, syllabus/verification state, stored
 *    explainers, per-node digests.
 *
 * 2. fetchRequestedContext() — the recall. Only runs when the model returns a
 *    contextRequest (because the student asked about their history, or the
 *    copilot strongly judges stored context changes the answer). Depth is
 *    digest-first: conversation rolling summary + the last few messages
 *    verbatim, clamped per item and by a GLOBAL budget — never whole raw
 *    transcripts by default.
 *
 * Everything is best-effort: a failed sub-query degrades to "nothing stored"
 * rather than breaking the turn.
 */
import prisma from '@/lib/prisma'
import type { TreeNode } from '@prisma/client'
import { clampText } from '@/lib/clamp'
import { parseQuizState, masteryTarget, masteryFilled } from '@/lib/mastery'

export const CONTEXT_KINDS = [
  'chat', 'notes', 'files', 'highlights', 'annotations', 'progress', 'syllabus', 'explainer',
] as const
export type ContextKind = typeof CONTEXT_KINDS[number]

/** One entry of a copilot contextRequest: a node handle (index into the same
 *  `real` array the prompt's numeric handles use) or "tree" for tree-level
 *  files, plus which kinds of stored context to pull. */
export interface ContextRequestNode {
  node?: number | string
  kinds?: string[]
}

export interface RecalledRef { node: string; kinds: string[] }

const nodeContext = (nodeId: string) => `tree-node:${nodeId}`

/** Parse a JSON-in-string array column, tolerating malformed JSON. */
function safeArray<T>(raw: string | null | undefined): T[] {
  if (!raw) return []
  try {
    const p = JSON.parse(raw)
    return Array.isArray(p) ? (p as T[]) : []
  } catch {
    return []
  }
}

function daysAgo(d: Date): string {
  const days = Math.max(0, Math.round((Date.now() - d.getTime()) / 86_400_000))
  return days === 0 ? 'today' : `${days}d ago`
}

/**
 * The per-node inventory the copilot sees EVERY turn. Counts and filenames
 * only — one line per node that has anything, so a bare tree costs ~nothing.
 * Handles ([#i]) index the same non-pending `real` array as the prompt's
 * CURRENT TREE list, so the model can request context for exactly the node
 * it means.
 */
export async function buildContextCatalog(userId: string, treeId: string, real: TreeNode[]): Promise<string> {
  try {
    const contexts = real.map(n => nodeContext(n.id))
    const [convs, files] = await Promise.all([
      contexts.length > 0
        ? prisma.conversation.findMany({
            where: { userId, context: { in: contexts } },
            select: { id: true, context: true, updatedAt: true, _count: { select: { messages: true } } },
          })
        : Promise.resolve([]),
      prisma.linkedFile.findMany({
        where: {
          userId,
          OR: [
            { workType: 'tree-node', workId: { in: real.map(n => n.id) } },
            { workType: 'tree', workId: treeId },
          ],
        },
        select: { workType: true, workId: true, name: true },
        orderBy: { addedAt: 'desc' },
        take: 200,
      }),
    ])
    const convByNode = new Map<string, { id: string; msgs: number; updatedAt: Date }>()
    for (const c of convs) {
      const nodeId = (c.context ?? '').replace('tree-node:', '')
      convByNode.set(nodeId, { id: c.id, msgs: c._count.messages, updatedAt: c.updatedAt })
    }
    const highlightByConv = new Map<string, number>()
    if (convs.length > 0) {
      try {
        const rows = await prisma.messageHighlight.groupBy({
          by: ['conversationId'],
          where: { conversationId: { in: convs.map(c => c.id) } },
          _count: { conversationId: true },
        })
        for (const r of rows) highlightByConv.set(r.conversationId, r._count.conversationId)
      } catch { /* non-critical */ }
    }
    const filesByNode = new Map<string, string[]>()
    const treeFiles: string[] = []
    for (const f of files) {
      if (f.workType === 'tree') treeFiles.push(f.name)
      else if (f.workId) {
        const arr = filesByNode.get(f.workId) ?? []
        if (arr.length < 6) arr.push(f.name)
        filesByNode.set(f.workId, arr)
      }
    }

    const lines: string[] = []
    real.forEach((n, i) => {
      const parts: string[] = []
      const conv = convByNode.get(n.id)
      if (conv && conv.msgs > 0) parts.push(`chat ${conv.msgs} msgs (${daysAgo(conv.updatedAt)})`)
      if (n.notes && n.notes.trim()) parts.push('notes')
      const fnames = filesByNode.get(n.id)
      if (fnames?.length) parts.push(`files: ${fnames.join(', ')}`)
      const hl = conv ? highlightByConv.get(conv.id) ?? 0 : 0
      if (hl > 0) parts.push(`${hl} highlights`)
      const ann = safeArray(n.annotations).length
      if (ann > 0) parts.push(`${ann} explainer-notes`)
      const prog = safeArray(n.progressLog).length
      if (prog > 0) parts.push(`progress ${prog}`)
      if (n.explainer && n.explainer.trim()) parts.push('explainer')
      if (n.contextSummary && n.contextSummary.trim()) parts.push('digest')
      const qs = parseQuizState(n.quizState)
      if (qs.attempts > 0 || (qs.facets && qs.facets.length > 0)) {
        parts.push(`syllabus ${masteryFilled(qs)}/${masteryTarget(qs)}`)
      }
      if (parts.length > 0) lines.push(`[#${i}] ${parts.join(' · ')}`)
    })
    if (treeFiles.length > 0) lines.push(`[tree] files: ${treeFiles.slice(0, 8).join(', ')}`)
    return lines.join('\n')
  } catch {
    return ''
  }
}

// ── Recall budgets (digest + excerpt policy) ──
const CHAT_MESSAGES = 12          // last N verbatim messages per node
const CHAT_MSG_CHARS = 600
const TOTAL_BUDGET = 14_000       // global clamp for the whole recalled block

/**
 * Fetch exactly the requested context blocks. Digest-first (per-node
 * contextSummary + the conversation's rolling summary before raw messages),
 * every item clamped, whole block capped at TOTAL_BUDGET chars.
 */
export async function fetchRequestedContext(
  userId: string, treeId: string, real: TreeNode[], requests: ContextRequestNode[],
): Promise<{ block: string; recalled: RecalledRef[] }> {
  const recalled: RecalledRef[] = []
  const sections: string[] = []
  try {
    const wantTreeFiles = requests.some(r => r.node === 'tree' || r.node === 'TREE')
    const nodeReqs = requests
      .map(r => {
        const idx = typeof r.node === 'number' ? r.node : Number.parseInt(String(r.node), 10)
        const node = Number.isInteger(idx) && idx >= 0 && idx < real.length ? real[idx] : undefined
        const kinds = (Array.isArray(r.kinds) ? r.kinds : [])
          .filter((k): k is ContextKind => (CONTEXT_KINDS as readonly string[]).includes(k))
        return node && kinds.length > 0 ? { node, idx, kinds: Array.from(new Set(kinds)) } : null
      })
      .filter((r): r is { node: TreeNode; idx: number; kinds: ContextKind[] } => r !== null)
      .slice(0, 6)

    for (const { node, idx, kinds } of nodeReqs) {
      const out: string[] = []
      const wantsChatish = kinds.includes('chat') || kinds.includes('highlights')
      const conv = wantsChatish
        ? await prisma.conversation.findFirst({
            where: { userId, context: nodeContext(node.id) },
            select: {
              id: true, summary: true,
              messages: { orderBy: { createdAt: 'desc' }, take: CHAT_MESSAGES, select: { role: true, content: true } },
            },
          }).catch(() => null)
        : null

      for (const kind of kinds) {
        switch (kind) {
          case 'chat': {
            const bits: string[] = []
            if (node.contextSummary?.trim()) bits.push(`Node digest: ${clampText(node.contextSummary, 600)}`)
            if (conv?.summary?.trim()) bits.push(`Earlier-conversation summary: ${clampText(conv.summary, 900)}`)
            const msgs = [...(conv?.messages ?? [])].reverse()
              .filter(m => m.role === 'user' || m.role === 'assistant')
              .map(m => `- ${m.role === 'user' ? 'Student' : 'Bob'}: ${clampText(m.content, CHAT_MSG_CHARS)}`)
            if (msgs.length > 0) bits.push(`Last ${msgs.length} messages:\n${msgs.join('\n')}`)
            out.push(`**Workspace conversation**\n${bits.length ? bits.join('\n') : '(no conversation yet)'}`)
            break
          }
          case 'notes':
            out.push(`**Student notes**\n${node.notes?.trim() ? clampText(node.notes, 1500) : '(none)'}`)
            break
          case 'files': {
            const nodeFiles = await prisma.linkedFile.findMany({
              where: { userId, workType: 'tree-node', workId: node.id },
              select: { name: true, mimeType: true, analysis: true, content: true },
              orderBy: { addedAt: 'desc' },
              take: 4,
            }).catch(() => [])
            const rendered = nodeFiles.map(f => {
              const body = f.analysis?.trim()
                ? clampText(f.analysis, 1000)
                : f.content && !f.content.startsWith('data:')
                  ? clampText(f.content, 800)
                  : '(binary file — no stored analysis)'
              return `- ${f.name}: ${body}`
            })
            out.push(`**Attached files**\n${rendered.length ? rendered.join('\n') : '(none)'}`)
            break
          }
          case 'highlights': {
            const rows = conv
              ? await prisma.messageHighlight.findMany({
                  where: { userId, conversationId: conv.id },
                  select: { selectedText: true, comment: true },
                  orderBy: { createdAt: 'desc' },
                  take: 10,
                }).catch(() => [])
              : []
            const rendered = rows.map(h =>
              `- "${clampText(h.selectedText, 160)}"${h.comment?.trim() ? ` — student note: ${clampText(h.comment, 160)}` : ''}`)
            out.push(`**Chat highlights (what the student marked)**\n${rendered.length ? rendered.join('\n') : '(none)'}`)
            break
          }
          case 'annotations': {
            const rows = safeArray<{ text?: string }>(node.annotations)
              .filter(a => typeof a?.text === 'string' && a.text.trim())
              .slice(0, 8)
              .map(a => `- ${clampText(a.text as string, 200)}`)
            out.push(`**Explainer annotations**\n${rows.length ? rows.join('\n') : '(none)'}`)
            break
          }
          case 'progress': {
            const rows = safeArray<{ text?: string; source?: string }>(node.progressLog)
              .filter(p => typeof p?.text === 'string' && p.text.trim())
              .slice(-8)
              .map(p => `- ${clampText(p.text as string, 160)}${p.source ? ` (${p.source})` : ''}`)
            out.push(`**Project progress log**\n${rows.length ? rows.join('\n') : '(none)'}`)
            break
          }
          case 'syllabus': {
            const qs = parseQuizState(node.quizState)
            const facets = (qs.facets ?? []).map(f => `${f.done ? '✅' : '⬜'} ${f.name}`).join(' · ')
            out.push(`**Verification state**\n${facets || '(no syllabus contract yet)'}\nproven ${masteryFilled(qs)}/${masteryTarget(qs)} · attempts ${qs.attempts} · own-words correct ${qs.shortCorrect}${qs.reviewedAt ? ` · last reviewed ${qs.reviewedAt.slice(0, 10)}` : ''}`)
            break
          }
          case 'explainer':
            out.push(`**Stored explainer**\n${node.explainer?.trim() ? clampText(node.explainer, 2000) : '(not generated yet)'}`)
            break
        }
      }
      if (out.length > 0) {
        sections.push(`### [#${idx}] "${node.title}" (${node.status})\n${out.join('\n\n')}`)
        recalled.push({ node: node.title, kinds })
      }
    }

    if (wantTreeFiles) {
      const files = await prisma.linkedFile.findMany({
        where: { userId, workType: 'tree', workId: treeId },
        select: { name: true, analysis: true, content: true },
        orderBy: { addedAt: 'desc' },
        take: 6,
      }).catch(() => [])
      const rendered = files.map(f => {
        const body = f.analysis?.trim()
          ? clampText(f.analysis, 1000)
          : f.content && !f.content.startsWith('data:') ? clampText(f.content, 800) : '(binary file — no stored analysis)'
        return `- ${f.name}: ${body}`
      })
      if (rendered.length > 0) {
        sections.push(`### Tree-level files (shared in this copilot)\n${rendered.join('\n')}`)
        recalled.push({ node: 'tree files', kinds: ['files'] })
      }
    }
  } catch { /* degrade to whatever was assembled */ }

  let block = sections.join('\n\n')
  if (block.length > TOTAL_BUDGET) {
    block = `${block.slice(0, TOTAL_BUDGET)}\n[…recalled context truncated to budget]`
  }
  return { block, recalled }
}
