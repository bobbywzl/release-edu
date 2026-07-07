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
  askedAt?: string
}

/** Per-node checkpoint tally, stored as JSON in TreeNode.quizState. */
export interface QuizState {
  correct: number
  attempts: number
  combo: number
  shortCorrect: number
  /** Last retention review of this node (ISO) — review picks the stalest. */
  reviewedAt?: string | null
  pending?: PendingQuiz | null
}

export function parseQuizState(raw: string | null | undefined): QuizState {
  const fallback: QuizState = { correct: 0, attempts: 0, combo: 0, shortCorrect: 0, reviewedAt: null, pending: null }
  if (!raw) return fallback
  try {
    const p = JSON.parse(raw) as Partial<QuizState>
    return {
      correct: Math.max(0, p.correct ?? 0),
      attempts: Math.max(0, p.attempts ?? 0),
      combo: Math.max(0, p.combo ?? 0),
      shortCorrect: Math.max(0, p.shortCorrect ?? 0),
      reviewedAt: typeof p.reviewedAt === 'string' ? p.reviewedAt : null,
      pending: p.pending && typeof p.pending === 'object' && typeof p.pending.question === 'string' ? p.pending : null,
    }
  } catch {
    return fallback
  }
}
