export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getUserId } from '@/lib/get-user-id'
import { dbStore } from '@/lib/db-store'
import { setChapterStatus, recalculateTrackStatus, consumeLastXpAwards } from '@/lib/status-cascade'
import { awardXp, updateStreak } from '@/lib/xp-engine'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const userId = await getUserId()
  const chapter = await prisma.chapter.findUnique({
    where: { id },
    include: { track: { select: { userId: true, name: true } } },
  })
  if (!chapter || chapter.track?.userId !== userId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  return NextResponse.json({
    sessionPlan: chapter.sessionPlan ? JSON.parse(chapter.sessionPlan) : null,
    sessionScore: chapter.sessionScore ?? 0,
    sessionData: chapter.sessionData ? JSON.parse(chapter.sessionData) : null,
    status: chapter.status,
  })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()
  const userId = await getUserId()
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'No API key' }, { status: 500 })

  const chapter = await prisma.chapter.findUnique({
    where: { id },
    include: { track: { select: { userId: true, name: true } } },
  })
  if (!chapter || chapter.track?.userId !== userId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  if (body.action === 'init') {
    // Generate session plan with Opus
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const client = new Anthropic({ apiKey })

    const result = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: `You are about to teach a student a chapter called "${chapter.title}" in the subject "${chapter.track?.name}".

Chapter content:
${chapter.content?.slice(0, 2000) || 'No content yet'}

Key topics: ${chapter.keyTopics || '[]'}

Create a structured session plan. Return ONLY valid JSON:
{
  "objectives": ["specific learning objective 1", "objective 2", "objective 3"],
  "plan": "2-3 sentence overview of how you'll teach this session — what you'll cover and in what order",
  "checkpoints": ["what question/exercise will verify objective 1", "checkpoint 2", "checkpoint 3"],
  "estimatedExchanges": 8
}`
      }]
    })

    {
      const { recordAnthropicUsage } = await import('@/lib/usage')
      recordAnthropicUsage(result.usage, { userId, model: 'claude-opus-4-8', feature: 'chapter' })
    }
    const planText = (result.content[0] as { type: string; text?: string }).text?.trim() ?? ''
    let plan
    try {
      const match = planText.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, planText]
      plan = JSON.parse(match[1] || planText)
    } catch {
      plan = { objectives: [chapter.title], plan: 'Work through this chapter interactively.', checkpoints: ['Verify understanding'], estimatedExchanges: 6 }
    }

    await prisma.chapter.update({ where: { id }, data: { sessionPlan: JSON.stringify(plan), sessionScore: 0, status: 'in-progress' } })
    // Cascade: mark in-progress and update track progress
    await recalculateTrackStatus(chapter.trackId)
    return NextResponse.json({ plan })
  }

  if (body.action === 'update_score') {
    const score = Math.max(0, Math.min(100, body.score ?? 0))
    // Merge new sessionData with existing to preserve answeredQuestionIds across updates
    let existingSessionData: Record<string, unknown> = {}
    if (chapter.sessionData) {
      try {
        existingSessionData = JSON.parse(chapter.sessionData as string)
      } catch { /* ignore parse errors */ }
    }
    const sessionDataWithReflection = {
      ...existingSessionData,
      ...body.sessionData,
      // Preserve answeredQuestionIds — prefer incoming if provided, else keep existing
      answeredQuestionIds: body.sessionData?.answeredQuestionIds || existingSessionData.answeredQuestionIds || [],
      lastReflection: body.reflection || null,
    }
    await prisma.chapter.update({
      where: { id },
      data: { sessionScore: score, sessionData: JSON.stringify(sessionDataWithReflection) },
    })
    // Cascade: if score > 0 and not already completed, mark in-progress
    if (score > 0 && chapter.status !== 'completed') {
      await setChapterStatus(id, 'in-progress')
    } else {
      // Still recalculate track to update weighted progress
      await recalculateTrackStatus(chapter.trackId)
    }
    // Award XP for quiz answers in this update
    const quizXpResults = []
    if (body.sessionData?.quizResults) {
      for (const q of body.sessionData.quizResults) {
        if (q.score >= 50) {
          const xp = await awardXp(userId, 'quiz_correct', { difficulty: q.score >= 80 ? 1 : 0.8 })
          if (xp) quizXpResults.push(xp)
        }
      }
    }

    // Perseverance XP — reward continued engagement after struggling. We
    // compare the prior reflection's streakWrong (already on disk) with the
    // incoming reflection's streakWrong. If it just crossed into a new tier
    // (2, 3, 4+), award once for that tier. This makes "keeping going after
    // a wrong answer" visibly rewarded, not just correctness.
    const perseveranceAwards = []
    try {
      const priorStreakWrong = parseInt(
        (existingSessionData.lastReflection as { streakWrong?: string } | undefined)?.streakWrong ?? '0',
        10,
      ) || 0
      const newStreakWrong = parseInt(
        (body.reflection as { streakWrong?: string } | undefined)?.streakWrong ?? '0',
        10,
      ) || 0
      // Award when we crossed UP into a tier: 0→2, 2→3, 3→4+. Not when going down (correct answer resets).
      const justCrossedTier =
        (priorStreakWrong < 2 && newStreakWrong >= 2) ||
        (priorStreakWrong < 3 && newStreakWrong === 3) ||
        (priorStreakWrong < 4 && newStreakWrong >= 4)
      if (justCrossedTier) {
        const xp = await awardXp(userId, 'perseverance', { streakWrong: newStreakWrong })
        if (xp) perseveranceAwards.push(xp)
      }
    } catch { /* non-critical */ }

    // Update streak on activity
    const streakResult = await updateStreak(userId)

    const allXpAwards = [...quizXpResults, ...perseveranceAwards, ...(streakResult.xpAwarded ? [streakResult.xpAwarded] : [])]
    return NextResponse.json({ success: true, score, xpAwards: allXpAwards })
  }

  if (body.action === 'complete') {
    // Opus evaluates mastery — this is the rigorous gate, keep Opus
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const client = new Anthropic({ apiKey })
    const store = dbStore.forUser(userId)
    const conv = await store.getConversation(body.conversationId)
    const messages = (conv?.messages || []).slice(-30).map((m: { role: string; content: string }) => `[${m.role}]: ${m.content.slice(0, 400)}`).join('\n\n')
    const sessionData = body.sessionData || {}

    const result = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `Evaluate whether this student has genuinely mastered the chapter "${chapter.title}".

Session objectives: ${JSON.stringify(sessionData.objectives || [])}
Quiz results: ${JSON.stringify(sessionData.quizResults || [])}
Current score: ${body.score}%

Recent conversation:
${messages.slice(-2000)}

Be RIGOROUS. The student should demonstrate:
1. Understanding of key concepts (not just memorization)
2. Ability to apply knowledge
3. Correct quiz answers (or good explanations when wrong)

Return JSON only:
{
  "shouldComplete": true/false,
  "score": 0-100,
  "reasoning": "brief explanation",
  "missingAreas": ["what still needs work if not complete"]
}`
      }]
    })

    {
      const { recordAnthropicUsage } = await import('@/lib/usage')
      recordAnthropicUsage(result.usage, { userId, model: 'claude-opus-4-8', feature: 'chapter' })
    }
    const evalText = (result.content[0] as { type: string; text?: string }).text?.trim() ?? ''
    let evaluation
    try {
      const match = evalText.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, evalText]
      evaluation = JSON.parse(match[1] || evalText)
    } catch {
      evaluation = { shouldComplete: false, score: body.score, reasoning: 'Evaluation failed' }
    }

    if (evaluation.shouldComplete) {
      await setChapterStatus(id, 'completed')
      await prisma.chapter.update({ where: { id }, data: { sessionScore: evaluation.score } })
    } else {
      // Update score even if not completing
      await prisma.chapter.update({ where: { id }, data: { sessionScore: evaluation.score } })
      await recalculateTrackStatus(chapter.trackId)
    }

    // Record session outcome for prompt evolution analysis
    try {
      await prisma.sessionOutcome.create({
        data: {
          userId,
          chapterId: id,
          conversationId: body.conversationId || '',
          startScore: 0,
          endScore: evaluation.score || body.score || 0,
          passed: evaluation.shouldComplete === true,
          messageCount: sessionData.objectives?.length || 0,
          subjectArea: chapter.track?.name || 'unknown',
          thumbsUp: 0,
          thumbsDown: 0,
        }
      })
    } catch (err) {
      console.error('[SessionOutcome] Failed to record:', err)
    }

    // Collect XP awards from chapter/track completion (set via status-cascade)
    const cascadeXpAwards = consumeLastXpAwards()
    return NextResponse.json({ evaluation, completed: evaluation.shouldComplete, xpAwards: cascadeXpAwards })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
