import { NextRequest, NextResponse } from 'next/server'
import { dbStore } from '@/lib/db-store'
import { getUserId } from '@/lib/get-user-id'

export async function POST(req: NextRequest) {
  const { fileContent, fileName, workType, workId, trackName } = await req.json()

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'No API key configured' }, { status: 500 })
  }

  const userId = await getUserId()
  const store = dbStore.forUser(userId)

  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const client = new Anthropic({ apiKey })

    const result = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: `Analyze this student's uploaded work file and extract learning insights.

File: ${fileName}
Work Type: ${workType}
Subject: ${trackName}

Content:
${fileContent.slice(0, 5000)}

Extract:
1. **Progress Assessment**: How far along is the student? What have they demonstrated understanding of?
2. **Strengths Observed**: What does this file show the student is good at?
3. **Areas for Improvement**: What gaps or misconceptions are visible?
4. **Suggestions**: 2-3 specific, actionable next steps for the student.
5. **Insights**: Any personality/learning style/interest signals?

Return as JSON:
{
  "progressAssessment": "...",
  "strengths": ["..."],
  "areasForImprovement": ["..."],
  "suggestions": ["..."],
  "insights": [{"type": "strength|weakness|interest|style|breakthrough|struggle", "content": "...", "confidence": 0.0-1.0}]
}`
      }]
    })

    {
      const { recordAnthropicUsage } = await import('@/lib/usage')
      recordAnthropicUsage(result.usage, { userId, model: 'claude-opus-4-8', feature: 'image' })
    }
    const textBlock = result.content[0]
    const text = textBlock && 'text' in textBlock ? textBlock.text?.trim() : null
    if (!text) {
      return NextResponse.json({ error: 'No analysis generated' }, { status: 500 })
    }

    let analysis
    try {
      const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, text]
      analysis = JSON.parse(jsonMatch[1] || text)
    } catch {
      analysis = { raw: text }
    }

    if (analysis.insights && Array.isArray(analysis.insights)) {
      for (const insight of analysis.insights) {
        if (insight.type && insight.content) {
          await store.addInsight({
            type: insight.type,
            content: insight.content,
            confidence: insight.confidence || 0.7,
            source: `file-analysis-${workType}-${workId}`,
          })
        }
      }
    }

    return NextResponse.json({ analysis })
  } catch (error) {
    console.error('File analysis error:', error)
    return NextResponse.json({ error: 'Analysis failed' }, { status: 500 })
  }
}
