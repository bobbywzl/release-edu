/**
 * Checkpoint-mastery constants and state — the single source of truth,
 * shared by server (tree-engine, quiz/chat routes) AND client (workspace
 * pips, help strings). Keep this module dependency-free so importing it
 * never drags server code into a client bundle.
 *
 * A node verifies at MASTERY_TARGET correct checkpoint answers including
 * at least MASTERY_MIN_SHORT own-words short answer — recognition alone
 * (MCQ) never verifies understanding.
 */

export const MASTERY_TARGET = 3
export const MASTERY_MIN_SHORT = 1

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
}

export function parseQuizState(raw: string | null | undefined): QuizState {
  const fallback: QuizState = {
    correct: 0, attempts: 0, combo: 0, shortCorrect: 0,
    sureWrong: 0, sureRight: 0, missed: [], reviewedAt: null, pending: null,
  }
  if (!raw) return fallback
  try {
    const p = JSON.parse(raw) as Partial<QuizState>
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
    }
  } catch {
    return fallback
  }
}
