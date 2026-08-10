export const dynamic = 'force-dynamic'

/**
 * GET /api/user/mobile — one call powering the mobile app's tabs (/m):
 * tree cards, the Today resume card + plan rows, the weak-spot review queue
 * (stalest verified nodes across ALL trees), and the notes directory.
 * Everything quizState-derived ships as counts only — never the raw state
 * (answer-key protection lives in mastery.ts; this route sidesteps it by
 * not shipping quizState at all).
 */
import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getUserId } from '@/lib/get-user-id'
import { parseQuizState, masteryTarget, masteryFilled } from '@/lib/mastery'

// A verified node is review-DUE when never reviewed, or last reviewed more
// than this many hours ago (keeps today's finished reviews out of the queue).
const REVIEW_COOLDOWN_MS = 16 * 60 * 60 * 1000

export async function GET() {
  const userId = await getUserId()
  const trees = await prisma.problemTree.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    include: { nodes: true },
  }).catch(() => [])

  const now = Date.now()
  type ReviewRow = { treeId: string; treeTitle: string; nodeId: string; nodeTitle: string; language: string | null; staleKey: string }
  const reviewCandidates: ReviewRow[] = []
  type NoteRow = { treeId: string; treeTitle: string; nodeId: string; nodeTitle: string; text: string; updatedAt: Date }
  const notes: NoteRow[] = []
  type ResumeRow = {
    treeId: string; treeTitle: string; nodeId: string; nodeTitle: string; summary: string
    language: string | null; filled: number; target: number; hasExplainer: boolean
    learning: boolean; attempts: number; updatedAt: Date
  }
  const resumeCandidates: ResumeRow[] = []

  const treeCards = trees.map(tree => {
    const treeTitle = (tree.displayTitle?.trim() || tree.title).slice(0, 200)
    const real = tree.nodes.filter(n => !n.pending && n.parentId !== null)
    let reviewDue = 0
    let resumeNodeId: string | null = null
    let resumeNodeTitle: string | null = null
    let resumeBest: ResumeRow | null = null
    for (const n of real) {
      const qs = parseQuizState(n.quizState)
      if (n.status === 'understood') {
        const last = qs.reviewedAt ? Date.parse(qs.reviewedAt) : NaN
        if (Number.isNaN(last) || now - last > REVIEW_COOLDOWN_MS) {
          reviewDue += 1
          reviewCandidates.push({
            treeId: tree.id, treeTitle, nodeId: n.id, nodeTitle: n.title,
            language: tree.language, staleKey: qs.reviewedAt ?? '',
          })
        }
      } else if (tree.status === 'active') {
        const row: ResumeRow = {
          treeId: tree.id, treeTitle, nodeId: n.id, nodeTitle: n.title, summary: n.summary ?? '',
          language: tree.language, filled: masteryFilled(qs), target: masteryTarget(qs),
          hasExplainer: !!(n.explainer && n.explainer.trim()),
          learning: n.status === 'learning', attempts: qs.attempts, updatedAt: n.updatedAt,
        }
        resumeCandidates.push(row)
        const better = (a: ResumeRow | null, b: ResumeRow) => {
          if (!a) return b
          // In-progress beats untouched; then recency.
          const aActive = a.learning || a.attempts > 0
          const bActive = b.learning || b.attempts > 0
          if (aActive !== bActive) return bActive ? b : a
          return b.updatedAt > a.updatedAt ? b : a
        }
        resumeBest = better(resumeBest, row)
      }
      if (n.notes && n.notes.trim()) {
        notes.push({
          treeId: tree.id, treeTitle, nodeId: n.id, nodeTitle: n.title,
          text: n.notes.slice(0, 20000), updatedAt: n.updatedAt,
        })
      }
    }
    if (resumeBest) { resumeNodeId = resumeBest.nodeId; resumeNodeTitle = resumeBest.nodeTitle }
    return {
      id: tree.id,
      title: treeTitle,
      status: tree.status,
      accentColor: tree.accentColor ?? null,
      language: tree.language ?? null,
      nodeCount: real.length,
      understoodCount: real.filter(n => n.status === 'understood').length,
      reviewDue,
      resumeNodeId,
      resumeNodeTitle,
      updatedAt: tree.updatedAt,
    }
  })

  // Global resume pick: same preference order as per-tree, across all trees.
  const resume = resumeCandidates.reduce<ResumeRow | null>((best, row) => {
    if (!best) return row
    const bestActive = best.learning || best.attempts > 0
    const rowActive = row.learning || row.attempts > 0
    if (bestActive !== rowActive) return rowActive ? row : best
    return row.updatedAt > best.updatedAt ? row : best
  }, null)

  // Stalest first: never-reviewed ('' sorts before any ISO stamp), then oldest.
  const reviewQueue = reviewCandidates
    .sort((a, b) => a.staleKey.localeCompare(b.staleKey))
    .slice(0, 3)
    .map(({ staleKey: _s, ...r }) => r)

  notes.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())

  const activeTrees = treeCards.filter(t => t.status === 'active')
  return NextResponse.json({
    trees: treeCards.filter(t => t.status !== 'archived'),
    stats: {
      active: activeTrees.length,
      mastered: treeCards.filter(t => t.status === 'completed').length,
      totalNodes: treeCards.reduce((s, t) => s + t.nodeCount, 0),
      understoodNodes: treeCards.reduce((s, t) => s + t.understoodCount, 0),
    },
    resume: resume ? {
      treeId: resume.treeId, treeTitle: resume.treeTitle, nodeId: resume.nodeId,
      nodeTitle: resume.nodeTitle, summary: resume.summary.slice(0, 300), language: resume.language,
      filled: resume.filled, target: resume.target, hasExplainer: resume.hasExplainer,
    } : null,
    reviewQueue,
    notes: notes.slice(0, 100),
  })
}
