export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'

/**
 * Semantic answer evaluation using Haiku.
 * Compares student answer against expected answer for meaning, not exact keywords.
 */
export async function POST(req: NextRequest) {
  const { studentAnswer, expectedAnswer, question } = await req.json() as {
    studentAnswer: string
    expectedAnswer: string
    question: string
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ score: 50, verdict: 'partial', feedback: 'Evaluation unavailable.' })

  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const client = new Anthropic({ apiKey })

    const result = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 150,
      messages: [{
        role: 'user',
        content: `You are evaluating a student's short answer for semantic correctness.

Question: ${question}
Expected answer: ${expectedAnswer}
Student answer: ${studentAnswer}

Score how well the student's answer captures the meaning of the expected answer.
Consider: Does it convey the same core idea? Does it demonstrate understanding even if worded differently?
Ignore surface wording — focus purely on whether the meaning and conceptual understanding is correct.

Reply with JSON only:
{"score": 0-100, "verdict": "correct"|"partial"|"incorrect", "feedback": "one sentence explaining what's right or missing"}

Score guide: 75-100 = correct, 40-74 = partial, 0-39 = incorrect`,
      }],
    })

    const text = (result.content[0] as { text: string }).text?.trim()
    const json = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || '{}')
    return NextResponse.json({
      score: Math.max(0, Math.min(100, json.score ?? 50)),
      verdict: ['correct', 'partial', 'incorrect'].includes(json.verdict) ? json.verdict : 'partial',
      feedback: json.feedback || '',
    })
  } catch {
    return NextResponse.json({ score: 50, verdict: 'partial', feedback: 'Could not evaluate answer.' })
  }
}
