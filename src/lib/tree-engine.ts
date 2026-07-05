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


async function recordUsage(result: { usage?: unknown }, userId: string, model: string, feature: 'tree-seed' | 'tree-expand' | 'tree-explainer' | 'tree-verify') {
  try {
    const { recordAnthropicUsage } = await import('@/lib/usage')
    recordAnthropicUsage(result.usage as Parameters<typeof recordAnthropicUsage>[0], { userId, model, feature })
  } catch { /* non-critical */ }
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
      ctx.insights.length ? `Known about the student:\n${ctx.insights.slice(0, 8).map(i => `- [${i.type}] ${i.content}`).join('\n')}\nWhere natural, build explanations as analogies from their [knowledge] and [strength] entries — connect new concepts to what they verifiably already understand.` : '',
    ].filter(Boolean)
    return parts.length ? `\n## About this student\n${parts.join('\n')}` : ''
  } catch {
    return ''
  }
}

// ── Seeding ──────────────────────────────────────────────────────────────

interface SeedNode { title: string; summary: string }
interface SeedResult { framing: string; rootSummary: string; solutions: SeedNode[] }

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

The tree model: the problem is the ROOT. Base branches are the CANDIDATE SOLUTIONS or FOUNDING CONCEPTS that answer it (real, distinct approaches or conceptual pillars an expert would name — 1 to 3; use 1 only when the problem has a single canonical resolution). Generate ONLY the root and these first branches — NOTHING deeper. The whole point of this product is that deeper nodes are pain points the student DISCOVERS through their own questions while working; the tree must never grow ahead of their curiosity.

Every node needs:
- "title": 2-6 words, the concept's name
- "summary": 1-2 sentences, a simplified plain-language description of what this is and why it matters to the problem (this appears ON the node in a logic diagram)

Also write:
- "framing": one tight paragraph restating the problem precisely — what mastery of it means, what the end state looks like
- "rootSummary": 1-2 sentence summary for the root node itself


Return ONLY JSON:
{"framing": "...", "rootSummary": "...", "solutions": [{"title": "...", "summary": "..."}]}`,
    }],
  })

  void recordUsage(result, userId, OPUS, 'tree-seed')
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
  // Seed stops at the solution branches — every deeper node is a pain point
  // the student discovers through their own questions.
  for (let s = 0; s < seed.solutions.length; s++) {
    const sol = seed.solutions[s]
    await prisma.treeNode.create({
      data: {
        treeId: tree.id, parentId: root.id, kind: 'solution',
        title: sol.title.slice(0, 120), summary: sol.summary ?? '', order: s,
      },
    })
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

export interface ExpansionResult {
  proposals: TreeNode[]
  /** When the ask is too vague to propose well, Bob asks this instead. */
  clarify?: string
}

/**
 * The student asked a question at a node. Propose 1-4 child nodes that
 * answer it — persisted as pending=true ghosts the student must approve.
 * If the question is too vague to branch well, returns a clarifying
 * question instead of guessing.
 */
export async function proposeExpansion(
  userId: string, treeId: string, nodeId: string, question: string, lang?: string,
): Promise<ExpansionResult> {
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

If the question is CLEAR enough to branch on, propose 1-4 NEW child nodes under the target node. Each must be a distinct pain point / concept the question surfaces, not already in the tree. kind is "component" (conceptual part) or "leaf" (specific technical knowledge or concrete pain-point resolution).

If the question is TOO VAGUE or could branch in several very different directions, do NOT guess — ask ONE precise clarifying question instead (student-facing, warm but direct).

${sessionDirectives(tree, lang)}

Return ONLY JSON — one of:
{"proposals": [{"title": "2-6 words", "summary": "1-2 sentences plain-language", "kind": "component|leaf"}]}
{"clarify": "your one clarifying question"}`,
    }],
  })

  void recordUsage(result, userId, SONNET, 'tree-expand')
  const text = (result.content[0] as { text?: string })?.text ?? ''
  const parsed = extractJSON<{ proposals?: Array<{ title: string; summary: string; kind?: string }>; clarify?: string }>(text)
    // Tolerate a bare array (older shape).
    ?? { proposals: extractJSON<Array<{ title: string; summary: string; kind?: string }>>(text) ?? [] }

  if (parsed.clarify && !(parsed.proposals?.length)) {
    return { proposals: [], clarify: parsed.clarify }
  }

  const existingCount = tree.nodes.filter(n => n.parentId === nodeId).length
  const created: TreeNode[] = []
  const list = parsed.proposals ?? []
  for (let i = 0; i < Math.min(4, list.length); i++) {
    const p = list[i]
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
  return { proposals: created }
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

  void recordUsage(result, userId, OPUS, 'tree-explainer')
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
  void recordUsage(result, userId, SONNET, 'tree-verify')
  const parsed = extractJSON<VerifyQuestions>((result.content[0] as { text?: string })?.text ?? '')
  if (!parsed?.questions?.length) throw new Error('Verification generation failed')
  return { questions: parsed.questions.slice(0, 3) }
}

export interface VerifyJudgement { passed: boolean; feedback: string; scores: number[] }

export async function judgeVerification(
  userId: string, treeId: string, nodeId: string,
  questions: string[], answers: string[], lang?: string,
  confidences?: Array<'sure' | 'unsure'>,
): Promise<VerifyJudgement> {
  const tree = await getTreeWithNodes(userId, treeId)
  const node = tree?.nodes.find(n => n.id === nodeId)
  if (!tree || !node) throw new Error('Node not found')

  const client = await anthropic()
  const result = await client.messages.create({
    model: SONNET,
    max_tokens: 900,
    messages: [{
      role: 'user',
      content: `Judge whether the student truly understands this concept (meaning over wording; partial credit for sound reasoning). Passing = average score ≥ 7.

NODE: "${node.title}" — ${node.summary}
${questions.map((q, i) => `Q${i + 1}: ${q}${confidences?.[i] ? ` [student's stated confidence: ${confidences[i]}]` : ''}\nStudent's answer: ${(answers[i] ?? '').slice(0, 800)}`).join('\n\n')}

HYPERCORRECTION RULE: a CONFIDENT-WRONG answer is the most dangerous and the most teachable state. If an answer marked "sure" scores below 5, your feedback must open by directly, memorably refuting the specific wrong belief (name it, then correct it) — high-confidence errors are unusually fixable when confronted head-on.

${sessionDirectives(tree, lang)}

Return ONLY JSON: {"scores": [0-10 per question], "passed": true|false, "feedback": "2-3 sentences: what they got right, what to revisit — refutation first if confident-wrong occurred"}`,
    }],
  })
  void recordUsage(result, userId, SONNET, 'tree-verify')
  const parsed = extractJSON<VerifyJudgement>((result.content[0] as { text?: string })?.text ?? '')
  if (!parsed) throw new Error('Judging failed')

  if (parsed.passed) {
    await prisma.treeNode.update({ where: { id: nodeId }, data: { status: 'understood' } })
    // Node mastery is the small-step reward of the Tree product.
    try {
      const { awardXp } = await import('@/lib/xp-engine')
      await awardXp(userId, 'objective_mastered')
    } catch { /* non-critical */ }
    // ── Insight constellation: verified mastery becomes durable ACQUIRED
    // KNOWLEDGE in Bob's memory (the raw material for analogy-bridging),
    // and any recorded struggles with this concept flip to growth events.
    try {
      await prisma.insight.create({
        data: {
          userId,
          type: 'knowledge',
          content: `Verified understanding of "${node.title}" (transfer-tested): ${node.summary.slice(0, 140)}`,
          confidence: 0.95,
          importance: 0.7,
          source: 'verification',
        },
      })
      const { markStrugglesResolved } = await import('@/lib/insight-memory')
      await markStrugglesResolved(userId, node.title)
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
    // A failed transfer test is diagnostic gold — record the specific gap.
    try {
      await prisma.insight.create({
        data: {
          userId,
          type: 'struggle',
          content: `Failed verification on "${node.title}": ${(parsed.feedback ?? '').slice(0, 180)}`,
          confidence: 0.85,
          importance: 0.55,
          source: 'verification',
        },
      })
    } catch { /* non-critical */ }
  }
  return parsed
}
