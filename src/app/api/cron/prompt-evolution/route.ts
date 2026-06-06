export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

/**
 * Weekly cron: analyze thumbs-down feedback + failed sessions, propose prompt improvements.
 * Triggered by Vercel Cron or an external scheduler.
 * Protected by CRON_SECRET env var.
 */
export async function POST(req: NextRequest) {
  // Verify cron secret (set CRON_SECRET in .env)
  const auth = req.headers.get('authorization')
  const secret = process.env.CRON_SECRET
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'No API key' }, { status: 500 })

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // last 7 days

  // Gather negative feedback
  const negativeFeedback = await prisma.messageFeedback.findMany({
    where: { rating: -1, createdAt: { gte: since } },
    include: { user: { select: { id: true } } },
    take: 100,
  })

  // Gather failed/abandoned sessions
  const failedSessions = await prisma.sessionOutcome.findMany({
    where: {
      createdAt: { gte: since },
      OR: [{ passed: false }, { dropOff: true }],
    },
    take: 100,
  })

  // Anti-sparse guard
  if (negativeFeedback.length < 5 && failedSessions.length < 3) {
    return NextResponse.json({
      skipped: true,
      reason: `Insufficient data: ${negativeFeedback.length} negative feedback, ${failedSessions.length} failed sessions. Minimum: 5 feedback or 3 sessions.`,
    })
  }

  // Build analysis prompt
  const feedbackBlock = negativeFeedback.slice(0, 30).map((f, i) =>
    `${i + 1}. [${f.mode || 'tutoring'}] messageId: ${f.messageId}`
  ).join('\n')

  const sessionsBlock = failedSessions.slice(0, 20).map((s, i) =>
    `${i + 1}. Subject: ${s.subjectArea} | Score: ${s.endScore}% | Drop-off: ${s.dropOff} | Messages: ${s.messageCount}`
  ).join('\n')

  const analysisPrompt = `You are analyzing teaching feedback to improve an AI tutor's system prompt.

NEGATIVE FEEDBACK (${negativeFeedback.length} thumbs-down in last 7 days):
${feedbackBlock}

FAILED/ABANDONED SESSIONS (${failedSessions.length} in last 7 days):
${sessionsBlock}

Identify patterns in what's not working. Be conservative and specific.

Rules:
- Only flag patterns appearing in 3+ examples
- Never suggest removing Socratic method or core lesson structure
- Propose additions/clarifications only — not rewrites
- Keep proposals tight and actionable

Output valid JSON only:
{
  "patterns": ["pattern description 1", "pattern description 2"],
  "proposed_changes": [
    {
      "section": "which section of system prompt to modify",
      "rationale": "why, citing N examples",
      "proposed_addition": "exact text to add",
      "sampleSize": 4
    }
  ]
}`

  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const client = new Anthropic({ apiKey })

    const result = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 1024,
      messages: [{ role: 'user', content: analysisPrompt }],
    })

    const text = (result.content[0] as { text: string }).text?.trim() || ''
    let parsed: { patterns: string[]; proposed_changes: { section: string; rationale: string; proposed_addition: string; sampleSize: number }[] }
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      parsed = JSON.parse(jsonMatch?.[0] || '{}')
    } catch {
      return NextResponse.json({ error: 'Failed to parse Opus response', raw: text }, { status: 500 })
    }

    if (!parsed.patterns?.length && !parsed.proposed_changes?.length) {
      return NextResponse.json({ skipped: true, reason: 'No patterns identified by analysis' })
    }

    // Store as pending proposal — admin must approve before anything changes
    const proposal = await prisma.promptEvolutionProposal.create({
      data: {
        analysisSource: 'weekly-cron',
        patternsFound: JSON.stringify(parsed.patterns || []),
        proposedChanges: JSON.stringify(parsed.proposed_changes || []),
        basedOnSessions: failedSessions.length,
        basedOnFeedback: negativeFeedback.length,
        status: 'pending',
      },
    })

    return NextResponse.json({
      success: true,
      proposalId: proposal.id,
      patternsFound: parsed.patterns?.length || 0,
      changesProposed: parsed.proposed_changes?.length || 0,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
