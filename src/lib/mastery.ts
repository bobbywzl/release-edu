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
  /** A checkpoint probing this facet was answered WRONG at some point.
   *  done && struggled = "failed first, then fixed" — the checkpoint rail
   *  renders it as repaired learning, distinct from a clean pass. */
  struggled?: boolean
}

/** How a correct answer's facet tag resolves against the coverage map. */
export type FacetResolution =
  | { kind: 'credit'; index: number }   // tag names exactly one UNDONE facet → flip it
  | { kind: 'deepening' }               // tag names an already-DONE facet → no coverage change
  | { kind: 'unresolved' }              // no tag, matches nothing, or ambiguous

/**
 * Resolve which facet a checkpoint's tag credits — the truthful rule: a facet
 * flips `done` ONLY when a checkpoint that actually targeted it is answered
 * correctly. Fuzzy matching runs over ALL facets and only when UNAMBIGUOUS,
 * so a tag like "water" that matches both "watering schedule" and "water
 * chemistry" resolves to 'unresolved' (never a wrong-sibling flip).
 */
export function resolveFacetCredit(facets: SyllabusFacet[], tag: string | null | undefined): FacetResolution {
  const want = (tag ?? '').trim().toLowerCase()
  if (!want) return { kind: 'unresolved' }
  const exact = facets.findIndex(f => f.name.trim().toLowerCase() === want)
  if (exact !== -1) return facets[exact].done ? { kind: 'deepening' } : { kind: 'credit', index: exact }
  const fuzzy = facets.map((f, i) => ({ f, i }))
    .filter(({ f }) => { const n = f.name.trim().toLowerCase(); return n.includes(want) || want.includes(n) })
  if (fuzzy.length !== 1) return { kind: 'unresolved' }
  return fuzzy[0].f.done ? { kind: 'deepening' } : { kind: 'credit', index: fuzzy[0].i }
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
  /** 'artifact' = evidence checkpoint: the student attaches the REAL thing
   *  (a photo, screenshot, capture, file) and the judge grades what the
   *  artifact actually shows — verification about their device, not prose. */
  kind: 'mcq' | 'short' | 'artifact'
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

/**
 * The ONLY checkpoint shape allowed to cross to a client — the answer key
 * (correctIndex / explanation / rubric) is stripped. The workspace card
 * renders from exactly these fields; it never needs the key (the quiz route
 * judges server-side against the DB copy).
 */
export interface SanitizedPending {
  kind: 'mcq' | 'short' | 'artifact'
  question: string
  options?: string[]
  hint?: string
  /** The syllabus facet this card probes — no answer material (the facet
   *  names are already fully visible in the coverage map); powers the
   *  checkpoint rail's jump-to-moment anchors. */
  facet?: string
}

/** Strip a pending checkpoint down to the client-safe shape (no answer key). */
export function sanitizePending(p: PendingQuiz | null | undefined): SanitizedPending | null {
  if (!p || typeof p.question !== 'string') return null
  return {
    kind: p.kind,
    question: p.question,
    ...(p.kind === 'mcq' && Array.isArray(p.options) ? { options: p.options } : {}),
    ...(typeof p.hint === 'string' && p.hint.trim() ? { hint: p.hint } : {}),
    ...(typeof p.facet === 'string' && p.facet.trim() ? { facet: p.facet } : {}),
  }
}

/**
 * Sanitize a raw quizState JSON string for a CLIENT payload: the answer key
 * NEVER leaves the server. Keeps every tally/facet field the workspace pips
 * need and a sanitized pending; drops correctIndex/explanation/rubric. Any
 * route that serializes TreeNode.quizState to a browser MUST run this — the
 * one enforcement point so the tree-GET and chat-GET shapes can't drift.
 */
export function sanitizeQuizStateForClient(raw: string | null | undefined): string {
  const qs = parseQuizState(raw)
  const safe = {
    correct: qs.correct, attempts: qs.attempts, combo: qs.combo,
    shortCorrect: qs.shortCorrect, sureWrong: qs.sureWrong, sureRight: qs.sureRight,
    missed: qs.missed, reviewedAt: qs.reviewedAt ?? null,
    facets: qs.facets ?? null,
    // The queued-remediation flag (its text is a missed QUESTION — already
    // client-visible via `missed`; no key material) — powers the tree panel's
    // "where you left off" resume line.
    remediationOwed: qs.remediationOwed ?? null,
    // Judged-attempt record (outcome/facet/confidence timestamps only — no
    // questions, no keys) — powers the Mastery Board's performance-over-time
    // sections. parseQuizState already whitelisted every field.
    history: qs.history ?? [],
    pending: sanitizePending(qs.pending),
  }
  return JSON.stringify(safe)
}

/** A previously missed checkpoint, queued for a delayed retest when the
 *  student returns to the node hours later (memory needs the gap). */
export interface MissedCheckpoint {
  question: string
  missedAt: string
}

/**
 * One judged checkpoint attempt, appended chronologically by the quiz route —
 * the node's PERFORMANCE RECORD THROUGH TIME. Powers the workspace Mastery
 * Board (attempt timeline, first-try vs after-feedback rates, best streak,
 * comeback/fix moments). Carries NO answer-key material: outcome + facet tag
 * only (facet names are already fully client-visible in the coverage map).
 */
export interface QuizHistoryEntry {
  /** ISO timestamp of the judged answer. */
  t: string
  /** Judged correct? */
  ok: boolean
  kind: 'mcq' | 'short' | 'artifact'
  /** Syllabus facet the checkpoint probed (as tagged by Bob), if any. */
  facet?: string
  /** Self-assessed confidence at answer time (calibration record). */
  conf?: 'sure' | 'unsure'
  /** Was a retention-review card on an already-verified node. */
  review?: boolean
  /** This correct answer closed a facet the learner had previously MISSED —
   *  the "failed first, then fixed" comeback moment. */
  fix?: boolean
}

/** History cap — enough for a rich timeline without unbounded JSON growth. */
export const QUIZ_HISTORY_CAP = 80

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
  /** Consecutive CORRECT answers on a contract-bearing node whose facet tag
   *  could not be resolved (missing / unmatched / ambiguous). Legit facet
   *  credit resets it; at 2 the anti-stall directive to Bob fires (a
   *  directive only — coverage NEVER advances without a resolved facet). */
  untaggedStreak?: number
  /** Consecutive WRONG checkpoint answers — the app's own ground truth for
   *  wheel-spinning. The chat route reads max(this, reflection.streakWrong),
   *  so the analogy bridge / prerequisite chain / intervention switch fire
   *  from judged answers, not only from typed confusion. */
  wrongStreak?: number
  /** A missed checkpoint whose law-mandated full remediation ([NODE_REMEDIATE])
   *  has not happened yet — the debt survives tab closes and node switches;
   *  the workspace fires the turn on mount and the chat route clears it. */
  remediationOwed?: string | null
  /** Chronological judged-attempt record (capped) — see QuizHistoryEntry. */
  history?: QuizHistoryEntry[]
}

export function parseQuizState(raw: string | null | undefined): QuizState {
  const fallback: QuizState = {
    correct: 0, attempts: 0, combo: 0, shortCorrect: 0,
    sureWrong: 0, sureRight: 0, missed: [], reviewedAt: null, pending: null, facets: null, untaggedStreak: 0,
  }
  if (!raw) return fallback
  try {
    let parsed: unknown = JSON.parse(raw)
    // Tolerate a double-encoded payload (a JSON string containing JSON —
    // seen in the wild on quizState): unwrap instead of silently zeroing
    // the whole mastery tally.
    if (typeof parsed === 'string') {
      try { parsed = JSON.parse(parsed) } catch { return fallback }
    }
    if (!parsed || typeof parsed !== 'object') return fallback
    const p = parsed as Partial<QuizState>
    const facets = Array.isArray(p.facets)
      ? p.facets
        .filter(f => f && typeof f.name === 'string' && f.name.trim())
        .map(f => ({ name: f.name.trim().slice(0, 120), done: f.done === true, struggled: f.struggled === true }))
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
      untaggedStreak: Math.max(0, p.untaggedStreak ?? 0),
      wrongStreak: Math.max(0, p.wrongStreak ?? 0),
      remediationOwed: typeof p.remediationOwed === 'string' && p.remediationOwed.trim() ? p.remediationOwed.slice(0, 400) : null,
      history: Array.isArray(p.history)
        ? p.history
          .filter(h => h && typeof h.t === 'string' && typeof h.ok === 'boolean'
            && (h.kind === 'mcq' || h.kind === 'short' || h.kind === 'artifact'))
          .map(h => ({
            t: h.t, ok: h.ok, kind: h.kind,
            ...(typeof h.facet === 'string' && h.facet.trim() ? { facet: h.facet.trim().slice(0, 120) } : {}),
            ...(h.conf === 'sure' || h.conf === 'unsure' ? { conf: h.conf } : {}),
            ...(h.review === true ? { review: true } : {}),
            ...(h.fix === true ? { fix: true } : {}),
          }))
          .slice(-QUIZ_HISTORY_CAP)
        : [],
    }
  } catch {
    return fallback
  }
}
