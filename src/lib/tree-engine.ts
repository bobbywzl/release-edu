/**
 * Tree Engine — the core of the Tree pivot.
 *
 * A ProblemTree grows from one ROOT problem the student wants to master:
 *   root (problem) → solution branches → component branches → leaves.
 * The engine seeds a new tree (root + candidate solutions + one level of
 * components), proposes expansions when the student asks questions (pending
 * nodes awaiting explicit approval), generates per-node comprehensive
 * explainers on demand, and runs Differentiator-style verification before a
 * node may be marked "understood".
 *
 * Model split: Opus for teaching-quality output (seed, explainers),
 * Sonnet for structured proposals and judging. Explainers are cached on the
 * node so each is paid for once.
 */
import prisma from '@/lib/prisma'
import type { TreeNode } from '@prisma/client'

const OPUS = 'claude-opus-4-8'
const SONNET = 'claude-sonnet-4-6'

function langDirective(lang?: string): string {
  return lang === 'zh'
    ? 'Respond entirely in Simplified Chinese (简体中文) for every student-facing string.'
    : 'Respond in English.'
}

// Difficulty tiers, calibrated to university course levels (same ideology
// as Release EDU's advancement levels).
const DIFFICULTY_GUIDE: Record<string, string> = {
  beginner: 'friendly introduction (≈ university 100-level) — plain language, generous analogies, no assumed background',
  intermediate: 'solid working depth (≈ 200–300-level) — real terminology, quantitative where natural, some assumed fundamentals',
  advanced: 'rigorous treatment (≈ 400-level / early graduate) — formal precision, edge cases, primary mechanisms',
  professional: 'practitioner/expert depth (≈ graduate seminar) — full technical rigor, current practice, open problems',
}

interface SessionFields { language?: string | null; difficulty?: string | null; personalContext?: string | null }

/**
 * Every tree is a self-contained SESSION with its own language, target
 * difficulty, and the student's stated background for this problem —
 * collected at session onboarding. All AI output within the session
 * follows these, not any global state.
 */
export function sessionDirectives(tree: SessionFields, fallbackLang?: string): string {
  const lang = tree.language ?? fallbackLang
  const parts = [langDirective(lang ?? undefined)]
  if (tree.difficulty && DIFFICULTY_GUIDE[tree.difficulty]) {
    parts.push(`TARGET LEVEL for this session: ${tree.difficulty} — ${DIFFICULTY_GUIDE[tree.difficulty]}. Calibrate every explanation and every test question to exactly this depth.`)
  }
  if (tree.personalContext) {
    parts.push(`THE STUDENT'S BACKGROUND for this problem (stated at session start): "${tree.personalContext.slice(0, 400)}" — connect examples to it and skip what it already covers.`)
  }
  return parts.join('\n')
}

async function anthropic() {
  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured')
  return new Anthropic({ apiKey })
}

function extractJSON<T>(text: string): T | null {
  try {
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/)
    return JSON.parse((match?.[1] ?? text).trim()) as T
  } catch {
    return null
  }
}

/** Student grounding for calibrated output (level, interests, memory). */
async function studentGrounding(userId: string): Promise<string> {
  try {
    const { getStudentContext } = await import('@/lib/student-context')
    const ctx = await getStudentContext(null, false, userId)
    const parts = [
      ctx.profile.advancementLevel ? `Target level: ${ctx.profile.advancementLevel}` : '',
      ctx.profile.occupation ? `Background: ${ctx.profile.occupation}` : '',
      ctx.interests.length ? `Interests: ${ctx.interests.slice(0, 5).join(', ')}` : '',
      ctx.insights.length ? `Known about the student:\n${ctx.insights.slice(0, 6).map(i => `- [${i.type}] ${i.content}`).join('\n')}` : '',
    ].filter(Boolean)
    return parts.length ? `\n## About this student\n${parts.join('\n')}` : ''
  } catch {
    return ''
  }
}

// ── Seeding ──────────────────────────────────────────────────────────────

interface SeedNode { title: string; summary: string }
interface SeedSolution extends SeedNode { components: SeedNode[] }
interface SeedResult { framing: string; rootSummary: string; solutions: SeedSolution[] }

/**
 * Create a new tree: root (the problem) + candidate solution branches +
 * each solution's first-level components. Deeper levels grow only when the
 * student asks — the tree expands with their curiosity, never ahead of it.
 *
 * opts carries the SESSION ONBOARDING answers (language, difficulty,
 * personal background) — stored on the tree, they govern every AI output
 * in this session.
 */
export async function seedTree(
  userId: string,
  problem: string,
  opts: { lang?: string; difficulty?: string; personalContext?: string } = {},
): Promise<string> {
  const client = await anthropic()
  const grounding = await studentGrounding(userId)
  const session: SessionFields = {
    language: opts.lang === 'zh' ? 'zh' : opts.lang ? 'en' : null,
    difficulty: opts.difficulty && DIFFICULTY_GUIDE[opts.difficulty] ? opts.difficulty : null,
    personalContext: opts.personalContext?.trim().slice(0, 1000) || null,
  }

  const result = await client.messages.create({
    model: OPUS,
    max_tokens: 3000,
    messages: [{
      role: 'user',
      content: `You are Bob, an expert mentor. A student wants to master ONE specific problem. Design the SEED of a learning tree for it.

THE PROBLEM: "${problem}"
${sessionDirectives(session)}
${grounding}

The tree model: the problem is the ROOT. Base branches are the CANDIDATE SOLUTIONS (real, distinct approaches an expert would weigh — 1 to 3 of them; use 1 only when the problem genuinely has a single canonical resolution). Each solution's children are its first-level COMPONENTS: the parts of that solution a beginner would NOT understand yet (2-4 per solution). Do NOT go deeper — deeper branches grow later from the student's own questions.

Every node needs:
- "title": 2-6 words, the concept's name
- "summary": 1-2 sentences, a simplified plain-language description of what this is and why it matters to the problem (this appears ON the node in a logic diagram)

Also write:
- "framing": one tight paragraph restating the problem precisely — what mastery of it means, what the end state looks like
- "rootSummary": 1-2 sentence summary for the root node itself


Return ONLY JSON:
{"framing": "...", "rootSummary": "...", "solutions": [{"title": "...", "summary": "...", "components": [{"title": "...", "summary": "..."}]}]}`,
    }],
  })

  const text = (result.content[0] as { text?: string })?.text ?? ''
  const seed = extractJSON<SeedResult>(text)
  if (!seed?.solutions?.length) throw new Error('Seed generation failed')

  const tree = await prisma.problemTree.create({
    data: {
      userId,
      title: problem.slice(0, 300),
      framing: seed.framing?.slice(0, 2000) ?? null,
      language: session.language,
      difficulty: session.difficulty,
      personalContext: session.personalContext,
    },
  })
  const root = await prisma.treeNode.create({
    data: {
      treeId: tree.id, parentId: null, kind: 'root',
      title: tree.title.slice(0, 120), summary: seed.rootSummary ?? seed.framing ?? '',
      order: 0,
    },
  })
  for (let s = 0; s < seed.solutions.length; s++) {
    const sol = seed.solutions[s]
    const solNode = await prisma.treeNode.create({
      data: {
        treeId: tree.id, parentId: root.id, kind: 'solution',
        title: sol.title.slice(0, 120), summary: sol.summary ?? '', order: s,
      },
    })
    for (let c = 0; c < (sol.components ?? []).length; c++) {
      const comp = sol.components[c]
      await prisma.treeNode.create({
        data: {
          treeId: tree.id, parentId: solNode.id, kind: 'component',
          title: comp.title.slice(0, 120), summary: comp.summary ?? '', order: c,
        },
      })
    }
  }
  return tree.id
}

// ── Context helpers ──────────────────────────────────────────────────────

export async function getTreeWithNodes(userId: string, treeId: string) {
  return prisma.problemTree.findFirst({
    where: { id: treeId, userId },
    include: { nodes: { orderBy: [{ createdAt: 'asc' }] } },
  })
}

/** Compact text sketch of the whole tree (for prompts). */
export function sketchTree(nodes: TreeNode[]): string {
  const byParent = new Map<string | null, TreeNode[]>()
  for (const n of nodes) {
    const k = n.parentId ?? null
    if (!byParent.has(k)) byParent.set(k, [])
    byParent.get(k)!.push(n)
  }
  const lines: string[] = []
  const walk = (parentId: string | null, depth: number) => {
    for (const n of (byParent.get(parentId) ?? []).sort((a, b) => a.order - b.order)) {
      lines.push(`${'  '.repeat(depth)}- [${n.kind}${n.pending ? ', PENDING' : ''}, ${n.status}] "${n.title}" — ${n.summary.slice(0, 100)}`)
      walk(n.id, depth + 1)
    }
  }
  walk(null, 0)
  return lines.join('\n')
}

/** Path from root to the node — grounds explainers in their lineage. */
export function nodePath(nodes: TreeNode[], nodeId: string): TreeNode[] {
  const byId = new Map(nodes.map(n => [n.id, n]))
  const path: TreeNode[] = []
  let cur = byId.get(nodeId)
  while (cur) {
    path.unshift(cur)
    cur = cur.parentId ? byId.get(cur.parentId) : undefined
  }
  return path
}

// ── Expansion (grows only with permission) ───────────────────────────────

/**
 * The student asked a question at a node. Propose 1-4 child nodes that
 * answer it — persisted as pending=true ghosts the student must approve.
 */
export async function proposeExpansion(
  userId: string, treeId: string, nodeId: string, question: string, lang?: string,
): Promise<TreeNode[]> {
  const tree = await getTreeWithNodes(userId, treeId)
  if (!tree) throw new Error('Tree not found')
  const node = tree.nodes.find(n => n.id === nodeId)
  if (!node) throw new Error('Node not found')

  const client = await anthropic()
  const result = await client.messages.create({
    model: SONNET,
    max_tokens: 1500,
    messages: [{
      role: 'user',
      content: `You are Bob, growing a problem-mastery learning tree. The student asked a question at one node; propose the child nodes (sub-branches) that would answer it.

PROBLEM (root): "${tree.title}"
CURRENT TREE:
${sketchTree(tree.nodes)}

TARGET NODE: "${node.title}" — ${node.summary}
STUDENT'S QUESTION: "${question.slice(0, 500)}"

Propose 1-4 NEW child nodes under the target node. Each must be a distinct pain point / concept the question surfaces, not already in the tree. kind is "component" (conceptual part) or "leaf" (specific technical knowledge or concrete pain-point resolution).

${sessionDirectives(tree, lang)}

Return ONLY JSON:
[{"title": "2-6 words", "summary": "1-2 sentences plain-language", "kind": "component|leaf"}]`,
    }],
  })

  const text = (result.content[0] as { text?: string })?.text ?? ''
  const proposals = extractJSON<Array<{ title: string; summary: string; kind?: string }>>(text) ?? []
  const existingCount = tree.nodes.filter(n => n.parentId === nodeId).length
  const created: TreeNode[] = []
  for (let i = 0; i < Math.min(4, proposals.length); i++) {
    const p = proposals[i]
    if (!p?.title) continue
    created.push(await prisma.treeNode.create({
      data: {
        treeId, parentId: nodeId,
        kind: p.kind === 'leaf' ? 'leaf' : 'component',
        title: p.title.slice(0, 120), summary: (p.summary ?? '').slice(0, 500),
        pending: true, order: existingCount + i,
      },
    }))
  }
  return created
}

// ── Explainer (generated once, cached on the node) ───────────────────────

export async function generateExplainer(userId: string, treeId: string, nodeId: string, lang?: string): Promise<string> {
  const tree = await getTreeWithNodes(userId, treeId)
  if (!tree) throw new Error('Tree not found')
  const node = tree.nodes.find(n => n.id === nodeId)
  if (!node) throw new Error('Node not found')
  if (node.explainer) return node.explainer

  const path = nodePath(tree.nodes, nodeId)
  const client = await anthropic()
  const grounding = await studentGrounding(userId)

  const result = await client.messages.create({
    model: OPUS,
    max_tokens: 2500,
    messages: [{
      role: 'user',
      content: `You are Bob, an expert mentor. Write the comprehensive PAIN-POINT EXPLAINER for one node of a problem-mastery tree — the piece a beginner reads to genuinely understand this point.

PROBLEM (root): "${tree.title}"
${tree.framing ? `FRAMING: ${tree.framing}` : ''}
PATH TO THIS NODE: ${path.map(n => `"${n.title}"`).join(' → ')}
THIS NODE: "${node.title}" — ${node.summary}
SIBLING/TREE CONTEXT:
${sketchTree(tree.nodes)}
${grounding}

Write in markdown (400-700 words):
1. **What this is** — precise but plain-language definition
2. **Why the problem needs it** — connect it explicitly BACK to the root problem and its parent branch
3. **How it works** — the core mechanism with ONE concrete worked example
4. **Where beginners go wrong** — the main misconception or failure mode
5. **How you'll know you understand it** — 1-2 sentences describing the transfer test

Dense, no fluff, no praise-padding. KaTeX ($...$) allowed for math.
${sessionDirectives(tree, lang)}`,
    }],
  })

  const explainer = (result.content[0] as { text?: string })?.text?.trim() ?? ''
  if (explainer) {
    await prisma.treeNode.update({ where: { id: nodeId }, data: { explainer } })
  }
  return explainer
}

// ── Verification (AI-verified mastery — Differentiator Principle) ────────

export interface VerifyQuestions { questions: string[] }

export async function generateVerification(userId: string, treeId: string, nodeId: string, lang?: string): Promise<VerifyQuestions> {
  const tree = await getTreeWithNodes(userId, treeId)
  const node = tree?.nodes.find(n => n.id === nodeId)
  if (!tree || !node) throw new Error('Node not found')

  const client = await anthropic()
  const result = await client.messages.create({
    model: SONNET,
    max_tokens: 800,
    messages: [{
      role: 'user',
      content: `Design a MINI PROBLEM SET (2-3 items) that verifies true understanding of one concept. Apply the Differentiator Principle: every item must separate a student who MEMORIZED this content from one who TRULY UNDERSTANDS it — transfer to an unseen context, why/what-if counterfactuals, edge cases where the memorized rule breaks. Never an item answerable by reciting a definition or repeating the explainer's words.

PROBLEM (root of their tree): "${tree.title}"
NODE UNDER TEST: "${node.title}" — ${node.summary}
${node.explainer ? `EXPLAINER THE STUDENT READ (do NOT quiz its literal sentences back):\n${node.explainer.slice(0, 1500)}` : ''}

Choose the format that authentically tests this subject: a small calculation/worked problem for quantitative concepts, a scenario-application or why/what-if short answer otherwise. All items are answered as free text. 2 items normally; 3 only if the concept has distinct facets that each need probing.

${sessionDirectives(tree, lang)}

Return ONLY JSON: {"questions": ["...", "..."]}`,
    }],
  })
  const parsed = extractJSON<VerifyQuestions>((result.content[0] as { text?: string })?.text ?? '')
  if (!parsed?.questions?.length) throw new Error('Verification generation failed')
  return { questions: parsed.questions.slice(0, 3) }
}

export interface VerifyJudgement { passed: boolean; feedback: string; scores: number[] }

export async function judgeVerification(
  userId: string, treeId: string, nodeId: string,
  questions: string[], answers: string[], lang?: string,
): Promise<VerifyJudgement> {
  const tree = await getTreeWithNodes(userId, treeId)
  const node = tree?.nodes.find(n => n.id === nodeId)
  if (!tree || !node) throw new Error('Node not found')

  const client = await anthropic()
  const result = await client.messages.create({
    model: SONNET,
    max_tokens: 800,
    messages: [{
      role: 'user',
      content: `Judge whether the student truly understands this concept (meaning over wording; partial credit for sound reasoning). Passing = average score ≥ 7.

NODE: "${node.title}" — ${node.summary}
${questions.map((q, i) => `Q${i + 1}: ${q}\nStudent's answer: ${(answers[i] ?? '').slice(0, 800)}`).join('\n\n')}

${sessionDirectives(tree, lang)}

Return ONLY JSON: {"scores": [0-10 per question], "passed": true|false, "feedback": "2-3 sentences: what they got right, what to revisit"}`,
    }],
  })
  const parsed = extractJSON<VerifyJudgement>((result.content[0] as { text?: string })?.text ?? '')
  if (!parsed) throw new Error('Judging failed')

  if (parsed.passed) {
    await prisma.treeNode.update({ where: { id: nodeId }, data: { status: 'understood' } })
    // Node mastery is the small-step reward of the Tree product.
    try {
      const { awardXp } = await import('@/lib/xp-engine')
      await awardXp(userId, 'objective_mastered')
    } catch { /* non-critical */ }
    // A fully-understood tree completes the problem.
    try {
      const remaining = await prisma.treeNode.count({
        where: { treeId, pending: false, status: { not: 'understood' } },
      })
      if (remaining === 0) {
        await prisma.problemTree.update({ where: { id: treeId }, data: { status: 'completed' } })
        const { awardXp } = await import('@/lib/xp-engine')
        await awardXp(userId, 'chapter_completed', { sessionScore: 90 })
      }
    } catch { /* non-critical */ }
  } else {
    await prisma.treeNode.update({ where: { id: nodeId }, data: { status: 'learning' } }).catch(() => null)
  }
  return parsed
}
