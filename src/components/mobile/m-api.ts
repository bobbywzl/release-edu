'use client'
/**
 * Mobile app client contracts: the /api/user/mobile payload types plus the
 * node-chat STREAM parser (same marker contract the workspace uses:
 * [[QUIZ]]{sanitized} / [[TREE_SUGGEST]] / [[XP]] / [[INCOMPLETE]] / [[DONE]])
 * and the checkpoint submit helper (409 = card consumed elsewhere).
 */
import type { BadgeEvent } from '@/components/xp-toast'

export interface MTree {
  id: string; title: string; status: string; accentColor: string | null
  language: string | null; nodeCount: number; understoodCount: number
  reviewDue: number; resumeNodeId: string | null; resumeNodeTitle: string | null
}
export interface MResume {
  treeId: string; treeTitle: string; nodeId: string; nodeTitle: string
  summary: string; language: string | null; filled: number; target: number; hasExplainer: boolean
}
export interface MReviewItem { treeId: string; treeTitle: string; nodeId: string; nodeTitle: string; language: string | null }
export interface MNote { treeId: string; treeTitle: string; nodeId: string; nodeTitle: string; text: string; updatedAt: string }
export interface MobileData {
  trees: MTree[]
  stats: { active: number; mastered: number; totalNodes: number; understoodNodes: number }
  resume: MResume | null
  reviewQueue: MReviewItem[]
  notes: MNote[]
}

export interface XpSummary {
  xpToday: number; dailyGoal: number; streak: number; activeToday: boolean
  xp: number; level: number
}

export interface MQuiz { kind: 'mcq' | 'short' | 'artifact'; question: string; options?: string[]; hint?: string; facet?: string }
export interface MXpAward { awarded: number; label: string; levelUp: boolean; newLevel: number; source?: string }
export interface MChatMsg { id: string; role: string; content: string; createdAt?: string }

export interface QuizVerdict {
  correct: boolean; correctIndex?: number; feedback: string; xp: MXpAward[]
  verified: boolean; alreadyVerified: boolean; review: boolean
  mastery: { correct: number; target: number }
  newBadges?: BadgeEvent[]
  stale?: boolean; error?: string
}

export const sumXp = (xp: MXpAward[] | undefined | null) => (xp ?? []).reduce((s, a) => s + (a.awarded || 0), 0)

const CONTENT_MARKS = ['[[QUIZ]]', '[[TREE_SUGGEST]]', '[[XP]]', '[[SYLLABUS]]']
function cutAt(s: string, marks: string[]): number {
  let at = -1
  for (const m of marks) {
    const i = s.indexOf(m)
    if (i !== -1 && (at === -1 || i < at)) at = i
  }
  return at
}

/** Prose safe to show — machine markers and their JSON stripped. */
export function visibleProse(full: string): string {
  let v = full
  const cut = cutAt(v, CONTENT_MARKS)
  if (cut !== -1) v = v.slice(0, cut)
  return v
    .replace(/\n*\[\[(DONE|INCOMPLETE|QUIZ_OFFER)\]\]/g, '')
    .replace(/\n*\[\[NEXT_NODE\]\]\{[^}]*\}?/g, '')
}

function parseMarkerJson<T>(full: string, mark: string): T | null {
  const idx = full.indexOf(mark)
  if (idx === -1) return null
  const rest = full.slice(idx + mark.length)
  const end = cutAt(rest, ['[[QUIZ]]', '[[TREE_SUGGEST]]', '[[XP]]', '[[SYLLABUS]]', '[[DONE]]', '[[INCOMPLETE]]'])
  const raw = (end === -1 ? rest : rest.slice(0, end)).trim()
  try { return JSON.parse(raw) as T } catch { return null }
}

export interface StreamResult {
  prose: string
  quiz: MQuiz | null
  xp: MXpAward[]
  cutOff: boolean
  budgetNote: string | null
  failed: boolean
}

/**
 * Run one node-chat turn (a student message or a control trigger like
 * [NODE_REVIEW]) and stream the visible prose through onText.
 */
export async function streamNodeChat(opts: {
  treeId: string; nodeId: string; message: string; lang?: string | null
  onText?: (visible: string) => void
  signal?: AbortSignal
}): Promise<StreamResult> {
  const empty: StreamResult = { prose: '', quiz: null, xp: [], cutOff: false, budgetNote: null, failed: false }
  try {
    const res = await fetch(`/api/tree/${opts.treeId}/node/${opts.nodeId}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: opts.message, ...(opts.lang ? { lang: opts.lang } : {}) }),
      signal: opts.signal,
    })
    if (res.status === 429) {
      return { ...empty, budgetNote: (await res.text().catch(() => '')) || null, failed: true }
    }
    if (!res.ok || !res.body) return { ...empty, failed: true }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let full = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      full += decoder.decode(value, { stream: true })
      opts.onText?.(visibleProse(full))
    }
    const sawDone = full.includes('[[DONE]]')
    const sawIncomplete = full.includes('[[INCOMPLETE]]')
    return {
      prose: visibleProse(full).trim(),
      quiz: parseMarkerJson<MQuiz>(full, '[[QUIZ]]'),
      xp: parseMarkerJson<MXpAward[]>(full, '[[XP]]') ?? [],
      cutOff: sawIncomplete || !sawDone,
      budgetNote: null,
      failed: false,
    }
  } catch {
    return { ...empty, failed: true }
  }
}

/** Judge a checkpoint answer against the server-stored card. */
export async function submitQuizAnswer(opts: {
  treeId: string; nodeId: string; quiz: MQuiz
  answer: string | number; confidence?: 'sure' | 'unsure' | null; lang?: string | null
}): Promise<QuizVerdict | null> {
  try {
    const res = await fetch(`/api/tree/${opts.treeId}/node/${opts.nodeId}/quiz`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quiz: { question: opts.quiz.question },
        answer: opts.answer,
        ...(opts.confidence ? { confidence: opts.confidence } : {}),
        ...(opts.lang ? { lang: opts.lang } : {}),
      }),
    })
    if (res.status === 409) return { stale: true } as QuizVerdict
    const data = await res.json().catch(() => null)
    if (!res.ok) return { error: (data?.error as string) || 'failed' } as QuizVerdict
    return data as QuizVerdict
  } catch {
    return null
  }
}

export async function fetchMobileData(): Promise<MobileData | null> {
  try {
    const r = await fetch('/api/user/mobile', { cache: 'no-store' })
    return r.ok ? await r.json() : null
  } catch { return null }
}

export async function fetchXpSummary(): Promise<XpSummary | null> {
  try {
    const r = await fetch('/api/xp/summary', { cache: 'no-store' })
    return r.ok ? await r.json() : null
  } catch { return null }
}

export interface NodeChatData { conversationId: string | null; pending: MQuiz | null; messages: MChatMsg[] }
export async function fetchNodeChat(treeId: string, nodeId: string): Promise<NodeChatData | null> {
  try {
    const r = await fetch(`/api/tree/${treeId}/node/${nodeId}/chat`, { cache: 'no-store' })
    return r.ok ? await r.json() : null
  } catch { return null }
}

export async function fetchExplainer(treeId: string, nodeId: string, lang?: string | null): Promise<string | null> {
  try {
    const r = await fetch(`/api/tree/${treeId}/node/${nodeId}/explainer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(lang ? { lang } : {}),
    })
    const d = await r.json().catch(() => null)
    return r.ok ? ((d?.explainer as string) ?? null) : null
  } catch { return null }
}

export async function saveNodeNotes(treeId: string, nodeId: string, text: string): Promise<boolean> {
  try {
    const r = await fetch(`/api/tree/${treeId}/node/${nodeId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'notes', text }),
    })
    return r.ok
  } catch { return false }
}
