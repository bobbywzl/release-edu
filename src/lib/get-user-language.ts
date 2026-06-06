/**
 * Server-side helper to read a user's language preference (stored in
 * StudentProfile.roadmapState._profileMeta.language) and build the system-prompt
 * directive that makes Claude generate in that language.
 *
 * CRITICAL: the directive must preserve all machine-parsed structure — block
 * fences (```quiz, ```problem, ```progress, ```reflection), tags
 * ([PROFILE_COMPLETE], [CHAPTER_MASTERED]), field NAMES, and enum VALUES
 * (type: project|core, APPROACH: re-explain, GAP_RESOLVED: yes, status, etc.)
 * stay in English exactly as specified. Only human-readable prose is translated.
 */
import prisma from '@/lib/prisma'

export type Language = 'en' | 'zh'

export async function getUserLanguage(userId: string): Promise<Language> {
  try {
    const sp = await prisma.studentProfile.findUnique({
      where: { userId },
      select: { roadmapState: true },
    })
    if (sp?.roadmapState) {
      const meta = JSON.parse(sp.roadmapState as string)?._profileMeta
      if (meta?.language === 'zh') return 'zh'
    }
  } catch { /* default to English */ }
  return 'en'
}

/**
 * Directive appended to a chat/tutoring/onboarding system prompt. Empty for
 * English (no-op). For Chinese, instructs full Chinese prose while preserving
 * all structured output verbatim.
 */
export function languageDirective(lang: Language): string {
  if (lang !== 'zh') return ''
  return `

## LANGUAGE — CRITICAL, OVERRIDES ALL OTHER STYLE INSTRUCTIONS
Respond ENTIRELY in Simplified Chinese (简体中文). All explanations, questions, quiz question text, quiz option text, problem statements, feedback, encouragement, summaries, and conversational prose MUST be in Chinese.

KEEP IN ENGLISH / EXACT FORMAT (do NOT translate these — the system parses them):
- All code fence markers exactly as specified: \`\`\`quiz, \`\`\`problem, \`\`\`progress, \`\`\`reflection, \`\`\`expectations, \`\`\`mermaid, \`\`\`chart, \`\`\`funcplot
- All control tags: [PROFILE_COMPLETE], [CHAPTER_MASTERED], [NEW SESSION - START], [REVIEW SESSION], [RESUME SESSION]
- All field NAMES inside structured blocks: TYPE, QUESTION, OPTIONS, ANSWER, GAP, GAP_DEPTH, GAP_RESOLVED, CONFIDENCE, NEXT_FOCUS, APPROACH, COVERED, OBJECTIVE_1, SCORE, etc.
- All enum field VALUES the system matches on: type: project|core, status: not-started|in-progress|completed, multiple-choice, short-answer, true-false, APPROACH values (re-explain, deepen, new-quiz, scenario-quiz, summary…), yes/no, correct/incorrect/partial, high/medium/low
- Math notation (LaTeX/KaTeX), code, and standard scientific/technical proper nouns. You may gloss a technical term bilingually on first use, e.g. "伊藤引理（Itô's lemma）".

So: the human-readable CONTENT is Chinese; the machine-readable SCAFFOLDING stays English. A quiz block looks like:
\`\`\`quiz
TYPE: multiple-choice
QUESTION: 下列哪一项最能解释……？
OPTIONS: A) ……| B) ……| C) ……| D) ……
ANSWER: B
\`\`\`
`
}

/**
 * Directive for curriculum generation. Course names, chapter titles,
 * descriptions, profileSummary, and aiRationale should be in Chinese, but the
 * JSON keys and enum values ("type": "project"/"core", "status") MUST stay
 * English so the parser and downstream UI work.
 */
export function curriculumLanguageDirective(lang: Language): string {
  if (lang !== 'zh') return ''
  return `

## LANGUAGE — CRITICAL
Generate all human-readable curriculum text in Simplified Chinese (简体中文): course "name", "description", chapter "title", "description", "aiRationale", "profileSummary", "projectIdea", and "skills" entries.
KEEP IN ENGLISH / EXACT: every JSON KEY (name, description, type, modules, title, status, estimatedHours, skills, projectIdea, tracks, etc.) and every enum VALUE — "type" must be exactly "project" or "core", "status" must be exactly "not-started" / "in-progress" / "completed". Do NOT translate these or the JSON will fail to parse. Course/chapter titles should read like a real Chinese university syllabus — specific and academic, e.g. "随机微积分与伊藤过程", not transliterations.
`
}
