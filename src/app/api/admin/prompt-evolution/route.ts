export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'

async function isAdmin(): Promise<boolean> {
  const cookieStore = await cookies()
  return cookieStore.get('admin-auth')?.value === 'true'
}

// GET → returns all PromptEvolutionProposals ordered by createdAt desc
export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const proposals = await prisma.promptEvolutionProposal.findMany({
    orderBy: { createdAt: 'desc' },
  })

  const pendingExamples = await prisma.trainingExample.count({
    where: { approved: false },
  })

  return NextResponse.json({ proposals, pendingExamples })
}

// POST { action: 'trigger-analysis' } → runs analysis
export async function POST(req: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  if (body.action !== 'trigger-analysis') {
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'No API key configured' }, { status: 500 })
  }

  // Fetch last 30 days of negative feedback
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  const negativeFeedback = await prisma.messageFeedback.findMany({
    where: {
      rating: -1,
      createdAt: { gte: thirtyDaysAgo },
    },
    include: {
      user: { select: { id: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  // Get message content for negative feedback
  const messageIds = negativeFeedback.map(f => f.messageId)
  const messages = await prisma.message.findMany({
    where: { id: { in: messageIds } },
    select: { id: true, content: true },
  })
  const messageContentMap = new Map(messages.map(m => [m.id, m.content]))

  const negativeExamples = negativeFeedback.map(f => ({
    ...f,
    messageContent: messageContentMap.get(f.messageId) || null,
  }))

  // Fetch failed/abandoned sessions
  const failedSessions = await prisma.sessionOutcome.findMany({
    where: {
      createdAt: { gte: thirtyDaysAgo },
      OR: [
        { passed: false },
        { dropOff: true },
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  const negativeCount = negativeExamples.length
  const failedCount = failedSessions.length

  // Anti-sparse-data guard
  if (negativeCount < 5 && failedCount < 3) {
    return NextResponse.json({
      error: 'Insufficient data',
      message: `Need at least 5 negative feedback entries (have ${negativeCount}) or 3 failed sessions (have ${failedCount}) to run analysis.`,
    }, { status: 422 })
  }

  // Call Claude Opus for analysis
  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const client = new Anthropic({ apiKey })

  const analysisPrompt = `You are analyzing teaching feedback to improve an AI tutor's system prompt.

NEGATIVE FEEDBACK PATTERNS (${negativeCount} thumbs-down responses):
${negativeExamples.map(f => `- "${(f.messageContent || 'no content')?.slice(0, 200)}"`).join('\n')}

FAILED/ABANDONED SESSIONS (${failedCount}):
${failedSessions.map(s => `- Subject: ${s.subjectArea}, Score: ${s.endScore}%, Drop-off: ${s.dropOff}`).join('\n')}

Identify at most 3 specific, actionable patterns. Be conservative — only flag patterns that appear in 3+ examples. Do NOT over-generalize from small samples.

Output JSON only:
{
  "patterns": ["pattern 1", "pattern 2"],
  "proposed_changes": [
    {
      "section": "which section of the system prompt",
      "rationale": "why this change based on N examples",
      "proposed_addition": "exact text to add",
      "sampleSize": 5
    }
  ]
}

Rules: Never propose changes based on fewer than 3 examples. Never suggest removing core Socratic method. Only propose additions/clarifications, not rewrites.`

  try {
    const result = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 1500,
      messages: [{ role: 'user', content: analysisPrompt }],
    })

    {
      const { recordAnthropicUsage } = await import('@/lib/usage')
      recordAnthropicUsage(result.usage, { model: 'claude-opus-4-8', feature: 'other' })
    }
    const text = (result.content[0] as { type: string; text?: string })?.text?.trim() ?? '{}'
    let parsed: { patterns?: string[]; proposed_changes?: Array<{ section: string; rationale: string; proposed_addition: string; sampleSize: number }> }
    try {
      const match = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, text]
      parsed = JSON.parse(match[1] || text)
    } catch {
      parsed = { patterns: ['Analysis parsing failed'], proposed_changes: [] }
    }

    const proposal = await prisma.promptEvolutionProposal.create({
      data: {
        status: 'pending',
        analysisSource: 'manual',
        patternsFound: JSON.stringify(parsed.patterns || []),
        proposedChanges: JSON.stringify(parsed.proposed_changes || []),
        basedOnSessions: failedCount,
        basedOnFeedback: negativeCount,
      },
    })

    return NextResponse.json({ proposal })
  } catch (err) {
    console.error('[PromptEvolution] Analysis failed:', err)
    return NextResponse.json({ error: 'Analysis failed' }, { status: 500 })
  }
}
