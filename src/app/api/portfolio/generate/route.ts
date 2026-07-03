// Long-running AI generation — without an explicit maxDuration, Vercel
// kills the function at the plan default before Claude finishes.
export const maxDuration = 300
import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '@/lib/get-user-id'
import prisma from '@/lib/prisma'

// Portfolios generated before the Tree pivot carry Release EDU data. The
// version stamp lets readers treat anything older as absent — a Tree EDU
// portfolio is built ONLY from Tree EDU session data.
const PORTFOLIO_VERSION = 2

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
      return NextResponse.json({ status: 'generating', startedAt: existing.startedAt })
    }
    // Stale (>5 min) — overwrite
  }

  await prisma.portfolioCache.upsert({
    where: { userId },
    create: { userId, data: '', status: 'generating', startedAt: new Date() },
    update: { status: 'generating', startedAt: new Date(), errorMessage: null },
  })

  void generatePortfolioInBackground(userId, apiKey).catch(err => {
    console.error('[Portfolio] Background generation failed:', err)
    return prisma.portfolioCache.update({
      where: { userId },
      data: { status: 'error', errorMessage: err instanceof Error ? err.message : String(err) },
    }).catch(() => {})
  })

  return NextResponse.json({ status: 'generating', startedAt: new Date() })
}

function safeParse<T>(str: string | null | undefined, fallback: T): T {
  if (!str) return fallback
  try { return JSON.parse(str) as T } catch { return fallback }
}

/**
 * Tree EDU portfolio — built EXCLUSIVELY from the student's problem-tree
 * sessions: their trees, verified nodes, own notes/annotations, uploaded
 * evidence files, and workspace conversations. Nothing from any prior
 * product (legacy curriculum, old conversations, carried-over insights)
 * may enter — a session's record is the session's data, full stop.
 */
async function generatePortfolioInBackground(userId: string, apiKey: string): Promise<void> {
  // Basic identity only (name/XP/streak) — no legacy profile interests.
  const [profileRow, userRow] = await Promise.all([
    prisma.studentProfile.findUnique({ where: { userId }, select: { displayName: true, xp: true, streak: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
  ])
  const name = profileRow?.displayName || userRow?.name || 'Student'

  // ── Session data: the trees ──
  const trees = await prisma.problemTree.findMany({
    where: { userId },
    include: { nodes: { orderBy: { createdAt: 'asc' } } },
    orderBy: { createdAt: 'asc' },
  })

  // Workspace conversations ONLY (context tag "tree-node:<id>").
  const nodeConvs = await prisma.conversation.findMany({
    where: { userId, context: { startsWith: 'tree-node:' } },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  })
  const convByNodeId = new Map(nodeConvs.map(c => [c.context!.slice('tree-node:'.length), c]))

  // Evidence files attached to nodes in this product.
  const nodeFiles = await prisma.linkedFile.findMany({
    where: { userId, workType: 'tree-node' },
    select: { name: true, workId: true, addedAt: true },
  })

  const realNodes = trees.flatMap(t => t.nodes.filter(n => !n.pending))
  const verifiedNodes = realNodes.filter(n => n.status === 'understood')
  const userMessages = nodeConvs.flatMap(c => c.messages.filter(m => m.role === 'user'))

  // Bob's accumulated insight memory — the personalization moat. Curated
  // (active, ranked) memory colors the portrait of WHO the student is; the
  // scope rule below stops it from smuggling in legacy product claims.
  let insightLines = ''
  try {
    const { getTopInsights } = await import('@/lib/insight-memory')
    const insights = await getTopInsights(userId, { limit: 20 })
    insightLines = insights.map(i => `- [${i.type}, confidence ${i.confidence.toFixed(2)}] ${i.content}`).join('\n')
  } catch { /* non-critical */ }

  if (trees.length === 0 || realNodes.length === 0) {
    const emptyPortfolio = {
      version: PORTFOLIO_VERSION,
      headline: 'Portfolio not yet available',
      summary: `${name} has just started on Tree EDU. As they plant problem trees, verify their understanding node by node, and attach real work as evidence, this portfolio will fill with verifiable proof of mastery. Every claim will be traceable to a specific verified node or artifact — no fabrication.`,
      skills: [],
      projects: [],
      strengths: [],
      growthAreas: [],
      metrics: { completionRate: 0, averagePace: 'Not enough data yet', consistencyScore: 0, qualityIndicators: [] },
      personalStatement: 'I am just beginning my journey on Tree EDU. This portfolio will grow with every problem I master.',
      insufficientData: true,
    }
    await prisma.portfolioCache.update({
      where: { userId },
      data: { data: JSON.stringify(emptyPortfolio), status: 'ready', generatedAt: new Date() },
    })
    return
  }

  // ── Per-tree session digests for the prompt ──
  const treeDigests = trees.map(t => {
    const nodes = t.nodes.filter(n => !n.pending)
    const verified = nodes.filter(n => n.status === 'understood')
    const nodeLines = nodes.slice(0, 25).map(n => {
      const annotations = safeParse<Array<{ text: string }>>(n.annotations, [])
      const files = nodeFiles.filter(f => f.workId === n.id)
      const conv = convByNodeId.get(n.id)
      return `  - [${n.kind}, ${n.status}] "${n.title}" — ${n.summary.slice(0, 100)}`
        + (n.notes ? `\n    Student's notes: "${n.notes.replace(/\s+/g, ' ').slice(0, 180)}"` : '')
        + (annotations.length ? `\n    Annotations: ${annotations.slice(0, 2).map(a => `"${a.text.slice(0, 100)}"`).join('; ')}` : '')
        + (files.length ? `\n    Evidence files: ${files.map(f => f.name).join(', ')}` : '')
        + (conv ? `\n    Workspace exchanges: ${conv.messages.length} messages` : '')
    }).join('\n')
    return `### Session: "${t.title}" [${t.status}]${t.difficulty ? ` · target level: ${t.difficulty}` : ''}${t.language ? ` · language: ${t.language}` : ''}
${t.framing ? `Framing: ${t.framing.slice(0, 220)}` : ''}
${t.personalContext ? `Student's stated background for this problem: "${t.personalContext.slice(0, 220)}"` : ''}
Progress: ${verified.length}/${nodes.length} nodes verified as understood (AI-tested, not self-marked)
Nodes:
${nodeLines}`
  }).join('\n\n')

  const recentUserExcerpts = userMessages.slice(-20)
    .map(m => `- "${m.content.replace(/\s+/g, ' ').slice(0, 220)}"`).join('\n')

  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const client = new Anthropic({ apiKey })

  const completionRate = realNodes.length > 0 ? Math.round((verifiedNodes.length / realNodes.length) * 100) : 0

  const result = await client.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 4000,
    messages: [{
      role: 'user',
      content: `Generate a RIGOROUSLY HONEST student portfolio/résumé for university and employer review, from Tree EDU problem-mastery sessions.

## TREE EDU PORTFOLIO — HALLMARKS OF TRUTH

Tree EDU teaches by growing a tree from ONE specific problem: solutions branch into components and technical leaves, and a node counts as understood ONLY after passing an AI-verified transfer test (questions designed to separate understanding from memorization). This portfolio therefore certifies VERIFIED understanding, not attendance.

### ABSOLUTE SCOPE RULE — read first:
Use ONLY the session data below. Do NOT reference, assume, or import anything from any other product, curriculum, chapter, course, or prior learning history. If it is not in the sessions below, it does not exist for this portfolio. Never mention "Release EDU", chapters, tracks, or curricula — this product has problems, trees, nodes, and verifications.

### Required hallmarks:
1. **Verification-backed claims**: every skill/strength must cite a specific verified node ("passed the transfer test on 'QEC surface codes'") or a real artifact (student's notes, annotation, evidence file, workspace quote).
2. **Numerical transparency**: real numbers — nodes verified, trees completed, verification rate. No vague praise.
3. **Honest limitations**: unverified nodes and abandoned trees are stated plainly.
4. **The problems ARE the résumé**: each completed tree is presented as a mastered problem with the solution path they came to understand.

## Student
Name: ${name}
XP: ${profileRow?.xp ?? 0} | Streak: ${profileRow?.streak ?? 0} days
Trees (sessions): ${trees.length} total, ${trees.filter(t => t.status === 'completed').length} completed
Nodes: ${verifiedNodes.length}/${realNodes.length} verified as understood (${completionRate}%)
Evidence files uploaded: ${nodeFiles.length}
Workspace messages written by the student: ${userMessages.length}

## SESSIONS (the complete, only source of truth)
${treeDigests}

## STUDENT'S OWN RECENT WORKSPACE WORDS (verbatim — use for "evidence" quotes)
${recentUserExcerpts || '(none yet)'}

## BOB'S ACCUMULATED MEMORY OF THE STUDENT (curated insights — the app's long-term understanding)
Use these ONLY to color WHO the student is (strengths, style, aspirations, growth areas) — never as claims of completed work, and never referencing any other product, curriculum, or chapters. Claims of ACHIEVEMENT must come from the sessions above.
${insightLines || '(no accumulated insights yet)'}

Generate a JSON portfolio with EXACTLY this schema. Every claim must be traceable to the sessions above. For any section with insufficient data, return empty arrays or honest "insufficient data" messages. DO NOT PAD. DO NOT ADD EXTRA FIELDS.

CRITICAL SCHEMA RULES:
- "skills[].level" MUST be exactly one of: "beginner" | "intermediate" | "advanced" | "expert"
- "metrics.completionRate" MUST be a single integer 0-100
- "metrics.consistencyScore" MUST be a single integer 0-100
- "metrics.averagePace" MUST be a short string under 40 characters
- "metrics.qualityIndicators" MUST be an array of short strings
- "projects" here means MASTERED OR IN-PROGRESS PROBLEMS (trees): title = the problem, description = the solution path they now understand, impact = what the verifications prove.

{
  "headline": "Honest one-line summary reflecting actual status",
  "summary": "Honest 2-3 paragraph summary of their problem-mastery record. State what IS verified, acknowledge what isn't yet.",
  "skills": [{"name": "skill name", "level": "beginner|intermediate|advanced|expert", "evidence": "specific verified node / artifact"}],
  "projects": [{"title": "the problem (tree title)", "description": "the solution path they came to understand", "skills": ["skills actually demonstrated"], "impact": "what the verified nodes prove"}],
  "strengths": [{"trait": "trait name", "description": "explanation", "evidence": "ACTUAL QUOTE from the student's workspace words or notes above", "conversationRef": "which tree/node"}],
  "growthAreas": [{"area": "area name", "description": "honest description", "progress": "actual progress on this"}],
  "metrics": {
    "completionRate": ${completionRate},
    "averagePace": "calculated from actual data",
    "consistencyScore": ${Math.min(100, (profileRow?.streak ?? 0) * 7)},
    "qualityIndicators": ["ONLY real indicators"]
  },
  "personalStatement": "Honest, realistic first-person statement reflecting their actual problem-mastery journey"
}

Return ONLY valid JSON.`,
    }],
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
    portfolio.version = PORTFOLIO_VERSION
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
