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
import { CHAT_MODELS, NO_THINKING } from '@/lib/chat-model-router'
import { buildContextCatalog, fetchRequestedContext, type ContextRequestNode, type RecalledRef } from '@/lib/tree-context'
import { ensureUserRow } from '@/lib/ensure-user'
import { clampText } from '@/lib/clamp'
import { NEW_PREFIX, REWIRE_MAX_OPS, simulateRewire, type RewireOp, type RewirePlan } from '@/lib/rewire'
import { parseQuizState } from '@/lib/mastery'

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

// The Answer Standard's companion law (canonical wording in FOUNDATION.md):
// a node teaches ONLY its own new ground — the branch below it is a launchpad,
// never a rerun. Injected wherever ancestor coverage is shown to the model.
export const NO_REDUNDANCY = `RULE — PER-NODE REDUNDANCY AVOIDANCE (law): this node teaches ONLY its own NEW ground. Material the branch below already covered is BUILT ON, never re-taught — acknowledge it in one clause ("you already verified how X works at '<node>' — building on that…") and go straight to what is new here. Re-explaining an ancestor's material is a failed syllabus and a failed answer. The boundary holds upward too: material owned by a child or sibling node is pointed to, not absorbed.`

// Plain Language, Intuition First (law — user directive, Aug 2026): node
// content kept coming out too technical. Rides inside sessionDirectives()
// so EVERY content-producing prompt (seed, syllabus, explainer, chat,
// checkpoints, copilot, grow box, answer, digests) gets it for free.
export const PLAIN_LANGUAGE = `RULE — PLAIN LANGUAGE, INTUITION FIRST (law): teach in the simplest words that still carry the full idea — short sentences, everyday wording, concrete pictures before abstractions. Build the intuition first (what it IS, plainly, with one concrete example), then name it precisely. Every technical term that must appear gets a plain-words unpacking in the same breath ("entropy — how spread out the energy is"). Never use a hard word where a simple one carries the same meaning, and never add words that don't earn their place: the goal is the FEWEST, SIMPLEST words that produce complete understanding. The session's target level raises DEPTH and rigor — never jargon density or wordiness: an advanced session still reads plainly, it just goes deeper.`

// Structured & Short (law — user directive, Aug 2026): plain-worded turns
// were still shipping as multi-page essays — same analogy retold, stacked
// paragraphs, no scannable shape. Rides sessionDirectives() beside
// PLAIN_LANGUAGE so every content surface gets it.
export const STRUCTURED_BREVITY = `RULE — STRUCTURED & SHORT (law): write to be scanned, not read end-to-end.
- Bullets with **bold lead-ins** are the DEFAULT body. A prose paragraph only where one flowing thought truly needs it — max 3 short sentences, never two paragraphs in a row.
- Every substantial reply has visible structure: one ## title naming the turn's topic, ### subheads for its parts, bullets under them. A wall of stacked paragraphs is a failed reply.
- SAY IT ONCE: one explanation and ONE example or analogy per concept — never the same story retold from a second angle, no preamble, no recap of what was already said, no closing summary.
- LENGTH BUDGET: a typical teaching turn fits in ~150 words; a full remediation/deep-dive in ~250. Only the student explicitly asking for more justifies more. If half the lines could be cut without losing meaning, cut them BEFORE sending.`

// Goal-Necessity & Plan-First Growth (law — canonical wording in
// FOUNDATION.md): the discipline for EVERY prompt that lays out nodes
// (seed, grow-box expansion, copilot, discovery). Analyze the goal first,
// then emit only load-bearing nodes.
export const GOAL_NECESSITY = `RULE — GOAL-NECESSITY & PLAN-FIRST GROWTH (law): the tree exists to thoroughly explain the concept/product or solve the problem at the ROOT — nothing else. Before naming ANY node, first think through what achieving that goal ACTUALLY requires (the irreducible pillars an expert would name, calibrated to this session's purpose and depth) — and only then lay out nodes, each traceable to a requirement in that analysis. NECESSITY TEST for every candidate node: if the learner mastered everything else except this node, would the goal have a hole in it? If not — merely related, interesting, adjacent, "good background" — the node does NOT belong. Nodes are load-bearing, never decorative; fewer essential nodes always beat more; a tree shaped like the topic's table of contents instead of the goal's requirements is a failed tree.`

/**
 * Every tree is a self-contained SESSION with its own language, target
 * difficulty, and the student's stated background for this problem —
 * collected at session onboarding. All AI output within the session
 * follows these, not any global state.
 */
export function sessionDirectives(tree: SessionFields, fallbackLang?: string): string {
  const lang = tree.language ?? fallbackLang
  const parts = [langDirective(lang ?? undefined), PLAIN_LANGUAGE, STRUCTURED_BREVITY]
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


async function recordUsage(result: { usage?: unknown }, userId: string, model: string, feature: 'tree-seed' | 'tree-expand' | 'tree-explainer' | 'tree-verify' | 'tree-digest' | 'tree-copilot' | 'tree-summary') {
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

/**
 * All text blocks of a response, joined. Never index content[0] directly:
 * on a thinking-capable model the first block can be a thinking block, and
 * a content[0].text read silently returns '' — the "generation failed"
 * failure mode with no trace.
 */
function responseText(result: { content: Array<{ type?: string; text?: string }> }): string {
  return result.content
    .filter(b => b.type === 'text' && typeof b.text === 'string')
    .map(b => b.text as string)
    .join('\n')
}

/** Student grounding for calibrated output (level, interests, memory).
 *  Exported: the node chat and copilot prompts call it too — the insight
 *  moat is useless if it only reaches the seed and the one-time explainer
 *  (the two surfaces a learner sees least). Token-light: ≤8 insight rows +
 *  ≤3 misconceptions, all clamped upstream. */
export async function studentGrounding(userId: string): Promise<string> {
  try {
    const { getStudentContext } = await import('@/lib/student-context')
    const ctx = await getStudentContext(null, userId)
    // STANDING MISCONCEPTION BLOCK: systematic wrong beliefs were write-only
    // (created/reinforced/resolved but never read back by a teaching prompt).
    // Repair theory's whole claim is that these survive ordinary practice —
    // so every teaching surface now sees the active ones.
    let misconceptions: Array<{ content: string }> = []
    try {
      const { getTopInsights } = await import('@/lib/insight-memory')
      misconceptions = await getTopInsights(userId, { limit: 3, types: ['misconception'] })
    } catch { /* non-critical */ }
    const parts = [
      ctx.profile.advancementLevel ? `Target level: ${ctx.profile.advancementLevel}` : '',
      ctx.profile.occupation ? `Background: ${ctx.profile.occupation}` : '',
      ctx.interests.length ? `Interests: ${ctx.interests.slice(0, 5).join(', ')}` : '',
      ctx.insights.length ? `Known about the student:\n${ctx.insights.slice(0, 8).map(i => `- [${i.type}] ${i.content}`).join('\n')}\nWhere natural, build explanations as analogies from their [knowledge] and [strength] entries — connect new concepts to what they verifiably already understand.` : '',
      misconceptions.length ? `ACTIVE MISCONCEPTIONS (systematic wrong beliefs on record — if this material touches one, refute it directly and memorably BEFORE building anything on top of it; never assume it self-corrected):\n${misconceptions.map(m => `- ${m.content}`).join('\n')}` : '',
    ].filter(Boolean)
    return parts.length ? `\n## About this student\n${parts.join('\n')}` : ''
  } catch {
    return ''
  }
}

/**
 * Short display headline for a tree (Haiku) — what the tree LIST cards and
 * page headers show instead of the raw, often-rambling problem statement the
 * student typed at onboarding. Presentation only: `ProblemTree.title` stays
 * verbatim and remains the ROOT PROBLEM in every prompt. Best-effort — any
 * failure returns null and the UI falls back to the verbatim title.
 */
export async function generateTreeDisplayTitle(
  userId: string, problem: string, lang?: string,
): Promise<string | null> {
  try {
    const client = await anthropic()
    const { getBackgroundModel } = await import('@/lib/model-resolver')
    const model = await getBackgroundModel()
    const result = await client.messages.create({
      model,
      max_tokens: 60,
      ...NO_THINKING,
      messages: [{
        role: 'user',
        content: `A learner typed this problem they want to master (verbatim, may be rambling):
"${problem.slice(0, 600)}"

Write a SHORT, specific title for it — 3 to 7 words, no quotes, no trailing period, title-case where natural. It must capture the CONCRETE goal (keep domain terms like QFT; "Plump, Sweet Backyard Strawberries" beats "Learning About Strawberries").
${lang === 'zh' ? 'Respond in Simplified Chinese (简体中文).' : 'Respond in English.'}
Return ONLY the title text.`,
      }],
    }, { timeout: 10000, maxRetries: 1 })
    try {
      const { recordAnthropicUsage } = await import('@/lib/usage')
      recordAnthropicUsage(result.usage, { userId, model, feature: 'title' })
    } catch { /* non-critical */ }
    const text = responseText(result)
      .trim().replace(/^["'“”]+|["'“”.。]+$/g, '').trim()
    // Sanity bounds: a degenerate echo (empty or the whole ramble) is worse
    // than the fallback.
    if (!text || text.length < 2 || text.length > 80) return null
    return text
  } catch {
    return null // fall back to the verbatim problem statement
  }
}

/**
 * RECIPROCITY GIFT for the session onboarding: the moment the problem is
 * typed — before a single further question is answered — Bob hands back a
 * genuinely useful 2-3 sentence first read ("what mastering this actually
 * involves"). Haiku, background-fired, never blocks the stepper.
 */
export async function firstProblemRead(
  userId: string, problem: string, lang?: string,
): Promise<string | null> {
  try {
    const client = await anthropic()
    const { getBackgroundModel } = await import('@/lib/model-resolver')
    const model = await getBackgroundModel()
    const result = await client.messages.create({
      model,
      max_tokens: 260,
      ...NO_THINKING,
      messages: [{
        role: 'user',
        content: `You are Bob, an expert mentor. A learner just told you the problem they want to master:
"${problem.slice(0, 600)}"

Give them an IMMEDIATELY useful first read — 2-3 sentences: what mastering this actually involves (the real crux or the 2-3 load-bearing pieces), concrete and specific to THIS problem, no generic study advice, no questions back. This is a gift of insight before setup even finishes. Plain, simple words — any technical term gets a plain-words unpacking in the same breath.
${lang === 'zh' ? 'Respond in Simplified Chinese (简体中文).' : 'Respond in English.'}
Return ONLY the 2-3 sentences.`,
      }],
    }, { timeout: 12000, maxRetries: 1 })
    try {
      const { recordAnthropicUsage } = await import('@/lib/usage')
      recordAnthropicUsage(result.usage, { userId, model, feature: 'onboarding' })
    } catch { /* non-critical */ }
    const text = responseText(result).trim()
    return text.length >= 20 ? text.slice(0, 700) : null
  } catch {
    return null
  }
}

/**
 * SMART DEFAULTS for the session onboarding's PURPOSE step: three tappable
 * candidate purposes drafted from the just-typed problem (Haiku, fired in the
 * background while the student answers the next question). The client shows
 * localized canned chips until these arrive; a null return keeps the canned
 * set — never blocks the stepper.
 */
export async function suggestPurposeIdeas(
  userId: string, problem: string, lang?: string,
): Promise<string[] | null> {
  try {
    const client = await anthropic()
    const { getBackgroundModel } = await import('@/lib/model-resolver')
    const model = await getBackgroundModel()
    const result = await client.messages.create({
      model,
      max_tokens: 220,
      ...NO_THINKING,
      messages: [{
        role: 'user',
        content: `A learner wants to master this problem:
"${problem.slice(0, 600)}"

Draft the 3 MOST LIKELY reasons someone states this problem — what they would DO with mastery (the session's purpose). Each: one concrete sentence ≤ 14 words, first person ("I want to…" implied, so start with the verb phrase, e.g. "Grow sweeter strawberries in my own backyard this season"). Distinct intents: e.g. apply/build, deeply understand the mechanism, prepare for something specific.
${lang === 'zh' ? 'Respond in Simplified Chinese (简体中文).' : 'Respond in English.'}
Return ONLY JSON: ["…","…","…"]`,
      }],
    }, { timeout: 10000, maxRetries: 1 })
    try {
      const { recordAnthropicUsage } = await import('@/lib/usage')
      recordAnthropicUsage(result.usage, { userId, model, feature: 'onboarding' })
    } catch { /* non-critical */ }
    const text = responseText(result)
    const ideas = extractJSON<string[]>(text)
    const clean = (Array.isArray(ideas) ? ideas : [])
      .filter(x => typeof x === 'string' && x.trim().length >= 4)
      .map(x => x.trim().slice(0, 140))
      .slice(0, 3)
    return clean.length === 3 ? clean : null
  } catch {
    return null
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
    max_tokens: 3500,
    ...NO_THINKING,
    messages: [{
      role: 'user',
      content: `You are Bob, an expert mentor. A student wants to master ONE specific problem. Design the SEED of a learning tree for it.

THE PROBLEM: "${problem}"
${sessionDirectives(session)}
${grounding}

The tree model: the problem is the ROOT. Base branches are the CANDIDATE SOLUTIONS or FOUNDING CONCEPTS that answer it (real, distinct approaches or conceptual pillars an expert would name — 1 to 3; use 1 only when the problem has a single canonical resolution). Generate ONLY the root and these first branches — NOTHING deeper. The whole point of this product is that deeper nodes are pain points the student DISCOVERS through their own questions while working; the tree must never grow ahead of their curiosity.

${GOAL_NECESSITY}

WORK IN TWO PASSES, in this one reply:
PASS 1 — PLAN (prose, a short paragraph under the heading "PLAN:"): analyze the goal deeply before naming any node. What does achieving THIS goal actually require — what would an expert name as its irreducible pillars? What does this student's stated purpose/background/depth change about that? Which tempting branches fail the necessity test and are deliberately excluded? This analysis is working thought, never shown to the student.
PASS 2 — THE SEED, as JSON in a \`\`\`json fence. Every branch must be traceable to a requirement named in your plan.

Every node needs:
- "title": 2-6 words, the concept's name
- "summary": 1-2 sentences, a simplified plain-language description of what this is and why it matters to the problem (this appears ON the node in a logic diagram)

Also write:
- "framing": one tight paragraph restating the problem precisely — what mastery of it means, what the end state looks like
- "rootSummary": 1-2 sentence summary for the root node itself

JSON shape:
{"framing": "...", "rootSummary": "...", "solutions": [{"title": "...", "summary": "..."}]}`,
    }],
  })

  void recordUsage(result, userId, model, 'tree-seed')
  const text = responseText(result)
  const seed = extractJSON<SeedResult>(text)
  if (!seed?.solutions?.length) throw new Error('Seed generation failed')

  // The insert must never fail AFTER the seed was paid for — guarantee the
  // FK target exists (first-action users have no row yet).
  await ensureUserRow(userId)

  // Short display headline (Haiku) — the card/header title. Best-effort: a
  // failure just means the UI falls back to the verbatim problem statement.
  const displayTitle = await generateTreeDisplayTitle(userId, problem, session.language ?? undefined)

  const tree = await prisma.problemTree.create({
    data: {
      userId,
      title: clampText(problem, 300),
      displayTitle,
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
      order: 0, origin: 'seed',
    },
  })
  // Seed stops at the solution branches — every deeper node is a pain point
  // the student discovers through their own questions.
  for (let s = 0; s < seed.solutions.length; s++) {
    const sol = seed.solutions[s]
    await prisma.treeNode.create({
      data: {
        treeId: tree.id, parentId: root.id, kind: 'solution',
        title: sol.title.slice(0, 120), summary: sol.summary ?? '', order: s, origin: 'seed',
      },
    })
  }
  return tree.id
}

// ── Context helpers ──────────────────────────────────────────────────────

export async function getTreeWithNodes(userId: string, treeId: string) {
  return prisma.problemTree.findFirst({
    where: { id: treeId, userId },
    // order-first: the copilot's "reorder" op sets the recommended learning
    // path per sibling group; createdAt breaks ties for legacy rows.
    include: { nodes: { orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] } },
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

// ── Node kind is DEPTH, nothing else (small-to-big law) ──────────────────
// root = the problem · level 1 = solution directions · level 2 = components
// · deeper = technical-knowledge leaves. Kinds are cosmetic-but-semantic
// (canvas dot size/color, prompts name them), so a COMPONENT sitting above a
// SOLUTION after a restructure inverts the whole product model on screen.

export function kindForDepth(depth: number): 'root' | 'solution' | 'component' | 'leaf' {
  return depth <= 0 ? 'root' : depth === 1 ? 'solution' : depth === 2 ? 'component' : 'leaf'
}

/**
 * Recompute EVERY node's kind from its live depth. Structural ops (move,
 * merge, insert-a-layer adoption, split, spinoff, rebalance, add-child)
 * change depths, so the tree is re-normalized wholesale after each one —
 * cheap (one findMany + only the drifted rows written), and it also heals
 * any inversion left behind by older restructures.
 */
export async function normalizeTreeKinds(treeId: string): Promise<void> {
  try {
    const nodes = await prisma.treeNode.findMany({
      where: { treeId },
      select: { id: true, parentId: true, kind: true },
    })
    const parentOf = new Map(nodes.map(n => [n.id, n.parentId]))
    const depthOf = (id: string): number => {
      let d = 0
      let cur = parentOf.get(id) ?? null
      while (cur && d <= 50) { d++; cur = parentOf.get(cur) ?? null }
      return d
    }
    const fixes = nodes
      .map(n => ({ id: n.id, want: kindForDepth(depthOf(n.id)), have: n.kind }))
      .filter(x => x.want !== x.have)
    if (fixes.length > 0) {
      await prisma.$transaction(fixes.map(f =>
        prisma.treeNode.update({ where: { id: f.id }, data: { kind: f.want } })))
    }
  } catch { /* non-critical — display-layer semantics, never block the op */ }
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
    // SPLIT FETCH: media rows (data: URIs) can be multi-MB of base64 that was
    // being pulled over the wire on every chat turn/explainer/digest purely to
    // be listed by name — fetch their Gemini `analysis` instead (that's the
    // legible evidence: photos ARE the dominant artifact), and pull `content`
    // only for text rows.
    const media = await prisma.linkedFile.findMany({
      where: { userId, workType: 'tree-node', workId: { in: nodeIds }, content: { startsWith: 'data:' } },
      select: { name: true, workId: true, mimeType: true, analysis: true },
      orderBy: { addedAt: 'desc' },
      take: maxFiles,
    })
    const textFiles = await prisma.linkedFile.findMany({
      where: { userId, workType: 'tree-node', workId: { in: nodeIds }, NOT: { content: { startsWith: 'data:' } } },
      select: { name: true, workId: true, content: true, addedAt: true },
      orderBy: { addedAt: 'desc' },
      take: maxFiles,
    })
    const rows = [
      ...textFiles.map(f => ({ at: titleById.get(f.workId ?? '') ?? 'tree', text: `### ${f.name} (at "${titleById.get(f.workId ?? '') ?? 'tree'}")\n${(f.content ?? '').slice(0, excerpt)}${(f.content ?? '').length > excerpt ? '\n…(truncated)' : ''}` })),
      ...media.map(f => ({
        at: titleById.get(f.workId ?? '') ?? 'tree',
        text: f.analysis?.trim()
          ? `### ${f.name} (at "${titleById.get(f.workId ?? '') ?? 'tree'}" — ${f.mimeType ?? 'media'}, Gemini analysis)\n${f.analysis.slice(0, excerpt)}${f.analysis.length > excerpt ? '\n…(truncated)' : ''}`
          : `### ${f.name} (at "${titleById.get(f.workId ?? '') ?? 'tree'}") — ${f.mimeType ?? 'binary'}, analysis pending`,
      })),
    ].slice(0, maxFiles)
    if (rows.length === 0) return ''
    return `\n## TREE EVIDENCE LOCKER (real artifacts uploaded across this tree — ground every number and claim in these; NEVER invent measurements when evidence exists)\n` + rows.map(r => r.text).join('\n\n')
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

/**
 * The node's whole subtree (itself + every descendant), walked over ALL
 * nodes — pending ghosts included, so no chain can slip through. The ONE
 * implementation behind every cycle guard and subtree sweep (copilot move
 * validation, the node route's move/delete): these must stay semantically
 * identical for advisory validation and authoritative enforcement to agree.
 */
export function collectSubtreeIds(nodes: Array<{ id: string; parentId: string | null }>, rootId: string): Set<string> {
  const children = new Map<string, string[]>()
  for (const n of nodes) {
    if (!n.parentId) continue
    if (!children.has(n.parentId)) children.set(n.parentId, [])
    children.get(n.parentId)!.push(n.id)
  }
  const out = new Set<string>([rootId])
  const queue = [rootId]
  while (queue.length) {
    for (const kid of children.get(queue.shift()!) ?? []) {
      if (!out.has(kid)) { out.add(kid); queue.push(kid) }
    }
  }
  return out
}

/**
 * Deterministic POSITION block — where a node sits on the way to solving the
 * root problem. Cheap (no queries, no tokens): the branch path, which top-level
 * solution it serves, how much of the foundation below it is already verified,
 * and overall tree progress. Injected alongside the ancestor coverage so every
 * node's workspace knows its role in the whole, not just its local content.
 * Returns '' at the root (the problem statement has no "position" to frame).
 */
export function nodePositionBlock(nodes: TreeNode[], nodeId: string): string {
  const path = nodePath(nodes, nodeId)
  if (path.length <= 1) return ''
  // Masterable nodes = everything except the root (the root is the problem
  // statement, not a node the learner verifies) and pending ghosts.
  const masterable = nodes.filter(n => !n.pending && n.parentId !== null)
  const root = path[0]
  const solution = path[1] // the top-level solution branch this node hangs under
  const ancestors = path.slice(1, -1) // solution … parent — the climb below this node
  const ancestorsDone = ancestors.filter(n => n.status === 'understood').length
  const treeDone = masterable.filter(n => n.status === 'understood').length
  const isTopLevel = path.length === 2
  const lines = [
    `## WHERE THIS NODE SITS ON THE WAY TO SOLVING THE ROOT`,
    `Root problem: "${clampText(root.title, 140)}".`,
    isTopLevel
      ? `This node is a top-level solution branch hanging directly off the root.`
      : `This node serves the solution branch "${clampText(solution.title, 80)}"; ${ancestorsDone}/${ancestors.length} of the ancestor node${ancestors.length === 1 ? '' : 's'} below it on this branch ${ancestorsDone === ancestors.length ? 'are already verified' : 'are verified so far'} — build on them, never re-teach them.`,
    `Overall progress: ${treeDone}/${masterable.length} of the tree's nodes are verified; mastering this node moves the root problem one node closer to solved.`,
  ]
  return `\n${lines.join('\n')}`
}

/**
 * Live-derived teaching digest for ONE ancestor — the FALLBACK for
 * branchCoverage() when a node has never been summarized yet (brand-new work).
 * Reads that node's workspace conversation: its syllabus opener + newest real
 * (non-verdict) teaching turn. The persisted contextSummary replaces this the
 * moment the background pass runs, so this raw-message path fades out per node.
 */
async function liveAncestorDigest(userId: string, ancestorId: string): Promise<string> {
  // Strip machine blocks — a checkpoint's JSON or an image directive is noise
  // inside a coverage digest.
  const clean = (s: string) =>
    s.replace(/\[\[QUIZ\]\][\s\S]*$/, '').replace(/```image[\s\S]*?```/g, '(diagram)').trim()
  const conv = await prisma.conversation.findFirst({
    where: { userId, context: `tree-node:${ancestorId}` },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  }).catch(() => null)
  if (!conv) return ''
  const [firstBob, recentBobs] = await Promise.all([
    prisma.message.findFirst({ where: { conversationId: conv.id, role: 'assistant' }, orderBy: { createdAt: 'asc' }, select: { id: true, content: true } }).catch(() => null),
    prisma.message.findMany({ where: { conversationId: conv.id, role: 'assistant' }, orderBy: { createdAt: 'desc' }, take: 8, select: { id: true, content: true } }).catch(() => []),
  ])
  const syllabus = firstBob ? clean(firstBob.content).slice(0, 600) : ''
  // The NEWEST assistant message on a verified/in-progress ancestor is usually
  // a quiz-route VERDICT BANNER (starts ✅/❌/🎉/🌱) — bookkeeping, not teaching.
  // Sample the newest NON-verdict turn so the digest reflects real teaching
  // (emoji prefix is language-independent).
  const isVerdict = (s: string) => /^\s*(✅|❌|🎉|🌱)/.test(s)
  const teaching = recentBobs.find(m => m.id !== firstBob?.id && clean(m.content).length > 0 && !isVerdict(clean(m.content)))
  const latest = teaching ? clean(teaching.content).slice(0, 350) : ''
  return [
    syllabus ? `Its workspace laid out: ${syllabus}` : '',
    latest ? `Latest teaching there: ${latest}` : '',
  ].filter(Boolean).join('\n')
}

/**
 * ALREADY-COVERED digest of the branch BELOW a node — what each ancestor's
 * workspace (root → parent) actually established, plus WHERE this node sits on
 * the way to the root. Each ancestor contributes its persisted CONTEXT SUMMARY
 * (a distilled, continuously-updated digest — see refreshNodeContextSummary),
 * which is read for free instead of re-slicing raw conversation messages every
 * turn; a node not yet summarized falls back to a live derivation. Injected
 * into the node chat + explainer prompts so every node BUILDS ON the branch
 * instead of re-teaching it (per-node redundancy avoidance — law, FOUNDATION.md).
 * Returns just the position block (usually '') at the root. Best-effort.
 */
export async function branchCoverage(userId: string, nodes: TreeNode[], nodeId: string): Promise<string> {
  try {
    const position = nodePositionBlock(nodes, nodeId)
    // Nearest 4 ancestors, kept in root-first order so the digest reads as
    // the student's actual climb.
    const ancestors = nodePath(nodes, nodeId).slice(0, -1).slice(-4)
    if (ancestors.length === 0) return position
    const { parseQuizState } = await import('@/lib/mastery')

    const sections: string[] = []
    for (const a of ancestors) {
      const qs = parseQuizState(a.quizState)
      const state = a.status === 'understood'
        ? 'VERIFIED — the student PROVED mastery here'
        : qs.attempts > 0
          ? `in progress (${qs.correct} checkpoint${qs.correct === 1 ? '' : 's'} correct so far)`
          : 'opened but not yet verified'
      // Prefer the ancestor's persisted CONTEXT SUMMARY — a purpose-built,
      // distilled digest kept fresh in the background. Reading it costs nothing
      // and is why this whole path no longer re-derives every ancestor from raw
      // messages on each turn. Fall back to a live derivation only for a node
      // that has never been summarized; the background pass replaces that
      // within a turn or two of real work.
      const covered = a.contextSummary?.trim()
        ? a.contextSummary.trim()
        : await liveAncestorDigest(userId, a.id)
      sections.push([
        `### "${a.title}" — ${state}`,
        a.summary ? `Scope: ${a.summary.slice(0, 200)}` : '',
        a.notes?.trim() ? `The student's own notes there: ${a.notes.trim().slice(0, 200)}` : '',
        covered,
      ].filter(Boolean).join('\n'))
    }
    return `${position}\n## ALREADY COVERED BELOW ON THIS BRANCH (root → parent — the ground the student climbed to get here)\n${sections.join('\n')}\n${NO_REDUNDANCY}`
  } catch {
    return ''
  }
}

/**
 * Regenerate a node's CONTEXT SUMMARY — the continuously-updated, distilled
 * digest of what THIS node's workspace proved and taught, plus its role toward
 * the root problem. A cheap background pass (Haiku): every ancestor's workspace
 * is read by its descendants through branchCoverage() via this summary INSTEAD
 * of re-deriving it from raw conversation messages on every turn — the per-node
 * redundancy law (FOUNDATION.md) without the token/context bloat. Triggered
 * after substantive node chat and on verification. Best-effort — never blocks a
 * user response and never throws into its caller.
 */
export async function refreshNodeContextSummary(userId: string, treeId: string, nodeId: string, lang?: string): Promise<void> {
  try {
    const tree = await getTreeWithNodes(userId, treeId)
    if (!tree) return
    const node = tree.nodes.find(n => n.id === nodeId)
    if (!node || node.pending) return
    const sessionLang = lang ?? tree.language ?? undefined
    const zh = sessionLang === 'zh'

    const { parseQuizState } = await import('@/lib/mastery')
    const qs = parseQuizState(node.quizState)

    // This node's OWN workspace conversation — its teaching record.
    const clean = (s: string) =>
      s.replace(/\[\[QUIZ\]\][\s\S]*$/, '').replace(/```image[\s\S]*?```/g, '(diagram)').trim()
    const isVerdict = (s: string) => /^\s*(✅|❌|🎉|🌱)/.test(s)
    let syllabus = ''
    let teachingExcerpts: string[] = []
    // The newest source-message time this summary is built FROM — used below as
    // a monotonic write guard so an older-state refresh that finishes late can
    // never clobber a newer one (both call sites are backgrounded and can race,
    // e.g. a chat refresh still in flight when verification schedules another).
    let basisAt: Date | null = null
    const conv = await prisma.conversation.findFirst({
      where: { userId, context: `tree-node:${nodeId}` },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    }).catch(() => null)
    if (conv) {
      const [firstBob, recentBobs] = await Promise.all([
        prisma.message.findFirst({ where: { conversationId: conv.id, role: 'assistant' }, orderBy: { createdAt: 'asc' }, select: { id: true, content: true } }).catch(() => null),
        prisma.message.findMany({ where: { conversationId: conv.id, role: 'assistant' }, orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, content: true, createdAt: true } }).catch(() => []),
      ])
      syllabus = firstBob ? clean(firstBob.content).slice(0, 1200) : ''
      teachingExcerpts = recentBobs
        .filter(m => m.id !== firstBob?.id && clean(m.content).length > 0 && !isVerdict(clean(m.content)))
        .slice(0, 3)
        .map(m => clean(m.content).slice(0, 700))
      // recentBobs is ordered newest-first, so [0] is the latest activity here
      // (a verification refresh runs after the quiz route persists its banner,
      // so its basis is strictly newer than any pre-verification chat refresh).
      basisAt = recentBobs[0]?.createdAt ?? null
    }

    // Nothing to summarize yet — don't burn a call or clobber a good summary
    // with an empty one.
    if (!syllabus && teachingExcerpts.length === 0 && !node.notes?.trim() && !node.explainer?.trim()) return

    const path = nodePath(tree.nodes, nodeId)
    const facetsDone = qs.facets?.filter(f => f.done).map(f => f.name) ?? []
    const facetsOpen = qs.facets?.filter(f => !f.done).map(f => f.name) ?? []
    const missed = (qs.missed ?? []).map(m => m.question.slice(0, 120))
    const state = node.status === 'understood'
      ? 'VERIFIED — the learner proved mastery here'
      : qs.attempts > 0 ? `in progress (${qs.correct} correct / ${qs.attempts} attempts)` : 'opened, not yet verified'

    const client = await anthropic()
    const { getBackgroundModel } = await import('@/lib/model-resolver')
    const model = await getBackgroundModel()
    const result = await client.messages.create({
      model,
      max_tokens: 500,
      ...NO_THINKING,
      messages: [{
        role: 'user',
        content: `You are writing the CONTEXT SUMMARY for one node of a learner's problem-mastery tree. This summary is read by the workspaces of the nodes ABOVE this one so they build on what was established here WITHOUT re-teaching it, and so the learner always knows how this node fits into solving the root problem. Be dense, factual, and specific — no praise, no filler, no invented content.

ROOT PROBLEM: "${tree.title}"
THIS NODE: "${node.title}" — ${node.summary}
Branch (root → here): ${path.map(n => `"${n.title}"`).join(' → ')}
Verification state: ${state}
${facetsDone.length ? `Facets PROVEN here: ${facetsDone.join('; ')}` : ''}
${facetsOpen.length ? `Facets still OPEN: ${facetsOpen.join('; ')}` : ''}
${missed.length ? `Checkpoints missed (sticking points): ${missed.join(' | ')}` : ''}
${node.notes?.trim() ? `Learner's own notes: ${node.notes.trim().slice(0, 500)}` : ''}
${syllabus ? `Workspace opening / syllabus: ${syllabus}` : ''}
${teachingExcerpts.length ? `Teaching that happened here:\n${teachingExcerpts.map((t, i) => `(${i + 1}) ${t}`).join('\n')}` : ''}
${node.explainer?.trim() && !syllabus ? `Node explainer: ${node.explainer.slice(0, 1000)}` : ''}

Write compact markdown with EXACTLY these four short sections (one to three tight bullets each; omit a bullet only if genuinely empty — never pad):
**Established here** — the specific concepts/mechanisms this node actually TAUGHT (what an upper node may reference in one clause and must not re-explain).
**Proven** — what the learner has verifiably demonstrated (from proven facets / correct own-words answers); write "nothing verified yet" if so.
**Still open** — unproven facets, missed checkpoints, or sticking points a later node should know about; write "none" if so.
**Role toward the root** — one sentence: how mastering this node contributes to solving the root problem.

Keep the WHOLE summary under 180 words. Write every word in ${zh ? 'Simplified Chinese (简体中文)' : 'English'}.`,
      }],
    })
    void recordUsage(result, userId, model, 'tree-summary')
    const summary = responseText(result).trim()
    if (!summary) return
    // Monotonic compare-and-set: write only if no fresher summary already
    // landed (contextSummaryAt is the basis-message time, so "fresher" = built
    // from newer messages). A summary with no conversation basis (notes/
    // explainer only) stamps write-time — it races nothing message-based.
    const writeAt = basisAt ?? new Date()
    await prisma.treeNode.updateMany({
      where: { id: nodeId, OR: [{ contextSummaryAt: null }, { contextSummaryAt: { lt: writeAt } }] },
      data: { contextSummary: clampText(summary, 1600), contextSummaryAt: writeAt },
    }).catch(() => null)
  } catch { /* non-critical */ }
}

/**
 * Regenerate a node's MASTERY BOARD digest — the learner-facing structured
 * narrative (headline, key moments, misconceptions cleared, Bob's read of the
 * checkpoint record, next focus) that powers the workspace progress board.
 * Sibling of refreshNodeContextSummary with the opposite audience: that one
 * is written FOR upper-node prompts, this one is written TO the learner, in
 * the session's language. Cheap Haiku background pass (usage tag
 * `tree-digest`), triggered after substantive node chat and after judged
 * checkpoints; monotonic CAS on boardDigestAt so a stale refresh finishing
 * late can never clobber a fresher one. Best-effort — never blocks a user
 * response and never throws into its caller.
 */
export async function refreshNodeBoardDigest(userId: string, treeId: string, nodeId: string, lang?: string): Promise<void> {
  try {
    const tree = await getTreeWithNodes(userId, treeId)
    if (!tree) return
    const node = tree.nodes.find(n => n.id === nodeId)
    if (!node || node.pending || node.parentId === null) return
    const zh = (lang ?? tree.language ?? undefined) === 'zh'

    const { parseQuizState } = await import('@/lib/mastery')
    const qs = parseQuizState(node.quizState)

    // This node's workspace conversation — student AND Bob turns, so the
    // digest can quote the learner's own breakthroughs, not just teaching.
    const clean = (s: string) => s
      .replace(/\[\[QUIZ\]\][\s\S]*$/, '(asked a checkpoint)')
      .replace(/\n*\[\[(DONE|INCOMPLETE|QUIZ_OFFER)\]\]/g, '')
      .replace(/\n*\[\[NEXT_NODE\]\]\{[^}]*\}/g, '')
      .replace(/```image[\s\S]*?```/g, '(sketched a diagram)')
      .trim()
    let convLines: string[] = []
    let basisAt: Date | null = null
    const conv = await prisma.conversation.findFirst({
      where: { userId, context: `tree-node:${nodeId}` },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    }).catch(() => null)
    if (conv) {
      const recent = await prisma.message.findMany({
        where: { conversationId: conv.id },
        orderBy: { createdAt: 'desc' },
        take: 18,
        select: { role: true, content: true, createdAt: true },
      }).catch(() => [])
      basisAt = recent[0]?.createdAt ?? null
      convLines = recent
        .slice()
        .reverse()
        .map(m => ({ role: m.role, text: clean(m.content) }))
        .filter(m => m.text.length > 0)
        .map(m => `${m.role === 'user' ? 'STUDENT' : 'BOB'}: ${m.text.slice(0, 450)}`)
    }

    // The build log — real-world execution progress Bob detected (the
    // achievement flow for build/solve sessions).
    let buildLines: string[] = []
    try {
      const parsed = JSON.parse(node.progressLog ?? '[]') as Array<{ text?: string; createdAt?: string }>
      if (Array.isArray(parsed)) {
        buildLines = parsed
          .filter(e => e && typeof e.text === 'string')
          .slice(-8)
          .map(e => `- ${(e.text as string).slice(0, 200)}${e.createdAt ? ` (${String(e.createdAt).slice(0, 10)})` : ''}`)
      }
    } catch { /* malformed log — digest just goes without it */ }

    // Nothing has happened here yet — don't burn a call on an empty board.
    if (convLines.length === 0 && qs.attempts === 0 && buildLines.length === 0) return

    const history = (qs.history ?? []).slice(-30)
    const historyLines = history.map(h =>
      `${h.ok ? '✔' : '✘'} ${h.kind}${h.facet ? ` on "${h.facet}"` : ''}${h.conf ? ` (felt ${h.conf})` : ''}${h.fix ? ' — FIXED a previously-missed point' : ''}${h.review ? ' [retention review]' : ''} at ${h.t.slice(0, 16)}`)
    const facetLines = (qs.facets ?? []).map(f =>
      `${f.done ? '✅ proven' : '⬜ unproven'}${f.struggled ? (f.done ? ' (failed first, then fixed)' : ' (missed — still open)') : ''} — "${f.name}"`)
    const state = node.status === 'understood'
      ? `VERIFIED${qs.reviewedAt ? ` (last retention review ${qs.reviewedAt.slice(0, 10)})` : ''}`
      : qs.attempts > 0 ? `in progress (${qs.correct} correct / ${qs.attempts} checkpoint answers)` : 'opened, not yet tested'

    const client = await anthropic()
    const { getBackgroundModel } = await import('@/lib/model-resolver')
    const model = await getBackgroundModel()
    const result = await client.messages.create({
      model,
      max_tokens: 900,
      ...NO_THINKING,
      messages: [{
        role: 'user',
        content: `You are Bob, the learner's AI mentor. Write the learner-facing PROGRESS DIGEST for one node of their problem-mastery tree — the narrative panels of their Mastery Board. Address the learner directly as "you"${zh ? ' (你)' : ''}. Ground EVERY item strictly in the material below — never invent events, quotes, scores, or beliefs that are not visibly there. Fewer true items beat padded lists; omit what the record doesn't support.

ROOT PROBLEM (session goal): "${tree.title}"${tree.purpose ? `\nWHY the learner wants this mastered: ${clampText(tree.purpose, 240)}` : ''}
THIS NODE: "${node.title}" — ${node.summary}
Verification state: ${state}
${facetLines.length ? `SYLLABUS COVERAGE MAP:\n${facetLines.join('\n')}` : 'No syllabus contract yet.'}
${historyLines.length ? `CHECKPOINT RECORD (oldest → newest):\n${historyLines.join('\n')}` : 'No checkpoints answered yet.'}
${(qs.missed ?? []).length ? `Missed checkpoints still open: ${qs.missed.map(m => m.question.slice(0, 120)).join(' | ')}` : ''}
${qs.sureWrong > 0 || qs.sureRight > 0 ? `Confidence calibration: ${qs.sureRight} sure-and-right, ${qs.sureWrong} sure-but-wrong.` : ''}
${buildLines.length ? `REAL-WORLD BUILD LOG (execution progress Bob detected):\n${buildLines.join('\n')}` : ''}
${node.notes?.trim() ? `Learner's own notes: ${node.notes.trim().slice(0, 400)}` : ''}
${convLines.length ? `RECENT WORKSPACE CONVERSATION (oldest → newest):\n${convLines.join('\n')}` : ''}

Return ONLY a JSON object, no prose around it:
{"headline": string, "moments": [{"kind": "learning"|"fixed"|"breakthrough"|"build", "text": string, "facet"?: string}], "misconceptions": [{"label": string, "cleared": boolean, "note"?: string}], "quizRead": string, "nextFocus": string}

Rules:
- headline: ONE sentence whose FORM is dictated by the verification state above — mastery is verified, never self-declared, so never claim an unproven capability:
  · nothing proven yet → the node's goal, future-framed ("The goal here: be able to ...");
  · some facets proven, not verified → "You're proving you can ..." grounded strictly in what the record shows;
  · VERIFIED → the earned form: "You can now ..." naming the strongest demonstrated capability.
- moments (up to 5, chronological): the moments real progress happened — a concept that clicked (kind "learning"), a previously-missed point later proven right (kind "fixed"), an insight in the learner's own words (kind "breakthrough"), concrete real-world build/execution progress (kind "build"). Each 1-2 specific sentences, past tense. Add "facet" only when one syllabus point clearly owns the moment (use its exact name).
- misconceptions (up to 4): wrong beliefs that actually SURFACED here (a wrong checkpoint answer, a confusion Bob corrected). "cleared": true only when the record shows the repair (a later correct answer on that ground / a fixed facet). Write "label" as the belief itself, stated plainly — not a description of the event.
- quizRead: 1-2 sentences reading the checkpoint record like a coach — the pattern, the trend, calibration (sure-but-wrong), comebacks. Only from the record above; if there are no checkpoints yet, "".
- nextFocus: the single most useful thing to prove or do next on THIS node; "" if the node is verified and nothing is open.
- Write every string in ${zh ? 'Simplified Chinese (简体中文)' : 'English'}.`,
      }],
    })
    void recordUsage(result, userId, model, 'tree-digest')
    const raw = extractJSON<Record<string, unknown>>(responseText(result))
    if (!raw) return
    // Round-trip through the shared tolerant parser so ONLY the clamped,
    // validated shape is ever stored (the client renders through the same
    // parser — the two can't drift).
    const { parseBoardDigest } = await import('@/lib/board-digest')
    const digest = parseBoardDigest(JSON.stringify(raw))
    if (!digest) return
    const writeAt = basisAt ?? new Date()
    await prisma.treeNode.updateMany({
      where: { id: nodeId, OR: [{ boardDigestAt: null }, { boardDigestAt: { lt: writeAt } }] },
      data: { boardDigest: JSON.stringify(digest), boardDigestAt: writeAt },
    }).catch(() => null)
  } catch { /* non-critical */ }
}

/**
 * ONE-CALL DIGEST PAIR (qa-findings-4 №6): the chat-route cadence used to
 * fire refreshNodeContextSummary AND refreshNodeBoardDigest back-to-back —
 * two Haiku calls re-fetching the same tree/conversation/quizState to narrate
 * the same events for two audiences. This merges them: one shared fetch, one
 * Haiku call returning both documents, each CAS-written under its own
 * monotonic guard. The standalone functions remain for the event-driven
 * callers (verification → context summary; judged answers → board digest).
 * Best-effort — never blocks a user response and never throws into its caller.
 */
export async function refreshNodeDigests(userId: string, treeId: string, nodeId: string, lang?: string): Promise<void> {
  try {
    const tree = await getTreeWithNodes(userId, treeId)
    if (!tree) return
    const node = tree.nodes.find(n => n.id === nodeId)
    if (!node || node.pending || node.parentId === null) return
    const zh = (lang ?? tree.language ?? undefined) === 'zh'

    const { parseQuizState } = await import('@/lib/mastery')
    const qs = parseQuizState(node.quizState)

    const cleanSummary = (s: string) =>
      s.replace(/\[\[QUIZ\]\][\s\S]*$/, '').replace(/```image[\s\S]*?```/g, '(diagram)').trim()
    const cleanBoard = (s: string) => s
      .replace(/\[\[QUIZ\]\][\s\S]*$/, '(asked a checkpoint)')
      .replace(/\n*\[\[(DONE|INCOMPLETE|QUIZ_OFFER)\]\]/g, '')
      .replace(/\n*\[\[NEXT_NODE\]\]\{[^}]*\}/g, '')
      .replace(/```image[\s\S]*?```/g, '(sketched a diagram)')
      .trim()
    const isVerdict = (s: string) => /^\s*(✅|❌|🎉|🌱)/.test(s)

    // ONE conversation fetch feeds both documents.
    let syllabus = ''
    let teachingExcerpts: string[] = []
    let convLines: string[] = []
    let basisAt: Date | null = null
    const conv = await prisma.conversation.findFirst({
      where: { userId, context: `tree-node:${nodeId}` },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    }).catch(() => null)
    if (conv) {
      const [firstBob, recent] = await Promise.all([
        prisma.message.findFirst({ where: { conversationId: conv.id, role: 'assistant' }, orderBy: { createdAt: 'asc' }, select: { id: true, content: true } }).catch(() => null),
        prisma.message.findMany({ where: { conversationId: conv.id }, orderBy: { createdAt: 'desc' }, take: 18, select: { id: true, role: true, content: true, createdAt: true } }).catch(() => []),
      ])
      syllabus = firstBob ? cleanSummary(firstBob.content).slice(0, 1200) : ''
      basisAt = recent[0]?.createdAt ?? null
      teachingExcerpts = recent
        .filter(m => m.role === 'assistant' && m.id !== firstBob?.id && cleanSummary(m.content).length > 0 && !isVerdict(cleanSummary(m.content)))
        .slice(0, 3)
        .map(m => cleanSummary(m.content).slice(0, 700))
      convLines = recent
        .slice()
        .reverse()
        .map(m => ({ role: m.role, text: cleanBoard(m.content) }))
        .filter(m => m.text.length > 0)
        .map(m => `${m.role === 'user' ? 'STUDENT' : 'BOB'}: ${m.text.slice(0, 450)}`)
    }

    let buildLines: string[] = []
    try {
      const parsed = JSON.parse(node.progressLog ?? '[]') as Array<{ text?: string; createdAt?: string }>
      if (Array.isArray(parsed)) {
        buildLines = parsed
          .filter(e => e && typeof e.text === 'string')
          .slice(-8)
          .map(e => `- ${(e.text as string).slice(0, 200)}${e.createdAt ? ` (${String(e.createdAt).slice(0, 10)})` : ''}`)
      }
    } catch { /* malformed log — go without it */ }

    // Nothing has happened here yet — don't burn a call on empty documents.
    if (!syllabus && teachingExcerpts.length === 0 && convLines.length === 0 && qs.attempts === 0 && buildLines.length === 0 && !node.notes?.trim() && !node.explainer?.trim()) return

    const path = nodePath(tree.nodes, nodeId)
    const facetLines = (qs.facets ?? []).map(f =>
      `${f.done ? '✅ proven' : '⬜ unproven'}${f.struggled ? (f.done ? ' (failed first, then fixed)' : ' (missed — still open)') : ''} — "${f.name}"`)
    const history = (qs.history ?? []).slice(-30)
    const historyLines = history.map(h =>
      `${h.ok ? '✔' : '✘'} ${h.kind}${h.facet ? ` on "${h.facet}"` : ''}${h.conf ? ` (felt ${h.conf})` : ''}${h.fix ? ' — FIXED a previously-missed point' : ''}${h.review ? ' [retention review]' : ''} at ${h.t.slice(0, 16)}`)
    const state = node.status === 'understood'
      ? `VERIFIED${qs.reviewedAt ? ` (last retention review ${qs.reviewedAt.slice(0, 10)})` : ''}`
      : qs.attempts > 0 ? `in progress (${qs.correct} correct / ${qs.attempts} checkpoint answers)` : 'opened, not yet tested'

    const client = await anthropic()
    const { getBackgroundModel } = await import('@/lib/model-resolver')
    const model = await getBackgroundModel()
    const result = await client.messages.create({
      model,
      max_tokens: 1300,
      ...NO_THINKING,
      messages: [{
        role: 'user',
        content: `Write TWO documents about ONE node of a learner's problem-mastery tree, from the same record. Ground EVERY item strictly in the material below — never invent events, quotes, scores, or beliefs. Fewer true items beat padded lists.

ROOT PROBLEM: "${tree.title}"${tree.purpose ? `\nWHY the learner wants this mastered: ${clampText(tree.purpose, 240)}` : ''}
THIS NODE: "${node.title}" — ${node.summary}
Branch (root → here): ${path.map(n => `"${n.title}"`).join(' → ')}
Verification state: ${state}
${facetLines.length ? `SYLLABUS COVERAGE MAP:\n${facetLines.join('\n')}` : 'No syllabus contract yet.'}
${historyLines.length ? `CHECKPOINT RECORD (oldest → newest):\n${historyLines.join('\n')}` : 'No checkpoints answered yet.'}
${(qs.missed ?? []).length ? `Missed checkpoints still open: ${qs.missed.map(m => m.question.slice(0, 120)).join(' | ')}` : ''}
${qs.sureWrong > 0 || qs.sureRight > 0 ? `Confidence calibration: ${qs.sureRight} sure-and-right, ${qs.sureWrong} sure-but-wrong.` : ''}
${buildLines.length ? `REAL-WORLD BUILD LOG:\n${buildLines.join('\n')}` : ''}
${node.notes?.trim() ? `Learner's own notes: ${node.notes.trim().slice(0, 400)}` : ''}
${syllabus ? `Workspace opening / syllabus: ${syllabus}` : ''}
${teachingExcerpts.length ? `Teaching that happened here:\n${teachingExcerpts.map((t, i) => `(${i + 1}) ${t}`).join('\n')}` : ''}
${convLines.length ? `RECENT WORKSPACE CONVERSATION (oldest → newest):\n${convLines.join('\n')}` : ''}
${node.explainer?.trim() && !syllabus ? `Node explainer: ${node.explainer.slice(0, 800)}` : ''}

DOCUMENT 1 — "contextSummary": read by the workspaces of nodes ABOVE this one so they build on what was established here without re-teaching it. Dense, factual, third-person. Compact markdown with EXACTLY these four short sections (one to three tight bullets each; never pad):
**Established here** — the specific concepts/mechanisms this node actually TAUGHT.
**Proven** — what the learner verifiably demonstrated (or "nothing verified yet").
**Still open** — unproven facets, missed checkpoints, sticking points (or "none").
**Role toward the root** — one sentence: how mastering this node moves the root problem.
Under 180 words total.

DOCUMENT 2 — "board": the learner-facing progress digest (their Mastery Board). Address the learner as "you"${zh ? ' (你)' : ''}. Rules:
- headline: ONE sentence whose form follows the verification state — nothing proven yet → future-framed goal ("The goal here: be able to ..."); some proven → "You're proving you can ..."; VERIFIED → "You can now ..." naming the strongest demonstrated capability. Never claim an unproven capability.
- moments (up to 5, chronological, past tense): real progress moments — kind "learning" (a concept clicked), "fixed" (a previously-missed point later proven), "breakthrough" (an insight in the learner's own words), "build" (real-world execution). Add "facet" only when one syllabus point clearly owns the moment (exact name).
- misconceptions (up to 4): wrong beliefs that actually SURFACED here; "cleared": true only when the record shows the repair. "label" is the belief itself, stated plainly.
- quizRead: 1-2 sentences reading the checkpoint record like a coach ("" if no checkpoints).
- nextFocus: the single most useful thing to prove or do next ("" if verified and nothing open).

Return ONLY JSON, no prose around it:
{"contextSummary": "markdown...", "board": {"headline": string, "moments": [{"kind": "learning"|"fixed"|"breakthrough"|"build", "text": string, "facet"?: string}], "misconceptions": [{"label": string, "cleared": boolean, "note"?: string}], "quizRead": string, "nextFocus": string}}
Write every string in ${zh ? 'Simplified Chinese (简体中文)' : 'English'}.`,
      }],
    })
    // One merged call serves both audiences — tagged tree-summary (the board
    // half's spend rides the same call instead of a second one).
    void recordUsage(result, userId, model, 'tree-summary')
    const raw = extractJSON<{ contextSummary?: unknown; board?: unknown }>(responseText(result))
    if (!raw) return
    const writeAt = basisAt ?? new Date()

    const summary = typeof raw.contextSummary === 'string' ? raw.contextSummary.trim() : ''
    if (summary) {
      await prisma.treeNode.updateMany({
        where: { id: nodeId, OR: [{ contextSummaryAt: null }, { contextSummaryAt: { lt: writeAt } }] },
        data: { contextSummary: clampText(summary, 1600), contextSummaryAt: writeAt },
      }).catch(() => null)
    }
    if (raw.board && typeof raw.board === 'object') {
      const { parseBoardDigest } = await import('@/lib/board-digest')
      const digest = parseBoardDigest(JSON.stringify(raw.board))
      if (digest) {
        await prisma.treeNode.updateMany({
          where: { id: nodeId, OR: [{ boardDigestAt: null }, { boardDigestAt: { lt: writeAt } }] },
          data: { boardDigest: JSON.stringify(digest), boardDigestAt: writeAt },
        }).catch(() => null)
      }
    }
  } catch { /* non-critical */ }
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
  // The JUDGE tier: this call's output is ~200 tokens of structured JSON
  // (titles + summaries + a 1-3 sentence reply) — structured-extraction
  // work, not deep teaching. The parser failures that once forced the
  // teaching tier predated NO_THINKING (hidden thinking was eating the
  // token budget and truncating the JSON); with thinking pinned off the
  // judge tier parses reliably at a fraction of the cost.
  const model = await getJudgeModel()

  // Join ALL text blocks — content[0] is not guaranteed to be the text block,
  // and losing the text here silently degrades every turn to the fallback.
  const textOf = (r: { content: Array<{ type?: string; text?: string }> }) =>
    r.content.filter(b => b.type === 'text' && typeof b.text === 'string').map(b => b.text as string).join('\n')

  type GrowParsed = { proposals?: Array<{ title: string; summary: string; kind?: string }>; reply?: string; clarify?: string | null }
  const parseGrow = (text: string): GrowParsed | null => {
    const obj = extractJSON<GrowParsed>(text)
    if (obj && (Array.isArray(obj.proposals) || typeof obj.reply === 'string')) return obj
    // Tolerate a bare array (older shape).
    const arr = extractJSON<Array<{ title: string; summary: string; kind?: string }>>(text)
    if (Array.isArray(arr)) return { proposals: arr }
    return null
  }

  // PRODUCTIVITY GUARANTEE: if the dialog already had an assistant turn but
  // there are still no ghosts on the board (replaceIds empty), this turn is
  // not allowed to stall again — it must produce proposals.
  const mustPropose = history.some(h => h.role === 'assistant') && replaceIds.length === 0

  // One serialization, shared by every pass this turn.
  const treeSketch = sketchTree(tree.nodes)

  const system = `You are Bob, growing a problem-mastery learning tree through a short CONVERSATION in the "Grow this branch" box. The student talks to you about what they don't understand at one node; you reply conversationally AND propose the sub-branches (child nodes) that would teach it.

PROBLEM (root): "${tree.title}"
CURRENT TREE:
${treeSketch}

TARGET NODE they are growing from: "${node.title}" — ${node.summary}

EVERY TURN you do three things: (1) JUDGE how specific the ask is, (2) PROPOSE the current-best ghost set, (3) stay CURIOUS if it's still underspecified.

RULES:
- ${GOAL_NECESSITY}
- PLAN BEFORE PROPOSING (every turn): before naming nodes, silently work out what closing THIS student's stated gap actually requires in service of the root goal — then propose only nodes traceable to that requirement.
- SPECIFICITY JUDGMENT (autonomous, every turn): do you know enough to cut this branch precisely — WHAT exactly they don't understand (which concept, decision, or step), WHERE the gap sits (the idea itself vs. applying it vs. tools/practice), and at what DEPTH their session purpose needs it? Decide for yourself; never ask the student whether their question was specific enough.
- ALWAYS PROPOSE, even underspecified: return your best 1-4 proposals under the MOST LIKELY reading — the ghost set is your WORKING HYPOTHESIS made visible, and the student watches it sharpen as the dialog converges. Usually 1-2 nodes; 3-4 ONLY when the ask genuinely spans that many distinct concepts. Each proposal is a distinct pain point / concept not already in the tree, RELEVANT to the root problem at the depth this session needs, with an INFORMATIVE summary (what it is + why it unlocks the ask). kind: "component" (conceptual part) or "leaf" (specific technical knowledge / concrete pain-point resolution).
- CURIOUS QUESTIONING: while the ask is underspecified, END the reply with ONE sharp question aimed at the biggest fork that would CHANGE the ghost set — name the fork explicitly ("Is it the chemistry of sweetness you're after, or when to water?"), never generic ("tell me more", "can you be more specific"). Keep asking across turns, one fork per turn, until the ask is specific enough — but every question RIDES ON a fresh proposal set; a question never replaces proposals.
- REGENERATE AT EVERY NEW UNDERSTANDING: each student answer updates your reading — return the FULL UPDATED SET each turn (the previous turn's unapproved ghosts are replaced by what you return now; an EMPTY proposals list keeps the previous set untouched). Re-cut, rename, split, merge, add, drop — the set must always reflect your CURRENT understanding, not your first guess.
- WHEN SPECIFIC ENOUGH, STOP ASKING: once you can pin the branch (or further answers would no longer change the set), return the final set and let the reply say confidently why it now matches what they need — no trailing question.
- CONTINGENT UNKNOWNS: if the right branch depends on a fact the STUDENT doesn't know yet (which tool/platform/variety/library), propose the diagnostic/conceptual node that resolves the unknown — never a fan of per-option how-tos. (This is different from a fact YOU need — those you ask for.)
- "reply" is your conversational voice in the thread (1-3 sentences): what you proposed / how the set just changed and why, then the fork question if one is still open. Empty proposals are allowed ONLY for pure small-talk (a thanks, a meta question about the app) — and even then the reply must move the conversation forward, never a dead end, never "no new branches".
- The reply NEVER lists the proposal titles verbatim as a menu — the UI shows the proposal cards; speak about them naturally (e.g. "I've re-cut the branches toward the watering side —").
${sessionDirectives(tree, lang)}

Return ONLY JSON:
{"proposals": [{"title": "2-6 words", "summary": "1-2 sentences plain-language", "kind": "component|leaf"}], "reply": "your conversational reply (session language)"}`

  const turnMessages = [...history, { role: 'user' as const, content: question.slice(0, 800) }]

  // The shared prefix carries a cache breakpoint: a retry pass re-reads it
  // at ~0.1× instead of re-billing the whole system (additions ride as
  // SEPARATE blocks after the breakpoint — string-concat would miss).
  // mustPropose toggles per turn, so it lives AFTER the breakpoint: inside
  // the prefix it would bust the cache exactly on the turns that retry.
  const cachedSystem = [
    { type: 'text' as const, text: system, cache_control: { type: 'ephemeral' as const } },
    ...(mustPropose ? [{
      type: 'text' as const,
      text: 'THIS TURN MUST PROPOSE: the dialog has already gone a turn without leaving proposals on the board. Return your best 1-4 proposals NOW under the most likely reading of everything said so far.',
    }] : []),
  ]

  // Pass 1: the conversational turn.
  let parsed: GrowParsed | null = null
  {
    const result = await client.messages.create({ model, max_tokens: 3000, ...NO_THINKING, system: cachedSystem, messages: turnMessages })
    void recordUsage(result, userId, model, 'tree-expand')
    parsed = parseGrow(textOf(result))
  }
  // Pass 2 (parse failed): same turn, demanding bare JSON. Non-fatal — a
  // failure here still falls through to the forced-generation pass.
  if (!parsed) {
    try {
      const result = await client.messages.create({
        model, max_tokens: 3000, ...NO_THINKING,
        system: [
          ...cachedSystem,
          { type: 'text' as const, text: 'CRITICAL: your ENTIRE output must be the JSON object alone — no prose, no code fences, nothing before or after it.' },
        ],
        messages: turnMessages,
      })
      void recordUsage(result, userId, model, 'tree-expand')
      parsed = parseGrow(textOf(result))
    } catch { /* fall through to the forced pass */ }
  }
  // Pass 3 (all else failed, or the dialog is stalling): go STRAIGHT to
  // generation — a single-purpose call that must return proposals.
  if (!parsed || ((parsed.proposals ?? []).length === 0 && mustPropose)) {
    try {
      const forced = await client.messages.create({
        model, max_tokens: 2500, ...NO_THINKING,
        system: `You grow a problem-mastery learning tree. Based on the dialog, you MUST return 1-4 child-node proposals for the target node — your single best reading of what the student needs; no questions, no refusals.
${GOAL_NECESSITY}

PROBLEM (root): "${tree.title}"
TARGET NODE: "${node.title}" — ${node.summary}
EXISTING TREE (do not duplicate):
${treeSketch}
${sessionDirectives(tree, lang)}

Output ONLY JSON: {"proposals": [{"title": "2-6 words", "summary": "1-2 sentences", "kind": "component|leaf"}], "reply": "1-2 sentences on what you proposed and why (session language)"}`,
        messages: turnMessages,
      })
      void recordUsage(forced, userId, model, 'tree-expand')
      const p2 = parseGrow(textOf(forced))
      if (p2 && ((p2.proposals ?? []).length > 0 || p2.reply)) {
        parsed = {
          proposals: (p2.proposals ?? []).length > 0 ? p2.proposals : parsed?.proposals,
          reply: p2.reply ?? parsed?.reply,
          clarify: parsed?.clarify,
        }
      }
    } catch { /* forced pass is best-effort — the turn still returns */ }
  }

  const list = parsed?.proposals ?? []

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
  // Kind is DEPTH (small-to-big law) — the model's kind suggestion is ignored.
  const childKind = kindForDepth(nodePath(tree.nodes, nodeId).length)
  const created: TreeNode[] = []
  for (let i = 0; i < Math.min(4, list.length); i++) {
    const p = list[i]
    if (!p?.title) continue
    created.push(await prisma.treeNode.create({
      data: {
        treeId, parentId: nodeId,
        kind: childKind,
        title: p.title.slice(0, 120), summary: (p.summary ?? '').slice(0, 500),
        pending: true, order: existing + i, origin: 'question',
      },
    }))
  }

  // The reply must always carry the conversation. If the model omitted it,
  // synthesize a serviceable one in the session language. (With the retry +
  // forced-generation passes above, the no-proposal branch here is a
  // last-resort that should essentially never fire.)
  const zh = (tree.language ?? lang) === 'zh'
  let reply = typeof parsed?.reply === 'string' && parsed.reply.trim() ? parsed.reply.trim().slice(0, 600) : ''
  if (!reply) {
    reply = created.length > 0
      ? (zh ? `我提议了 ${created.length} 个分枝——在树上确认或继续告诉我你想深入哪里。` : `I've proposed ${created.length} ${created.length === 1 ? 'branch' : 'branches'} — approve them on the tree, or keep telling me where you want to go deeper.`)
      : (zh ? '这次没能生成分枝——再发一次，我会直接按最可能的理解提出分枝。' : "I couldn't generate branches on that one — send it again and I'll propose directly under the most likely reading.")
  }
  const clarify = typeof parsed?.clarify === 'string' && parsed.clarify.trim() ? parsed.clarify.trim() : undefined
  return { proposals: created, reply, clarify }
}

// ── Tree Copilot (one chatbox, every tree function) ──────────────────────

export interface CopilotResult {
  reply: string
  proposals: TreeNode[]
  /** A sharper session purpose the conversation surfaced — applied only
   *  after the student taps Approve (permission-based, like all growth). */
  purposeUpdate?: string | null
  /** The REWIRE PLAN — the copilot's full structural control (add/edit/move/
   *  delete/merge/reorder/split/rebalance/spinoff), server-validated against
   *  the live tree, shipped as ONE approval card. The student's single tap
   *  posts it to /api/tree/[id]/rewire, which re-validates and executes it
   *  atomically (snapshot + restore-on-failure). NOTHING is executed by the
   *  copilot itself: same permission covenant as growth. */
  plan: RewirePlan | null
  /** Stored context the copilot recalled this turn (transparency line). */
  recalled?: RecalledRef[]
}

/**
 * One turn of the TREE COPILOT — the tree page's single conversational box
 * that combines every tree-level function: teach about the whole problem,
 * propose branches under ANY node, refine the session PURPOSE (e.g.
 * reorienting the tree into a build-partner for a product the student is
 * making), and REWIRE the tree (add/edit/move/delete/merge/reorder/split/
 * rebalance/spinoff as ONE validated plan the student applies with one tap).
 * Attachment analyses (images/audio/video/files, via Gemini) arrive as
 * grounding. EVERYTHING stays permission-based: proposals are pending
 * ghosts; purpose changes and the rewire plan ship back as approval cards —
 * the copilot itself never mutates an existing node.
 */
export async function copilotTurn(
  userId: string, treeId: string, message: string, lang?: string,
  opts: {
    history?: GrowTurn[]
    attachments?: Array<{ name: string; analysis: string }>
    replaceIds?: string[]
  } = {},
): Promise<CopilotResult> {
  const tree = await getTreeWithNodes(userId, treeId)
  if (!tree) throw new Error('Tree not found')

  const real = tree.nodes.filter(n => !n.pending)
  // CANVAS-MATCHED HANDLES (trust-critical): handle #k is the SAME number the
  // student's canvas shows on the learning path — a pre-order walk from the
  // root, siblings in `order` (getTreeWithNodes already sorts by
  // order,createdAt, the exact canvas comparator). Handle 0 is the root.
  // Array-index handles used to diverge from the canvas numbering, so
  // "queued it under #7" pointed the student at a different node than the
  // one the copilot meant — a hallucination in the student's eyes.
  const kidsOf = new Map<string, TreeNode[]>()
  for (const n of real) {
    if (!n.parentId) continue
    if (!kidsOf.has(n.parentId)) kidsOf.set(n.parentId, [])
    kidsOf.get(n.parentId)!.push(n)
  }
  const rootNode = real.find(n => n.parentId === null)
  const handles: TreeNode[] = []
  if (rootNode) {
    handles.push(rootNode)
    const walkHandles = (pid: string) => {
      for (const c of kidsOf.get(pid) ?? []) { handles.push(c); walkHandles(c.id) }
    }
    walkHandles(rootNode.id)
  }
  // Defensive: a malformed tree (orphaned rows) must not hide nodes.
  for (const n of real) if (!handles.includes(n)) handles.push(n)
  const indexList = handles.map((n, i) =>
    `[#${i}] "${n.title}" (${n.parentId === null ? 'ROOT' : n.status})${n.summary ? ` — ${n.summary.slice(0, 100)}` : ''}`).join('\n')

  // The token-light inventory of everything stored for this tree (counts and
  // names only — content arrives ONLY via an explicit contextRequest recall).
  const catalog = await buildContextCatalog(userId, treeId, real)

  // The insight moat rides into tree-level planning too: verified knowledge
  // grounds proposals-as-analogies, and active misconceptions must never be
  // built into the tree's shape.
  const grounding = await studentGrounding(userId)

  const history = (opts.history ?? []).slice(-10).map(h => ({
    role: h.role === 'assistant' ? 'assistant' as const : 'user' as const,
    content: String(h.content ?? '').slice(0, 1500),
  })).filter(h => h.content.trim())

  const attachBlock = (opts.attachments ?? []).length > 0
    ? `\n## ATTACHMENTS THE STUDENT JUST SHARED (analyzed for you — ground your reply in their ACTUAL content)\n${(opts.attachments ?? []).map(a => `### ${a.name}\n${a.analysis.slice(0, 3000)}`).join('\n\n')}`
    : ''

  const replaceIds = (opts.replaceIds ?? []).filter(id => typeof id === 'string').slice(0, 8)

  const client = await anthropic()
  const model = await getTeachingModel()
  // CACHE LAYOUT (qa-findings-4 №5): everything session-stable — the role,
  // laws, functions, JSON contract — is the breakpointed prefix; the live
  // tree index / work catalog / grounding (any workspace message anywhere
  // changes them) ride a SEPARATE block after it, and this turn's
  // attachments ride inside the student's latest message. The old layout put
  // the volatile material FIRST inside the one cached block, so the prefix
  // could never hit across turns.
  const systemStatic = `You are Bob, the TREE COPILOT for one problem-mastery learning tree — a single conversation that can operate EVERY tree-level function. The student talks to you about the tree as a whole; you converse, teach, grow, and re-aim it.

PROBLEM (root): "${tree.title}"
${tree.framing ? `FRAMING: ${tree.framing}` : ''}
SESSION PURPOSE: ${tree.purpose ? `"${tree.purpose}"` : '(not yet stated — surfacing it is one of your jobs)'}
(The live CURRENT TREE index and STORED WORK CATALOG arrive in the next system block; anything the student attached THIS turn arrives analyzed inside their latest message.)

YOUR FUNCTIONS (all in one box):
1. CONVERSE & TEACH about the whole problem under the Answer Standard — every answer Relevant (scoped to this tree's problem and purpose) and Informative (carries the mechanism/why). Never re-teach what an existing node already owns — point to that node instead ("open '<node>' for that — here's how it connects…").
2. PROPOSE BRANCHES anywhere: return proposals as {"parent": <numeric handle>, "title", "summary", "kind"} — they appear as pending ghosts the student must approve. Propose under the MOST fitting parent (root for new solution directions, deeper nodes for components). 0-6 per turn; each must be a distinct pain point/concept NOT already in the tree, with an informative summary (what it is + why it unlocks the goal).
   INSERT A LAYER: a proposal may carry "adoptChildren": [<handles of EXISTING nodes>] — when the student approves that ghost, those nodes (each with its whole subtree) automatically re-parent UNDER it. This is how you restructure top-down: e.g. "intro nodes between the root and the current branches" = propose under root with adoptChildren = the current branch handles. Never put the same handle in two proposals; never adopt the root or the proposal's own parent.
   PREREQUISITE EXTRACTION: when the stored work shows several branches stumbling over the SAME missing concept (repeated wrong-streaks/questions across branches — confirm via recall), propose ONE prerequisite node under their closest common ancestor and pair it with a "reorder" action that puts it FIRST among its siblings — one shared foundation beats re-teaching it in every branch.
3. REFINE THE PURPOSE: when the conversation (or an attachment — e.g. the product they're building) reveals what this tree is REALLY for, return "purposeUpdate": a sharp 1-2 sentence purpose. The student approves it with a tap. When the purpose reorients the tree (e.g. "improve MY product" → build-partner mode: solution-proposing, evidence-grounded, deployable depth), ALSO propose the new solution branches that fit — prefer growing over pruning: a reorientation alone is never a reason to delete nodes (that needs function 6's bar).
4. BE A BUILD PARTNER when the purpose is a real product/project: ground every proposal and answer in the student's actual artifacts (the analyzed attachments in their message), propose concrete improvement branches, and teach the mechanism behind each suggestion.
5. GENERATED VISUALS: when the student asks for a diagram/graph/sketch, OR the concept is inherently visual (structure, flow, comparison, a product sketch), place EXACTLY one fenced block inside your reply markdown where the visual belongs:
\`\`\`image
one-sentence description of the diagram/sketch to draw — name every part and label explicitly
\`\`\`
The UI renders it as a generated image in place. Never mention the block. At most ONE per reply; it must carry mechanism or a concrete design, never decoration. VISUAL CONFIDENCE (law): if one static generated image cannot CONFIDENTLY deliver the request (animation/interactivity/many interacting elements/precise geometry needed), emit NO block — instead link the best real visual resource (simulation/animation/video) and say explicitly you chose it over generating. When you point at real resources — the honest-redirect case above, or ANY time you name a paper, simulation, video or tool the learner should actually open — emit them as a fenced resources block instead of prose, so they render as clickable cards a beginner will actually use:
\`\`\`resources
[{"name": "PhET — Gas Properties", "url": "https://phet.colorado.edu/en/simulations/gas-properties", "why": "lets you drop the divider yourself and watch the atoms fill the volume", "look": "Set 100 particles, then remove the barrier"}]
\`\`\`
1-3 items, each with a real https URL, a one-line "why this one", and "look" naming exactly what to open/see (figure number, section, control to move). Never leave a recommended resource as plain prose — an inert name is a resource a beginner will never find.
6. REWIRE THE TREE (one-tap plan — full structural control): when the student asks to rename, rewrite, reorganize, merge, remove or completely restructure — or the conversation shows the map is wrong — return "plan": {"summary": "one line: what this rewire does", "ops": [...]}. The student sees the WHOLE plan as one card and applies it with ONE tap; ops execute in order, atomically (all or nothing), with an automatic undo snapshot. NOTHING changes until they tap Apply.
   Node references inside ops: an existing node = its numeric #handle; a node this plan creates = the "ref" string its add op declared (e.g. "a").
   {"op":"add","parent":3,"ref":"a","title":"2-6 words","summary":"1-2 sentences"} — create a new node (the plan tap is its approval). Use it INSIDE restructures — e.g. a new layer that later ops move existing nodes under. For ordinary "you could learn X next" growth use "proposals" (ghosts), never plan adds.
   {"op":"edit","node":2,"title":"new title","summary":"new 1-2 sentence summary"} — sharpen the wording of the SAME concept; include ONLY the field(s) you're changing. An edit never retargets a node to a DIFFERENT concept (its checkpoint history would lie) — that is delete + add.
   {"op":"move","node":5,"newParent":"a"} — re-parent the node (its whole subtree follows) to where it truly belongs.
   {"op":"delete","node":7} — remove the node AND its entire subtree. Propose only when the student asked, or the node is clearly wrong for this tree — verified nodes carry the student's proven work, so deleting one needs an explicit ask.
   {"op":"merge","node":4,"into":6} — fold an overlapping/duplicate node into an EXISTING node: its children, conversation, notes, files, highlights and syllabus contract all transfer to the target, then it is removed. The merged node must RE-PROVE the combined syllabus (it stays verified only if every combined facet is already proven) — say so in your reply. Only for genuine overlap.
   {"op":"spinoff","node":9} — a branch has outgrown THIS tree's goal (goal-necessity law): detach the node and its whole subtree into a NEW problem tree of its own — all workspaces, files and verification travel with it. Prefer this over delete whenever the work is valuable but off-goal.
   {"op":"rebalance","node":3,"title":"new child 2-6 words","summary":"1-2 sentences","facets":["exact UNPROVEN facet names to move"]} — an overloaded syllabus: move some of the node's unproven facets into a new child node. The node keeps at least one facet; PROVEN facets never move. Use when the catalog shows a wide contract barely advancing.
   {"op":"reorder","node":0,"children":[2,"a",5]} — set the LEARNING PATH through a node's children (the canvas numbers the path; ancestors are always learned before descendants). Use after inserting a prerequisite, or whenever the student asks "where do I start".
   {"op":"split","node":3,"title":"2-6 words","summary":"1-2 sentences","moveTail":8} — RESTRUCTURE DRIFT: when a node's workspace conversation has clearly outgrown that node's own syllabus (the catalog shows a long chat against a narrow or already-proven syllabus — RECALL the chat first to confirm the drift and choose the boundary), extract the drifted thread into a NEW CHILD node: the LAST moveTail (2-30) messages of that workspace MOVE into the child's workspace. One concept per node — the tree must stay the true map of what is being learned.
   The ROOT (#0) can be edited (reframing their problem, when asked) but never moved, deleted, merged or spun off. Up to ${REWIRE_MAX_OPS} ops — a complete rewire of the whole tree fits in ONE plan; order matters, and later ops may reference earlier adds by ref. A single small change is simply a 1-op plan.
7. RECALL STORED CONTEXT (on demand — the catalog above is your index): you do NOT automatically see the student's per-node work. Available kinds per node: "chat" (workspace conversation: node digest + rolling summary + recent messages), "notes" (their editable notes), "files" (attached evidence incl. analyzed images/audio/PDFs), "highlights" (passages they marked in chat), "annotations" (their notes on the explainer), "progress" (project-progress log), "syllabus" (verification/facet state), "explainer" (the stored full explainer). "tree" as the node value = files shared in THIS copilot.
   WHEN to recall: (a) the student asks about their own history/work/files/notes/conversations ("what did I discuss…", "based on my notes/files…", "summarize what I've learned"), or (b) you STRONGLY judge stored context would materially change your answer or proposals (e.g. proposing branches that a workspace may already have covered, or tailoring to evidence they attached earlier). Recall costs the student tokens — NEVER recall for greetings, small talk, or anything answerable from the tree structure and catalog alone.
   HOW: instead of a final reply, return ONLY {"contextRequest": {"nodes": [{"node": <handle or "tree">, "kinds": ["chat", …]}], "why": "one short line"}} — max 6 nodes, and only kinds the catalog actually lists for that node. The content arrives immediately and you answer in the SAME turn; you get ONE recall per turn, so request everything you need at once.

RULES:
- NODE REFERENCES (trust-critical): the #numbers above are the student's own canvas labels. When your reply mentions a node, cite it EXACTLY as mapped — #k "Title" (the root by name). NEVER use a number, title, or node that is not in the map, and never renumber: an invented node reference reads to the student as you hallucinating their tree. If you can't tell which node the student means, ask.
- ${GOAL_NECESSITY}
- PLAN BEFORE PROPOSING: before returning proposals or rewire ops, silently work out what the root goal (through the session purpose) actually requires — every proposal traceable to that requirement, every delete/move justified by it.
- CURIOUS SPECIFICITY (like the grow box): judge each ask yourself; when underspecified, still act under the most likely reading AND end with ONE sharp fork question that would change what you propose. Never a bare "tell me more".
- EVERYTHING is PERMISSION-BASED: proposals, purpose changes, and the rewire plan are suggestions until tapped — say what the plan will do when applied.
- WORDS NEVER CHANGE THE TREE (hard law): the tree changes ONLY through this JSON's "plan" ops and ghost "proposals". NEVER write a reply claiming you renamed/moved/deleted/added/reorganized anything unless the matching ops are in THIS response — a reply describing a change it doesn't carry is lying to the student. If you cannot express the change as ops, say so honestly and ask.
- On follow-up turns your NEW proposals replace your previous turn's unapproved ones (empty proposals list = previous set kept). The plan doesn't accumulate either — re-emit a still-relevant plan.
- The reply never lists proposal/plan-op titles as a menu (the UI shows cards) — speak about them naturally.
- RADICAL CONCISENESS (UI constraint — the ambient cloud shows only 1-2 lines): "reply" is 1-2 SHORT sentences MAXIMUM. Be a concise executor: DO the instruction (proposals/plan), then confirm in one line ("Plan's ready — one tap applies it." / "Proposed 2 branches under X."). At most ONE short fork question, and only when you genuinely cannot act without the answer. NO paragraphs, NO explanations of your reasoning, NO teaching in the reply — full teaching happens only when the student explicitly asks a learning question, and even then keep it tight or suggest opening the full conversation.
${sessionDirectives(tree, lang)}

Return ONLY JSON — either a normal turn:
{"reply": "markdown (may contain one \`\`\`image block)", "proposals": [{"parent": 0, "title": "2-6 words", "summary": "1-2 sentences", "kind": "component|leaf", "adoptChildren": [1, 2]}], "purposeUpdate": "sharper purpose or null", "plan": {"summary": "one line", "ops": [{"op":"add|edit|move|delete|merge|reorder|split|rebalance|spinoff","node":0,"parent":0,"ref":"a","title":"…","summary":"…","newParent":0,"into":0,"children":[1,2],"moveTail":8,"facets":["…"]}]} or null}
OR a recall request first (function 7):
{"contextRequest": {"nodes": [{"node": 0, "kinds": ["chat","files"]}], "why": "…"}}`

  const systemLive = `CURRENT TREE (#k here is the EXACT number the student's canvas shows on the learning path — #0 is the root):
${indexList}

STORED WORK CATALOG (the student's history you can RECALL on demand — counts only, you do NOT see any of this content until you request it; nodes not listed have no stored work yet):
${catalog || '(no stored work yet beyond the tree itself)'}
${grounding}`

  type RawPlanOp = {
    op?: string; node?: number | string; parent?: number | string; ref?: string
    title?: string; summary?: string; newParent?: number | string; into?: number | string
    children?: Array<number | string>; moveTail?: number; facets?: string[]
  }
  type CopilotParsed = {
    reply?: string
    proposals?: Array<{ parent?: number; title?: string; summary?: string; kind?: string; adoptChildren?: number[] }>
    purposeUpdate?: string | null
    plan?: { summary?: string; ops?: RawPlanOp[] } | null
    contextRequest?: { nodes?: ContextRequestNode[]; why?: string }
  }
  const textOf = (r: { content: Array<{ type?: string; text?: string }> }) =>
    r.content.filter(b => b.type === 'text' && typeof b.text === 'string').map(b => b.text as string).join('\n')
  const parseTurn = (text: string): CopilotParsed | null => {
    const obj = extractJSON<CopilotParsed>(text)
    if (!obj) return null
    if (Array.isArray(obj.contextRequest?.nodes) && obj.contextRequest!.nodes!.length > 0) return obj
    return typeof obj.reply === 'string' || Array.isArray(obj.proposals) ? obj : null
  }
  // This turn's attachments ride the user message (volatile by definition) —
  // never the cached system prefix.
  const turnMessages = [...history, {
    role: 'user' as const,
    content: `${attachBlock ? `${attachBlock.trim()}\n\n` : ''}${message.slice(0, 2000)}`,
  }]

  // The static ~11k-char prefix carries the cache breakpoint; the live
  // index/catalog/grounding block sits after it. Retry and recall passes
  // append their additions as further SEPARATE blocks (string-concat would
  // change the prefix bytes and miss), so both same-turn passes AND future
  // turns re-read the law text at ~0.1× instead of re-billing it.
  const cachedSystem = [
    { type: 'text' as const, text: systemStatic, cache_control: { type: 'ephemeral' as const } },
    { type: 'text' as const, text: systemLive },
  ]
  // The system array that produced the CURRENT `parsed` — the recall pass
  // swaps in its extended copy, and the plan-repair pass reuses whichever is
  // live so the corrective call keeps the same grounding (and cache prefix).
  let activeSystem: Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }> = cachedSystem

  let parsed: CopilotParsed | null = null
  let firstText = ''
  {
    const result = await client.messages.create({ model, max_tokens: 3500, ...NO_THINKING, system: cachedSystem, messages: turnMessages })
    void recordUsage(result, userId, model, 'tree-copilot')
    firstText = textOf(result)
    parsed = parseTurn(firstText)
  }
  if (!parsed) {
    try {
      const result = await client.messages.create({
        model, max_tokens: 3500, ...NO_THINKING,
        system: [
          ...cachedSystem,
          { type: 'text' as const, text: 'CRITICAL: your ENTIRE output must be the JSON object alone — no prose, no code fences, nothing before or after it.' },
        ],
        messages: turnMessages,
      })
      void recordUsage(result, userId, model, 'tree-copilot')
      parsed = parseTurn(textOf(result))
    } catch { /* degrade to the prose tolerance below */ }
  }
  // PROSE TOLERANCE: a conversational answer with no JSON wrapper (a greeting,
  // a clarification) is a perfectly VALID turn — reply-only, no proposals.
  // Showing it beats the canned "didn't generate" line, which was surfacing on
  // every small-talk message and truncated reply.
  if (!parsed) {
    const prose = firstText.trim().replace(/^```[a-z]*\n?|\n?```$/g, '').trim()
    if (prose && !prose.startsWith('{') && !prose.includes('"reply"')) {
      parsed = { reply: prose.slice(0, 4000) }
    }
  }

  const zh = (tree.language ?? lang) === 'zh'

  // ── ON-DEMAND CONTEXT RECALL (function 7) — ONE round per turn ──
  // The model asked to read stored work before answering. Fetch exactly the
  // requested blocks (digest-first, clamped) and run the SAME turn again with
  // the content in front of it. A second contextRequest is not honored — the
  // recalled block explicitly says so, and we strip it defensively.
  let recalled: RecalledRef[] = []
  if (parsed?.contextRequest && Array.isArray(parsed.contextRequest.nodes) && parsed.contextRequest.nodes.length > 0) {
    const fetched = await fetchRequestedContext(userId, treeId, real, parsed.contextRequest.nodes)
    if (fetched.block) {
      recalled = fetched.recalled
      // Same cached prefix + the recalled content as a separate trailing
      // block — the expensive part of this second call is a cache read.
      const system2 = [
        ...cachedSystem,
        {
          type: 'text' as const,
          text: `## RECALLED STORED CONTEXT (you requested this — it is now in front of you)
${fetched.block}

Answer the student NOW, grounded in the content above; quote or reference it concretely. contextRequest is NOT available on this pass. A synthesis the student explicitly asked for may run up to ~5 short sentences despite the conciseness rule.`,
        },
      ]
      activeSystem = system2
      let secondText = ''
      parsed = null
      try {
        const result = await client.messages.create({ model, max_tokens: 3500, ...NO_THINKING, system: system2, messages: turnMessages })
        void recordUsage(result, userId, model, 'tree-copilot')
        secondText = textOf(result)
        parsed = parseTurn(secondText)
      } catch { /* prose tolerance below */ }
      if (parsed?.contextRequest) {
        // Defensive: a repeat request is dropped; keep whatever reply it carried.
        parsed = typeof parsed.reply === 'string' && parsed.reply.trim() ? { ...parsed, contextRequest: undefined } : null
      }
      if (!parsed) {
        const prose = secondText.trim().replace(/^```[a-z]*\n?|\n?```$/g, '').trim()
        if (prose && !prose.startsWith('{') && !prose.includes('"reply"')) {
          parsed = { reply: prose.slice(0, 4000) }
        }
      }
    } else {
      // Catalog promised nothing / fetch failed — answer honestly instead of
      // hallucinating recalled content.
      parsed = {
        reply: zh
          ? '那些节点还没有可调取的记录——先在节点工作区里学习或添加笔记/文件，我就能引用它们了。'
          : "There's no stored work on those nodes yet — once you chat, take notes, or attach files in a node's workspace, I can pull it in.",
      }
    }
  }
  // ── REWIRE PLAN — build, validate, repair once if needed ────────────────
  // Silently dropping an invalid op while the reply claims the change was
  // THE "said it in words, tree unchanged" failure. Every rejected op is now
  // collected with its reason and the model gets ONE corrective pass with
  // the errors in front of it; a plan that still doesn't validate becomes an
  // honest note on the reply instead of a phantom claim.
  const buildPlan = (p: CopilotParsed | null): { plan: RewirePlan | null; errors: string[]; attempted: boolean } => {
    const rawOps = Array.isArray(p?.plan?.ops) ? p!.plan!.ops! : []
    if (rawOps.length === 0) return { plan: null, errors: [], attempted: false }
    const errors: string[] = []
    const ops: RewireOp[] = []
    const declaredRefs = new Set<string>()
    const refTitles = new Map<string, string>() // "new:<ref>" → title
    const titleOf = (id: string): string => id.startsWith(NEW_PREFIX)
      ? (refTitles.get(id) ?? id.slice(NEW_PREFIX.length))
      : (handles.find(h => h.id === id)?.title ?? '?')
    const resolveRef = (v: number | string | undefined, what: string, opIdx: number): string | null => {
      if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < handles.length) return handles[v].id
      if (typeof v === 'string' && declaredRefs.has(v.trim())) return NEW_PREFIX + v.trim()
      errors.push(`op ${opIdx + 1} (${what}): "${String(v)}" is neither a live tree #handle nor a ref declared by an earlier add`)
      return null
    }
    const cleanTitle = (v: unknown) => typeof v === 'string' && v.trim() ? v.trim().slice(0, 120) : undefined
    const cleanSummary = (v: unknown) => typeof v === 'string' && v.trim() ? v.trim().slice(0, 500) : undefined
    for (let i = 0; i < Math.min(rawOps.length, REWIRE_MAX_OPS); i++) {
      const a = rawOps[i] ?? {}
      if (a.op === 'add') {
        const ref = typeof a.ref === 'string' && a.ref.trim() ? a.ref.trim().slice(0, 40) : ''
        const title = cleanTitle(a.title)
        if (!ref || declaredRefs.has(ref)) { errors.push(`op ${i + 1} (add): missing or duplicate ref`); continue }
        if (!title) { errors.push(`op ${i + 1} (add): missing title`); continue }
        const parent = resolveRef(a.parent, 'add.parent', i)
        if (!parent) continue
        declaredRefs.add(ref)
        refTitles.set(NEW_PREFIX + ref, title)
        ops.push({ op: 'add', ref, parentId: parent, title, summary: cleanSummary(a.summary), label: title, toLabel: titleOf(parent) })
      } else if (a.op === 'edit') {
        const target = resolveRef(a.node, 'edit.node', i)
        if (!target) continue
        const title = cleanTitle(a.title)
        const summary = cleanSummary(a.summary)
        if (!title && !summary) { errors.push(`op ${i + 1} (edit): no title or summary to change`); continue }
        ops.push({ op: 'edit', nodeId: target, title, summary, label: titleOf(target), toLabel: title })
      } else if (a.op === 'move') {
        const target = resolveRef(a.node, 'move.node', i)
        const parent = resolveRef(a.newParent, 'move.newParent', i)
        if (!target || !parent) continue
        ops.push({ op: 'move', nodeId: target, newParentId: parent, label: titleOf(target), toLabel: titleOf(parent) })
      } else if (a.op === 'delete') {
        const target = resolveRef(a.node, 'delete.node', i)
        if (!target) continue
        ops.push({ op: 'delete', nodeId: target, label: titleOf(target) })
      } else if (a.op === 'merge') {
        const target = resolveRef(a.node, 'merge.node', i)
        const into = resolveRef(a.into, 'merge.into', i)
        if (!target || !into) continue
        ops.push({ op: 'merge', nodeId: target, intoId: into, label: titleOf(target), toLabel: titleOf(into) })
      } else if (a.op === 'reorder') {
        const target = resolveRef(a.node, 'reorder.node', i)
        if (!target) continue
        const kids = (Array.isArray(a.children) ? a.children : []).map(c => resolveRef(c, 'reorder.children', i))
        if (kids.some(k => !k)) continue
        const childIds = kids.filter((k): k is string => !!k)
        if (childIds.length < 2) { errors.push(`op ${i + 1} (reorder): needs at least two children`); continue }
        ops.push({ op: 'reorder', nodeId: target, childIds, label: titleOf(target), childLabels: childIds.map(titleOf) })
      } else if (a.op === 'split') {
        const target = resolveRef(a.node, 'split.node', i)
        if (!target) continue
        const title = cleanTitle(a.title)
        if (!title) { errors.push(`op ${i + 1} (split): missing title`); continue }
        const moveTail = Math.max(2, Math.min(30, Number.isFinite(a.moveTail as number) ? Math.round(a.moveTail as number) : 8))
        ops.push({ op: 'split', nodeId: target, title, summary: cleanSummary(a.summary), moveTail, label: titleOf(target), toLabel: title })
      } else if (a.op === 'rebalance') {
        const target = resolveRef(a.node, 'rebalance.node', i)
        if (!target) continue
        const title = cleanTitle(a.title)
        const facets = (Array.isArray(a.facets) ? a.facets : [])
          .filter((f): f is string => typeof f === 'string' && f.trim().length > 0)
          .map(f => f.trim().slice(0, 200)).slice(0, 8)
        if (!title || facets.length === 0) { errors.push(`op ${i + 1} (rebalance): needs a title and facet names`); continue }
        // Facet names must match the node's real UNPROVEN facets EXACTLY —
        // one wrong name would otherwise fail the whole atomic plan at
        // apply. Checked here so the corrective pass sees the real names.
        const have = parseQuizState(tree.nodes.find(n => n.id === target)?.quizState ?? null).facets ?? []
        const unproven = have.filter(f => !f.done).map(f => f.name)
        const wrong = facets.filter(f => !unproven.includes(f))
        if (wrong.length > 0) {
          errors.push(`op ${i + 1} (rebalance): ${wrong.map(f => `"${f}"`).join(', ')} not among that node's unproven facets (unproven: ${unproven.map(f => `"${f}"`).join(', ') || 'none'})`)
          continue
        }
        if (facets.length >= have.length) { errors.push(`op ${i + 1} (rebalance): the node must keep at least one facet`); continue }
        ops.push({ op: 'rebalance', nodeId: target, title, summary: cleanSummary(a.summary), facets, label: titleOf(target), toLabel: title })
      } else if (a.op === 'spinoff') {
        const target = resolveRef(a.node, 'spinoff.node', i)
        if (!target) continue
        ops.push({ op: 'spinoff', nodeId: target, label: titleOf(target) })
      } else {
        errors.push(`op ${i + 1}: unknown op "${String(a.op)}"`)
      }
    }
    if (rawOps.length > REWIRE_MAX_OPS) errors.push(`plan too long: ${rawOps.length} ops (max ${REWIRE_MAX_OPS})`)
    // Structural replay over ALL nodes (ghosts included — cycle guards must
    // see them): the SAME validator the rewire route runs again at apply
    // time, so a shipped plan can only fail later on live drift.
    if (errors.length === 0 && ops.length > 0) {
      const sim = simulateRewire(tree.nodes.map(n => ({ id: n.id, parentId: n.parentId })), ops)
      if (!sim.ok) errors.push(`op ${sim.index + 1}: ${sim.reason}`)
    }
    const summary = typeof p?.plan?.summary === 'string' && p.plan.summary.trim() ? p.plan.summary.trim().slice(0, 300) : ''
    return {
      plan: errors.length === 0 && ops.length > 0
        ? { summary: summary || (zh ? '树结构调整' : 'Tree rewire'), ops }
        : null,
      errors,
      attempted: true,
    }
  }

  let planBuild = buildPlan(parsed)
  if (planBuild.errors.length > 0) {
    // ONE corrective pass: the model sees exactly which ops were rejected
    // and why, and re-emits the full JSON (cached prefix — the retry is
    // mostly a cache read).
    try {
      const repairSystem = [
        ...activeSystem,
        {
          type: 'text' as const,
          text: `REWIRE PLAN REJECTED — ops in your previous JSON do not fit the live tree:
${planBuild.errors.map(e => `- ${e}`).join('\n')}
Your previous plan was: ${JSON.stringify(parsed?.plan ?? null).slice(0, 4000)}
Re-emit your ENTIRE corrected JSON response now (same contract: reply/proposals/purposeUpdate/plan). Fix or drop the failing ops and keep the valid ones. If no valid rewire remains, set "plan": null and make the reply honestly say what could not be matched — NEVER claim a change happened.`,
        },
      ]
      const result = await client.messages.create({ model, max_tokens: 3500, ...NO_THINKING, system: repairSystem, messages: turnMessages })
      void recordUsage(result, userId, model, 'tree-copilot')
      const reparsed = parseTurn(textOf(result))
      if (reparsed && !reparsed.contextRequest) {
        parsed = reparsed
        planBuild = { ...buildPlan(parsed), attempted: true }
      }
    } catch { /* keep the failed build — the honest note below covers it */ }
  }
  const plan = planBuild.plan

  const rawProposals = (parsed?.proposals ?? []).filter(p => p && typeof p.title === 'string' && p.title.trim()).slice(0, 6)

  // Replace this dialog's previous unapproved ghosts ONLY when the new turn
  // actually produced replacements (same covenant as the grow box).
  if (replaceIds.length > 0 && rawProposals.length > 0) {
    await prisma.treeNode.deleteMany({
      where: { id: { in: replaceIds }, treeId, pending: true },
    }).catch(() => null)
  }

  const created: TreeNode[] = []
  const adopted = new Set<string>() // a node can be adopted by ONE ghost per turn
  for (const p of rawProposals) {
    const parentIdx = Number.isInteger(p.parent) ? (p.parent as number) : 0
    // An out-of-map handle is a hallucinated node — drop the proposal rather
    // than clamping it onto an arbitrary real one.
    if (parentIdx < 0 || parentIdx >= handles.length) continue
    const parent = handles[parentIdx]
    if (!parent) continue
    // INSERT-A-LAYER: resolve adoptChildren handles → an approval-gated plan
    // stored on the ghost. Excludes the root, the ghost's own parent and its
    // ancestor chain (cycles), and anything already claimed this turn.
    const parentAncestors = new Set<string>()
    {
      let cur: string | null = parent.id
      const byId = new Map(tree.nodes.map(n => [n.id, n.parentId]))
      while (cur) { parentAncestors.add(cur); cur = byId.get(cur) ?? null }
    }
    const adopt = (Array.isArray(p.adoptChildren) ? p.adoptChildren : [])
      .filter(h => Number.isInteger(h) && (h as number) >= 0 && (h as number) < handles.length)
      .map(h => handles[h as number])
      .filter(n => n.parentId !== null && !parentAncestors.has(n.id) && !adopted.has(n.id))
      .slice(0, 12)
    adopt.forEach(n => adopted.add(n.id))
    const siblings = await prisma.treeNode.count({ where: { parentId: parent.id } })
    created.push(await prisma.treeNode.create({
      data: {
        treeId, parentId: parent.id,
        // Kind is DEPTH (small-to-big law): parentAncestors.size == parent
        // depth + 1 == this ghost's depth. The model's kind hint is ignored.
        kind: kindForDepth(parentAncestors.size),
        title: (p.title as string).slice(0, 120), summary: (p.summary ?? '').slice(0, 500),
        pending: true, order: siblings, origin: 'copilot',
        ...(adopt.length > 0 ? { pendingPlan: JSON.stringify({ adopt: adopt.map(n => n.id) }) } : {}),
      },
    }))
  }

  let reply = typeof parsed?.reply === 'string' && parsed.reply.trim() ? parsed.reply.trim().slice(0, 6000) : ''
  if (!reply) {
    reply = plan
      ? (zh ? '重构方案已就绪——点一下即可应用。' : "The rewire plan is ready — one tap applies it.")
      : created.length > 0
        ? (zh ? `我提出了 ${created.length} 个分枝建议——在树上确认，或继续告诉我方向。` : `I've proposed ${created.length} ${created.length === 1 ? 'branch' : 'branches'} — approve them on the tree, or keep steering me.`)
        : (zh ? '这次没能生成回应——再发一次，我会直接按最可能的理解来做。' : "That one didn't generate — send it again and I'll act on the most likely reading directly.")
  }
  const purposeUpdate = typeof parsed?.purposeUpdate === 'string' && parsed.purposeUpdate.trim()
    ? parsed.purposeUpdate.trim().slice(0, 500)
    : null

  // The words-only guard's last line: the model attempted structural ops but
  // no valid plan survived even the repair pass — the reply must say so
  // instead of standing on a phantom claim.
  if (planBuild.attempted && !plan) {
    const failNote = zh
      ? '（有些结构改动没能匹配当前的树，方案未生成——告诉我你想怎么改，我再试一次。）'
      : "(Some structural changes didn't match the live tree, so no plan was attached — tell me what to change and I'll retry.)"
    reply = reply ? `${reply}\n\n${failNote}` : failNote
  }

  return { reply, proposals: created, purposeUpdate, plan, recalled }
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
  const coverage = await branchCoverage(userId, tree.nodes, nodeId)

  // THIS NODE'S OWN WORKSPACE — the explainer used to be written blind to
  // the node's chat, restating whatever Bob had already taught there. The
  // node digest, proven facets, and latest exchanges ground it so it builds
  // on the conversation instead of re-lecturing it.
  let ownWork = ''
  try {
    const { parseQuizState } = await import('@/lib/mastery')
    const conv = await prisma.conversation.findFirst({
      where: { userId, context: `tree-node:${nodeId}` },
      orderBy: { createdAt: 'asc' },
      include: { messages: { orderBy: { createdAt: 'desc' }, take: 8 } },
    })
    const recent = (conv?.messages ?? []).reverse()
      .map(m => `${m.role === 'user' ? 'Student' : 'Bob'}: ${m.content.slice(0, 350)}`)
      .join('\n')
    const qs = parseQuizState(node.quizState)
    const proven = (qs.facets ?? []).filter(f => f.done).map(f => `"${f.name}"`).join(', ')
    if (node.contextSummary?.trim() || recent || proven) {
      ownWork = `
THIS NODE'S WORKSPACE SO FAR (the chat may already have covered ground here — BUILD ON it, never restate it):${node.contextSummary?.trim() ? `
Digest: ${node.contextSummary.trim().slice(0, 1200)}` : ''}${proven ? `
Facets already PROVEN by correct checkpoints: ${proven} — treat these as understood; reference them in a clause, don't re-teach them.` : ''}${recent ? `
Latest exchanges:
${recent.slice(0, 2000)}` : ''}
`
    }
  } catch { /* non-critical — the explainer still writes */ }

  const model = await getTeachingModel()
  const result = await client.messages.create({
    model,
    max_tokens: 2500,
    ...NO_THINKING,
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
${coverage}${ownWork}
Write in markdown, 300-450 words TOTAL — structured for scanning: each section below is a ### subhead with tight bullets as the default body (a prose paragraph only where one flowing thought needs it, max 3 short sentences). One example per concept, told once.
1. **What this is** — precise but plain-language definition
2. **Why the problem needs it** — connect it explicitly BACK to the root problem and its parent branch; where the ALREADY COVERED section shows the branch below established something this builds on, reference it in one clause instead of re-explaining it. Same law for THIS NODE'S WORKSPACE above: what the chat already taught or proved gets a one-clause callback, and the words go to what the chat has NOT yet covered — the explainer completes the picture, it never re-lectures the conversation
3. **How it works** — the core mechanism with ONE concrete worked example
4. **Where beginners go wrong** — the main misconception or failure mode
5. **How you'll know you understand it** — 1-2 sentences describing the transfer test

WORKED-EXAMPLE HONESTY (non-negotiable): you do NOT know the student's actual project details (their stack, file names, real numbers). The worked example must be an EXPLICITLY fictional third party ("imagine a shop called…") or clearly hedged as an assumption to verify — NEVER assert conclusions about THEIR project ("X is serving your files", "you see: yourbundle.js — 1.8 MB") as if observed. Asserted fiction about their own product seeds confident misconceptions the chat then has to repair.
Nodes marked PENDING in the tree sketch are unapproved proposals — never reference them as siblings the student has learned from or as promised next steps.

Dense, no fluff, no praise-padding. KaTeX ($...$) allowed for math.
If (and only if) this concept is inherently visual — structure, flow, spatial layout, comparison — include ONE diagram at the point it belongs, as a fenced block the UI renders into a generated image (labels in the session's language, textbook style). VISUAL CONFIDENCE (law): only when one static diagram can CONFIDENTLY deliver it — otherwise link the best real visual resource instead and say explicitly that you chose it over generating. When you point at real resources — the honest-redirect case above, or ANY time you name a paper, simulation, video or tool the learner should actually open — emit them as a fenced resources block instead of prose, so they render as clickable cards a beginner will actually use:
\`\`\`resources
[{"name": "PhET — Gas Properties", "url": "https://phet.colorado.edu/en/simulations/gas-properties", "why": "lets you drop the divider yourself and watch the atoms fill the volume", "look": "Set 100 particles, then remove the barrier"}]
\`\`\`
1-3 items, each with a real https URL, a one-line "why this one", and "look" naming exactly what to open/see (figure number, section, control to move). Never leave a recommended resource as plain prose — an inert name is a resource a beginner will never find.
Diagram block form:
\`\`\`image
one-sentence description of the labeled diagram to draw
\`\`\`
${ANSWER_STANDARD}
${sessionDirectives(tree, lang)}`,
    }],
  })

  void recordUsage(result, userId, model, 'tree-explainer')
  const explainer = responseText(result).trim()
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
// node flips to "understood" once EVERY facet of its syllabus contract is
// proven by a correct answer (static MASTERY_TARGET fallback for nodes
// without a contract), including at least MASTERY_MIN_SHORT own-words answer.
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
  opts?: { artifact?: boolean },
): Promise<CheckpointJudgement> {
  const tree = await getTreeWithNodes(userId, treeId)
  const node = tree?.nodes.find(n => n.id === nodeId)
  if (!tree || !node) throw new Error('Node not found')

  const client = await anthropic()
  const primaryModel = await getJudgeModel()
  const prompt = opts?.artifact
    ? `Judge whether the student's ATTACHED REAL-WORLD ARTIFACT actually demonstrates what this checkpoint asked them to produce. Correct = score ≥ 7.

NODE UNDER STUDY: "${node.title}" — ${node.summary}
ROOT PROBLEM: "${tree.title}"
THE CHECKPOINT ASKED THEM TO ATTACH: ${question.slice(0, 600)}
${rubric ? `WHAT THE ARTIFACT MUST VISIBLY SHOW: ${rubric.slice(0, 400)}` : ''}
THE ARTIFACT (as a machine content-analysis of their attachment, plus any note they added)${confidence ? ` [stated confidence: ${confidence}]` : ''}:
${answer.slice(0, 1800)}

STRICT EVIDENCE BAR: the artifact must itself SHOW the asked-for thing — the measurement, the running build, the real output. An attachment that is merely related, generic, stock-looking, or could not plausibly have come from actually doing the task scores below 7. Judge substance over polish: photos and screenshots of real work are expected to be messy. If the analysis is too unclear to verify the specific ask, score below 7 and say exactly what a sufficient capture would show.

The feedback must be INFORMATIVE, not a verdict: in 1-3 sentences name what the artifact does or doesn't demonstrate, and what would complete it.

${sessionDirectives(tree, lang)}

Return ONLY JSON: {"score": 0-10, "feedback": "1-3 sentences"}`
    : `Judge whether the student's answer shows TRUE understanding (meaning over wording; partial credit for sound reasoning). Correct = score ≥ 7.

NODE UNDER STUDY: "${node.title}" — ${node.summary}
ROOT PROBLEM: "${tree.title}"
CHECKPOINT QUESTION: ${question.slice(0, 600)}
${rubric ? `WHAT A TRULY-UNDERSTANDING ANSWER MUST CONTAIN: ${rubric.slice(0, 400)}` : ''}
STUDENT'S ANSWER${confidence ? ` [stated confidence: ${confidence}]` : ''}: ${answer.slice(0, 4000)}

HYPERCORRECTION RULE: a CONFIDENT-WRONG answer is the most teachable state. If the answer is marked "sure" and scores below 5, your feedback must open by directly, memorably refuting the specific wrong belief (name it, then correct it).

The feedback must be INFORMATIVE, not a verdict: in 1-3 sentences give the scientific reason the right answer is right (and where their reasoning broke, if it did).

${sessionDirectives(tree, lang)}

Return ONLY JSON: {"score": 0-10, "feedback": "1-3 sentences"}`
  const judgeBody = {
    max_tokens: 700,
    ...NO_THINKING,
    messages: [{
      role: 'user' as const,
      content: prompt,
    }],
  }
  // Judging must survive a bad model id, a model-specific outage, AND the
  // Vercel function-duration cap. A 3-model chain — resolved judge model →
  // pinned Sonnet → pinned Opus (the teaching tier, demonstrably reachable
  // whenever chat streams) — with TIGHT per-attempt timeouts and no SDK
  // retries (the next model in the chain IS the retry). Worst case
  // ≈ 12+12+20s, comfortably inside the route's maxDuration=60 so a slow
  // upstream degrades into the next model instead of a killed function.
  // Every attempt's failure is recorded and thrown in the error message, so
  // the route's 502 (and the on-screen diagnostic) names the real cause.
  const chain: Array<{ model: string; timeout: number }> = []
  const seen = new Set<string>()
  for (const m of [
    { model: primaryModel, timeout: 12000 },
    { model: CHAT_MODELS.sonnet, timeout: 12000 },
    { model: CHAT_MODELS.opus, timeout: 20000 },
  ]) {
    if (!seen.has(m.model)) { seen.add(m.model); chain.push(m) }
  }
  const attemptErrors: string[] = []
  let usedModel = ''
  let result: Awaited<ReturnType<typeof client.messages.create>> | null = null
  for (const step of chain) {
    try {
      result = await client.messages.create({ model: step.model, ...judgeBody }, { timeout: step.timeout, maxRetries: 0 })
      usedModel = step.model
      break
    } catch (err) {
      const status = (err as { status?: number })?.status
      attemptErrors.push(`${step.model}: ${status ?? ''} ${(err as Error)?.name ?? ''} ${String((err as Error)?.message ?? err).slice(0, 120)}`.trim())
    }
  }
  if (!result) {
    throw new Error(`judge-models-failed [${attemptErrors.join(' | ')}]`)
  }
  void recordUsage(result, userId, usedModel, 'tree-verify')
  const rawText = (result.content.find(b => 'text' in b) as { text?: string } | undefined)?.text ?? ''
  const parsed = extractJSON<{ score?: number; feedback?: string }>(rawText)
  if (!parsed || typeof parsed.score !== 'number') {
    throw new Error(`judge-unparseable [${usedModel}] ${rawText.slice(0, 120)}`)
  }
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
// True when a deployable-depth tree (advanced/professional) has NO build
// evidence yet. Evidence = a citation-verified build-log entry OR a facet
// PROVEN by a judged artifact checkpoint (provenBy:'artifact'). A merely
// uploaded file no longer counts (qa-findings-4 №1: a screenshot attached in
// chat to ask a question was opening the Deployed gate — evidence must be
// JUDGED, not present). Fails open: a query hiccup must never dam a
// completion that was otherwise earned.
async function deployableGateBlocks(treeId: string): Promise<boolean> {
  try {
    const tree = await prisma.problemTree.findUnique({
      where: { id: treeId }, select: { difficulty: true },
    })
    if (tree?.difficulty !== 'advanced' && tree?.difficulty !== 'professional') return false
    const nodes = await prisma.treeNode.findMany({
      where: { treeId }, select: { id: true, progressLog: true, quizState: true },
    })
    const hasLog = nodes.some(n => {
      try {
        const log = JSON.parse(n.progressLog ?? '[]')
        return Array.isArray(log) && log.length > 0
      } catch { return false }
    })
    if (hasLog) return false
    const { parseQuizState } = await import('@/lib/mastery')
    const hasJudgedArtifact = nodes.some(n =>
      (parseQuizState(n.quizState).facets ?? []).some(f => f.done && f.provenBy === 'artifact'))
    return !hasJudgedArtifact
  } catch { return false }
}

export async function markNodeVerified(
  userId: string, treeId: string, nodeId: string, lang?: string,
): Promise<{ xp: XpAwardLite[]; treeCompleted: boolean; seedOnly?: boolean; buildPending?: boolean }> {
  const node = await prisma.treeNode.findUnique({ where: { id: nodeId } })
  if (!node) throw new Error('Node not found')
  const zh = lang === 'zh'
  const xp: XpAwardLite[] = []
  let treeCompleted = false
  let seedOnly = false
  // DEPLOYABLE COMPLETION GATE (qa-findings-4 №2): sessions targeting
  // advanced/professional depth promised deployable understanding — their
  // completion requires ≥1 piece of real build evidence (a cited build-log
  // entry or an uploaded artifact) on top of all-verified. Checkpoints alone
  // certify EXPLAINED; the evidence flips the tree to DEPLOYED.
  let buildPending = false

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
        treeId,
      },
    })
    const { markStrugglesResolved } = await import('@/lib/insight-memory')
    await markStrugglesResolved(userId, node.title)
  } catch { /* non-critical */ }
  // MASTERY = ROOT VERIFIED (user decision, Jul 2026 — manual "mark as
  // complete" is gone): the tree completes exactly when its root flips to
  // 'understood'. The ROOT is the problem statement, not a masterable pain
  // point — it is excluded from the requirement (verifying "your own
  // question" was an unreachable dead-end) and the engine verifies it as
  // the crown once every branch is proven; tree completion rides on that
  // same flip, so the only path to "problem mastered" runs through
  // AI-verified checkpoints.
  try {
    const remaining = await prisma.treeNode.count({
      where: { treeId, pending: false, parentId: { not: null }, status: { not: 'understood' } },
    })
    if (remaining === 0) {
      // COMPLETION GATE (deep-audit A3/2): a tree that never grew past its
      // 1-3 seeded branches is a plan, not a mastered problem — certifying
      // it hands out the trophy for ~15 answers and every incentive then
      // points away from growth. The seed is depth-capped BY DESIGN, so
      // completion requires at least one learner-driven node (copilot /
      // question / manual origin). Legacy trees predating the origin column
      // (all-null origins) are exempt — they can't be distinguished.
      const grown = await prisma.treeNode.findMany({
        where: { treeId, pending: false, parentId: { not: null } },
        select: { origin: true },
      })
      const hasOriginData = grown.some(g => g.origin !== null)
      const grewPastSeed = grown.some(g => g.origin === 'copilot' || g.origin === 'question' || g.origin === 'manual')
      if (hasOriginData && !grewPastSeed) {
        // Every seeded branch is verified but the tree never grew: no crown,
        // no trophy — the quiz route surfaces "is the problem actually
        // answered?" with the Copilot gap-check as the next step instead.
        seedOnly = true
      } else if (await deployableGateBlocks(treeId)) {
        // DEPLOYABLE COMPLETION GATE: this session's target depth promised
        // "real-life deployable understanding" (Mode: the learner's own files
        // and products as an answer to "do you understand this point").
        // Every branch is verified — EXPLAINED — but no build evidence exists
        // yet, so the crown waits: the quiz route surfaces "show me it
        // running" with the build-log/upload path as the next step.
        buildPending = true
      } else {
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
      // THE ROOT ANSWER (the founding paragraph's missing artifact): on
      // completion, assemble the resolution from the verified nodes' digests
      // — the answer the learner came for, not a status report. Backgrounded.
      // The old cached document is STALE-STAMPED first (rootAnswerAt = null,
      // doc kept): clients read answer-without-timestamp as "reassembling"
      // instead of serving the pre-completion version as if it were new.
      try {
        await prisma.problemTree.updateMany({
          where: { id: treeId, rootAnswer: { not: null } },
          data: { rootAnswerAt: null },
        }).catch(() => null)
        const { inBackground } = await import('@/lib/background')
        inBackground(generateRootAnswer(userId, treeId, lang))
      } catch { /* non-critical */ }
      }
    }
  } catch { /* non-critical */ }

  // The node's CONTEXT SUMMARY should now reflect its freshly-VERIFIED state so
  // every ancestor-reading descendant knows this ground is proven. Refresh it
  // in the background — never blocks the verification response (Vercel
  // waitUntil keeps the lambda alive past the response so the pass survives).
  try {
    const { inBackground } = await import('@/lib/background')
    inBackground(refreshNodeContextSummary(userId, treeId, nodeId, lang))
  } catch { /* non-critical */ }

  return { xp, treeCompleted, seedOnly, buildPending }
}

// ── THE ROOT ANSWER (the artifact the founding paragraph promises) ───────

/**
 * Assemble the full resolution of the ROOT problem from the verified nodes'
 * distilled digests — in the session's language, calibrated to its purpose
 * and depth, each claim traceable to the node that proved it, with an honest
 * boundary naming what is still unproven. Cached on the tree (rootAnswer /
 * rootAnswerAt); regenerated on demand from the tree page. This is the
 * completion payoff: "here is the answer you came for", not a status report.
 */
export async function generateRootAnswer(userId: string, treeId: string, lang?: string): Promise<string | null> {
  try {
    const tree = await getTreeWithNodes(userId, treeId)
    if (!tree) return null
    const real = tree.nodes.filter(n => !n.pending && n.parentId !== null)
    const proven = real.filter(n => n.status === 'understood')
    if (proven.length === 0) return null
    const open = real.filter(n => n.status !== 'understood')
    const zh = (tree.language ?? lang) === 'zh'
    const provenBlock = proven.map(n =>
      `### "${n.title}"\n${(n.contextSummary?.trim() || n.summary || '').slice(0, 1200)}`).join('\n\n')
    const client = await anthropic()
    const model = await getTeachingModel()
    const result = await client.messages.create({
      model, max_tokens: 3000, ...NO_THINKING,
      system: `You write THE ANSWER — the document that resolves a learner's root problem, assembled ONLY from what they have verifiably proven. ${ANSWER_STANDARD}`,
      messages: [{
        role: 'user',
        content: `ROOT PROBLEM: "${tree.title}"
${tree.framing ? `FRAMING: ${tree.framing}` : ''}
${tree.purpose ? `THE LEARNER'S PURPOSE (defines what "answered" means here): ${tree.purpose}` : ''}

WHAT THE LEARNER HAS PROVEN, node by node (their verified understanding — the ONLY source you may draw claims from):
${provenBlock.slice(0, 14000)}
${open.length > 0 ? `\nSTILL UNPROVEN (never present these as established): ${open.map(n => `"${n.title}"`).join(', ')}` : ''}

Write THE ANSWER to the root problem as one coherent markdown document (\`##\` title, \`###\` sections, bullets as the default body — prose paragraphs max 3 sentences; each claim stated once, as short as complete resolution allows), entirely in ${zh ? 'Simplified Chinese (简体中文)' : 'English'}:
1. Open with the resolution itself — the direct, complete answer to the root problem, synthesized across the proven nodes (not a node-by-node tour).
2. Then the mechanism: WHY that answer holds, woven from the proven material; tag each major claim to the node that proved it with a short parenthetical (e.g. ${zh ? '（已在「节点名」验证）' : '(proven at "node title")'}).
3. ${open.length > 0 ? 'Close with an HONEST BOUNDARY section naming exactly what remains unproven and what it would change.' : 'Close with the single most important takeaway.'}
Ground every claim in the proven material above — NOTHING invented, no generic field lecture. This document is what the learner shows someone who asks "so, what's the answer?".
${sessionDirectives(tree, lang)}`,
      }],
    })
    void recordUsage(result, userId, model, 'tree-digest')
    const answer = responseText(result).trim().slice(0, 20000)
    if (!answer) return null
    await prisma.problemTree.update({
      where: { id: treeId },
      data: { rootAnswer: answer, rootAnswerAt: new Date() },
    })
    return answer
  } catch (err) {
    console.error('[tree] root answer generation failed:', err)
    return null
  }
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
      const log = JSON.parse(n.progressLog ?? '[]') as Array<{ text: string; createdAt: string; evidence?: { kind?: string; name?: string; quote?: string } }>
      return log.slice(-5).map(e => {
        // Provenance rides with every entry: cited entries carry their
        // verbatim quote; legacy/uncited entries are explicitly flagged so
        // the digest can never launder them into established fact.
        const cite = e.evidence?.quote
          ? ` [evidence — ${e.evidence.kind === 'file' ? `file "${e.evidence.name ?? 'attachment'}"` : "the student's own words"}: "${String(e.evidence.quote).slice(0, 160)}"]`
          : ' [UNCONFIRMED — recorded without cited evidence]'
        return `- [${(e.createdAt ?? '').slice(0, 10)}] (${n.title}) ${e.text}${cite}`
      })
    } catch { return [] }
  }).join('\n')

  const notesLines = real.filter(n => n.notes?.trim()).map(n => `- (${n.title}) ${n.notes!.slice(0, 250)}`).join('\n')
  const locker = await evidenceLocker(userId, tree.nodes, undefined, { maxFiles: 8, excerpt: 500 })

  const client = await anthropic()
  const model = await getJudgeModel()
  const result = await client.messages.create({
    model,
    max_tokens: 1600,
    ...NO_THINKING,
    messages: [{
      role: 'user',
      content: `Write the TREE DIGEST — a dense, copy-ready status report of one problem-mastery session, for the learner to read or paste to their team.

PROBLEM (root): "${tree.title}"
${tree.framing ? `FRAMING: ${tree.framing}` : ''}
${tree.purpose ? `PURPOSE (why they're mastering this): ${tree.purpose}` : ''}
Verified: ${real.filter(n => n.status === 'understood').length}/${real.length} nodes.

NODES:
${nodeLines || '(none)'}

BUILD LOG (real-world execution detected in chats; every entry carries its provenance):
${progressLines || '(none recorded)'}
BUILD-LOG RULE (trust-critical): an entry tagged [UNCONFIRMED] must NEVER be restated as an established fact or accomplishment — omit it, or explicitly present it as an unverified self-report. Only entries with cited evidence may appear under Findings/Progress as things that actually happened.

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
  const digest = responseText(result).trim()
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
export async function recordCheckpointStruggle(userId: string, nodeTitle: string, feedback: string, lang?: string, treeId?: string): Promise<void> {
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
        ...(treeId ? { treeId } : {}),
      },
    })
  } catch { /* non-critical */ }
}
