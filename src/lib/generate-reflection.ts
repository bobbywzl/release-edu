/**
 * Server-side reflection generator.
 *
 * Replaces the inline `reflection` block Bob used to emit at the end of every
 * chapter-session response. Two reasons it lives separately now:
 *   1. Cost — reflection is structured classification (GAP / CONFIDENCE /
 *      APPROACH / etc.), perfectly fine on Sonnet. When Bob's main response
 *      was on Opus (syllabus / capstone / quiz-emission turns), the inline
 *      reflection was also generated on Opus — pure waste.
 *   2. Determinism — pulling reflection into its own call with a tightly
 *      scoped prompt makes the output structure more reliable than asking
 *      Bob to also output it amongst a large teaching response.
 *
 * Output format mirrors the OLD inline block exactly so the existing client
 * parser (parseReflectionBlock in src/app/dashboard/chat/page.tsx) keeps
 * working without modification.
 */

import Anthropic from '@anthropic-ai/sdk'
import { CHAT_MODELS } from '@/lib/chat-model-router'

export interface ReflectionInputs {
  studentMessage: string
  bobResponse: string
  /** Chapter title — gives the model the subject context for GAP. */
  chapterTitle?: string
  /** All learning objectives for this chapter, comma-separated. */
  objectives?: string
  /** Previously-understood objectives, comma-separated. */
  understood?: string
  /** Most recent prior reflection (if any) — used to track persistent gaps. */
  priorReflection?: {
    gap?: string
    stuckOn?: string
    covered?: string
    personalThread?: string
    streakCorrect?: string
    streakWrong?: string
    currentDifficulty?: string
  } | null
}

const REFLECTION_PROMPT = (i: ReflectionInputs) => `You are a teaching-assistant analytics agent. Read the most recent exchange between a student and their AI tutor (Bob) and emit a single reflection block in the exact format below. The block is consumed by automated systems — do not add commentary, headers, or any text outside the fenced block.

CHAPTER: ${i.chapterTitle ?? '(unknown)'}
OBJECTIVES: ${i.objectives ?? '(none listed)'}
ALREADY UNDERSTOOD: ${i.understood ?? 'none yet'}
${i.priorReflection ? `PRIOR REFLECTION:
  - last gap: ${i.priorReflection.gap || 'none'}
  - persistent stuck-on: ${i.priorReflection.stuckOn || 'none'}
  - covered so far: ${i.priorReflection.covered || 'none yet'}
  - personal thread: ${i.priorReflection.personalThread || 'none'}
  - streak correct: ${i.priorReflection.streakCorrect || '0'}
  - streak wrong: ${i.priorReflection.streakWrong || '0'}
  - current difficulty: ${i.priorReflection.currentDifficulty || '2'}` : 'PRIOR REFLECTION: (first exchange — start at difficulty 2)'}

STUDENT SAID:
${i.studentMessage}

BOB RESPONDED:
${i.bobResponse}

Now emit ONE reflection block in this EXACT format (no other text):

\`\`\`reflection
GAP: [specific concept/sub-concept the student is missing — precise, e.g. "does not distinguish between X and Y". Write "none" only if genuinely solid.]
GAP_DEPTH: [surface | partial | deep]
GAP_RESOLVED: [yes | no — "yes" only if (1) correct answer, (2) high confidence, (3) no contradictory signals. Default "no".]
CONFIDENCE: [high | medium | low]
LAST_QUIZ_SCORE: [correct | incorrect | partial | n/a — n/a if no quiz was answered this turn]
NEXT_FOCUS: [exact concept to address next, drawn from OBJECTIVES. If GAP_RESOLVED=no, must equal the current GAP.]
APPROACH: [re-explain | deepen | hypothetical | personal-connection | new-quiz | scenario-quiz | summary. If GAP_RESOLVED=no, must be one of: re-explain, deepen, hypothetical, personal-connection.]
HOOK_CONTEXT: [what the student said earlier that can personalise future examples, or "none"]
EXPLAINED_THIS_TURN: [comma-separated concepts/sub-concepts that Bob WALKED THROUGH (defined, illustrated, or worked an example for) in BOB RESPONDED this turn — NOT what he merely mentioned in passing. Be precise: "geosmin as marker of actinobacteria" not "soil microbes". Write "none" if Bob did not explain a concept this turn.]
COVERED: [comma-separated cumulative list of concepts Bob has actually TAUGHT across this conversation so far (carry forward prior-reflection COVERED + add EXPLAINED_THIS_TURN). This is the AUTHORITATIVE quiz-eligible set — Bob may only quiz on items appearing here.]
STUCK_ON: [comma-separated concepts the student has repeatedly struggled with]
QUIZ_BALANCE: [theoretical:N scenario:N — running counts of quiz types issued so far]
QUIZ_COMPLIANCE: [ok | violation — set to "violation" if BOB RESPONDED contains a quiz whose subject is NOT in COVERED above (i.e. Bob is testing something he has not yet explained in this conversation). Set "ok" if no quiz this turn or the quiz is on a covered concept.]
QUIZ_VIOLATION_DETAIL: [if QUIZ_COMPLIANCE=violation, the exact concept name the quiz tested that was never taught, plus a one-line correction directive for Bob's next turn (e.g. "teach what geosmin is before quizzing on it"). "none" otherwise.]
STREAK_CORRECT: [integer — consecutive correct answers ending with this turn. Rules: if LAST_QUIZ_SCORE=correct, prior+1. If incorrect or partial, reset to 0. If n/a, carry prior forward.]
STREAK_WRONG: [integer — consecutive wrong/partial answers ending with this turn. Rules: if LAST_QUIZ_SCORE=incorrect, prior+1. If partial, prior+1 (partial counts as a struggle signal). If correct, reset to 0. If n/a, carry prior forward.]
CURRENT_DIFFICULTY: [1–5 — the difficulty level of the quiz that was just answered (or the prior level if no quiz this turn). 1=recall (name/define), 2=comprehension (explain in own words), 3=application (apply in familiar context), 4=analysis (new scenario, distinguish similars), 5=synthesis (edge cases, design, critique). Carry prior forward if no quiz this turn.]
NEXT_DIFFICULTY: [1–5 — recommended difficulty for Bob's NEXT quiz. Calibration rules — apply STRICTLY:
  * STREAK_WRONG = 1 → max(1, CURRENT-1). Drop one level. Next question should give more scaffolding, fewer steps, more obvious distractors.
  * STREAK_WRONG ≥ 2 → max(1, CURRENT-2). Drop two levels. Next question should be near-trivial recall — almost gives the answer in the prompt, only checks the single core idea.
  * STREAK_CORRECT = 1 → CURRENT (hold steady). One correct isn't enough to ramp.
  * STREAK_CORRECT ≥ 2 → min(5, CURRENT+1). Step up one level. Add a scenario twist or require connecting two ideas.
  * STREAK_CORRECT ≥ 3 → min(5, CURRENT+1) AND favor APPROACH=scenario-quiz. Push toward applied/edge-case territory.
  * LAST_QUIZ_SCORE=partial → max(1, CURRENT-1). Treat partial like a soft wrong — ease one level.
  * LAST_QUIZ_SCORE=n/a (no quiz this turn) → carry CURRENT forward as NEXT_DIFFICULTY.
  * Floor at 1, ceiling at 5, never skip more than 2 levels in one step.]
PERSONAL_THREAD: [a personal interest/example the student has mentioned, or "none"]
\`\`\``

/**
 * Generate a reflection block on Sonnet. Returns the markdown-fenced block
 * (including the surrounding ```reflection ... ``` fence) ready to append to
 * Bob's response. Returns null on failure — caller should treat that as
 * "skip reflection this turn" and continue.
 */
export async function generateReflectionBlock(
  apiKey: string,
  inputs: ReflectionInputs,
): Promise<string | null> {
  try {
    const client = new Anthropic({ apiKey })
    const result = await client.messages.create({
      // Haiku — pure structured classification. The reflection schema is
      // tight (single fenced block, well-defined fields), so the model just
      // needs to read the exchange and emit categorical metadata. No
      // long-form reasoning required; Sonnet/Opus would be overkill.
      model: CHAT_MODELS.haiku,
      max_tokens: 600,
      messages: [{ role: 'user', content: REFLECTION_PROMPT(inputs) }],
    })
    const { recordAnthropicUsage } = await import('@/lib/usage')
    recordAnthropicUsage(result.usage, { model: CHAT_MODELS.haiku, feature: 'reflection' })
    const text = (result.content[0] as { type: string; text?: string })?.text?.trim() ?? ''
    // Pull just the fenced block out — the model occasionally adds a stray
    // newline or wrapper despite the instructions.
    const match = text.match(/```reflection\n[\s\S]*?```/)
    return match ? match[0] : null
  } catch (err) {
    console.error('[reflection] generation failed:', err)
    return null
  }
}
