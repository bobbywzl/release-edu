/**
 * Model routing for the chat API.
 *
 * KEY INSIGHT — content generation in this app is AUTONOMOUS, not on user
 * request. Bob auto-generates the syllabus, problem set, and evaluation based
 * on a deterministic lesson-phase state machine driven by `sessionScore` and
 * whether a `sessionPlan` exists. The router reads those exact same signals.
 *
 * Mapping (chapter sessions):
 *   - PHASE 1 — no sessionPlan, score = 0 → Bob outputs the full syllabus →
 *     OPUS (generation, must be high-quality)
 *   - PHASE 2 — score < 80 → Socratic teaching, discussion, hooking, follow-up
 *     → SONNET (discussion-class, 1/5 the price, indistinguishable quality)
 *   - PHASE 3 — 80 ≤ score < 100 → Bob outputs the capstone problem set →
 *     OPUS (generation)
 *   - PHASE 4 — score = 100 → evaluating student answers, light verification →
 *     SONNET
 *
 * Message-tag overrides (client-supplied special tags):
 *   - "[NEW SESSION - START]"  → OPUS (always — full syllabus emission)
 *   - "[REVIEW SESSION]"       → OPUS (summary + offer practice problems)
 *   - "[RESUME SESSION]"       → SONNET (warm continuation, no new syllabus)
 *
 * Non-chapter contexts (free chat, project mode, L&C mode):
 *   - Project mode (projectId set): SONNET — Bob discusses the project, the
 *     actual project artifact generation happens in /api/projects/* endpoints
 *     that we tune separately
 *   - Free tutoring chat: SONNET, with keyword override for explicit user
 *     requests like "quiz me", "give me problems" → OPUS. (Inside chapter
 *     sessions the phase machine takes priority; this keyword path is the
 *     fallback for sessions outside the chapter flow.)
 *
 * Background sub-tasks (action extraction, insight extraction, answer
 * verification, confidence/gap scoring): always HAIKU. Classification work.
 */

// Pinned fallbacks — the model-resolver auto-adopts the newest Opus/Sonnet
// from the catalog, but these are what every call uses when that fetch can't
// resolve (cold start, slow/blocked catalog). They MUST be current, valid ids:
// a stale pin here is silently fatal for whichever tier falls back to it — a
// stale Sonnet ('claude-sonnet-4-6' when the live model was 'claude-sonnet-5')
// made every checkpoint JUDGE call reject while teaching (valid Opus) kept
// working, surfacing as the workspace "trouble connecting" on judging only.
export const CHAT_MODELS = {
  opus: 'claude-opus-4-8',
  sonnet: 'claude-sonnet-5',
  haiku: 'claude-haiku-4-5-20251001',
} as const

// Tags the client embeds in the message body to signal session lifecycle
// events. The chat route's lessonPhase prompt checks for these — we mirror
// the same checks to route the right model BEFORE Bob writes a token.
const NEW_SESSION_TAG = '[NEW SESSION - START]'
const REVIEW_SESSION_TAG = '[REVIEW SESSION]'
const RESUME_SESSION_TAG = '[RESUME SESSION]'

// Fallback keyword patterns for non-chapter contexts. Inside chapter
// sessions, the phase state machine overrides these. Only used when there's
// no chapter or project context (free Bob chat).
const CONTENT_GEN_PATTERNS: RegExp[] = [
  /\b(quiz|test)\s+me\b/i,
  /\b(give|make|create|generate|write)\s+(me\s+)?(a|some|the)?\s*(quiz|quizzes|test|tests|mcqs?|multiple[\s-]choice)/i,
  /\bmcqs?\b/i,
  /\bmultiple[\s-]choice\s+(questions?|test|quiz)/i,
  /\b(give|make|create|generate|prepare|write)\s+(me\s+)?(some|a|the)?\s*(problem|practice|exercise|drill)/i,
  /\bproblem\s+set\b/i,
  /\bp\s*-?\s*set\b/i,
  /\bpractice\s+(problems?|questions?|exercises?)\b/i,
  /\b(give|make|create|generate|write)\s+(me\s+)?(some|a|the)?\s*short[\s-]answer/i,
  /\bshort\s+(?:answer\s+)?questions?\b/i,
  /\b(generate|create|make|build|draft|write|outline)\s+(me\s+)?(a|the|my)?\s*(syllabus|curriculum|outline|lesson\s+plan)/i,
]

export interface ChatRoutingContext {
  /** The user message being responded to. */
  message: string
  /** Set when the response is part of a chapter session (lesson mode). */
  activeChapterId?: string | null
  /** Set when the response is inside a project session. */
  projectId?: string | null
  /** Latest persisted sessionScore (0–100) on the active chapter. */
  sessionScore?: number
  /** True if the chapter already has a sessionPlan persisted. */
  hasSessionPlan?: boolean
  /**
   * APPROACH value from the previous turn's reflection block. Possible:
   *   re-explain | deepen | hypothetical | personal-connection
   *   | new-quiz | scenario-quiz | summary
   * Quiz-class values mean Bob is about to emit a quiz block this turn,
   * so we promote to Opus even within Phase 2.
   */
  lastReflectionApproach?: string | null
}

// Approach values from the previous turn's REFLECTION block that mean Bob
// will autonomously generate a quiz block this turn. Mid-lesson quizzes
// fire 8-10 times during Phase 2 — these are the only Phase 2 turns where
// the Sonnet default is wrong and we need to promote to Opus.
const QUIZ_APPROACH_VALUES = new Set(['new-quiz', 'scenario-quiz'])
function isQuizApproach(approach: string | null | undefined): boolean {
  if (!approach) return false
  return QUIZ_APPROACH_VALUES.has(approach.trim().toLowerCase())
}

type Tier = 'opus' | 'sonnet'
interface RoutingResult {
  model: string
  tier: Tier
  reason: string
}

/**
 * The actual decision function. Pure — no I/O, no API calls. Same signals
 * the prompt's lessonPhase block reads, so the model choice aligns with what
 * Bob is being asked to do this turn.
 */
function route(ctx: ChatRoutingContext): RoutingResult {
  const { message, activeChapterId, projectId, sessionScore = 0, hasSessionPlan = false, lastReflectionApproach } = ctx

  // ── Chapter session: lesson-phase state machine ─────────────────────────
  if (activeChapterId) {
    // Session-lifecycle tags trump phase math (they're explicit signals
    // from the client about what Bob should do this turn).
    if (message.includes(NEW_SESSION_TAG)) {
      return { model: CHAT_MODELS.opus, tier: 'opus', reason: 'chapter session: [NEW SESSION - START] tag → syllabus generation' }
    }
    if (message.includes(REVIEW_SESSION_TAG)) {
      return { model: CHAT_MODELS.opus, tier: 'opus', reason: 'chapter session: [REVIEW SESSION] tag → summary + optional problem generation' }
    }
    if (message.includes(RESUME_SESSION_TAG)) {
      return { model: CHAT_MODELS.sonnet, tier: 'sonnet', reason: 'chapter session: [RESUME SESSION] tag → continuation chat' }
    }
    // Phase math — same conditions as the lessonPhase prompt builder.
    if (sessionScore === 0 && !hasSessionPlan) {
      return { model: CHAT_MODELS.opus, tier: 'opus', reason: 'chapter session phase 1: syllabus generation' }
    }
    if (sessionScore < 80) {
      // Phase 2 (teaching) is mostly Socratic discussion — Sonnet by default.
      // BUT: when the previous turn's REFLECTION block declared APPROACH:
      // new-quiz or scenario-quiz, Bob will autonomously emit a quiz this
      // turn. Promote to Opus so the quiz quality matches the syllabus and
      // capstone tier. This is the only Phase 2 case where Bob is generating
      // content rather than discussing.
      if (isQuizApproach(lastReflectionApproach)) {
        return { model: CHAT_MODELS.opus, tier: 'opus', reason: `chapter session phase 2: prior APPROACH=${lastReflectionApproach} → quiz generation` }
      }
      return { model: CHAT_MODELS.sonnet, tier: 'sonnet', reason: 'chapter session phase 2: Socratic teaching / discussion' }
    }
    if (sessionScore < 100) {
      return { model: CHAT_MODELS.opus, tier: 'opus', reason: 'chapter session phase 3: capstone problem set generation' }
    }
    return { model: CHAT_MODELS.sonnet, tier: 'sonnet', reason: 'chapter session phase 4: evaluation / grading' }
  }

  // ── Project session: mostly discussion ──────────────────────────────────
  if (projectId) {
    return { model: CHAT_MODELS.sonnet, tier: 'sonnet', reason: 'project session: discussion (artifact generation lives in /api/projects/*)' }
  }

  // ── Free chat: keyword fallback for explicit user requests ──────────────
  for (const pattern of CONTENT_GEN_PATTERNS) {
    if (pattern.test(message)) {
      return { model: CHAT_MODELS.opus, tier: 'opus', reason: `free chat: explicit content request (matched ${pattern.source})` }
    }
  }
  return { model: CHAT_MODELS.sonnet, tier: 'sonnet', reason: 'free chat: default discussion tier' }
}

/** Pick the main response model. */
export function pickMainModel(ctx: ChatRoutingContext): string {
  return route(ctx).model
}

/** Same as pickMainModel but also returns tier and human-readable reason. */
export function explainMainModelChoice(ctx: ChatRoutingContext): { tier: Tier; reason: string; model: string } {
  return route(ctx)
}

/** Model for background sub-tasks — action/insight extraction, verification. */
export function pickBackgroundModel(): string {
  return CHAT_MODELS.haiku
}
