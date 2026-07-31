import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getUserId } from '@/lib/get-user-id'

export const dynamic = 'force-dynamic'

export async function GET() {
  const userId = await getUserId()
  const cache = await prisma.portfolioCache.findUnique({ where: { userId } })

  if (!cache) {
    return NextResponse.json({ status: 'none' })
  }

  // If generation started more than 5 minutes ago, consider it stale/timed out
  if (cache.status === 'generating' && cache.startedAt) {
    const age = Date.now() - cache.startedAt.getTime()
    if (age > 5 * 60 * 1000) {
      await prisma.portfolioCache.update({
        where: { userId },
        data: { status: 'error', errorMessage: 'Generation timed out' },
      })
      return NextResponse.json({ status: 'error', error: 'Generation timed out' })
    }
    return NextResponse.json({ status: 'generating', startedAt: cache.startedAt })
  }

  if (cache.status === 'error') {
    return NextResponse.json({ status: 'error', error: cache.errorMessage })
  }

  // Ready
  try {
    const portfolio = JSON.parse(cache.data)
    // Portfolios generated before the Tree pivot carry legacy Release EDU
    // data. Treat them as absent so a fresh, session-only portfolio must be
    // generated — old product data must never surface here.
    if ((portfolio?.version ?? 0) < 2) {
      return NextResponse.json({ status: 'none' })
    }
    // STALENESS: the portfolio is a cached AI artifact, so it silently drifts
    // from reality as the learner keeps working — and it is the document they
    // show other people. Compare the live counts against what the cache was
    // built from; the client shows "last generated" + a refresh prompt when
    // they disagree.
    let stale = false
    let live: { verifiedNodes: number; trees: number; files: number } | null = null
    try {
      const [verifiedNodes, treeCount, files] = await Promise.all([
        prisma.treeNode.count({ where: { tree: { userId }, pending: false, parentId: { not: null }, status: 'understood' } }),
        prisma.problemTree.count({ where: { userId } }),
        prisma.linkedFile.count({ where: { userId, workType: { in: ['tree-node', 'tree'] } } }),
      ])
      live = { verifiedNodes, trees: treeCount, files }
      const snap = portfolio?.snapshot as { verifiedNodes?: number; trees?: number; files?: number } | undefined
      stale = !snap
        || snap.verifiedNodes !== verifiedNodes
        || snap.trees !== treeCount
        || snap.files !== files
    } catch { /* non-critical — treat as fresh rather than nag wrongly */ }
    return NextResponse.json({ status: 'ready', portfolio, generatedAt: cache.generatedAt, stale, live })
  } catch {
    return NextResponse.json({ status: 'error', error: 'Stored portfolio is corrupted' })
  }
}
