/**
 * Systematic title normalization for curriculum content (subject names,
 * chapter titles, project ideas). Applied at the save boundary so EVERY
 * curriculum — default templates, Claude-generated, future sources —
 * shares the same professional naming standard.
 *
 * Rules:
 *   1. Title Case: capitalize every meaningful word; small grammatical
 *      words ("of", "and", "in", ...) stay lowercase mid-phrase.
 *   2. First and last word are always capitalized.
 *   3. Acronyms (all-caps tokens of 2+ chars) are preserved as-is.
 *   4. Chapter titles do not echo their parent subject name verbatim — if
 *      they do, the subject portion is stripped and the title is rebuilt.
 *   5. Redundant introductory suffixes ("Fundamentals Foundations") are
 *      collapsed.
 */

const SMALL_WORDS = new Set([
  'a', 'an', 'the',
  'and', 'but', 'or', 'nor', 'so', 'yet',
  'as', 'at', 'by', 'for', 'in', 'of', 'off', 'on', 'per', 'to', 'up', 'via',
  'vs', '&',
])

/** True if a token looks like an acronym (≥2 uppercase letters, no lowercase). */
function isAcronym(token: string): boolean {
  return /^[A-Z0-9]{2,}$/.test(token)
}

/** Apply Title Case to a single word, respecting acronyms. */
function titleCaseWord(word: string, isFirstOrLast: boolean): string {
  if (!word) return word
  if (isAcronym(word)) return word
  const lower = word.toLowerCase()
  if (!isFirstOrLast && SMALL_WORDS.has(lower)) return lower
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
}

/**
 * Convert any string to professional Title Case.
 * Preserves whitespace runs and existing acronyms.
 */
export function toTitleCase(input: string): string {
  if (!input) return input
  // Split on word boundaries while keeping separators so we can rebuild exactly.
  const tokens = input.trim().split(/(\s+|[—–-])/)
  // Identify which indices are "words" (not whitespace/punct) so we know first/last.
  const wordIndices: number[] = []
  tokens.forEach((t, i) => { if (/\S/.test(t) && !/^[—–-]$/.test(t)) wordIndices.push(i) })
  const firstIdx = wordIndices[0]
  const lastIdx = wordIndices[wordIndices.length - 1]
  return tokens.map((token, i) => {
    if (!/\S/.test(token)) return token
    if (/^[—–-]$/.test(token)) return token
    return titleCaseWord(token, i === firstIdx || i === lastIdx)
  }).join('')
}

/**
 * Collapse redundant suffixes that arise when an interest already contains
 * an introductory word and a template appends another. Example:
 *   "Game Programming Fundamentals Foundations" → "Game Programming Fundamentals"
 */
export function collapseRedundantSuffix(input: string): string {
  return input.replace(
    /\b(fundamentals|foundations|basics|essentials|intro|introduction)(?:\s+\1\b)+/gi,
    '$1',
  ).replace(
    /\b(fundamentals)\s+(foundations)\b/gi, '$1',
  ).replace(
    /\b(foundations)\s+(fundamentals)\b/gi, '$1',
  ).replace(
    /\b(intro|introduction)\s+(fundamentals|foundations|basics|essentials)\b/gi, '$2',
  ).replace(
    /\b(fundamentals|foundations|basics|essentials)\s+(intro|introduction)\b/gi, '$1',
  ).trim()
}

/**
 * Normalize a chapter title against its parent subject. If the chapter title
 * verbatim contains the subject name (case-insensitive), strip it and clean
 * up grammatical artifacts. The subject header already conveys the topic, so
 * "Introduction to Game Programming" inside the "Game Programming" subject
 * becomes simply "Introduction" — which reads like a real syllabus.
 */
export function normalizeChapterTitle(rawTitle: string, parentSubject: string): string {
  if (!rawTitle) return rawTitle
  const subject = (parentSubject || '').trim()
  let working = rawTitle.trim()

  if (subject) {
    // Try to remove "[connector] [subject]" patterns first so we don't leave
    // dangling prepositions ("Introduction to") behind.
    const escaped = subject.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const patterns = [
      new RegExp(`\\b(in|to|for|of|on|with|using|about|into)\\s+${escaped}\\b`, 'gi'),
      new RegExp(`\\b${escaped}\\b`, 'gi'),
    ]
    for (const pat of patterns) {
      working = working.replace(pat, '').trim()
    }
    // Clean leftover punctuation/whitespace.
    working = working
      .replace(/\s+/g, ' ')
      .replace(/^[\s:—–-]+|[\s:—–-]+$/g, '')
      .replace(/\s+([,.:;])/g, '$1')
      .trim()
  }

  // If we stripped the title down to nothing meaningful, fall back.
  if (!working || working.length < 3) working = rawTitle.trim()

  working = collapseRedundantSuffix(working)
  return toTitleCase(working)
}

/** Normalize a subject/track name. */
export function normalizeSubjectName(rawName: string): string {
  if (!rawName) return rawName
  return toTitleCase(collapseRedundantSuffix(rawName.trim()))
}

/**
 * Normalize an entire curriculum tracks array in one pass. Every track name,
 * every chapter title, every chapter `subject` field, and projectIdea text
 * runs through the same normalizer. Apply this at the save boundary.
 */
export interface NormalizableTrack {
  name: string
  description?: string
  color?: string
  type?: string
  projectIdea?: string
  modules?: Array<{
    title: string
    description?: string
    type?: string
    subject?: string
    status?: string
    estimatedHours?: number
    skills?: string[]
    aiRationale?: string
    [k: string]: unknown
  }>
  [k: string]: unknown
}

export function normalizeCurriculumTracks<T extends NormalizableTrack>(tracks: T[]): T[] {
  return tracks.map(t => {
    const normalizedName = normalizeSubjectName(t.name)
    // projectIdea is a sentence ("Build: A working X system"), not a title.
    // Don't Title Case it — that would look weird. Just collapse redundant
    // suffixes if any.
    const normalizedProjectIdea = t.projectIdea
      ? collapseRedundantSuffix(t.projectIdea)
      : t.projectIdea
    const normalizedModules = (t.modules ?? []).map(m => ({
      ...m,
      title: normalizeChapterTitle(m.title, normalizedName),
      subject: m.subject ? normalizeSubjectName(m.subject) : m.subject,
    }))
    return {
      ...t,
      name: normalizedName,
      projectIdea: normalizedProjectIdea,
      modules: normalizedModules,
    }
  })
}
