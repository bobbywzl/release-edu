/**
 * Mastery Board digest — the learner-facing, structured narrative a cheap
 * background pass (tree-engine's refreshNodeBoardDigest) writes onto each
 * node (TreeNode.boardDigest). Client-safe and dependency-free: the
 * workspace board renders through parseBoardDigest and the server pass
 * validates through it before writing, so malformed stored JSON can never
 * crash a render (JSON-in-string column rule).
 */

export type BoardMomentKind = 'learning' | 'fixed' | 'breakthrough' | 'build'

/** One narrated moment of real progress on this node. */
export interface BoardMoment {
  /** learning = a concept clicked · fixed = a previously-missed point proven
   *  · breakthrough = an own-words insight · build = real-world execution. */
  kind: BoardMomentKind
  text: string
  /** Syllabus facet this moment belongs to, when one clearly applies. */
  facet?: string
}

/** A wrong belief that surfaced in this node's work, and whether the record
 *  shows it was repaired. */
export interface BoardMisconception {
  label: string
  cleared: boolean
  note?: string
}

export interface BoardDigest {
  /** One learner-facing sentence naming the strongest capability proven so far. */
  headline: string
  /** Chronological key moments (≤6). */
  moments: BoardMoment[]
  /** Misconceptions surfaced here (≤5), each marked cleared or still open. */
  misconceptions: BoardMisconception[]
  /** Bob's coach-read of the checkpoint record (1-2 sentences). */
  quizRead: string
  /** The single most useful next focus on this node ('' once done). */
  nextFocus: string
}

const KINDS: BoardMomentKind[] = ['learning', 'fixed', 'breakthrough', 'build']

/** Tolerant parse + clamp of a stored (or freshly generated) digest.
 *  Returns null when there is nothing renderable. */
export function parseBoardDigest(raw: string | null | undefined): BoardDigest | null {
  if (!raw) return null
  try {
    let parsed: unknown = JSON.parse(raw)
    // Tolerate a double-encoded payload (JSON string containing JSON).
    if (typeof parsed === 'string') {
      try { parsed = JSON.parse(parsed) } catch { return null }
    }
    if (!parsed || typeof parsed !== 'object') return null
    const p = parsed as Partial<BoardDigest>
    const moments: BoardMoment[] = (Array.isArray(p.moments) ? p.moments : [])
      .filter(m => m && typeof m.text === 'string' && m.text.trim())
      .map(m => ({
        kind: KINDS.includes(m.kind as BoardMomentKind) ? (m.kind as BoardMomentKind) : 'learning',
        text: m.text.trim().slice(0, 300),
        ...(typeof m.facet === 'string' && m.facet.trim() ? { facet: m.facet.trim().slice(0, 120) } : {}),
      }))
      .slice(0, 6)
    const misconceptions: BoardMisconception[] = (Array.isArray(p.misconceptions) ? p.misconceptions : [])
      .filter(m => m && typeof m.label === 'string' && m.label.trim())
      .map(m => ({
        label: m.label.trim().slice(0, 180),
        cleared: m.cleared === true,
        ...(typeof m.note === 'string' && m.note.trim() ? { note: m.note.trim().slice(0, 220) } : {}),
      }))
      .slice(0, 5)
    const headline = typeof p.headline === 'string' ? p.headline.trim().slice(0, 220) : ''
    const quizRead = typeof p.quizRead === 'string' ? p.quizRead.trim().slice(0, 420) : ''
    const nextFocus = typeof p.nextFocus === 'string' ? p.nextFocus.trim().slice(0, 260) : ''
    if (!headline && moments.length === 0 && misconceptions.length === 0 && !quizRead) return null
    return { headline, moments, misconceptions, quizRead, nextFocus }
  } catch {
    return null
  }
}
