/**
 * Shared server-side attachment pipeline — ONE implementation for every chat
 * surface (tree copilot, node workspace chat), so multimodal attachments
 * behave identically everywhere: Gemini analysis (images/video/PDFs described,
 * voice notes transcribed to TRANSCRIPT + NOTES) plus LinkedFile evidence
 * persistence, with every size/count policy in one place.
 *
 * Attachments are analyzed in PARALLEL (≤3 per turn, client-capped body size)
 * so a multi-attachment turn pays the slowest single analysis, not the sum —
 * this runs BEFORE the teaching model's streamed reply starts.
 */
import prisma from '@/lib/prisma'

export interface IncomingAttachment { name?: string; type?: string; content?: string }
export interface AttachmentAnalysis { name: string; analysis: string }

export const MAX_ATTACHMENTS_PER_TURN = 3

/** The persisted-record label for a message with attachments — the same
 *  string the client shows as the optimistic user bubble, so live and
 *  rehydrated threads render identically. */
export function attachmentRecordLabel(message: string, atts: IncomingAttachment[]): string {
  if (atts.length === 0) return message
  return `${message}${message ? '\n' : ''}[${atts.map(a => `📎 ${(a.name ?? 'attachment').slice(0, 80)}`).join(' · ')}]`
}

/**
 * Analyze every attachment with Gemini and persist each as LinkedFile
 * evidence under the given work item. Small images are stored verbatim
 * (renderable later); heavy media persists as its analysis text. A failed
 * or unreadable attachment is skipped — it must never kill the turn.
 * Returns the analyses (prompt grounding) and the created row ids (so the
 * caller can exclude them from its own evidence queries this turn).
 */
export async function analyzeAndPersistAttachments(
  userId: string,
  attachments: IncomingAttachment[],
  opts: { context: string; workType: string; workId: string },
): Promise<{ analyses: AttachmentAnalysis[]; fileIds: string[] }> {
  const atts = attachments.slice(0, MAX_ATTACHMENTS_PER_TURN)
  const results = await Promise.all(atts.map(async a => {
    const name = (a.name ?? 'attachment').slice(0, 120)
    const content = a.content ?? ''
    if (!content) return null
    try {
      if (content.startsWith('data:')) {
        // Request bodies are capped (~4.5MB on Vercel; the client enforces a
        // total-encoded budget) so this is bounded, but clamp defensively.
        const [head, b64] = content.split(',', 2)
        const mime = /data:([^;]+)/.exec(head)?.[1] ?? (a.type || 'image/jpeg')
        if (!b64) return null
        const { analyzeImage } = await import('@/lib/gemini')
        const analysis = await analyzeImage(b64, opts.context, mime, userId)
        // Small images keep their raw data URI in `content` (so they still
        // render in the Files tab); heavy media keeps the analysis text there.
        // EITHER way the Gemini analysis is ALSO stored in `analysis`, so a
        // later turn can reference the media's CONTENT, not just its filename.
        const storable = mime.startsWith('image/') && content.length <= 1_000_000
          ? content
          : `[${mime} — analyzed]\n${analysis.slice(0, 8000)}`
        const row = await prisma.linkedFile.create({
          data: {
            userId, workType: opts.workType, workId: opts.workId, name, mimeType: mime,
            content: storable.slice(0, 1_500_000),
            analysis: analysis.slice(0, 8000),
          },
        }).catch(() => null)
        return { name, analysis, fileId: row?.id ?? null }
      }
      const text = content.slice(0, 6000)
      const row = await prisma.linkedFile.create({
        data: { userId, workType: opts.workType, workId: opts.workId, name, mimeType: a.type || 'text/plain', content: content.slice(0, 1_500_000) },
      }).catch(() => null)
      return { name, analysis: `Text file content:\n${text}`, fileId: row?.id ?? null }
    } catch {
      return null // an unanalyzable attachment must not kill the turn
    }
  }))
  const ok = results.filter((r): r is { name: string; analysis: string; fileId: string | null } => r !== null)
  return {
    analyses: ok.map(r => ({ name: r.name, analysis: r.analysis })),
    fileIds: ok.map(r => r.fileId).filter((x): x is string => !!x),
  }
}
