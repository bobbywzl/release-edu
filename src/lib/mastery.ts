/**
 * Checkpoint-mastery constants and state — the single source of truth,
 * shared by server (tree-engine, quiz/chat routes) AND client (workspace
 * pips, help strings). Keep this module dependency-free so importing it
 * never drags server code into a client bundle.
 *
 * VERIFICATION IS SYLLABUS COVERAGE, not a fixed count: each node's opening
 * syllabus emits a facet contract (its "What you'll cover" sub-points,
 * stored in QuizState.facets), every checkpoint targets one facet, and the
 * node verifies only when EVERY facet has been proven by a correct answer —
 * including at least MASTERY_MIN_SHORT own-words short answer (recognition
 * alone never verifies). The number of checkpoints therefore tracks the
 * syllabus (typically 3-5). MASTERY_TARGET is the FALLBACK contract for
 * nodes without a facet map (pre-contract nodes, failed extraction).
 */

export const MASTERY_TARGET = 3
export const MASTERY_MIN_SHORT = 1

/** One promised sub-point from the node's syllabus — the verification
 *  contract's unit. done flips when a checkpoint probing it is answered
 *  correctly. */
export interface SyllabusFacet {
  name: string
  done: boolean
}

/** The node's verification target: its facet count when a syllabus contract
 *  exists, else the static fallback. */
export function masteryTarget(qs: QuizState): number {
  return qs.facets && qs.facets.length >= 2 ? qs.facets.length : MASTERY_TARGET
}

/** Progress toward the target, in the same unit as masteryTarget. */
export function masteryFilled(qs: QuizState): number {
  return qs.facets && qs.facets.length >= 2
    ? qs.facets.filter(f => f.done).length
    : Math.min(qs.correct, MASTERY_TARGET)
}

/** The verification condition: full syllabus coverage (or the fallback
 *  count) AND the own-words requirement. */
export function masteryMet(qs: QuizState): boolean {
  const coverage = qs.facets && qs.facets.length >= 2
    ? qs.facets.every(f => f.done)
    : qs.correct >= MASTERY_TARGET
  return coverage && qs.shortCorrect >= MASTERY_MIN_SHORT
}

/**
 * The full checkpoint a node is currently asking, stored server-side in
 * TreeNode.quizState.pending. The answer key (correctIndex / explanation /
 * rubric) NEVER leaves the server — clients receive only {kind, question,
 * options}.
 */
export interface PendingQuiz {
  kind: 'mcq' | 'short'
  question: string
  options?: string[]
  correctIndex?: number
  explanation?: string
  rubric?: string
  /** A nudge that narrows thinking WITHOUT revealing the answer — safe to
   *  ship to the client; shown only when the student taps Hint. */
  hint?: string
  /** Which syllabus facet this checkpoint probes — a correct answer marks
   *  that facet done in the node's coverage contract. */
  facet?: string
  /** Issued during a retention-review turn — pays full XP on a verified node. */
  review?: boolean
  /** Set by Bob inside the [[QUIZ]] JSON when this checkpoint IS the directed
   *  retest — the server only links retestOf when he says so. */
  retest?: boolean
  /** This checkpoint re-probes a previously MISSED one (delayed retest) —
   *  a correct answer clears that entry from QuizState.missed. */
  retestOf?: string
  askedAt?: string
}

/** A previously missed checkpoint, queued for a delayed retest when the
 *  student returns to the node hours later (memory needs the gap). */
export interface MissedCheckpoint {
  question: string
  missedAt: string
}

/** Per-node checkpoint tally, stored as JSON in TreeNode.quizState. */
export interface QuizState {
  correct: number
  attempts: number
  combo: number
  shortCorrect: number
  /** Confidence calibration: answers marked "sure" that were wrong/right —
   *  a high sureWrong is the node's blind spot, and checkpoints target it. */
  sureWrong: number
  sureRight: number
  /** Missed checkpoints awaiting a delayed retest (cap 5, newest kept). */
  missed: MissedCheckpoint[]
  /** Last retention review of this node (ISO) — review picks the stalest. */
  reviewedAt?: string | null
  pending?: PendingQuiz | null
  /** The node's verification contract: the syllabus sub-points, each proven
   *  (done) by a correct checkpoint. null = no contract yet → static
   *  MASTERY_TARGET fallback applies. */
  facets?: SyllabusFacet[] | null
}

export function parseQuizState(raw: string | null | undefined): QuizState {
  const fallback: QuizState = {
    correct: 0, attempts: 0, combo: 0, shortCorrect: 0,
    sureWrong: 0, sureRight: 0, missed: [], reviewedAt: null, pending: null, facets: null,
  }
  if (!raw) return fallback
  try {
    const p = JSON.parse(raw) as Partial<QuizState>
    const facets = Array.isArray(p.facets)
      ? p.facets
        .filter(f => f && typeof f.name === 'string' && f.name.trim())
        .map(f => ({ name: f.name.trim().slice(0, 120), done: f.done === true }))
        .slice(0, 6)
      : null
    return {
      correct: Math.max(0, p.correct ?? 0),
      attempts: Math.max(0, p.attempts ?? 0),
      combo: Math.max(0, p.combo ?? 0),
      shortCorrect: Math.max(0, p.shortCorrect ?? 0),
      sureWrong: Math.max(0, p.sureWrong ?? 0),
      sureRight: Math.max(0, p.sureRight ?? 0),
      missed: Array.isArray(p.missed)
        ? p.missed.filter(m => m && typeof m.question === 'string' && typeof m.missedAt === 'string').slice(-5)
        : [],
      reviewedAt: typeof p.reviewedAt === 'string' ? p.reviewedAt : null,
      pending: p.pending && typeof p.pending === 'object' && typeof p.pending.question === 'string' ? p.pending : null,
      // A contract needs at least 2 facets to be meaningful — below that,
      // treat as absent so the static fallback governs.
      facets: facets && facets.length >= 2 ? facets : null,
    }
  } catch {
    return fallback
  }
}
