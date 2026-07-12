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
import { getTeachingModel, getJudgeModel } from '@/lib/model-resolver'
import { ensureUserRow } from '@/lib/ensure-user'
import { clampText } from '@/lib/clamp'

function langDirective(lang?: string): string {
  return lang === 'zh'
    ? 'Respond entirely in Simplified Chinese (简体中文) for every student-facing string.'
    : 'Respond in English.'
}

// Difficulty tiers: the axis runs from a general understanding you can
// EXPLAIN up to a professional understanding you can DEPLOY in real life
// (university course levels kept as a familiar calibration anchor).
const DIFFICULTY_GUIDE: Record<string, string> = {
  beginner: 'general understanding (≈ university 100-level) — plain language, generous analogies, no assumed background; the goal is being able to EXPLAIN the ideas clearly, not operate them',
  intermediate: 'working understanding (≈ 200–300-level) — real terminology, quantitative where natural, some assumed fundamentals; the goal is applying the ideas to guided, well-defined cases',
  advanced: 'rigorous understanding (≈ 400-level / early graduate) — formal precision, edge cases, primary mechanisms; the goal is independently attacking novel variants of the problem',
  professional: 'deployable understanding (≈ practitioner/graduate seminar) — full technical rigor, current practice, failure modes, open problems; the goal is building and operating a REAL-LIFE solution end to end',
}

interface SessionFields {
  language?: string | null
  difficulty?: string | null
  personalContext?: string | null
  purpose?: string | null
}

/**
 * The Answer Standard (FOUNDATION.md — law): every learner-facing answer must
 * be BOTH Relevant and Informative. Inject into every prompt that produces
 * workspace answers (node chat, explainers).
 */
export const ANSWER_STANDARD = `## THE ANSWER STANDARD (every answer must pass BOTH — non-negotiable)
- RELEVANT: answer the question actually asked, scoped to THIS node in service of the root problem. No generic field surveys, no depth the question didn't call for — calibrate how deep you go to what this specific problem needs, and stop there.
- INFORMATIVE: never a bare answer, verdict, or recipe. Every answer teaches the scientific background behind it — the mechanism or principle that explains WHY — so the student walks away with transferable understanding, not an isolated fact.
- The two failure modes, equally fatal: TOO GENERAL (a textbook lecture dumped on a specific question) and TOO THIN (a correct answer with no science underneath).`

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
  if (tree.purpose) {
    parts.push(`THE STUDENT'S PURPOSE for mastering this (stated at session start): "${tree.purpose.slice(0, 400)}" — this defines RELEVANT for the whole session: keep every branch, answer, and checkpoint in service of this purpose, and calibrate depth to what the purpose actually needs (the Answer Standard's relevance test).`)
  }
  return parts.join('\n')
}


async function recordUsage(result: { usage?: unknown }, userId: string, model: string, feature: 'tree-seed' | 'tree-expand' | 'tree-explainer' | 'tree-verify' | 'tree-digest') {
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

/**
 * Robustly pull a JSON value out of a model reply, even when the model wraps
 * it in prose or a code fence. Tries, in order: a ```json fence, the whole
 * string, then the first balanced {...} object, then the first [...] array.
 * A fragile parser here silently produced empty proposals — "Propose
 * branches" would create nothing and fail without a trace.
 */
function extractJSON<T>(text: string): T | null {
  const tryParse = (s: string): T | null => {
    try { return JSON.parse(s.trim()) as T } catch { return null }
  }
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence?.[1]) { const r = tryParse(fence[1]); if (r !== null) return r }
  const whole = tryParse(text); if (whole !== null) return whole
  const o1 = text.indexOf('{'), o2 = text.lastIndexOf('}')
  if (o1 !== -1 && o2 > o1) { const r = tryParse(text.slice(o1, o2 + 1)); if (r !== null) return r }
  const a1 = text.indexOf('['), a2 = text.lastIndexOf(']')
  if (a1 !== -1 && a2 > a1) { const r = tryParse(text.slice(a1, a2 + 1)); if (r !== null) return r }
  return null
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
  opts: { lang?: string; difficulty?: string; personalContext?: string; purpose?: string } = {},
): Promise<string> {
  const client = await anthropic()
  const grounding = await studentGrounding(userId)
  const session: SessionFields = {
    language: opts.lang === 'zh' ? 'zh' : opts.lang ? 'en' : null,
    difficulty: opts.difficulty && DIFFICULTY_GUIDE[opts.difficulty] ? opts.difficulty : null,
    personalContext: opts.personalContext?.trim().slice(0, 1000) || null,
    purpose: opts.purpose?.trim().slice(0, 1000) || null,
  }

  const model = await getTeachingModel()
  const result = await client.messages.create({
    model,
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

  void recordUsage(result, userId, model, 'tree-seed')
  const text = (result.content[0] as { text?: string })?.text ?? ''
  const seed = extractJSON<SeedResult>(text)
  if (!seed?.solutions?.length) throw new Error('Seed generation failed')

  // The insert must never fail AFTER the seed was paid for — guarantee the
  // FK target exists (first-action users and demo visitors have no row yet).
  await ensureUserRow(userId)

  const tree = await prisma.problemTree.create({
    data: {
      userId,
      title: clampText(problem, 300),
      framing: seed.framing?.slice(0, 2000) ?? null,
      language: session.language,
      difficulty: session.difficulty,
      personalContext: session.personalContext,
      purpose: session.purpose,
    },
  })
  const root = await prisma.treeNode.create({
    data: {
      treeId: tree.id, parentId: null, kind: 'root',
      // Word-boundary clamp — the raw slice cut the problem mid-sentence
      // ("…I need to figure out") right on the canvas root node.
      title: clampText(tree.title, 120), summary: seed.rootSummary ?? seed.framing ?? '',
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

/**
 * THE EVIDENCE LOCKER — every real artifact uploaded anywhere on this tree
 * (files live on nodes via LinkedFile workType "tree-node"). Fed to every
 * explainer and chat turn so Bob grounds numbers and claims in the student's
 * REAL work instead of inventing plausible examples. Text files are
 * excerpted; binaries listed by name; `excludeNodeId` skips the node whose
 * files are already shown in full detail.
 */
export async function evidenceLocker(
  userId: string, nodes: TreeNode[], excludeNodeId?: string,
  opts: { maxFiles?: number; excerpt?: number } = {},
): Promise<string> {
  const { maxFiles = 6, excerpt = 700 } = opts
  try {
    const nodeIds = nodes.filter(n => !n.pending && n.id !== excludeNodeId).map(n => n.id)
    if (nodeIds.length === 0) return ''
    const titleById = new Map(nodes.map(n => [n.id, n.title]))
    const files = await prisma.linkedFile.findMany({
      where: { userId, workType: 'tree-node', workId: { in: nodeIds } },
      select: { name: true, content: true, workId: true },
      orderBy: { addedAt: 'desc' },
      take: maxFiles,
    })
    if (files.length === 0) return ''
    return `\n## TREE EVIDENCE LOCKER (real artifacts uploaded across this tree — ground every number and claim in these; NEVER invent measurements when evidence exists)\n` + files.map(f => {
      const isText = !(f.content ?? '').startsWith('data:')
      const at = titleById.get(f.workId ?? '') ?? 'tree'
      return isText
        ? `### ${f.name} (at "${at}")\n${(f.content ?? '').slice(0, excerpt)}${(f.content ?? '').length > excerpt ? '\n…(truncated)' : ''}`
        : `### ${f.name} (at "${at}") — binary/image, content not inlined`
    }).join('\n\n')
  } catch {
    return ''
  }
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
  /** Bob's conversational reply for the grow-box thread: what he proposed and
   *  why, and/or a follow-up question. NEVER empty — the grow box is a
   *  conversation, and a dead-end "no new branches" is a failed turn. */
  reply: string
  /** Kept for older clients: the follow-up question when Bob asked one. */
  clarify?: string
}

export interface GrowTurn { role: 'user' | 'assistant'; content: string }

/**
 * The grow-box CONVERSATION. Each student message in the grow thread lands
 * here with the dialog so far; Bob replies conversationally AND (whenever the
 * dialog is about material to learn) proposes 1-4 child nodes, persisted as
 * pending=true ghosts. Follow-up turns re-propose the FULL updated set for
 * this dialog — `replaceIds` (the dialog's still-pending ghosts from the
 * previous turn) are deleted first so refinements reconfigure the ghosts
 * instead of piling up. Ghosts approved mid-dialog are no longer pending and
 * therefore survive. Never refuses, never dead-ends.
 */
export async function proposeExpansion(
  userId: string, treeId: string, nodeId: string, question: string, lang?: string,
  opts: { history?: GrowTurn[]; replaceIds?: string[] } = {},
): Promise<ExpansionResult> {
  const tree = await getTreeWithNodes(userId, treeId)
  if (!tree) throw new Error('Tree not found')
  const node = tree.nodes.find(n => n.id === nodeId)
  if (!node) throw new Error('Node not found')

  // Refine flow: this dialog's previous still-pending ghosts are replaced by
  // the new turn's proposals — but they are deleted only AFTER the model turn
  // succeeds AND actually produced replacements (below). Deleting up front
  // would destroy the student's pending proposals on an API failure or on a
  // purely conversational turn, which is permission-based growth violated in
  // the removal direction.
  const replaceIds = (opts.replaceIds ?? []).filter(id => typeof id === 'string').slice(0, 8)

  const history = (opts.history ?? []).slice(-8).map(h => ({
    role: h.role === 'assistant' ? 'assistant' as const : 'user' as const,
    content: String(h.content ?? '').slice(0, 600),
  })).filter(h => h.content.trim())

  const client = await anthropic()
  const model = await getJudgeModel()
  const result = await client.messages.create({
    model,
    max_tokens: 1500,
    system: `You are Bob, growing a problem-mastery learning tree through a short CONVERSATION in the "Grow this branch" box. The student talks to you about what they don't understand at one node; you reply conversationally AND propose the sub-branches (child nodes) that would teach it.

PROBLEM (root): "${tree.title}"
CURRENT TREE:
${sketchTree(tree.nodes)}

TARGET NODE they are growing from: "${node.title}" — ${node.summary}

RULES:
- ALWAYS lean toward proposing: whenever the student's message (in the context of the whole dialog) is about something to learn or understand, return your best 1-4 proposals under the most likely reading — make reasonable assumptions rather than refusing. Usually 1-2 nodes; 3-4 ONLY when the ask genuinely spans that many distinct concepts. Each proposal is a distinct pain point / concept not already in the tree. kind: "component" (conceptual part) or "leaf" (specific technical knowledge / concrete pain-point resolution).
- On FOLLOW-UP turns, propose the FULL UPDATED SET for this dialog (the previous turn's unapproved proposals are replaced by what you return now; if you return an EMPTY proposals list, the previous set is KEPT untouched) — refine, rename, add or drop based on what the student just said.
- CONTINGENT UNKNOWNS: if the right branch depends on a fact the student doesn't know yet (which tool/platform/variety/library), propose the diagnostic/conceptual node that resolves the unknown — never a fan of per-option how-tos.
- "reply" is your conversational voice in the thread (1-3 sentences): say what you proposed and why it answers them, and — when one specific detail would sharpen the set — ask ONE short follow-up question. If their message is purely conversational (a thanks, a meta question, an answer that changes nothing), reply naturally; proposals may then be empty, but your reply must MOVE THE CONVERSATION FORWARD (offer a direction, ask what they're stuck on) — never a dead end, never "no new branches".
- The reply NEVER lists the proposal titles verbatim as a menu — the UI shows the proposal cards; speak about them naturally.
${sessionDirectives(tree, lang)}

Return ONLY JSON:
{"proposals": [{"title": "2-6 words", "summary": "1-2 sentences plain-language", "kind": "component|leaf"}], "reply": "your conversational reply (session language)"}`,
    messages: [...history, { role: 'user' as const, content: question.slice(0, 800) }],
  })

  void recordUsage(result, userId, model, 'tree-expand')
  const text = (result.content[0] as { text?: string })?.text ?? ''
  const parsed = extractJSON<{ proposals?: Array<{ title: string; summary: string; kind?: string }>; reply?: string; clarify?: string | null }>(text)
    // Tolerate a bare array (older shape).
    ?? { proposals: extractJSON<Array<{ title: string; summary: string; kind?: string }>>(text) ?? [] }

  const list = parsed.proposals ?? []

  // Replace the dialog's previous ghosts ONLY now that the turn succeeded and
  // produced actual replacements. A conversational turn (proposals: []) keeps
  // the previous set on the board. Scoped so ghosts from other dialogs/nodes
  // and already-approved (pending=false) nodes are never touched.
  if (replaceIds.length > 0 && list.length > 0) {
    await prisma.treeNode.deleteMany({
      where: { id: { in: replaceIds }, treeId, parentId: nodeId, pending: true },
    }).catch(() => null)
  }

  const existing = await prisma.treeNode.count({ where: { treeId, parentId: nodeId } })
  const created: TreeNode[] = []
  for (let i = 0; i < Math.min(4, list.length); i++) {
    const p = list[i]
    if (!p?.title) continue
    created.push(await prisma.treeNode.create({
      data: {
        treeId, parentId: nodeId,
        kind: p.kind === 'leaf' ? 'leaf' : 'component',
        title: p.title.slice(0, 120), summary: (p.summary ?? '').slice(0, 500),
        pending: true, order: existing + i,
      },
    }))
  }

  // The reply must always carry the conversation. If the model omitted it,
  // synthesize a serviceable one in the session language.
  const zh = (tree.language ?? lang) === 'zh'
  let reply = typeof parsed.reply === 'string' && parsed.reply.trim() ? parsed.reply.trim().slice(0, 600) : ''
  if (!reply) {
    reply = created.length > 0
      ? (zh ? `我提议了 ${created.length} 个分枝——在树上确认或继续告诉我你想深入哪里。` : `I've proposed ${created.length} ${created.length === 1 ? 'branch' : 'branches'} — approve them on the tree, or keep telling me where you want to go deeper.`)
      : (zh ? '再多说一点你卡在哪里——是概念本身，还是怎么落地？' : "Tell me a bit more about where you're stuck — the concept itself, or how to apply it?")
  }
  const clarify = typeof parsed.clarify === 'string' && parsed.clarify.trim() ? parsed.clarify.trim() : undefined
  return { proposals: created, reply, clarify }
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
  const locker = await evidenceLocker(userId, tree.nodes)

  const model = await getTeachingModel()
  const result = await client.messages.create({
    model,
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
${locker}

Write in markdown (400-700 words):
1. **What this is** — precise but plain-language definition
2. **Why the problem needs it** — connect it explicitly BACK to the root problem and its parent branch
3. **How it works** — the core mechanism with ONE concrete worked example
4. **Where beginners go wrong** — the main misconception or failure mode
5. **How you'll know you understand it** — 1-2 sentences describing the transfer test

WORKED-EXAMPLE HONESTY (non-negotiable): you do NOT know the student's actual project details (their stack, file names, real numbers). The worked example must be an EXPLICITLY fictional third party ("imagine a shop called…") or clearly hedged as an assumption to verify — NEVER assert conclusions about THEIR project ("X is serving your files", "you see: yourbundle.js — 1.8 MB") as if observed. Asserted fiction about their own product seeds confident misconceptions the chat then has to repair.
Nodes marked PENDING in the tree sketch are unapproved proposals — never reference them as siblings the student has learned from or as promised next steps.

Dense, no fluff, no praise-padding. KaTeX ($...$) allowed for math.
If (and only if) this concept is inherently visual — structure, flow, spatial layout, comparison — include ONE diagram at the point it belongs, as a fenced block the UI renders into a generated image (labels in the session's language, textbook style):
\`\`\`image
one-sentence description of the labeled diagram to draw
\`\`\`
${ANSWER_STANDARD}
${sessionDirectives(tree, lang)}`,
    }],
  })

  void recordUsage(result, userId, model, 'tree-explainer')
  const explainer = (result.content[0] as { text?: string })?.text?.trim() ?? ''
  if (explainer) {
    await prisma.treeNode.update({ where: { id: nodeId }, data: { explainer } })
  }
  return explainer
}

// ── Checkpoint verification (AI-verified mastery — Differentiator law) ───
//
// There is no separate test screen: mastery is proven through the checkpoint
// questions Bob asks IN the workspace chat ([[QUIZ]] blocks — MCQ or short
// answer). MCQs are judged deterministically; short answers by Sonnet. The
// node flips to "understood" once the student has MASTERY_TARGET correct
// answers including at least MASTERY_MIN_SHORT own-words short answer.
// Constants + quizState parsing live in src/lib/mastery.ts (client-safe,
// shared with the workspace UI).

export interface CheckpointJudgement { correct: boolean; score: number; feedback: string }

/**
 * Judge one short-answer checkpoint (meaning over wording; the Differentiator
 * bar: does the answer show understanding that would transfer, or recitation?).
 */
export async function judgeCheckpointAnswer(
  userId: string, treeId: string, nodeId: string,
  question: string, rubric: string | undefined, answer: string,
  confidence?: 'sure' | 'unsure', lang?: string,
): Promise<CheckpointJudgement> {
  const tree = await getTreeWithNodes(userId, treeId)
  const node = tree?.nodes.find(n => n.id === nodeId)
  if (!tree || !node) throw new Error('Node not found')

  const client = await anthropic()
  const model = await getJudgeModel()
  const result = await client.messages.create({
    model,
    max_tokens: 700,
    messages: [{
      role: 'user',
      content: `Judge whether the student's answer shows TRUE understanding (meaning over wording; partial credit for sound reasoning). Correct = score ≥ 7.

NODE UNDER STUDY: "${node.title}" — ${node.summary}
ROOT PROBLEM: "${tree.title}"
CHECKPOINT QUESTION: ${question.slice(0, 600)}
${rubric ? `WHAT A TRULY-UNDERSTANDING ANSWER MUST CONTAIN: ${rubric.slice(0, 400)}` : ''}
STUDENT'S ANSWER${confidence ? ` [stated confidence: ${confidence}]` : ''}: ${answer.slice(0, 1200)}

HYPERCORRECTION RULE: a CONFIDENT-WRONG answer is the most teachable state. If the answer is marked "sure" and scores below 5, your feedback must open by directly, memorably refuting the specific wrong belief (name it, then correct it).

The feedback must be INFORMATIVE, not a verdict: in 1-3 sentences give the scientific reason the right answer is right (and where their reasoning broke, if it did).

${sessionDirectives(tree, lang)}

Return ONLY JSON: {"score": 0-10, "feedback": "1-3 sentences"}`,
    }],
  })
  void recordUsage(result, userId, model, 'tree-verify')
  const parsed = extractJSON<{ score?: number; feedback?: string }>((result.content[0] as { text?: string })?.text ?? '')
  if (!parsed || typeof parsed.score !== 'number') throw new Error('Judging failed')
  const score = Math.max(0, Math.min(10, parsed.score))
  // Sentence-safe clamp — the raw slice showed the student "…caught the bon"
  // at the exact moment of praise.
  return { correct: score >= 7, score, feedback: clampText(parsed.feedback ?? '', 600) }
}

export interface XpAwardLite { awarded: number; label: string; levelUp: boolean; newLevel: number; source?: string }

/**
 * Flip a node to "understood" with every mastery side effect: XP, the
 * knowledge insight (analogy-bridge raw material), struggle resolution, and
 * the tree-completion check. Returns the XP awards for client celebration.
 */
export async function markNodeVerified(
  userId: string, treeId: string, nodeId: string, lang?: string,
): Promise<{ xp: XpAwardLite[]; treeCompleted: boolean }> {
  const node = await prisma.treeNode.findUnique({ where: { id: nodeId } })
  if (!node) throw new Error('Node not found')
  const zh = lang === 'zh'
  const xp: XpAwardLite[] = []
  let treeCompleted = false

  await prisma.treeNode.update({ where: { id: nodeId }, data: { status: 'understood' } })
  // Node mastery is the small-step reward of the Tree product.
  try {
    const { awardXp } = await import('@/lib/xp-engine')
    const a = await awardXp(userId, 'objective_mastered')
    if (a) xp.push(a)
  } catch { /* non-critical */ }
  // ── Insight constellation: verified mastery becomes durable ACQUIRED
  // KNOWLEDGE in Bob's memory (the raw material for analogy-bridging),
  // and any recorded struggles with this concept flip to growth events.
  try {
    await prisma.insight.create({
      data: {
        userId,
        type: 'knowledge',
        // Localized so the "What Bob knows about you" panel never mixes an
        // English wrapper onto Chinese content in a 中文 session.
        content: zh
          ? `已通过迁移测试验证对「${node.title}」的理解：${clampText(node.summary, 140)}`
          : `Verified understanding of "${node.title}" (transfer-tested): ${clampText(node.summary, 140)}`,
        confidence: 0.95,
        importance: 0.7,
        source: 'verification',
      },
    })
    const { markStrugglesResolved } = await import('@/lib/insight-memory')
    await markStrugglesResolved(userId, node.title)
  } catch { /* non-critical */ }
  // A fully-understood tree completes the problem. The ROOT is the problem
  // statement, not a masterable pain point — it is excluded from the
  // requirement (verifying "your own question" was an unreachable dead-end)
  // and flips green automatically as the crown once every branch verifies.
  try {
    const remaining = await prisma.treeNode.count({
      where: { treeId, pending: false, parentId: { not: null }, status: { not: 'understood' } },
    })
    if (remaining === 0) {
      await prisma.treeNode.updateMany({
        where: { treeId, parentId: null },
        data: { status: 'understood' },
      }).catch(() => null)
      // Compare-and-set on the tree status: the completion bonus pays exactly
      // once per tree. Growing a completed tree and mastering the new node
      // must not re-pay it (repeatable XP inflation), and two nodes verifying
      // concurrently must not both take this branch.
      const flipped = await prisma.problemTree.updateMany({
        where: { id: treeId, status: { not: 'completed' } },
        data: { status: 'completed' },
      })
      if (flipped.count > 0) {
        const { awardXp } = await import('@/lib/xp-engine')
        const a = await awardXp(userId, 'chapter_completed', { sessionScore: 90 })
        if (a) xp.push(a)
      }
      treeCompleted = true
    }
  } catch { /* non-critical */ }

  return { xp, treeCompleted }
}

// ── Tree Digest (the project's status report, built from tree state) ─────

/**
 * Generate the TREE DIGEST — a shareable status report of the whole
 * problem-mastery session: key numbers (only from real evidence/logs),
 * findings, progress made, blockages, and next actions. Cached on the tree
 * (digest/digestAt); regenerate on demand.
 */
export async function generateTreeDigest(userId: string, treeId: string, lang?: string): Promise<{ digest: string; digestAt: Date }> {
  const tree = await getTreeWithNodes(userId, treeId)
  if (!tree) throw new Error('Tree not found')
  const real = tree.nodes.filter(n => !n.pending)

  const { parseQuizState } = await import('@/lib/mastery')
  const nodeLines = real.map(n => {
    const qs = parseQuizState(n.quizState)
    const bits = [
      `status: ${n.status}`,
      qs.attempts > 0 ? `checkpoints: ${qs.correct} correct / ${qs.attempts} attempts` : '',
      qs.sureWrong > 0 ? `confidently-wrong ×${qs.sureWrong}` : '',
      qs.missed.length > 0 ? `open misses: ${qs.missed.map(m => `"${m.question.slice(0, 80)}"`).join('; ')}` : '',
    ].filter(Boolean).join(' · ')
    return `- "${n.title}" — ${bits}`
  }).join('\n')

  const progressLines = real.flatMap(n => {
    try {
      const log = JSON.parse(n.progressLog ?? '[]') as Array<{ text: string; createdAt: string }>
      return log.slice(-5).map(e => `- [${(e.createdAt ?? '').slice(0, 10)}] (${n.title}) ${e.text}`)
    } catch { return [] }
  }).join('\n')

  const notesLines = real.filter(n => n.notes?.trim()).map(n => `- (${n.title}) ${n.notes!.slice(0, 250)}`).join('\n')
  const locker = await evidenceLocker(userId, tree.nodes, undefined, { maxFiles: 8, excerpt: 500 })

  const client = await anthropic()
  const model = await getJudgeModel()
  const result = await client.messages.create({
    model,
    max_tokens: 1600,
    messages: [{
      role: 'user',
      content: `Write the TREE DIGEST — a dense, copy-ready status report of one problem-mastery session, for the learner to read or paste to their team.

PROBLEM (root): "${tree.title}"
${tree.framing ? `FRAMING: ${tree.framing}` : ''}
${tree.purpose ? `PURPOSE (why they're mastering this): ${tree.purpose}` : ''}
Verified: ${real.filter(n => n.status === 'understood').length}/${real.length} nodes.

NODES:
${nodeLines || '(none)'}

BUILD LOG (real-world execution detected in chats):
${progressLines || '(none recorded)'}

STUDENT NOTES:
${notesLines || '(none)'}
${locker || '\n(no evidence files uploaded)'}

Write markdown with EXACTLY these sections (omit a section only if truly empty, saying so in one line):
## TL;DR — 2-3 sentences: where this problem stands right now.
## Key numbers — every real metric found in the evidence/logs/notes as "metric: value (→ target if stated)". STRICT: only numbers that literally appear above; if none exist, write "No measured numbers yet — upload evidence to track them."
## Findings — what has been established (verified nodes' core takeaways, discoveries from the build log).
## Progress made — what was actually done, newest first.
## Blockages & open questions — unverified nodes standing in the way, missed checkpoints not yet retested, confidently-wrong blind spots, unanswered real-world questions.
## Next actions — 3-5 concrete, ordered steps (learning AND real-world doing).

Dense and factual — no praise, no filler, no invented data.
${sessionDirectives(tree, lang)}`,
    }],
  })
  void recordUsage(result, userId, model, 'tree-digest')
  const digest = (result.content[0] as { text?: string })?.text?.trim() ?? ''
  if (!digest) throw new Error('Digest generation failed')

  const digestAt = new Date()
  await prisma.problemTree.update({ where: { id: treeId }, data: { digest, digestAt } }).catch(() => null)
  return { digest, digestAt }
}

/**
 * A failed short-answer checkpoint is diagnostic gold — record the gap.
 * Reinforce-over-duplicate: repeated misses on the same node bump the
 * existing struggle insight instead of stacking near-identical rows
 * (a bad afternoon must not clutter Bob's memory).
 */
export async function recordCheckpointStruggle(userId: string, nodeTitle: string, feedback: string, lang?: string): Promise<void> {
  try {
    // Match the DELIMITED title in either quote style ("title" EN / 「title」
    // 中文). Delimiters keep dedup cross-language AND collision-immune — a bare
    // substring would let a miss on "递归" bump the "尾递归" row.
    const existing = await prisma.insight.findFirst({
      where: {
        userId, type: 'struggle', status: 'active',
        OR: [{ content: { contains: `"${nodeTitle}"` } }, { content: { contains: `「${nodeTitle}」` } }],
      },
      orderBy: { lastConfirmedAt: 'desc' },
    }).catch(() => null)
    if (existing) {
      await prisma.insight.update({
        where: { id: existing.id },
        data: {
          timesObserved: { increment: 1 },
          lastConfirmedAt: new Date(),
          confidence: Math.min(1, (existing.confidence ?? 0.5) + 0.05),
        },
      })
      return
    }
    await prisma.insight.create({
      data: {
        userId,
        type: 'struggle',
        // Localized wrapper so a 中文 open learner model stays all-Chinese.
        content: lang === 'zh'
          ? `在「${nodeTitle}」上答错了一道检查题：${clampText(feedback, 180)}`
          : `Missed a checkpoint on "${nodeTitle}": ${clampText(feedback, 180)}`,
        confidence: 0.85,
        importance: 0.55,
        source: 'verification',
      },
    })
  } catch { /* non-critical */ }
}
