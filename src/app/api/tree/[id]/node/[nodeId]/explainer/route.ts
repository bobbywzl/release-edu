export const dynamic = 'force-dynamic'
export const maxDuration = 90

/**
 * POST /api/tree/[id]/node/[nodeId]/explainer { lang }
 * Generate (or return the cached) comprehensive pain-point explainer for a
 * node. Generated once by Opus, cached on the node forever.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '@/lib/get-user-id'
import { generateExplainer } from '@/lib/tree-engine'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; nodeId: string }> }) {
  const { id, nodeId } = await params
  const userId = await getUserId()
  const { lang } = (await req.json().catch(() => ({}))) as { lang?: string }
  // The root has no workspace (law) — nothing to explain there.
  try {
    const prisma = (await import('@/lib/prisma')).default
    const n = await prisma.treeNode.findUnique({ where: { id: nodeId }, select: { parentId: true } })
    if (n && n.parentId === null) {
      return NextResponse.json({ error: 'The root node has no workspace.' }, { status: 400 })
    }
  } catch { /* fall through — generateExplainer scopes by user anyway */ }
  try {
    const explainer = await generateExplainer(userId, id, nodeId, lang)
    if (!explainer) throw new Error('empty explainer')
    return NextResponse.json({ explainer })
  } catch (err) {
    console.error('[tree] explainer failed:', err)
    return NextResponse.json({ error: 'Could not generate the explainer right now.' }, { status: 502 })
  }
}
