export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/tree/[id]/node/[nodeId]/verify
 *   { phase: 'start', lang }
 *     → { questions: [q1, q2] }  (Differentiator-style transfer probes)
 *   { phase: 'judge', questions, answers, lang }
 *     → { passed, scores, feedback }  (pass flips the node to 'understood' + XP)
 *
 * Mastery in the Tree product is AI-verified only — no self-marking.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '@/lib/get-user-id'
import { generateVerification, judgeVerification } from '@/lib/tree-engine'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; nodeId: string }> }) {
  const { id, nodeId } = await params
  const userId = await getUserId()
  const body = (await req.json().catch(() => ({}))) as {
    phase?: string; questions?: string[]; answers?: string[]; lang?: string
    confidences?: Array<'sure' | 'unsure'>
  }

  try {
    if (body.phase === 'start') {
      const q = await generateVerification(userId, id, nodeId, body.lang)
      return NextResponse.json(q)
    }
    if (body.phase === 'judge') {
      if (!Array.isArray(body.questions) || !Array.isArray(body.answers) || body.questions.length === 0) {
        return NextResponse.json({ error: 'questions and answers required' }, { status: 400 })
      }
      const judgement = await judgeVerification(userId, id, nodeId, body.questions, body.answers, body.lang, body.confidences)
      return NextResponse.json(judgement)
    }
    return NextResponse.json({ error: 'Unknown phase' }, { status: 400 })
  } catch (err) {
    console.error('[tree] verify failed:', err)
    return NextResponse.json({ error: 'Verification is unavailable right now.' }, { status: 502 })
  }
}
