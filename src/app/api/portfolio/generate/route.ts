// Long-running AI generation — without an explicit maxDuration, Vercel
// kills the function at the plan default before Claude finishes.
export const maxDuration = 300
import { NextRequest, NextResponse } from 'next/server'
import { dbStore } from '@/lib/db-store'
import { getUserId } from '@/lib/get-user-id'
import { getStudentContext } from '@/lib/student-context'
import { getUserCompletionStats } from '@/lib/status-cascade'
import prisma from '@/lib/prisma'

export async function POST(_req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'No API key' }, { status: 500 })
  }

  const userId = await getUserId()

  // Check if generation is already in progress
  const existing = await prisma.portfolioCache.findUnique({ where: { userId } })
  if (existing?.status === 'generating' && existing.startedAt) {
    const age = Date.now() - existing.startedAt.getTime()
    if (age < 5 * 60 * 1000) {
      // Already generating — return current status
      return NextResponse.json({ status: 'generating', startedAt: existing.startedAt })
    }
    // Stale (>5 min) — overwrite
  }

  // Mark as generating
  await prisma.portfolioCache.upsert({
    where: { userId },
    create: { userId, data: '', status: 'generating', startedAt: new Date() },
    update: { status: 'generating', startedAt: new Date(), errorMessage: null },
  })

  // Kick off generation in the background
  void generatePortfolioInBackground(userId, apiKey).catch(err => {
    console.error('[Portfolio] Background generation failed:', err)
    return prisma.portfolioCache.update({
      where: { userId },
      data: { status: 'error', errorMessage: err instanceof Error ? err.message : String(err) },
    }).catch(() => {})
  })

  return NextResponse.json({ status: 'generating', startedAt: new Date() })
}

async function generatePortfolioInBackground(userId: string, apiKey: string): Promise<void> {
  const store = dbStore.forUser(userId)
  const studentContext = await getStudentContext(userId, false, userId)
  // Curated memory only — stale/merged insights from abandoned directions
  // must not contaminate the portfolio. Resolved struggles come separately:
  // they're the growth narrative (started struggling with X, mastered it).
  const { getTopInsights, getResolvedStruggles } = await import('@/lib/insight-memory')
  const insights = await getTopInsights(userId, { limit: 40 })
  const resolvedStruggles = await getResolvedStruggles(userId).catch(() => [])
  const conversations = await store.getConversations()

  // Separate insights by type
  const strengths = insights.filter(i => i.type === 'strength' || i.type === 'breakthrough')
  const improvements = insights.filter(i => i.type === 'weakness' || i.type === 'struggle')
  const interests = insights.filter(i => i.type === 'interest' || i.type === 'aspiration')
  const personality = insights.filter(i => i.type === 'personality' || i.type === 'style')

  // Get conversation excerpts for evidence — get full messages for each conv
  const allMessages: { conversationTitle: string; role: string; content: string; date: Date }[] = []
  for (const c of conversations) {
    const fullConv = await store.getConversation(c.id)
    if (fullConv) {
      for (const m of fullConv.messages) {
        allMessages.push({
          conversationTitle: c.title,
          role: m.role,
          content: m.content,
          date: m.createdAt,
        })
      }
    }
  }

  // Get chapter completion stats
  const completionStatsData = await getUserCompletionStats(userId)

  // Get archived curriculum blocks (included in portfolio)
  const archivedBlocks = await prisma.curriculumBlock.findMany({
    where: { userId, includedInPortfolio: true },
    orderBy: { startedAt: 'asc' },
  })

  // ── Rich evidence-gathering queries ──

  // Session outcomes (success rate, subject breakdown, evolution)
  const sessionOutcomes = await prisma.sessionOutcome.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
    select: { endScore: true, passed: true, messageCount: true, subjectArea: true, sessionSummary: true, createdAt: true, thumbsUp: true, thumbsDown: true },
  })

  // Chapter-level performance (scores, completion pace)
  const chaptersWithTracks = await prisma.chapter.findMany({
    where: { track: { userId } },
    select: {
      title: true, status: true, sessionScore: true, createdAt: true,
      track: { select: { name: true, type: true } },
    },
    orderBy: { createdAt: 'asc' },
  })

  // Project work (real outputs)
  const projectsWithDetail = await prisma.subjectProject.findMany({
    where: { track: { userId } },
    select: {
      title: true, description: true, status: true, progress: true, mentorFeedback: true, createdAt: true, updatedAt: true,
      track: { select: { name: true } },
      tasks: { select: { title: true, completed: true } },
      milestones: { select: { title: true, completed: true, date: true } },
    },
  })

  // Homework submissions (student's written output)
  const homeworkSubmissions = await prisma.homework.findMany({
    where: { track: { userId }, status: 'completed', studentResponse: { not: null } },
    select: { title: true, studentResponse: true, track: { select: { name: true } } },
    take: 15,
  })

  // Quiz performance
  const quizzes = await prisma.quiz.findMany({
    where: { track: { userId }, score: { not: null } },
    select: { title: true, score: true, totalPoints: true, track: { select: { name: true } } },
  })

  // User's own highlights — what they marked as important (reveals what resonates)
  const highlightsData = await prisma.messageHighlight.findMany({
    where: { userId },
    select: { selectedText: true, comment: true, color: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 20,
  })

  // Compute performance metrics from real data
  const passedSessions = sessionOutcomes.filter(s => s.passed).length
  const successRate = sessionOutcomes.length > 0 ? Math.round((passedSessions / sessionOutcomes.length) * 100) : 0
  const chapterScores = chaptersWithTracks.filter(c => c.sessionScore != null).map(c => c.sessionScore!)
  const avgChapterScore = chapterScores.length > 0 ? Math.round(chapterScores.reduce((a, b) => a + b, 0) / chapterScores.length) : 0
  const completedChapters = chaptersWithTracks.filter(c => c.status === 'completed')

  // Evolution: first 1/3 vs last 1/3 session scores to show growth
  const sortedScores = chapterScores.slice()
  const thirdSize = Math.floor(sortedScores.length / 3) || 1
  const earlyAvg = sortedScores.length >= 3 ? Math.round(sortedScores.slice(0, thirdSize).reduce((a, b) => a + b, 0) / thirdSize) : null
  const recentAvg = sortedScores.length >= 3 ? Math.round(sortedScores.slice(-thirdSize).reduce((a, b) => a + b, 0) / thirdSize) : null
  const improvement = earlyAvg != null && recentAvg != null ? recentAvg - earlyAvg : null

  // User message tendencies: average length, question rate, technical vocabulary
  const userMessages = allMessages.filter(m => m.role === 'user')
  const avgUserMsgLen = userMessages.length > 0 ? Math.round(userMessages.reduce((a, m) => a + m.content.length, 0) / userMessages.length) : 0
  const questionRate = userMessages.length > 0 ? Math.round((userMessages.filter(m => m.content.includes('?')).length / userMessages.length) * 100) : 0

  // ── Pre-check: is there enough real data to generate a portfolio? ──
  const hasConversations = allMessages.length > 0
  const hasInsights = insights.length > 0
  const hasProgress = studentContext.progress.overallCompletion > 0
  const hasProjects = studentContext.projects.active.length > 0
  const hasArchive = archivedBlocks.length > 0
  const dataPoints = [hasConversations, hasInsights, hasProgress, hasProjects, hasArchive].filter(Boolean).length

  if (dataPoints === 0) {
    const emptyPortfolio = {
      headline: 'Portfolio not yet available',
      summary: `${studentContext.profile.name} has just started their learning journey on Release EDU. As they engage with the curriculum, complete assignments, work on projects, and discuss topics with Bob, this portfolio will be populated with verified evidence of their skills, character traits, and growth. Every claim in this portfolio will be backed by real data — no fabrication.`,
      skills: [],
      projects: [],
      strengths: [],
      growthAreas: [],
      metrics: { completionRate: 0, averagePace: 'Not enough data yet', consistencyScore: 0, qualityIndicators: [] },
      personalStatement: `I am just beginning my learning journey on Release EDU. This portfolio will grow as I engage with the curriculum, complete projects, and develop my skills. Check back soon!`,
      insufficientData: true,
    }
    await prisma.portfolioCache.update({
      where: { userId },
      data: { data: JSON.stringify(emptyPortfolio), status: 'ready', generatedAt: new Date() },
    })
    return
  }

  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const client = new Anthropic({ apiKey })

  const result = await client.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 4000,
    messages: [{
      role: 'user',
      content: `Generate a RIGOROUSLY HONEST student portfolio/resume for university and employer review.

## RELEASE EDU PORTFOLIO — HALLMARKS OF TRUTH

This is a Release EDU Portfolio. It MUST be **OBJECTIVE**, **TRANSPARENT**, and **ACCURATE**. Universities and employers will read this to decide real outcomes. Every claim must be traceable to concrete evidence.

### Required hallmarks of a Release EDU Portfolio:
1. **Quote-backed evidence**: Every strength, skill, and trait must cite ACTUAL quotes from the student's conversations or homework submissions — with context. Never paraphrase as evidence.
2. **Numerical transparency**: State real numbers — success rate %, average session score, chapter count, projects completed, improvement delta. No vague "strong performance" — give the number.
3. **Evolution over time**: Compare early-curriculum performance to recent. Show trajectory, not just snapshot.
4. **Tendencies from behavior**: What does the student DO? Ask a lot of questions? Write long thoughtful responses? Revisit the same topic? Highlight theory or applications? Observe and report.
5. **Output artifacts**: Reference real homework responses, project outputs, and user-chosen highlights as evidence of thought.
6. **Honest limitations**: Name gaps. "No projects completed yet" is more valuable than padding.
7. **Cumulative across curricula**: Include evidence from archived curriculum blocks — show the full learning journey.

### CRITICAL HONESTY RULES:
1. ONLY include information DIRECTLY SUPPORTED by data below. No inference beyond what's stated.
2. For "strengths" — ONLY include traits with specific quote/data evidence. If no evidence, return empty array.
3. For "skills" — ONLY list skills where real work exists (completed chapters with scores, homework submitted, etc.). Level reflects actual progress.
4. For "projects" — ONLY real projects. Never invent impact.
5. Every "evidence" field MUST contain at least one real quote or specific data point (e.g. "scored 88% on Diffusion Models chapter", "wrote 340-word response to homework X stating '[quote]'").
6. For "conversationRef" — cite the specific conversation title or chapter context.
7. If early-stage with limited data, SAY SO.

## Student Profile
Name: ${studentContext.profile.name}
Learning Stage: ${studentContext.profile.stageName}
XP: ${studentContext.profile.xp} | Streak: ${studentContext.profile.streak} days
Learning Style: ${studentContext.profile.learningStyle || 'not determined yet'}
Interests: ${studentContext.interests.length > 0 ? studentContext.interests.join(', ') : 'not yet identified'}
Aspirations: ${studentContext.aspirations || 'not yet expressed'}

## Actual Completion Data (from chapter status cascade)
Overall Progress: ${completionStatsData.overall.progress}%
Chapters Completed: ${completionStatsData.overall.completed}/${completionStatsData.overall.total}
Tracks: ${completionStatsData.tracks.map(t => `${t.trackName}: ${t.progress}%`).join(', ')}

## Curriculum Progress
Overall: ${studentContext.progress.overallCompletion}%
Excelling: ${studentContext.progress.excellingTopics.length > 0 ? studentContext.progress.excellingTopics.join(', ') : 'none identified yet'}
Subjects: ${studentContext.progress.subjectBreakdown.map(s => `${s.subject}: ${s.mastery}%`).join(', ')}

## Projects (ONLY include these — do not invent others)
${studentContext.projects.active.length > 0 ? studentContext.projects.active.map(p => `- ${p.name} (${p.progress}% complete)`).join('\n') : 'No projects started yet'}

## Identified Strengths from Bob's observations (ONLY use these — do not invent)
${strengths.length > 0 ? strengths.map(s => `- [confidence: ${s.confidence}] ${s.content} (source: ${s.source})`).join('\n') : 'No strengths identified yet — not enough interaction data'}

## Areas for Growth from Bob's observations
${improvements.length > 0 ? improvements.map(s => `- [confidence: ${s.confidence}] ${s.content}`).join('\n') : 'No areas identified yet'}

## Interests & Aspirations from conversations
${interests.length > 0 ? interests.map(s => `- ${s.content}`).join('\n') : 'None expressed yet'}

## Personality & Learning Style observations
${personality.length > 0 ? personality.map(s => `- ${s.content}`).join('\n') : 'Not enough data to assess'}

## PERFORMANCE METRICS (from real chapter/session data)
- Overall chapter completion: ${completionStatsData.overall.completed}/${completionStatsData.overall.total}
- Completed chapters with scores: ${completedChapters.length}
- Average session score: ${avgChapterScore}% (from ${chapterScores.length} scored chapters)
- Session pass rate: ${successRate}% (${passedSessions}/${sessionOutcomes.length} sessions passed)
${earlyAvg != null ? `- Evolution: early curriculum avg ${earlyAvg}% → recent avg ${recentAvg}% (${improvement! >= 0 ? '+' : ''}${improvement} points change)` : '- Evolution: insufficient data'}
- XP earned: ${studentContext.profile.xp}
- Current streak: ${studentContext.profile.streak} days

## SESSION OUTCOMES (real session-by-session history)
${sessionOutcomes.length > 0 ? sessionOutcomes.slice(-12).map(s => `- [${s.subjectArea}] ${s.passed ? '✓ passed' : '✗ failed'} at ${s.endScore}% · ${s.messageCount} msgs · ${s.createdAt.toISOString().slice(0,10)}${s.thumbsUp ? ` · 👍${s.thumbsUp}` : ''}${s.thumbsDown ? ` · 👎${s.thumbsDown}` : ''}${s.sessionSummary ? ` · "${s.sessionSummary.slice(0, 80)}"` : ''}`).join('\n') : 'No sessions completed yet'}

## CHAPTER-BY-CHAPTER PERFORMANCE (evidence of mastery per topic)
${completedChapters.slice(0, 20).map(c => `- [${c.track.name}] "${c.title}": ${c.sessionScore != null ? c.sessionScore + '%' : 'completed'}`).join('\n') || 'No completed chapters yet'}

## PROJECT WORK (real outputs, not just plans)
${projectsWithDetail.length > 0 ? projectsWithDetail.map(p => {
  const doneTasks = p.tasks.filter(t => t.completed).length
  const doneMilestones = p.milestones.filter(m => m.completed).length
  return `- [${p.track.name}] "${p.title}" (${p.status}, ${p.progress}%)
    Description: ${p.description?.slice(0, 150) || 'n/a'}
    Tasks: ${doneTasks}/${p.tasks.length} complete${p.tasks.slice(0, 3).map(t => `\n      • ${t.completed ? '✓' : '○'} ${t.title}`).join('')}
    Milestones: ${doneMilestones}/${p.milestones.length} complete
    ${p.mentorFeedback ? `Mentor feedback: "${p.mentorFeedback.slice(0, 200)}"` : ''}`
}).join('\n\n') : 'No projects started yet'}

## HOMEWORK SUBMISSIONS (student's written output — real evidence of thinking)
${homeworkSubmissions.length > 0 ? homeworkSubmissions.slice(0, 8).map(h => `- [${h.track.name}] "${h.title}"\n  Student wrote: "${(h.studentResponse || '').slice(0, 300)}"`).join('\n\n') : 'No homework submissions yet'}

## QUIZ PERFORMANCE
${quizzes.length > 0 ? quizzes.map(q => `- [${q.track.name}] "${q.title}": ${q.score}/${q.totalPoints}`).join('\n') : 'No quizzes completed yet'}

## USER'S OWN HIGHLIGHTS (what the student chose to mark as important — reveals what resonates)
${highlightsData.length > 0 ? highlightsData.slice(0, 10).map(h => `- [${h.color}] "${h.selectedText.slice(0, 150)}"${h.comment ? ` — student's note: "${h.comment}"` : ''}`).join('\n') : 'No annotations yet'}

## BEHAVIORAL TENDENCIES (from ${userMessages.length} user messages)
- Average message length: ${avgUserMsgLen} characters
- Question-asking rate: ${questionRate}% of messages contain questions
- Total conversations: ${conversations.length}

## ACTUAL CONVERSATION EXCERPTS (verbatim — use for "evidence" fields)
${allMessages.length > 0 ? allMessages.slice(-20).map(m => `[${m.role} in "${m.conversationTitle}"] ${m.content.slice(0, 250)}`).join('\n') : 'No conversations yet'}

## PAST CURRICULUM HISTORY (archived blocks — cumulative achievements)
${archivedBlocks.length > 0 ? archivedBlocks.map(b => {
  const tracks = JSON.parse(b.tracksJson || '[]')
  const blockInsights = b.insightsJson ? JSON.parse(b.insightsJson) : []
  const outcomes = b.sessionOutcomesJson ? JSON.parse(b.sessionOutcomesJson) : []
  return `### ${b.title} (${new Date(b.startedAt).toLocaleDateString()} — ${new Date(b.archivedAt).toLocaleDateString()})
Progress: ${b.overallProgress}% · Chapters: ${b.completedChapters}/${b.totalChapters} · XP: ${b.totalXp}
Tracks: ${tracks.map((t: { name: string; progress: number }) => `${t.name} (${t.progress}%)`).join(', ')}
Key insights: ${blockInsights.slice(0, 5).map((i: { content: string }) => i.content).join('; ') || 'none'}
Sessions: ${outcomes.length} total, ${outcomes.filter((o: { passed: boolean }) => o.passed).length} passed`
}).join('\n\n') : 'No past curricula archived yet'}

## Overcome Struggles (growth narrative — strongest portfolio material)
${resolvedStruggles.length > 0
  ? resolvedStruggles.map(s => `- Previously: "${s.content}" — since RESOLVED through completed chapters (use this as evidence of growth over time)`).join('\n')
  : 'None recorded yet'}

## Data Availability Summary
- Conversations: ${allMessages.length} messages across ${conversations.length} conversations
- Insights: ${insights.length} total (${strengths.length} strengths, ${improvements.length} growth areas, ${resolvedStruggles.length} resolved struggles)
- Completion: ${studentContext.progress.overallCompletion}%
- Projects: ${studentContext.projects.active.length} active
- Archived curriculum blocks: ${archivedBlocks.length} (included in portfolio)

Generate a JSON portfolio with EXACTLY this schema. EMBED the evidence from above into the relevant fields — each claim should quote actual data, user writings, or highlights. The portfolio must show GROWTH AND IMPROVEMENT OVER TIME (cite score trajectories, evolution between curriculum blocks, early vs recent performance). For any section with insufficient data, return empty arrays or honest "insufficient data" messages. DO NOT PAD. DO NOT ADD EXTRA FIELDS.

CRITICAL SCHEMA RULES:
- "skills[].level" MUST be exactly one of: "beginner" | "intermediate" | "advanced" | "expert" (NO variants like "beginner-to-intermediate")
- "metrics.completionRate" MUST be a single integer 0-100 (NOT an object with sub-fields)
- "metrics.consistencyScore" MUST be a single integer 0-100
- "metrics.averagePace" MUST be a short string under 40 characters (e.g. "3 chapters/month")
- "metrics.qualityIndicators" MUST be an array of short strings
- Do NOT add fields like "projectsNote", "cautionaryIndicators", "dataLimitations", or any other top-level or nested fields not in the schema below

{
  "headline": "Honest one-line summary reflecting actual status",
  "summary": "Honest 2-3 paragraph summary. State what IS known, acknowledge what isn't yet. No flattery without evidence.",
  "skills": [{"name": "skill name", "level": "beginner|intermediate|advanced|expert", "evidence": "SPECIFIC evidence from actual work — module completed, project milestone hit, etc."}],
  "projects": [{"title": "ACTUAL project name from data", "description": "what they actually built (based on progress)", "skills": ["skills actually demonstrated"], "impact": "honest assessment of what this shows"}],
  "strengths": [{"trait": "trait name", "description": "explanation", "evidence": "ACTUAL QUOTE from conversation excerpts above", "conversationRef": "which conversation"}],
  "growthAreas": [{"area": "area name", "description": "honest description", "progress": "actual progress on this"}],
  "metrics": {
    "completionRate": ${studentContext.progress.overallCompletion},
    "averagePace": "calculated from actual data",
    "consistencyScore": ${Math.min(100, studentContext.profile.streak * 7)},
    "qualityIndicators": ["ONLY real indicators"]
  },
  "personalStatement": "Honest, realistic personal statement reflecting actual journey stage"
}

Return ONLY valid JSON.`
    }]
  })

  {
    const { recordAnthropicUsage } = await import('@/lib/usage')
    recordAnthropicUsage(result.usage, { userId, model: 'claude-opus-4-8', feature: 'portfolio' })
  }
  const text = (result.content[0] as { type: string; text?: string })?.text?.trim()
  if (!text) {
    await prisma.portfolioCache.update({
      where: { userId },
      data: { status: 'error', errorMessage: 'Empty AI response' },
    })
    return
  }

  try {
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, text]
    const portfolio = JSON.parse(jsonMatch[1] || text)
    await prisma.portfolioCache.update({
      where: { userId },
      data: { data: JSON.stringify(portfolio), status: 'ready', generatedAt: new Date(), errorMessage: null },
    })
  } catch (err) {
    await prisma.portfolioCache.update({
      where: { userId },
      data: { status: 'error', errorMessage: err instanceof Error ? err.message : 'Parse failure' },
    })
  }
}
