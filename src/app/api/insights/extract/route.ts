import { NextRequest, NextResponse } from 'next/server'
import { dbStore } from '@/lib/db-store'
import { getUserId } from '@/lib/get-user-id'

/**
 * POST /api/insights/extract
 * Extracts insights from a conversation using Claude Haiku.
 * Updates the student's profile with new interests, aspirations, strengths, weaknesses.
 */
export async function POST(req: NextRequest) {
  const body = await req.json() as { conversationId: string }
  const { conversationId } = body

  if (!conversationId) {
    return NextResponse.json({ error: 'conversationId required' }, { status: 400 })
  }

  const userId = await getUserId()
  const store = dbStore.forUser(userId)

  // Get conversation messages
  const conv = await store.getConversation(conversationId)
  const messages = conv?.messages.map(m => ({ role: m.role, content: m.content })) ?? []

  if (messages.length === 0) {
    return NextResponse.json({ error: 'Conversation not found or empty' }, { status: 404 })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY

  interface Insights {
    newInterests: string[]
    aspirations: string | null
    strugglingTopics: string[]
    excellingTopics: string[]
    suggestedStageAdjustment: number | null
    summary: string
  }

  if (!apiKey) {
    const mockInsights: Insights = {
      newInterests: [],
      aspirations: null,
      strugglingTopics: [],
      excellingTopics: [],
      suggestedStageAdjustment: null,
      summary: 'No API key — using mock insights.',
    }
    return NextResponse.json({ insights: mockInsights, applied: false })
  }

  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const client = new Anthropic({ apiKey })

    const transcript = messages
      .slice(-10)
      .map(m => `${m.role.toUpperCase()}: ${m.content}`)
      .join('\n\n')

    const result = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `Analyze this tutoring conversation and extract structured insights about the student.

CONVERSATION:
${transcript}

Respond with ONLY valid JSON in this exact format:
{
  "newInterests": ["topic1", "topic2"],
  "aspirations": "career or personal goal mentioned, or null",
  "strugglingTopics": ["topic1"],
  "excellingTopics": ["topic1"],
  "suggestedStageAdjustment": null,
  "summary": "1-2 sentence summary of what was discussed and learned"
}

Guidelines:
- newInterests: only topics the student expressed genuine curiosity about
- aspirations: only if they explicitly mentioned a career/life goal
- strugglingTopics: topics where they showed confusion or difficulty
- excellingTopics: topics where they showed strong understanding
- suggestedStageAdjustment: 1-4 if the conversation suggests a stage change, else null
- summary: brief factual summary`,
      }],
    })

    const text = (result.content[0] as { type: string; text?: string })?.text ?? '{}'
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    const insights: Insights = jsonMatch ? JSON.parse(jsonMatch[0]) : {
      newInterests: [],
      aspirations: null,
      strugglingTopics: [],
      excellingTopics: [],
      suggestedStageAdjustment: null,
      summary: 'Could not extract insights.',
    }

    // Apply insights to student profile
    const profile = await store.getProfile()
    const currentInterests: string[] = profile?.interests ? JSON.parse(profile.interests) : []
    const currentWeaknesses: string[] = profile?.weaknesses ? JSON.parse(profile.weaknesses) : []
    const currentStrengths: string[] = profile?.strengths ? JSON.parse(profile.strengths) : []

    const mergedInterests = Array.from(new Set([...currentInterests, ...insights.newInterests]))
    const mergedWeaknesses = Array.from(new Set([...currentWeaknesses, ...insights.strugglingTopics]))
    const mergedStrengths = Array.from(new Set([...currentStrengths, ...insights.excellingTopics]))

    await store.updateProfile({
      interests: JSON.stringify(mergedInterests),
      weaknesses: JSON.stringify(mergedWeaknesses),
      strengths: JSON.stringify(mergedStrengths),
      ...(insights.aspirations && { aspirations: insights.aspirations }),
      ...(insights.suggestedStageAdjustment && { learningStage: insights.suggestedStageAdjustment }),
    })

    return NextResponse.json({ insights, applied: true })
  } catch (error) {
    console.error('Insight extraction error:', error)
    return NextResponse.json({ error: 'Extraction failed' }, { status: 500 })
  }
}
