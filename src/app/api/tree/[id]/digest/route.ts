export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/tree/[id]/digest { refresh?, lang }
 *
 * The TREE DIGEST — a copy-ready status report of the whole session: key
 * numbers (strictly from real evidence/build-log data), findings, progress
 * made, blockages & open questions, next actions. Cached on the tree;
 * pass refresh=true to regenerate.
 */
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getUserId } from '@/lib/get-user-id'
import { generateTreeDigest } from '@/lib/tree-engine'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const userId = await getUserId()
  const { refresh, lang } = (await req.json().catch(() => ({}))) as { refresh?: boolean; lang?: string }

  const tree = await prisma.problemTree.findFirst({
    where: { id, userId },
    select: { digest: true, digestAt: true },
  }).catch(() => null)
  if (!tree) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (tree.digest && !refresh) {
    return NextResponse.json({ digest: tree.digest, digestAt: tree.digestAt, cached: true })
  }

  try {
    const { digest, digestAt } = await generateTreeDigest(userId, id, lang)
    return NextResponse.json({ digest, digestAt, cached: false })
  } catch (err) {
    console.error('[tree] digest failed:', err)
    return NextResponse.json({ error: 'The digest is unavailable right now.' }, { status: 502 })
  }
}
