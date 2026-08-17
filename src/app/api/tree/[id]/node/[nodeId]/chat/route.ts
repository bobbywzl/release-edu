export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * POST /api/tree/[id]/node/[nodeId]/chat { message, lang, attachments? }
 *
 * Bob inside the node workspace: a streaming tutoring chat grounded in the
 * problem tree, the node's lineage, and its explainer. One persistent
 * conversation per node (Conversation.context = "tree-node:<nodeId>").
 *
 * Multimodal (same contract as the tree copilot): attachments arrive as
 * [{name, type, content}] — content is a data: URI for media or plain text
 * for text files. Each is analyzed by Gemini BEFORE Bob's turn (images/
 * video/PDFs described, voice notes transcribed) so the analysis grounds
 * the reply, and persists as node-level evidence (LinkedFile "tree-node" —
 * the workspace Files tab) that future turns read back.
 *
 * If the student's question opens genuinely NEW ground (not teachable within
 * this node), Bob points them to the Grow button instead of silently
 * expanding the tree — growth stays permission-based.
 */
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getUserId } from '@/lib/get-user-id'
import { dbStore } from '@/lib/db-store'
import { getTreeWithNodes, sketchTree, nodePath, sessionDirectives, ANSWER_STANDARD, evidenceLocker, branchCoverage, refreshNodeDigests, studentGrounding, type XpAwardLite } from '@/lib/tree-engine'
import { parseQuizState, MASTERY_TARGET, MASTERY_MIN_SHORT, masteryTarget, masteryFilled, type PendingQuiz } from '@/lib/mastery'
import { getTeachingModel } from '@/lib/model-resolver'
import { NO_THINKING } from '@/lib/chat-model-router'

interface Reflection {
  state: string          // one-line read of where the student is
  gapDepth: 'none' | 'partial' | 'deep'
  streakWrong: number    // consecutive confused/incorrect turns
  directive: string      // Bob's next move
  // Discovery: repeated questions circling a field the tree doesn't cover
  // yet → suggest a new node (the student approves via a button in chat).
  suggestNode?: { title: string; summary: string } | null
  // The discussion actually belongs to a different existing node.
  moveToNodeId?: string | null
  moveToTitle?: string | null
  // Concrete real-world execution progress detected in the student's message.
  // MUST carry a verbatim citation (validated server-side) — an uncited
  // claim is dropped, never logged. Older prompts returned a bare string;
  // that shape is treated as uncited and dropped too.
  projectProgress?: { text?: string; evidence?: { kind?: string; name?: string; quote?: string } } | string | null
  // A SYSTEMATIC wrong belief (same wrong idea expressed as their model of
  // the world) — needs direct refutation, not more practice (repair theory).
  misconception?: string | null
}

function safeParse<T>(str: string | null | undefined, fallback: T): T {
  if (!str) return fallback
  try { return JSON.parse(str) as T } catch { return fallback }
}

/**
 * FOLDED ASSESSMENT (was: a blocking Haiku pre-pass before every turn).
 * The main teaching call now runs the contextual read itself — confusion
 * state, analogy bridge, wheel-spinning, discovery, progress — and reports
 * the structured half on a trailing [[ASSESS]] line, captured server-side
 * and never shown to the student. One less model call per turn, faster
 * first token, and the read rides tokens the turn already pays for.
 */
interface Assess {
  streakWrong?: number
  suggestNode?: { title?: string; summary?: string } | null
  moveToTitle?: string | null
  projectProgress?: { text?: string; evidence?: { kind?: string; name?: string; quote?: string } } | null
  misconception?: string | null
}

const ASSESS_MARK = '[[ASSESS]]'

/** Strip the [[ASSESS]] line from the model output and parse its JSON
 *  (balanced-brace scan — the payload may sit before a [[QUIZ]] block). */
function extractAssess(full: string): [string, Assess | null] {
  const idx = full.indexOf(ASSESS_MARK)
  if (idx === -1) return [full, null]
  const rest = full.slice(idx + ASSESS_MARK.length)
  const start = rest.indexOf('{')
  let parsed: Assess | null = null
  let end = -1
  if (start !== -1 && start <= 3) {
    let depth = 0
    let inStr = false
    for (let i = start; i < rest.length; i++) {
      const ch = rest[i]
      if (inStr) {
        if (ch === '\\') i++
        else if (ch === '"') inStr = false
      } else if (ch === '"') inStr = true
      else if (ch === '{') depth++
      else if (ch === '}') { depth--; if (depth === 0) { end = i; break } }
    }
    if (end !== -1) {
      try { parsed = JSON.parse(rest.slice(start, end + 1)) as Assess } catch { parsed = null }
    }
  }
  // No trimming before the marker: bytes up to idx may already be streamed,
  // and shortening them would desync every index the caller holds.
  // On a parse failure (no brace, brace too far, unbalanced) strip ONLY the
  // marker's own line and keep the remainder — the old rebuild dropped the
  // ENTIRE tail, silently eating any [[QUIZ]] block that followed a
  // malformed marker (qa-findings-4 №3).
  const cleaned = end !== -1
    ? `${full.slice(0, idx)}${rest.slice(end + 1)}`
    : (() => { const nl = rest.indexOf('\n'); return `${full.slice(0, idx)}${nl !== -1 ? rest.slice(nl) : ''}` })()
  return [cleaned, parsed]
}

/**
 * SYLLABUS CONTRACT REPAIR (deep-audit §4): the [[SYLLABUS]] block is one
 * best-effort shot at the end of the longest turn Bob ever writes — a
 * truncated or malformed intro silently downgraded the node to quota
 * testing forever, while the UI kept promising "prove every syllabus
 * point". This derives the facets from the stored intro's "What you'll
 * cover" sub-points and CAS-writes them ONLY while the node still has no
 * contract (existing facet progress is never touched).
 */
async function deriveSyllabusContract(apiKey: string, userId: string, nodeId: string, introText: string | null): Promise<void> {
  try {
    if (!introText) {
      const conv = await prisma.conversation.findFirst({
        where: { userId, context: `tree-node:${nodeId}` },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      })
      if (!conv) return
      const first = await prisma.message.findFirst({
        where: { conversationId: conv.id, role: 'assistant' },
        orderBy: { createdAt: 'asc' },
        select: { content: true },
      })
      introText = first?.content ?? null
    }
    if (!introText || introText.length < 200) return
    // Still contract-less? Re-check before spending the call.
    const row = await prisma.treeNode.findUnique({ where: { id: nodeId }, select: { quizState: true } })
    if (!row || parseQuizState(row.quizState).facets) return
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const client = new Anthropic({ apiKey })
    const { getBackgroundModel } = await import('@/lib/model-resolver')
    const bgModel = await getBackgroundModel()
    const res = await client.messages.create({
      model: bgModel,
      max_tokens: 300,
      ...NO_THINKING,
      messages: [{
        role: 'user',
        content: `This is a tutoring node's opening syllabus. Extract its "What you'll cover" sub-points as short facet names (the bolded terms, 2-6 words each), 3-6 entries, in the SAME language as the text. If the text has no recognizable sub-point roadmap, return an empty list.\n\n${introText.slice(0, 4000)}\n\nReturn ONLY JSON: {"facets":["...","..."]}`,
      }],
    })
    try {
      const { recordAnthropicUsage } = await import('@/lib/usage')
      recordAnthropicUsage(res.usage, { userId, model: bgModel, feature: 'tree-verify' })
    } catch { /* non-critical */ }
    // Join ALL text blocks — content[0] can be a thinking block on a
    // thinking-first model, and a bare .text read silently returns nothing.
    const text = res.content.filter(b => (b as { type?: string }).type === 'text').map(b => (b as { text?: string }).text ?? '').join('\n')
    const payload = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? '{}') as { facets?: unknown[] }
    const names = (Array.isArray(payload.facets) ? payload.facets : [])
      .map(f => String(f ?? '').trim().slice(0, 120)).filter(Boolean).slice(0, 6)
    if (names.length < 2) return
    for (let attempt = 0; attempt < 3; attempt++) {
      const freshRow = await prisma.treeNode.findUnique({ where: { id: nodeId }, select: { quizState: true } })
      if (!freshRow) return
      const qs = parseQuizState(freshRow.quizState)
      if (qs.facets && qs.facets.length >= 2) return
      // MERGE, never overwrite: an existing entry (a sub-2 stub) keeps its
      // progress; derived names only fill in what's missing.
      const existing = qs.facets ?? []
      const have = new Set(existing.map(f => f.name.trim().toLowerCase()))
      qs.facets = [...existing, ...names.filter(n => !have.has(n.trim().toLowerCase())).map(n => ({ name: n, done: false }))]
      const w = await prisma.treeNode.updateMany({
        where: { id: nodeId, quizState: freshRow.quizState },
        data: { quizState: JSON.stringify(qs) },
      }).catch(() => null)
      if (w && w.count > 0) return
    }
  } catch { /* non-critical — the static fallback governs */ }
}

/** GET — the node's persisted conversation history (for the Workspace),
 *  plus the LIVE pending checkpoint (sanitized — no answer key). The server
 *  pending is the single source of truth for arming the interactive card:
 *  arming from "is the quiz marker the last message?" broke the moment any
 *  later turn landed, stranding unanswered cards invisibly. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ nodeId: string }> }) {
  const { nodeId } = await params
  const userId = await getUserId()
  // orderBy pins every reader/writer to the OLDEST row if a concurrent
  // first-open ever created duplicates for this context tag.
  const conv = await prisma.conversation.findFirst({
    where: { userId, context: `tree-node:${nodeId}` },
    orderBy: { createdAt: 'asc' },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  })
  let pending: { kind: string; question: string; options?: string[]; hint?: string; facet?: string } | null = null
  // The persisted remediation debt: a wrong answer whose law-mandated full
  // remediation never ran (tab closed, judge response lost) — the workspace
  // fires [NODE_REMEDIATE] on mount when this is set.
  let remediationOwed: string | null = null
  try {
    const row = await prisma.treeNode.findFirst({
      where: { id: nodeId, tree: { userId } },
      select: { quizState: true },
    })
    const qs = parseQuizState(row?.quizState)
    remediationOwed = qs.remediationOwed ?? null
    const p = qs.pending
    if (p) {
      pending = {
        kind: p.kind, question: p.question,
        ...(p.kind === 'mcq' && Array.isArray(p.options) ? { options: p.options } : {}),
        ...(typeof p.hint === 'string' && p.hint.trim() ? { hint: p.hint } : {}),
        ...(typeof p.facet === 'string' && p.facet.trim() ? { facet: p.facet } : {}),
      }
    }
  } catch { /* non-critical — card just won't re-arm this fetch */ }
  return NextResponse.json({
    conversationId: conv?.id ?? null,
    pending,
    remediationOwed,
    messages: (conv?.messages ?? []).map(m => ({
      id: m.id, role: m.role, content: m.content, createdAt: m.createdAt,
    })),
  })
}

interface AttachmentIn { name?: string; type?: string; content?: string }

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; nodeId: string }> }) {
  const { id, nodeId } = await params
  const userId = await getUserId()
  const store = dbStore.forUser(userId)
  const { message, lang, attachments } = (await req.json().catch(() => ({}))) as {
    message?: string; lang?: string; attachments?: AttachmentIn[]
  }
  const msgText = (message ?? '').trim()
  const atts = (Array.isArray(attachments) ? attachments : []).slice(0, 3)
  if (!msgText && atts.length === 0) return new Response('Message or attachment required', { status: 400 })
  // Cap message length BEFORE persisting: a giant paste stored verbatim would
  // poison the history and make every later turn (incl. checkpoint/remediation
  // triggers) exceed the model context — the attachment path is the channel
  // for large artifacts. Control triggers are exempt (short tokens).
  const MSG_MAX = 8000
  const isControlTrigger = ['[NODE_INTRO]', '[NODE_REVIEW]', '[NODE_CHECKPOINT]', '[NODE_REMEDIATE]', '[NODE_VERIFIED]'].includes(msgText)
  if (!isControlTrigger && msgText.length > MSG_MAX) {
    return new Response(lang === 'zh' ? '消息太长，请精简后再发送。' : 'Message too long — please shorten it.', { status: 413 })
  }

  const tree = await getTreeWithNodes(userId, id)
  const node = tree?.nodes.find(n => n.id === nodeId)
  if (!tree || !node) return new Response('Not found', { status: 404 })
  // THE ROOT HAS NO WORKSPACE (law): it is the problem statement itself,
  // edited only through the Tree Copilot — never chatted on.
  if (node.parentId === null) return new Response('The root node has no workspace.', { status: 400 })
  // '[NODE_VERIFIED]' is a SYSTEM payoff turn, not a client right: without
  // this gate a crafted POST authored a fake celebration transcript (and
  // cancelled remediation debt) on a node that never verified — the status
  // column is the only authority (qa-findings-4 №8).
  if (msgText === '[NODE_VERIFIED]' && node.status !== 'understood') {
    return new Response('Node is not verified.', { status: 400 })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return new Response('Not configured', { status: 503 })

  // PER-USER DAILY BUDGET (the guard that keeps depth affordable): the two
  // expensive doors — this route and the copilot — check the last 24h of
  // recorded spend. Judging (the quiz route) is never gated: a learner
  // mid-checkpoint always gets their verdict. 429 carries the localized
  // message; the client renders it verbatim.
  try {
    const { checkDailyBudget, budgetMessage } = await import('@/lib/ai-budget')
    const budget = await checkDailyBudget(userId)
    if (!budget.ok) {
      return new Response(budgetMessage((tree.language ?? lang) === 'zh'), { status: 429 })
    }
  } catch { /* fail-open — a telemetry outage must never block learning */ }

  // Client triggers, not student messages — nothing is persisted for the
  // trigger itself; only Bob's reply is saved.
  //   [NODE_INTRO]     — first open: condensed syllabus-style hook.
  //   [NODE_REVIEW]    — retention review of a verified node: reactivate the
  //                      idea, then one fresh checkpoint (full XP).
  //   [NODE_CHECKPOINT] / [NODE_REMEDIATE] — Bottleneck-Triggered Teaching
  //   (FOUNDATION.md): the client fires CHECKPOINT after a CORRECT answer
  //   (no bottleneck found — keep asking) and REMEDIATE after a WRONG one
  //   (a bottleneck WAS just found — teach into it before asking again).
  const isIntro = msgText === '[NODE_INTRO]'
  const isReview = msgText === '[NODE_REVIEW]'
  const isCheckpoint = msgText === '[NODE_CHECKPOINT]'
  const isRemediate = msgText === '[NODE_REMEDIATE]'
  // [NODE_CONTINUE] — the learner tapped Continue on an answer that was cut
  // off mid-sentence. Bob resumes exactly where he stopped; nothing about
  // this is a student utterance, so it never feeds insight extraction.
  const isContinue = msgText === '[NODE_CONTINUE]'
  // [NODE_VERIFIED] — the node just verified: the payoff moment finally has
  // an author. Bob restates what was proven as capabilities, ties it to the
  // root, and names the next stop on the learning path.
  const isVerifiedTurn = msgText === '[NODE_VERIFIED]'
  const isTrigger = isIntro || isReview || isCheckpoint || isRemediate || isContinue || isVerifiedTurn

  // Parsed ONCE, up front: the reflection/adaptive assembly below needs the
  // judged wrong-streak and remediation debt, not only the prompt sections.
  const quizStateNow = parseQuizState(node.quizState)

  // One conversation per node, found by context tag. The window must be the
  // LATEST 40 messages (desc + reverse to chronological) — an ascending take
  // would pin Bob's context and the return-visit gate to the conversation's
  // ancient head once it grows past 40 messages.
  const contextTag = `tree-node:${nodeId}`
  let conv = await prisma.conversation.findFirst({
    where: { userId, context: contextTag },
    orderBy: { createdAt: 'asc' },
    include: { messages: { orderBy: { createdAt: 'desc' }, take: 40 } },
  })
  if (conv) conv.messages.reverse()
  if (!conv) {
    const created = await store.createConversation(node.title.slice(0, 60), contextTag)
    conv = { ...created, messages: [] } as typeof conv & { messages: [] }
  }

  // The persisted record carries the attachment chips so the thread shows
  // them after reloads (same convention as the copilot). Persisted BEFORE
  // the (slow) attachment analysis: if Gemini stalls past the function
  // limit, the student's message must already be in the thread.
  const { analyzeAndPersistAttachments, attachmentRecordLabel } = await import('@/lib/attachments')
  const userRecord = attachmentRecordLabel(msgText, atts)
  if (!isTrigger) await store.addMessage(conv!.id, 'user', userRecord)

  // ── Analyze attachments (image / voice / video / pdf / text) ──
  // Shared pipeline with the tree copilot: Gemini reads the media before
  // Bob's turn (voice notes come back as TRANSCRIPT + NOTES), and every
  // attachment persists as THIS NODE's evidence (the workspace Files tab) —
  // future turns read it back through the files block below.
  const { analyses, fileIds: attachedFileIds } = isTrigger || atts.length === 0
    ? { analyses: [], fileIds: [] }
    : await analyzeAndPersistAttachments(userId, atts, {
        context: `The student is working on the node "${node.title}" (${node.summary}) of their problem-mastery tree "${tree.title}". They shared this in the node's workspace chat.`,
        workType: 'tree-node',
        workId: nodeId,
      })

  // ONE definition of "what the student said this turn" for every silent
  // consumer (folded assessment, insight extraction): the typed text plus
  // a clearly-framed digest of the attachment analyses — a voice note's
  // transcript IS the student speaking, and dropping it would starve the
  // insight moat on exactly the richest turns.
  const turnContent = analyses.length > 0
    ? `${msgText}${msgText ? '\n' : ''}[Shared: ${analyses.map(a => a.name).join(', ')}] ${analyses.map(a => a.analysis).join(' · ').slice(0, 800)}`
    : msgText

  // Adaptive layer, PRE-PASS FOLDED: the blocking Haiku read before every
  // turn is gone. Bob runs the contextual read HIMSELF this turn (rules in
  // the STUDENT ASSESSMENT section below) and reports the structured half —
  // streak, discovery, move, progress, misconception — on a trailing
  // [[ASSESS]] line, processed after the stream. The server still assembles
  // the PERSISTED state the read needs: the prior streak, and (in the risk
  // zone) the analogy anchors and unverified prerequisites the
  // Insight-Constellation laws teach from.
  let reflectionBlock = ''
  let suggestion: { type: 'add'; title: string; summary: string } | { type: 'move'; nodeId: string; title: string } | null = null
  // XP earned server-side during this turn (perseverance tiers) — appended to
  // the stream as a [[XP]] marker so the client can toast it.
  const turnXp: XpAwardLite[] = []
  const priorReflection = safeParse<{ lastReflection?: Reflection }>(conv!.summary, {}).lastReflection ?? null
  // JUDGED ANSWERS ARE GROUND TRUTH: typed-confusion streaks live in the
  // stored reflection; checkpoint misses in quizState (written by the quiz
  // route). The live streak is whichever is worse.
  const priorStreak = Math.max(priorReflection?.streakWrong ?? 0, quizStateNow.wrongStreak ?? 0)
  if (!isTrigger) {
    let analogyBlock = ''
    let prereqBlock = ''
    if (priorStreak >= 1) {
      // One confused/wrong turn already on record — this turn can cross the
      // 2-streak threshold, so the bridge material rides along now.
      try {
        const { getTopInsights } = await import('@/lib/insight-memory')
        const anchors = await getTopInsights(userId, { limit: 8, types: ['knowledge', 'strength', 'interest'] })
        if (anchors.length > 0) {
          analogyBlock = `\n- ANALOGY BRIDGE (apply at 2+ confused turns): the student verifiably knows / is strong in:\n${anchors.map(a => `    · [${a.type}] ${a.content}`).join('\n')}\n  Build the re-explanation as an EXPLICIT analogy: map the structure of one of these onto "${node.title}" step by step ("you already know X — this works the same way, except…"). Anchor the new concept to their existing knowledge, then show where the analogy breaks.`
        }
      } catch { /* non-critical */ }
      const ancestors = nodePath(tree.nodes, nodeId).slice(0, -1).filter(a => a.parentId !== null && a.status !== 'understood')
      if (ancestors.length > 0) {
        prereqBlock = `\n- PREREQUISITE CHECK (apply at 2+ confused turns): these upstream nodes are NOT yet verified: ${ancestors.map(a => `"${a.title}"`).join(', ')}. The real gap may live there — probe one prerequisite briefly; if confirmed, recommend moving to that node.`
      }
    }
    const misconceptionBlock = priorReflection?.misconception
      ? `\n- KNOWN MISCONCEPTION (recorded earlier): "${priorReflection.misconception}" — if this turn shows it again, refute the belief itself DIRECTLY and memorably (repair theory); more examples alone will not fix it.`
      : ''
    reflectionBlock = `

## STUDENT ASSESSMENT (silent — run it before answering; never mention it)
- Consecutive confused/incorrect turns BEFORE this message: ${priorStreak}${(quizStateNow.wrongStreak ?? 0) > 0 ? ` (incl. ${quizStateNow.wrongStreak} judged checkpoint misses)` : ''}
- Read this message against the exchange first: is the student tracking, partially there, or lost? Confusion or an incorrect idea → the streak becomes ${priorStreak + 1}; a sound message → it resets to 0. Then act:
- Tracking well → a Socratic probe ("why do you think that works?") beats another explanation.
- Streak at 2+ → SUPPORT FIRST: open with genuine, specific reassurance, then teach from a COMPLETELY different angle. NO checkpoint question this turn — struggling IS the learning here.
- Streak at 4+ → WHEEL-SPINNING: more of the same teaching will NOT work. Switch intervention entirely — a fully worked example start-to-finish, a different representation (visual/concrete/numeric), or the prerequisite route — and say openly that you're changing approach.
- A SYSTEMATIC wrong belief (stated as their model of how things work, or repeated) → refute it DIRECTLY and memorably: name the belief, show precisely why it fails, replace it (repair theory). More examples alone will not fix it.${analogyBlock}${prereqBlock}${misconceptionBlock}
THEN — after your reply's last prose line, BEFORE any [[QUIZ]] block, emit this on ONE single line (never mention or explain it; it is stripped before the student sees anything):
[[ASSESS]]{"streakWrong":<${priorStreak + 1} if this message shows confusion/an incorrect idea, else 0>,"suggestNode":<usually null — see DISCOVERY>,"moveToTitle":<usually null — the exact title of the DIFFERENT existing tree node this discussion clearly belongs to>,"projectProgress":<usually null — see PROGRESS>,"misconception":<"the systematic wrong belief, stated precisely" — or null>}
- DISCOVERY (suggestNode): ONLY when the student's questions have REPEATEDLY (2+ times) circled a coherent field NO existing tree node covers AND the root goal has a hole without it (goal-necessity law; merely related/interesting → null): {"title":"2-6 words","summary":"1-2 plain sentences"}. Be conservative — most turns warrant null.
- PROGRESS (projectProgress): ONLY for citable, COMPLETED real-world execution (ran an experiment, wrote code, built something, measured results): {"text":"one line","evidence":{"kind":"message"|"file","name":"<file name when kind=file>","quote":"<snippet copied VERBATIM from the student's message or an attachment's analysis>"}}. The system verifies the quote character-for-character and silently drops mismatches. Intentions, plans, and questions are never progress; a file merely existing is never progress.
- suggestNode / projectProgress / misconception strings follow the session language — they are persisted and shown to the student.`
  } else if (isRemediate) {
    // ── THE ADAPTIVE LAYER, ON THE TURN IT EXISTS FOR (deep-audit §5) ──
    // The remediation turn used to run with reflectionBlock = '' — no
    // analogy bridge, no prerequisite chain, no wheel-spinning escape, no
    // learner memory — because the whole assembly was gated on the student
    // having TYPED something. A trigger turn has no utterance, so it is
    // assembled from PERSISTED state instead: the judged wrong-streak and
    // the last stored reflection.
    const wrong = priorStreak
    let analogyBlock = ''
    if (wrong >= 2) {
      try {
        const { getTopInsights } = await import('@/lib/insight-memory')
        const anchors = await getTopInsights(userId, { limit: 8, types: ['knowledge', 'strength', 'interest'] })
        if (anchors.length > 0) {
          analogyBlock = `\n- ANALOGY BRIDGE: the student verifiably knows / is strong in:\n${anchors.map(a => `    · [${a.type}] ${a.content}`).join('\n')}\n  Build this remediation as an EXPLICIT analogy: map the structure of one of these onto "${node.title}" step by step ("you already know X — this works the same way, except…"). Anchor the new concept to their existing knowledge, then show where the analogy breaks.`
        }
      } catch { /* non-critical */ }
    }
    let prereqBlock = ''
    if (wrong >= 2) {
      const ancestors = nodePath(tree.nodes, nodeId).slice(0, -1).filter(a => a.parentId !== null && a.status !== 'understood')
      if (ancestors.length > 0) {
        prereqBlock = `\n- PREREQUISITE CHECK: these upstream nodes are NOT yet verified: ${ancestors.map(a => `"${a.title}"`).join(', ')}. The real gap may live there — after teaching this gap, briefly check one prerequisite; if confirmed, recommend moving to that node.`
      }
    }
    const misconceptionBlock = priorReflection?.misconception
      ? `\n- KNOWN MISCONCEPTION (recorded earlier): "${priorReflection.misconception}" — if this miss traces to it, refute the belief itself DIRECTLY and memorably (repair theory); more examples alone will not fix it.`
      : ''
    const wheelBlock = wrong >= 4
      ? `\n- WHEEL-SPINNING: ${wrong} consecutive missed checkpoints. More of the same teaching will NOT work. Switch intervention entirely: a fully worked example start-to-finish, OR a different representation (visual/concrete/numeric), OR the prerequisite route above. Say openly that you're changing approach.`
      : ''
    // Perseverance XP from JUDGED misses (typed confusion has its own path
    // above): pays once per wrong answer — gated on the still-armed
    // remediation debt so a mount-refire of this turn can't double-pay.
    if (quizStateNow.remediationOwed && wrong >= 2 && wrong <= 4) {
      try {
        const { awardXp } = await import('@/lib/xp-engine')
        const a = await awardXp(userId, 'perseverance', { streakWrong: wrong })
        if (a) turnXp.push(a)
      } catch { /* non-critical */ }
    }
    if (analogyBlock || prereqBlock || misconceptionBlock || wheelBlock) {
      reflectionBlock = `

## CONTEXTUAL READ (persisted learner state — act on it, never mention it)
- Consecutive missed checkpoints on this node: ${wrong}${analogyBlock}${prereqBlock}${misconceptionBlock}${wheelBlock}`
    }
  }

  // The student's uploaded evidence for this node — Bob reads actual file
  // content (text files excerpted; images/binaries listed by name). Files
  // persisted from THIS turn's attachments are excluded: their full analyses
  // already ride in the ATTACHMENTS block below. Split queries so MB-scale
  // data-URI media rows never ship their base64 content just to be listed
  // by name — only text-content rows (which includes stored analyses) are
  // fetched with content.
  let filesBlock = ''
  try {
    const baseWhere = {
      userId, workType: 'tree-node', workId: nodeId,
      ...(attachedFileIds.length ? { id: { notIn: attachedFileIds } } : {}),
    }
    const [textFiles, mediaFiles] = await Promise.all([
      prisma.linkedFile.findMany({
        where: { ...baseWhere, NOT: { content: { startsWith: 'data:' } } },
        select: { name: true, content: true },
        orderBy: { addedAt: 'desc' },
        take: 5,
      }),
      prisma.linkedFile.findMany({
        where: { ...baseWhere, content: { startsWith: 'data:' } },
        select: { name: true, mimeType: true, analysis: true },
        orderBy: { addedAt: 'desc' },
        take: 5,
      }),
    ])
    if (textFiles.length > 0 || mediaFiles.length > 0) {
      filesBlock = `\n## THE STUDENT'S FILES ON THIS NODE (their real work — read and reference it)\n` + [
        ...textFiles.map(f => `### ${f.name}\n${(f.content ?? '').slice(0, 2000)}${(f.content ?? '').length > 2000 ? '\n…(truncated)' : ''}`),
        // Media evidence: Gemini's understanding of the image/audio/video/PDF
        // (a voice note's TRANSCRIPT is the student speaking) so Bob can ground
        // in the CONTENT. A row with no analysis yet (just uploaded, or an old
        // pre-analysis file) falls back to the filename note.
        ...mediaFiles.map(f => f.analysis?.trim()
          ? `### ${f.name} (${f.mimeType ?? 'media'} — Gemini analysis)\n${f.analysis.slice(0, 2500)}`
          : `### ${f.name} (${f.mimeType ?? 'binary'} — analysis pending; ask the student about it if relevant)`),
      ].join('\n\n')
    }
  } catch { /* non-critical */ }

  // Evidence locker: real artifacts uploaded anywhere on the tree (this
  // node's files are already shown in full above) — Bob grounds numbers in
  // these instead of inventing plausible examples.
  const lockerBlock = await evidenceLocker(userId, tree.nodes, nodeId)

  // What the branch BELOW this node already taught (ancestor workspaces) —
  // the per-node redundancy-avoidance law: build on it, never re-teach it.
  const coverageBlock = await branchCoverage(userId, tree.nodes, nodeId)

  // What the student attached to THIS message, analyzed — the reply must be
  // grounded in the actual content (same convention as the tree copilot).
  // When attachments arrived but NOTHING could be read/analyzed, Bob must be
  // told so — otherwise "(see the attachments above)" points at nothing and
  // he narrates around a phantom.
  const attachBlock = analyses.length > 0
    ? `\n## ATTACHMENTS THE STUDENT JUST SHARED (analyzed for you — ground your reply in their ACTUAL content; a voice note's TRANSCRIPT is the student speaking, so answer it as their words)\n${analyses.map(a => `### ${a.name}\n${a.analysis.slice(0, 3000)}`).join('\n\n')}`
    : !isTrigger && atts.length > 0
      ? `\n## ATTACHMENTS: the student attached ${atts.map(a => `"${(a.name ?? 'attachment').slice(0, 80)}"`).join(', ')} but the content could not be read or analyzed this turn. Say so briefly and ask them to describe it or re-send it — do NOT pretend to have seen it.`
      : ''

  const path = nodePath(tree.nodes, nodeId)

  // ── Delayed retest (memory needs the gap) ──
  // When the student RETURNS to this node after hours away and a checkpoint
  // was missed last time, Bob re-probes that exact gap from a new angle —
  // a re-ask five minutes later only tests short-term memory.
  const RETEST_GAP_MS = 3 * 60 * 60 * 1000
  let retestTarget: string | null = null
  if (!isTrigger && quizStateNow.missed.length > 0) {
    // conv.messages was fetched BEFORE this turn's user message was
    // persisted, so the last entry is genuinely the previous visit's tail.
    const msgs = conv!.messages ?? []
    const lastMsgAt = msgs.length > 0 ? new Date(msgs[msgs.length - 1].createdAt).getTime() : 0
    const returning = lastMsgAt > 0 && Date.now() - lastMsgAt >= RETEST_GAP_MS
    if (returning) {
      const due = quizStateNow.missed.find(m => Date.now() - new Date(m.missedAt).getTime() >= RETEST_GAP_MS)
      if (due) retestTarget = due.question
    }
  }

  // Learning-path successor (pre-order = the canvas numbering) — the
  // [NODE_VERIFIED] turn names it and ships it as the [[NEXT_NODE]] button.
  const nextOnPath = (() => {
    if (!isVerifiedTurn) return null
    const real = tree.nodes.filter(n => !n.pending)
    const rootN = real.find(n => n.parentId === null)
    if (!rootN) return null
    const kids = new Map<string, typeof real>()
    for (const n of real) {
      if (!n.parentId) continue
      if (!kids.has(n.parentId)) kids.set(n.parentId, [])
      kids.get(n.parentId)!.push(n)
    }
    const walkOrder: typeof real = []
    const rec = (pid: string) => { for (const c of kids.get(pid) ?? []) { walkOrder.push(c); rec(c.id) } }
    rec(rootN.id)
    return walkOrder.find(n => n.status !== 'understood' && n.id !== nodeId) ?? null
  })()

  // The insight moat, finally in the surface where 95% of learning happens
  // (deep-audit §9): verified knowledge, strengths, and ACTIVE misconceptions
  // ride into every workspace turn.
  const groundingBlock = await studentGrounding(userId)

  // ── PROMPT CACHING LAYOUT (prefix rule: stable first, volatile last) ──
  // Block 1 (cached): everything stable for the whole node session —
  // identity, node position, explainer, every teaching law, the static
  // checkpoint/visual rules, session directives. Block 2 (its own breakpoint,
  // AFTER block 1, so a status flip anywhere on the tree busts only the
  // sketch, never the big block): the full tree sketch. Block 3 (own
  // breakpoint): the SESSION CONTEXT — files, evidence locker, branch
  // coverage, student grounding — stable across a node session absent
  // uploads/summary refreshes; it used to ride the per-turn message at full
  // input rate every turn (qa-findings-4 №4). Genuinely per-turn material —
  // attachments, mastery state, trigger scripts, assessment — rides INSIDE
  // the final user message, AFTER the cached history, so history prefixes
  // keep hitting too (a chunk-anchored window keeps them stable).
  const systemCore = `You are Bob, the student's expert mentor inside the Tree EDU problem-mastery tree.

## WHERE YOU ARE
PROBLEM (root): "${tree.title}"
${tree.framing ? `FRAMING: ${tree.framing}\n` : ''}The student is working on the node: "${node.title}" — ${node.summary}
Path from root: ${path.map(n => `"${n.title}"`).join(' → ')}
(The FULL TREE sketch and the SESSION CONTEXT — the student's files, tree evidence, what the branch below already covered, what is known about the student — are the next system blocks; the live per-turn material — this turn's attachments, the LIVE MASTERY STATE, and this turn's script — arrives inside the latest user message as TURN CONTEXT.)
${node.explainer ? `\nThe node's explainer (already shown to the student):\n${node.explainer.slice(0, 2500)}` : ''}

## HOW TO TEACH HERE
- Everything you say serves ONE goal: this student genuinely understanding THIS node in service of the root problem.
- NO REDUNDANCY: when the ALREADY COVERED section (in the SESSION CONTEXT) shows the branch below taught something this node touches, build FROM it by reference ("as you saw at '<node>'…") — never re-explain it. Teach only what is NEW at this node.
- Dense, precise, zero praise-padding. Concrete examples over abstractions.
- **Be Socratic where it earns its place**: when the student is tracking well, probe ("why would that break if…?") instead of explaining more. When they're lost, teach directly — Socratic questioning of a confused student is theatre, not teaching.
- Connect answers back to the root problem and this node's branch whenever natural.
- Nodes marked PENDING in the tree are unapproved proposals — they do NOT exist for the student. Never cite them as siblings they've learned from, completed context, or promised destinations. If one genuinely holds the answer, say it's waiting as a proposal on their tree for them to approve or dismiss.
- Stay CONSISTENT with the node's explainer shown above. If you must simplify or correct it, say so explicitly ("the explainer simplifies here — the fuller picture is…") — never silently contradict it; the student reads both.
- You do not know facts about the student's real project (stack, files, configs) unless they told you or their uploaded files show it — never assert such facts; ask or hedge.

${ANSWER_STANDARD}

## FORMAT EVERY TEACHING RESPONSE FOR SCANNING (structure IS the page)
- Substantial responses: ONE short \`##\` title naming the turn's topic, \`###\` subheads for its parts, and BULLETS as the default body — **bold lead-in**, then the plain-words point. A prose paragraph only where one flowing thought needs it (max 3 short sentences), never two paragraphs in a row.
- **Bold** key terms where they're defined; > blockquote for the ONE takeaway worth remembering; KaTeX ($...$) for any math; a tiny table where a 2-way contrast is the point.
- Short conversational replies (a quick answer, a Socratic probe) stay 1-3 plain sentences — no headers, no bullets; never decorate a one-liner.
- If their question opens genuinely NEW ground that this node cannot teach (a distinct concept deserving its own branch), answer briefly, then tell them: use the "Grow branch" button at the top of this workspace — or the "Grow this into a branch" action under any message — with that question, so the tree can propose new child nodes here for their approval. The tree only grows with their permission; do not pretend to add nodes yourself.

## CHECKPOINT QUESTIONS — THE RULES (mastery is proven HERE in chat — there is no separate test; the LIVE MASTERY STATE in each turn's TURN CONTEXT is the live tally)
- VERIFICATION INTEGRITY (trust-critical): you NEVER declare this node verified — only the checkpoint system announces verification, in the feedback after a passing answer. Until the LIVE MASTERY STATE says otherwise, the node is NOT verified, no matter how well the conversation is going. The three pips in the workspace header always display this node's correct-checkpoint tally (e.g. 2/3) — if the student asks about them, say exactly that; never invent UI meanings.
- THE LIVE MASTERY STATE IS THE ONLY TRUTH about progress. If the conversation's visible ✅ count, the student's belief, or your own memory disagrees with it, the mastery state WINS: say plainly how many answers are recorded (e.g. "the system has 2 of 3 recorded — one more correct answer verifies it") and simply continue with the next checkpoint. NEVER speculate about display bugs, sync issues, or tell the student to "trust the header over me" / refresh the page — the header and this state are the same number, and inventing a discrepancy story erodes the exact trust verification exists to build.
- To check understanding — after teaching a chunk, when the student sounds ready, or when they ask to be quizzed — end your message with EXACTLY ONE checkpoint block as the very last line:
[[QUIZ]]{"kind":"mcq","question":"...","options":["...","...","...","..."],"correctIndex":0,"explanation":"1-2 sentences: the science of why the right answer is right and why the tempting distractor fails","hint":"a nudge that narrows the student's thinking WITHOUT revealing or eliminating the answer","facet":"the exact coverage-map facet this probes (when a map exists)"}
or
[[QUIZ]]{"kind":"short","question":"...","rubric":"what a truly-understanding answer must contain (never shown to the student)","hint":"a nudge that points at the right ANGLE of thinking without giving the answer","facet":"the exact coverage-map facet this probes (when a map exists)"}

[[QUIZ]]{"kind":"artifact","question":"name the EXACT real-world evidence to produce and attach — the artifact itself, never prose about it (e.g. 'Attach your actual 10-minute profiler capture' / 'A photo of the wired relay with the pump running')","rubric":"what the attached artifact must visibly SHOW to prove this facet (never shown to the student)","hint":"where or how to capture it, without doing it for them","facet":"the exact coverage-map facet this probes (when a map exists)"}

ARTIFACT CHECKPOINTS — when a facet is proven by DOING (a measurement taken, a circuit wired, code run and its output, a capture recorded), prefer kind "artifact": the card lets the student attach a photo/screenshot/file from their device, and the judge grades what the artifact actually shows — their build, not their wording. On a session whose target level is advanced/professional, make at least ONE checkpoint on this node an artifact checkpoint whenever any facet is genuinely doable at the student's stage. Never demand an artifact the student cannot plausibly produce yet, and never use kind "artifact" for purely conceptual facets.
- When a SYLLABUS COVERAGE MAP rides in the LIVE MASTERY STATE, EVERY checkpoint must include "facet":"<exact name from the map>" naming the ⬜ UNDONE facet it probes. Target undone facets — a correct answer proves that facet; questions on already-✅ facets never advance verification. Every promised facet must be probed and proven — none may be skipped, and verification is COVERAGE, not a count. If you omit the tag or misname the facet, that correct answer CANNOT advance coverage — copy the facet name EXACTLY from the map.
- The "hint" ships to the card's Hint button — write it so a stuck student gets un-stuck but still has to do the understanding themselves (point at the mechanism to consider, never at the answer).
- NEVER paste a checkpoint's question or options as plain chat text — plain text cannot be answered, graded, or counted toward mastery. If the student says they can't see the card or its options, do NOT work around it in prose: tell them briefly that a fresh interactive card is attached right below your message (the system attaches it automatically on such turns).
- Every checkpoint obeys the Differentiator Principle: transfer to an UNSEEN context, a why/what-if, or an edge case where the memorized rule breaks — never answerable by reciting the explainer. MCQ distractors are the tempting misconceptions, not filler.
- SCOPE — test ONLY what THIS node ("${node.title}") teaches, using its explainer and this conversation as the whole-node content. Use the FULL TREE sketch to see the BOUNDARIES: concepts owned by OTHER nodes (siblings, children, other branches) are out of scope, and a correct answer here must NEVER require the student to explain another node's mechanism. Example of the trap to avoid: if this node is about the genetic/variety ceiling, do NOT make passing depend on naming a soil/watering/sunlight mechanism — that is a different node's material; ask instead about THIS node's own claim (e.g. why care alone can't beat the variety's ceiling). Cover the WHOLE of this node's material, and stay strictly inside it.
- "short" (own-words) carries the mastery weight — use it for the WHY/transfer probes; "mcq" for quick discrimination checks. Vary the formats.
- At most one checkpoint per message. Never in your opening hook. Skip it on turns where the STUDENT ASSESSMENT rules say SUPPORT FIRST — and NEVER staple a checkpoint to a turn where the student just expressed confusion or you are clarifying a misunderstanding they voiced. Quizzing a lost student converts live confusion into a recorded failure; teach first, checkpoint only once they've re-explained or responded confidently (saying "no quiz yet — tell me back in your own words first" is itself good teaching).
- READINESS INVITATION: on a teaching/discussion turn where the student sounds ready to be tested but you are NOT firing a checkpoint this same turn (the explanation should land first, or you want their consent), end with ONE short natural invitation in the session's language ("Ready for a challenge?" / "Want to prove this one?") and then [[QUIZ_OFFER]] alone on the very last line — the UI renders it as a "Quiz me" button in the chat. Rules: never [[QUIZ_OFFER]] and a [[QUIZ]] block in the same message; never on a SUPPORT-FIRST or remediation turn; never mention the marker itself. If they accept, your next turn opens with the checkpoint.
- The chat UI renders the block as an interactive card — introduce it naturally in prose ("Quick check:"), but do NOT repeat the question or options in your prose, and NEVER mention the JSON or the marker.
- Question, options, explanation and rubric all follow the session's language.
- There is NO "Verify understanding" button — never mention one. When the node verifies, congratulate briefly and point to the next unverified node in service of the root problem.

## VISUAL EXPLANATIONS (a diagram where words strain)
- Use a visual when the student explicitly asks for one, OR when the concept is inherently visual — structure, spatial layout, flow/sequence, timelines/waterfalls, comparisons, geometry — and prose alone is straining. Place EXACTLY this block at the point in your explanation where the diagram belongs:
\`\`\`image
one-sentence description of the diagram to draw — name every part and label explicitly, textbook-diagram style
\`\`\`
- The UI turns the block into a generated diagram in place. Never mention the block or that an image is being generated — just continue teaching around it.
- Labels inside the diagram follow the session's language. At most ONE per message. The Answer Standard applies to visuals too: a diagram must carry mechanism, never decoration.
- VISUAL CONFIDENCE (law): before emitting the block, judge honestly whether ONE static generated diagram can CONFIDENTLY deliver this request. If it can't — the request needs animation, interactivity, many interacting elements, or precise geometry that image generation reliably botches (e.g. many reflected rays forming an envelope) — do NOT emit the block. Instead name the best REAL visual resource for exactly this (a specific interactive simulation, animation, or video — PhET, GeoGebra, Desmos, Falstad, 3Blue1Brown, a Wikipedia animation…) as a markdown link, and TELL the student explicitly that you chose a real resource over generating a diagram because it captures this better. (The system also scores every generated diagram and redirects when it falls short — your upfront judgment saves the student a bad image.)
- When you point at real resources — the honest-redirect case above, or ANY time you name a paper, simulation, video or tool the learner should actually open — emit them as a fenced resources block instead of prose, so they render as clickable cards a beginner will actually use:
\`\`\`resources
[{"name": "PhET — Gas Properties", "url": "https://phet.colorado.edu/en/simulations/gas-properties", "why": "lets you drop the divider yourself and watch the atoms fill the volume", "look": "Set 100 particles, then remove the barrier"}]
\`\`\`
1-3 items, each with a real https URL, a one-line "why this one", and "look" naming exactly what to open/see (figure number, section, control to move). Never leave a recommended resource as plain prose — an inert name is a resource a beginner will never find.
${sessionDirectives(tree, lang)}`

  const systemTree = `## THE FULL TREE (the student's whole learning world right now)
${sketchTree(tree.nodes)}`

  // SESSION CONTEXT (block 3, own breakpoint): stable across the node
  // session — re-billed only when an upload or a background summary refresh
  // actually changes it, instead of at full rate every turn.
  const systemSession = [filesBlock, lockerBlock, coverageBlock, groundingBlock]
    .map(b => b.trim()).filter(Boolean).join('\n\n')

  // The LIVE MASTERY STATE — the per-turn tally the static checkpoint rules
  // (system block 1) refer to. Rides in the TURN CONTEXT, never the cache.
  const masteryStateBlock = `

## LIVE MASTERY STATE (this node, right now)
${node.status === 'understood'
  ? '- This node is already VERIFIED. Checkpoints are optional deepening now (exception: on a RETENTION REVIEW turn you MUST ask one) — focus on connections onward to the root problem.'
  : `- Mastery state: ${masteryFilled(quizStateNow)}/${masteryTarget(quizStateNow)} ${quizStateNow.facets ? 'syllabus facets proven' : 'checkpoint answers correct'} so far${quizStateNow.shortCorrect < MASTERY_MIN_SHORT ? ' — the own-words short-answer requirement is NOT yet met (make an upcoming checkpoint a "short" own-words probe)' : ' — own-words requirement met'}. The node verifies automatically when ${quizStateNow.facets ? 'EVERY facet in the coverage map below is proven by a correct checkpoint' : `${MASTERY_TARGET} answers are correct`} (incl. ${MASTERY_MIN_SHORT} own-words short answer), and the student is told in the feedback.`}
${node.status !== 'understood' && quizStateNow.facets ? `- SYLLABUS COVERAGE MAP (the node's VERIFICATION CONTRACT — the sub-points this node's syllabus promised): ${quizStateNow.facets.map(f => `${f.done ? '✅' : '⬜'} "${f.name}"`).join(' · ')}${(quizStateNow.untaggedStreak ?? 0) >= 1 ? `
- TAGGING ALERT: the student's last ${quizStateNow.untaggedStreak} correct answer(s) carried a missing or unmatchable "facet" tag and could NOT advance coverage — there is NO automatic credit, ever. On your next checkpoint, copy one ⬜ facet name from the map CHARACTER-FOR-CHARACTER into the "facet" field.` : ''}` : ''}
${quizStateNow.sureWrong >= 2 && quizStateNow.sureWrong > quizStateNow.sureRight ? `- CONFIDENCE CALIBRATION: the student has been confidently wrong ${quizStateNow.sureWrong} times on this node (vs ${quizStateNow.sureRight} confidently right) — a real blind-spot pattern, not a slip. Aim checkpoints at exactly the claims they were sure-but-wrong about, and weight a confident tone in their answers as weak evidence until their calibration recovers.` : ''}
${retestTarget ? `- DELAYED RETEST DUE: on their last visit the student MISSED this checkpoint: "${retestTarget.slice(0, 300)}". After addressing their current message, re-probe that exact gap THIS TURN with a checkpoint block asking it from a NEW angle (different scenario and wording — never reuse the old question), and include "retest": true inside that checkpoint's JSON so the system links it to the missed one (omit the flag on any unrelated checkpoint). If the STUDENT ASSESSMENT says SUPPORT FIRST, teach now and retest on the next calm turn instead.` : ''}`

  const turnScript = `${isIntro ? `
## THIS TURN: THE NODE SYLLABUS (the student just arrived; they have NOT spoken)
Open with a BAREBONES syllabus — an outline, not a lecture. The teaching happens in the checkpoint loop that follows; this opener only maps the ground. EXACTLY this structure:

## <name the concept as a title>
ONE sentence: ${coverageBlock ? 'a one-clause callback to what the branch below already established (from the ALREADY COVERED section — reference, zero re-explanation), then ' : ''}what this node establishes and why the ROOT problem ("${tree.title}") needs it.

### What you'll cover
The 3-5 specific sub-points this node owns — each a **bolded term** plus at most one short clause. SPECIFIC to "${node.title}" (the real mechanisms, choices, quantities, terms — never generic placeholders); if this node already has child nodes in the tree, use those as the sub-points. Every sub-point is NEW ground owned by THIS node — anything an ancestor's workspace already taught may appear only as a one-clause callback inside a bullet, never as its own sub-point.

OPTIONAL — only if the node's structure is inherently visual/spatial (a flow, a layout, interacting parts): ONE \`\`\`image concept-map block placing the sub-points in relation to each other. Skip it otherwise.
Close with ONE line noting the full explainer is available on demand — one tap/click in this workspace (name no specific button: the control differs per device) — and that mastery is proven by answering the checkpoints right here in chat; then ONE engaging question that pulls them straight into the first sub-point (conversational prose; do NOT emit a [[QUIZ]] block in this opener).
HARD LIMIT: no "big idea" paragraph, no objectives list, no trap section, no welcome filler — at most ~120 words of prose beyond the bullets. Barebones and specific beats comprehensive here.
FINALLY — as the very LAST line of the message, emit this machine block (never mention or explain it):
[[SYLLABUS]]{"facets":["<sub-point 1>","<sub-point 2>","..."]}
— one entry per "What you'll cover" sub-point (3-5 entries), each the short bolded term you used, in the session's language. THIS LIST IS THE NODE'S VERIFICATION CONTRACT: every facet you promise here must later be proven by a correct checkpoint before the node verifies, so promise exactly what this node truly owns — no filler facets, no facets belonging to other nodes.` : ''}${isReview ? `
## THIS TURN: RETENTION REVIEW (the student clicked Review on this verified node — they have not spoken)
Memory fades; this visit exists to interrupt that.
1. In 2-4 sentences, reactivate the core idea as a recall cue — what it is and why it mattered to the ROOT problem ("${tree.title}"). No full re-lecture.
2. END with exactly ONE [[QUIZ]] checkpoint (prefer "short") that probes the concept from an angle NOT used earlier in this conversation. Reviews pay full XP — make it a genuine transfer question.` : ''}${isCheckpoint ? (node.status === 'understood' ? `
## THIS TURN: DEEPENING CHECK ON A VERIFIED NODE (the student just answered correctly — this node is ALREADY verified)
There is NO verification progress to advance and you must never imply there is — no "N more to verify", no facet targeting, no own-words requirement talk (the mastery state above is the only truth: this node is verified). In 2-4 sentences, acknowledge the correct answer and connect it ONWARD — to the next unverified node in the tree above, or to the ROOT problem ("${tree.title}"). You MAY end with exactly ONE deeper transfer [[QUIZ]] checkpoint (Differentiator bar, scoped to THIS node) ONLY if the student has shown appetite for more practice this visit; otherwise end with the connection onward and NO checkpoint block.` : `
## THIS TURN: NEXT CHECKPOINT (the student just answered CORRECTLY — keep asking)
BOTTLENECK-TRIGGERED TEACHING (law): no bottleneck was found — a correct answer means nothing needs teaching right now, so don't. This node is NOT yet verified (${masteryFilled(quizStateNow)}/${masteryTarget(quizStateNow)} ${quizStateNow.facets ? 'facets proven' : 'correct'}${quizStateNow.shortCorrect < MASTERY_MIN_SHORT ? `, and still needs ${MASTERY_MIN_SHORT} own-words short answer` : ''}). Keep the momentum:
1. A 3-6 word "Good — next:" bridge is enough. No lecture. HARD LIMIT, not a style note: the bridge is AT MOST 2 SHORT SENTENCES and never a paragraph. A correct answer means the model found NO bottleneck, so there is nothing to teach into — re-explaining the concept they just proved wastes their time, buries the next question, and breaks Bottleneck-Triggered Teaching. Do NOT restate the mechanism, do NOT add "to build on that…", do NOT elaborate the example, do NOT preview the next facet's content. Confirm what they got right in one clause, then ask.
2. Then END with exactly ONE NEW [[QUIZ]] checkpoint — different from every question already asked, scoped strictly to THIS node${quizStateNow.facets ? ` and probing the NEXT UNDONE facet from the coverage map${quizStateNow.facets.find(f => !f.done) ? ` ("${quizStateNow.facets.find(f => !f.done)!.name}")` : ''} with its "facet" field set` : ''}${quizStateNow.shortCorrect < MASTERY_MIN_SHORT ? ', and make it a "short" own-words probe (the node still needs one to verify)' : ' (vary MCQ / short)'}.
Output nothing after the checkpoint block.
(If their last answer was actually wrong/shaky — this trigger is only meant to fire on correct, but just in case — do NOT ask a new checkpoint; instead teach into it exactly as [NODE_REMEDIATE] would below.)`) : ''}${isRemediate ? `
## THIS TURN: BOTTLENECK TEACHING (the student just answered a checkpoint WRONG — this is the bottleneck the ask-first model exists to find)
BOTTLENECK-TRIGGERED TEACHING (law, FOUNDATION.md): Tree EDU asks before it teaches — content is deployed reactively, exactly where a question just proved a gap exists. That gap is right here. Look at the checkpoint question, the student's answer, and the judge's feedback in the conversation above — together they pinpoint PRECISELY what this student does not yet understand. That gap, and ONLY that gap, is what you teach this turn.
Write the remediation as ONE tightly structured mini-explainer — NOT a one-line correction, NOT a re-explanation of the whole node, and NOT an essay. HARD SHAPE, ~250 words max:
## <the gap, named in 2-5 words>
1. **The belief** — 1-2 lines: what their answer shows they think, and why it's a reasonable model.
2. **What's actually true** — the correct mechanism under a \`###\` subhead, bullets-first, with exactly ONE concrete example or analogy told ONCE. This is the core: depth means the right mechanism stated precisely, never length.
3. **Where your reasoning forked** — 1-2 lines (or a tiny 2-row table) drawing the exact line between their model and the true one.
4. OPTIONAL, only when the difference must be FELT: one contrasting case in 2-3 lines — never a second full walkthrough, never the same analogy again.
Everything here obeys the Answer Standard above (Relevant to exactly this gap, never a field survey), STRUCTURED & SHORT, and Per-Node Redundancy Avoidance — if the ALREADY COVERED section shows an ancestor already taught something this touches, reference it in one clause, never re-teach it.
Close with ONE short, conversational, inviting question checking they're following ("does that land?" / "want me to walk the [specific piece] again a different way?") — plain prose only. Do NOT ask a new checkpoint this turn, do NOT offer to quiz them, and do NOT emit a [[QUIZ]] block — they need room to actually absorb this before being tested on it again. Asking resumes once they re-engage.` : ''}${isContinue ? `
## THIS TURN: CONTINUE A CUT-OFF ANSWER
Your previous reply was cut off mid-thought by a length limit — the student is looking at a half-finished explanation. Resume EXACTLY where it stopped and finish the thought.
- Do NOT greet, do NOT apologise, do NOT recap, do NOT restate anything you already wrote. The student sees your earlier text directly above; your output is appended to it.
- If the cut landed mid-sentence (or mid-formula), begin with the exact continuation of that sentence so the two halves read as one.
- Finish what you were saying, then stop. Emit a [[QUIZ]] block ONLY if the cut-off turn was itself building to a checkpoint (never on a remediation turn).` : ''}${isVerifiedTurn ? `
## THIS TURN: THE NODE JUST VERIFIED (the payoff moment — you author it; the student has not spoken)
The checkpoint system just verified "${node.title}" — the student proved every promised point. This is the highest-momentum moment in the product; give it an author:
1. ONE line of genuine, specific congratulation — never generic praise.
2. WHAT THEY PROVED, as capabilities: ${quizStateNow.facets?.length ? `restate each proven syllabus point as something they can now DO, one clause each: ${quizStateNow.facets.map(f => `"${f.name}"`).join(', ')}.` : 'restate the 2-3 core things this node established as capabilities ("you can now …").'}
${quizStateNow.provenAnswers?.length ? `2b. QUOTE THEIR OWN WINNING EXPLANATION back to them — verbatim, quotation-marked, attributed: In your words: "${quizStateNow.provenAnswers[quizStateNow.provenAnswers.length - 1].answer.slice(0, 300)}". Then one clause on why that explanation is exactly right — that explanation is THEIRS now; let them see it stand.` : ''}
3. ONE sentence tying this node's mastery to the ROOT problem ("${tree.title}")${tree.purpose ? ` and their purpose (${tree.purpose.slice(0, 160)})` : ''} — what just became reachable.
${nextOnPath ? `4. Name the next stop on their learning path — "${nextOnPath.title}" — in one inviting sentence about why it comes next (the UI attaches a button to it; do NOT tell them to find it manually).` : `4. Every branch is now verified — say so, and invite them to ask the Tree Copilot whether the ROOT problem is fully answered or a gap remains.`}
4-6 sentences TOTAL. No headers, no lecture, no re-teaching, NO [[QUIZ]] block and NO [[QUIZ_OFFER]] — this turn is a landing, not a launch.` : ''}${reflectionBlock}`

  // Excerpt any oversized past entry so a message stored before the length
  // cap (or a huge assistant turn) can't keep exceeding the model context.
  const HISTORY_MSG_CAP = 4000
  // CHUNK-ANCHORED WINDOW: a plain "last 20" slides one step every turn,
  // changing the prompt prefix and busting the history cache on every
  // message. The window START instead advances in steps of 12 (the window
  // holds 20-31 messages), so the history prefix stays byte-stable for ~6
  // turns at a stretch and the breakpoint on its tail keeps hitting.
  const allMsgs = (conv!.messages ?? []).filter(m => m.role === 'user' || m.role === 'assistant')
  const totalMsgs = allMsgs.length >= 40
    ? Math.max(allMsgs.length, await prisma.message.count({ where: { conversationId: conv!.id } }).then(n => n - (isTrigger ? 0 : 1)).catch(() => allMsgs.length))
    : allMsgs.length
  const HIST_CHUNK = 12
  const winLen = Math.min(allMsgs.length, totalMsgs - Math.floor(Math.max(0, totalMsgs - 20) / HIST_CHUNK) * HIST_CHUNK)
  const history = allMsgs.slice(allMsgs.length - winLen).map(m => ({
    role: m.role as 'user' | 'assistant',
    content: m.content.length > HISTORY_MSG_CAP ? `${m.content.slice(0, HISTORY_MSG_CAP)}\n…[truncated]` : m.content,
  }))

  // Per-turn material rides in the FINAL user message — after the cached
  // history — the only part of the prompt that changes every turn.
  const turnContext = `${attachBlock}${masteryStateBlock}${turnScript}`

  const encoder = new TextEncoder()
  const convId = conv!.id
  const QUIZ_MARK = '[[QUIZ]]'
  const SYL_MARK = '[[SYLLABUS]]'
  const stream = new ReadableStream({
    async start(controller) {
      let full = ''
      // Bob always speaks with the newest teaching model (resolver: latest
      // Opus release, pinned fallback) — upgrades land without a deploy.
      const model = await getTeachingModel()
      // Machine-marker protection: the [[QUIZ]] JSON must never stream to
      // the client (it carries correctIndex/rubric), and the [[SYLLABUS]] /
      // [[ASSESS]] blocks are server-only bookkeeping. We forward text with a
      // holdback the length of the longest marker, so no byte at or past a
      // possible marker start ever leaves before we know what it is.
      const MARK_HOLD = Math.max(QUIZ_MARK.length, SYL_MARK.length, ASSESS_MARK.length)
      let sentLen = 0
      // TRUNCATION: set when the model was guillotined by the token cap.
      // A half-finished explanation is worse than none — the learner
      // cannot tell whether they misread it or the app broke.
      let truncated = false
      const forwardSafe = () => {
        const idxs = [full.indexOf(QUIZ_MARK), full.indexOf(SYL_MARK), full.indexOf(ASSESS_MARK)].filter(i => i !== -1)
        const firstMark = idxs.length ? Math.min(...idxs) : -1
        const safeLen = firstMark !== -1 ? firstMark : Math.max(sentLen, full.length - MARK_HOLD)
        if (safeLen > sentLen) {
          try { controller.enqueue(encoder.encode(full.slice(sentLen, safeLen))) } catch { /* closed */ }
          sentLen = safeLen
        }
      }
      try {
        const Anthropic = (await import('@anthropic-ai/sdk')).default
        const client = new Anthropic({ apiKey })
        const response = client.messages.stream({
          model,
          // Long remediation turns were hitting the old 2000 cap and getting
          // cut off mid-sentence (mid-LaTeX, even). Give real teaching room;
          // the truncation marker below still catches the tail cases.
          max_tokens: 3200,
          ...NO_THINKING,
          // Cached prefix: core laws (block 1) + tree sketch (block 2) +
          // session context (block 3), each with its own breakpoint so a
          // change in one never re-bills the ones before it. The 4th
          // breakpoint rides the last HISTORY message so the conversation
          // prefix re-reads from cache and grows incrementally; the per-turn
          // context sits after it, inside the final user turn.
          system: [
            { type: 'text' as const, text: systemCore, cache_control: { type: 'ephemeral' as const } },
            { type: 'text' as const, text: systemTree, cache_control: { type: 'ephemeral' as const } },
            ...(systemSession ? [{ type: 'text' as const, text: `## SESSION CONTEXT (this node's stored ground — files, tree evidence, branch coverage, the student)\n${systemSession}`, cache_control: { type: 'ephemeral' as const } }] : []),
          ],
          messages: [
            ...history.map((m, i) => i === history.length - 1
              ? { role: m.role, content: [{ type: 'text' as const, text: m.content, cache_control: { type: 'ephemeral' as const } }] }
              : m),
            { role: 'user' as const, content: `<turn_context>${turnContext}\n</turn_context>\n\n${msgText || '(see the attachments above)'}` },
          ],
        })
        for await (const event of response) {
          if (event.type === 'content_block_delta' && 'text' in event.delta) {
            full += event.delta.text
            forwardSafe()
          }
        }
        // Cost telemetry for the streamed turn.
        try {
          const final = await response.finalMessage()
          // stop_reason 'max_tokens' = the answer was cut off mid-thought.
          if (final.stop_reason === 'max_tokens') truncated = true
          const { recordAnthropicUsage } = await import('@/lib/usage')
          recordAnthropicUsage(final.usage, { userId, model, feature: 'node-chat' })
        } catch { /* non-critical */ }
      } catch (err) {
        console.error('[tree] node chat failed:', err)
        // The stream returns HTTP 200, so the client's localized catch never
        // fires — this fallback IS what the student reads, so it must obey the
        // session language (no English leaking into a 中文 session).
        if (!full) {
          const zhSession = (tree.language ?? lang) === 'zh'
          controller.enqueue(encoder.encode(zhSession
            ? '现在连接有些问题，请稍后再试。'
            : "I'm having trouble connecting right now. Please try again in a moment."))
        }
      }

      // ── Folded assessment capture ([[ASSESS]]) ──
      // The structured half of the contextual read Bob just ran: stripped
      // from the output, then processed exactly as the old pre-pass was.
      // Extraction runs on EVERY turn — trigger turns included: Bob
      // sometimes carries the marker onto a [NODE_CONTINUE]/trigger turn
      // (the cut-off turn's instructions demanded it), and an unstripped
      // marker persisted raw JSON into the student's chat (qa-findings-4
      // №3). The payload is PROCESSED only on free-chat turns.
      {
        const [cleaned, assess] = extractAssess(full)
        full = cleaned
        if (!isTrigger && assess) {
          const streak = Math.max(Number(assess.streakWrong) || 0, quizStateNow.wrongStreak ?? 0)
          void prisma.conversation.update({
            where: { id: convId },
            data: { summary: JSON.stringify({ lastReflection: { state: '', gapDepth: 'none', streakWrong: streak, directive: '', suggestNode: assess.suggestNode ?? null, moveToTitle: assess.moveToTitle ?? null, misconception: assess.misconception ?? null } }) },
          }).catch(() => null)
          // Perseverance XP: struggle that keeps going is visibly rewarded —
          // once per tier crossing (2 → 3 → 4 confused turns).
          if (streak >= 2 && streak <= 4 && streak > priorStreak) {
            try {
              const { awardXp } = await import('@/lib/xp-engine')
              const a = await awardXp(userId, 'perseverance', { streakWrong: streak })
              if (a) turnXp.push(a)
            } catch { /* non-critical */ }
          }
          // Systematic misconception → remembered (reinforce-over-duplicate:
          // the same belief bumps the existing row instead of stacking).
          if (assess.misconception && typeof assess.misconception === 'string') {
            const zhSession = (tree.language ?? lang) === 'zh'
            const belief = assess.misconception
            void (async () => {
              try {
                const { clampText } = await import('@/lib/clamp')
                // Localized wrapper (no English scaffolding in a 中文 panel);
                // dedup matches on the BARE title across both quote styles.
                const tag = zhSession ? `（出现在「${node.title}」）` : `(at "${node.title}")`
                const existing = await prisma.insight.findFirst({
                  where: {
                    userId, type: 'misconception', status: 'active',
                    OR: [{ content: { contains: `"${node.title}"` } }, { content: { contains: `「${node.title}」` } }],
                  },
                  orderBy: { lastConfirmedAt: 'desc' },
                })
                if (existing) {
                  await prisma.insight.update({
                    where: { id: existing.id },
                    data: {
                      timesObserved: { increment: 1 },
                      lastConfirmedAt: new Date(),
                      confidence: Math.min(1, (existing.confidence ?? 0.5) + 0.05),
                    },
                  })
                } else {
                  await prisma.insight.create({
                    data: {
                      userId, type: 'misconception',
                      content: `${clampText(belief, 250)} ${tag}`,
                      confidence: 0.7, importance: 0.6, source: 'reflection',
                      treeId: id,
                    },
                  })
                }
              } catch { /* non-critical */ }
            })()
          }
          // ── BUILD-LOG EVIDENCE GATE (trust-critical) ──
          // A progress claim is written ONLY when its citation verifies
          // verbatim against this turn's actual inputs — the student's own
          // message or an attachment's Gemini analysis. Everything else is
          // dropped, loudly (a fabricated build-log entry poisons the
          // digest and the portfolio).
          if (assess.projectProgress) {
            const claim = typeof assess.projectProgress === 'object' && assess.projectProgress !== null ? assess.projectProgress : null
            const text = (claim?.text ?? '').trim()
            const quote = (claim?.evidence?.quote ?? '').trim()
            const norm = (s: string) => s.replace(/\s+/g, ' ').toLowerCase()
            let evidence: { kind: 'message' | 'file'; name?: string; quote: string } | null = null
            if (text && quote.length >= 8) {
              if (claim?.evidence?.kind === 'message' && norm(msgText).includes(norm(quote))) {
                evidence = { kind: 'message', quote: quote.slice(0, 300) }
              } else if (claim?.evidence?.kind === 'file') {
                const hit = analyses.find(a => norm(a.analysis).includes(norm(quote)))
                if (hit) evidence = { kind: 'file', name: hit.name.slice(0, 120), quote: quote.slice(0, 300) }
              }
            }
            if (evidence) {
              const cited = evidence
              void (async () => {
                try {
                  const row = await prisma.treeNode.findUnique({ where: { id: nodeId }, select: { progressLog: true } })
                  const log = safeParse<Array<{ text: string; source: string; createdAt: string; evidence?: unknown }>>(row?.progressLog, [])
                  log.push({ text: text.slice(0, 300), source: 'chat', createdAt: new Date().toISOString(), evidence: cited })
                  await prisma.treeNode.update({ where: { id: nodeId }, data: { progressLog: JSON.stringify(log.slice(-30)) } })
                } catch { /* non-critical */ }
              })()
            } else {
              console.warn('[tree] progress claim DROPPED — citation failed verification', {
                nodeId, text: text.slice(0, 120), kind: claim?.evidence?.kind ?? 'missing',
              })
            }
          }
          // Discovery cards, gated for timing (simulation findings): never
          // two turns in a row, no add-cards mid-struggle, no move-cards
          // while this node's mastery tally is in progress.
          const suggestedLastTurn = !!priorReflection?.suggestNode || !!priorReflection?.moveToTitle
          const addTitle = (assess.suggestNode?.title ?? '').trim()
          if (addTitle && !suggestedLastTurn && streak < 2) {
            suggestion = { type: 'add', title: addTitle.slice(0, 120), summary: (assess.suggestNode?.summary ?? '').slice(0, 300) }
          } else if (assess.moveToTitle && !suggestedLastTurn) {
            const moveTitle = String(assess.moveToTitle)
            const midTally = node.status !== 'understood' && quizStateNow.correct > 0
            if (!midTally) {
              const target = tree.nodes.find(n => !n.pending && n.id !== nodeId && n.title.toLowerCase() === moveTitle.toLowerCase())
                ?? tree.nodes.find(n => !n.pending && n.id !== nodeId && n.title.toLowerCase().includes(moveTitle.toLowerCase()))
              if (target) suggestion = { type: 'move', nodeId: target.id, title: target.title }
            }
          }
        } else if (!isTrigger) {
          // Marker missing or malformed on a free-chat turn: carry the prior
          // streak and misconception forward instead of skipping the write —
          // a skipped write recorded NOTHING for the turn, so the streak state
          // silently went stale (qa-findings-4 №3).
          void prisma.conversation.update({
            where: { id: convId },
            data: { summary: JSON.stringify({ lastReflection: { state: '', gapDepth: 'none', streakWrong: priorStreak, directive: '', suggestNode: null, moveToTitle: null, misconception: priorReflection?.misconception ?? null } }) },
          }).catch(() => null)
        }
      }

      // ── Syllabus contract capture ([NODE_INTRO] turns) ──
      // The intro's [[SYLLABUS]] block names the facets the syllabus just
      // promised — the node's VERIFICATION CONTRACT (FOUNDATION.md: the node
      // verifies only when every facet is proven, so the checkpoint count
      // follows the syllabus instead of a static 3). Stored once, never
      // overwritten (facet progress must survive re-intros); stripped from
      // the stream (holdback) and from the persisted message.
      {
        let contractLanded = false
        const sIdx = full.indexOf(SYL_MARK)
        if (sIdx !== -1) {
          const rawSyl = full.slice(sIdx + SYL_MARK.length).trim()
          full = full.slice(0, sIdx)
          try {
            const payload = JSON.parse(rawSyl.match(/\{[\s\S]*\}/)?.[0] ?? rawSyl) as { facets?: unknown[] }
            const names = (Array.isArray(payload.facets) ? payload.facets : [])
              .map(f => String(f ?? '').trim().slice(0, 120))
              .filter(Boolean)
              .slice(0, 6)
            if (names.length >= 2) {
              contractLanded = true
              for (let attempt = 0; attempt < 4; attempt++) {
                const freshRow = await prisma.treeNode.findUnique({ where: { id: nodeId }, select: { quizState: true } }).catch(() => null)
                const base = freshRow ? freshRow.quizState : node.quizState
                const qs = parseQuizState(base)
                if (qs.facets && qs.facets.length >= 2) break // contract already set — keep its progress
                qs.facets = names.map(n2 => ({ name: n2, done: false }))
                const w = await prisma.treeNode.updateMany({
                  where: { id: nodeId, quizState: base },
                  data: { quizState: JSON.stringify(qs) },
                }).catch(() => null)
                if (w && w.count > 0) break
              }
            }
          } catch { /* malformed contract — the repair pass below rebuilds it */ }
        }
        // CONTRACT REPAIR: the marker was truncated/malformed/missing on an
        // intro, or the node reached checkpoint flow still contract-less —
        // re-derive the facets from the intro text in the background instead
        // of silently downgrading to quota testing forever.
        if ((isIntro && !contractLanded) || (isCheckpoint && !quizStateNow.facets && node.status !== 'understood')) {
          try {
            const { inBackground } = await import('@/lib/background')
            inBackground(deriveSyllabusContract(apiKey, userId, nodeId, isIntro ? full : null))
          } catch { /* non-critical */ }
        }
      }

      // ── Checkpoint capture ──
      // The full quiz (with answer key) is stored server-side on the node;
      // the client — stream AND persisted message — gets only a sanitized
      // {kind, question, options} marker to render the card from.
      //
      // TRUST INVARIANT — NO SILENT DROPS: once Bob's prose promises a
      // checkpoint (or the turn demands one: [NODE_CHECKPOINT], a review,
      // the "Quiz me" button), a card MUST land. A malformed or
      // lint-rejected card is REPLACED by a freshly authored one, never
      // silently discarded — silent drops produced dangling "here's the
      // checkpoint:" promises the student could only answer with confusion.
      let persistContent = full
      let quizShipped = false
      const qIdx = full.indexOf(QUIZ_MARK)
      const proseOnly = (qIdx !== -1 ? full.slice(0, qIdx) : full).trimEnd()

      const cardShapeValid = (card: PendingQuiz): boolean => {
        const validArtifact = card.kind === 'artifact'
        const validMcq = card.kind === 'mcq'
          && Array.isArray(card.options) && card.options.length >= 2
          && Number.isInteger(card.correctIndex)
          && (card.correctIndex as number) >= 0 && (card.correctIndex as number) < card.options.length
        return typeof card.question === 'string' && !!card.question.trim() && (validMcq || card.kind === 'short' || validArtifact)
      }

      // Store the full card (answer key) on the node via compare-and-set —
      // the request-start quizState is seconds stale by stream end, and a
      // blind write could erase a tally earned from another device — then
      // stream + persist only the sanitized marker.
      const shipCard = async (card: PendingQuiz): Promise<boolean> => {
        if (!cardShapeValid(card)) return false
        // retestOf links this card to the missed checkpoint ONLY when Bob
        // marked it as the retest — an unrelated checkpoint on a retest turn
        // must not clear the queue (if he forgets the flag, the entry just
        // stays queued: the safe direction).
        const pendingCard = {
          ...card,
          review: isReview || undefined,
          retestOf: card.retest && retestTarget ? retestTarget : undefined,
          askedAt: new Date().toISOString(),
        }
        // Four CAS attempts, then an unconditional merge write — a card that
        // streamed to the client but never landed server-side 404s on submit,
        // and a lost write here can also collide away a concurrent tally.
        // EVIDENCE CONTRACT paper trail: an artifact checkpoint issued on a
        // facet is remembered — if that facet is later proven by reasoning
        // instead, the tally marks it evidencePending (see the quiz route).
        const stampArtifactAsked = (qs: ReturnType<typeof parseQuizState>) => {
          const facet = typeof pendingCard.facet === 'string' ? pendingCard.facet.trim() : ''
          if (pendingCard.kind !== 'artifact' || !facet) return
          const have = new Set((qs.artifactAsked ?? []).map(x => x.toLowerCase()))
          if (!have.has(facet.toLowerCase())) qs.artifactAsked = [...(qs.artifactAsked ?? []), facet.slice(0, 120)].slice(-6)
        }
        let stored = false
        for (let attempt = 0; attempt < 4 && !stored; attempt++) {
          const freshRow = await prisma.treeNode.findUnique({ where: { id: nodeId }, select: { quizState: true } }).catch(() => null)
          const base = freshRow ? freshRow.quizState : node.quizState
          const qs = parseQuizState(base)
          qs.pending = pendingCard
          stampArtifactAsked(qs)
          const w = await prisma.treeNode.updateMany({
            where: { id: nodeId, quizState: base },
            data: { quizState: JSON.stringify(qs) },
          }).catch(() => null)
          if (w && w.count > 0) stored = true
        }
        if (!stored) {
          console.warn('[tree] pending-card CAS exhausted — merge write', { nodeId })
          try {
            const freshRow = await prisma.treeNode.findUnique({ where: { id: nodeId }, select: { quizState: true } })
            const qs = parseQuizState(freshRow?.quizState ?? node.quizState)
            qs.pending = pendingCard
            stampArtifactAsked(qs)
            await prisma.treeNode.update({ where: { id: nodeId }, data: { quizState: JSON.stringify(qs) } })
          } catch (err) {
            console.error('[tree] pending-card merge write failed:', err)
          }
        }
        const sanitized = JSON.stringify({
          kind: card.kind, question: card.question,
          ...(card.kind === 'mcq' && Array.isArray(card.options) ? { options: card.options } : {}),
          // The hint is answer-safe by construction (a nudge, not the key) —
          // it powers the card's Hint button client-side.
          ...(typeof card.hint === 'string' && card.hint.trim() ? { hint: card.hint } : {}),
          // The facet name is already fully client-visible in the coverage
          // map — carrying it on the marker anchors the checkpoint rail's
          // jump-to-moment navigation.
          ...(typeof card.facet === 'string' && card.facet.trim() ? { facet: card.facet } : {}),
        })
        try { controller.enqueue(encoder.encode(`\n\n${QUIZ_MARK}${sanitized}`)) } catch { /* closed */ }
        persistContent = `${proseOnly}\n\n${QUIZ_MARK}${sanitized}`
        quizShipped = true
        return true
      }

      // The repair path: author a fresh Differentiator-grade checkpoint when
      // Bob's own card was malformed/recitable or he promised one without
      // attaching it. Judge-model, JSON-only, one retry — this path backs the
      // checkpoint guarantee, so it logs loudly instead of failing silently.
      const authorCheckpoint = async (avoid?: string): Promise<PendingQuiz | null> => {
        const nextFacet = node.status !== 'understood' ? quizStateNow.facets?.find(f => !f.done)?.name : undefined
        const prompt = `Author exactly ONE checkpoint question for a tutoring node, under the Differentiator Principle: it must separate a student who MEMORIZED the content from one who truly UNDERSTANDS it — transfer to an UNSEEN context, a why/what-if, or an edge case where the memorized rule breaks. It must NOT be answerable by copying sentences from the teaching text below.

NODE being tested: "${node.title}" — ${node.summary}
${node.explainer ? `NODE EXPLAINER (the student has read this):\n${node.explainer.slice(0, 1200)}\n` : ''}TUTOR'S LATEST TEACHING (the answer must NOT be quotable from it):
"${proseOnly.slice(-1200)}"
${avoid ? `\nDO NOT reuse or lightly reword this question: "${avoid.slice(0, 300)}"` : ''}
SCOPE: test ONLY this node's own material — never a sibling or child node's mechanism.
${nextFacet ? `TARGET FACET: this checkpoint probes the syllabus facet "${nextFacet}" (the node's next unproven promise) — include "facet":"${nextFacet}" verbatim in the JSON.` : ''}
${node.status !== 'understood' && quizStateNow.shortCorrect < MASTERY_MIN_SHORT ? 'FORMAT: kind "short" — the student still needs an own-words answer for mastery.' : 'FORMAT: "short" for why/transfer probes, "mcq" for quick discrimination — pick what fits.'}
${sessionDirectives(tree, lang)}
Return ONLY the JSON object (no prose, no code fences):
{"kind":"mcq","question":"...","options":["...","...","...","..."],"correctIndex":0,"explanation":"1-2 sentences: why the right answer is right and why the tempting distractor fails","hint":"a nudge that narrows thinking WITHOUT revealing or eliminating the answer"${nextFacet ? `,"facet":"${nextFacet}"` : ''}}
or
{"kind":"short","question":"...","rubric":"what a truly-understanding answer must contain (never shown to the student)","hint":"a nudge that points at the right ANGLE of thinking without giving the answer"${nextFacet ? `,"facet":"${nextFacet}"` : ''}}`
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const Anthropic = (await import('@anthropic-ai/sdk')).default
            const { getJudgeModel } = await import('@/lib/model-resolver')
            const authorModel = await getJudgeModel()
            const authorClient = new Anthropic({ apiKey })
            const res = await authorClient.messages.create({
              model: authorModel,
              max_tokens: 700,
              ...NO_THINKING,
              messages: [{ role: 'user', content: prompt }],
            })
            try {
              const { recordAnthropicUsage } = await import('@/lib/usage')
              recordAnthropicUsage(res.usage, { userId, model: authorModel, feature: 'tree-verify' })
            } catch { /* non-critical */ }
            const txt = res.content.filter(b => (b as { type?: string }).type === 'text').map(b => (b as { text?: string }).text ?? '').join('\n')
            const tryParse = (s: string): PendingQuiz | null => {
              try { const c = JSON.parse(s.trim()) as PendingQuiz; return cardShapeValid(c) ? c : null } catch { return null }
            }
            const fence = txt.match(/```(?:json)?\s*([\s\S]*?)```/)
            const o1 = txt.indexOf('{'), o2 = txt.lastIndexOf('}')
            const card = (fence?.[1] ? tryParse(fence[1]) : null)
              ?? tryParse(txt)
              ?? (o1 !== -1 && o2 > o1 ? tryParse(txt.slice(o1, o2 + 1)) : null)
            if (card) {
              // The SERVER chose this facet (not a guess) — stamp it so the
              // repair/guarantee-path card always credits the right facet.
              if (nextFacet && !String(card.facet ?? '').trim()) card.facet = nextFacet
              return card
            }
            console.warn('[tree] authorCheckpoint: unparseable card output', txt.slice(0, 200))
          } catch (err) {
            console.warn('[tree] authorCheckpoint attempt failed:', err)
          }
        }
        return null
      }

      // BOTTLENECK-TRIGGERED TEACHING (law): no checkpoint may ride the node
      // INTRO (openers never quiz) or a REMEDIATION turn (the learner needs
      // room to absorb the explainer before being re-probed). If Bob emitted a
      // [[QUIZ]] on such a turn anyway, DROP it — the prose is flushed/persisted
      // as proseOnly and no card is armed. Enforced in code, not just prompt.
      if (qIdx !== -1 && (isIntro || isRemediate || isVerifiedTurn)) {
        if (qIdx > sentLen) {
          try { controller.enqueue(encoder.encode(full.slice(sentLen, qIdx))) } catch { /* closed */ }
          sentLen = qIdx
        }
        persistContent = proseOnly
        console.warn('[tree] suppressed a checkpoint on', isIntro ? 'intro' : isRemediate ? 'remediation' : 'verified', 'turn', { nodeId })
      } else if (qIdx !== -1) {
        if (qIdx > sentLen) {
          try { controller.enqueue(encoder.encode(full.slice(sentLen, qIdx))) } catch { /* closed */ }
          sentLen = qIdx
        }
        persistContent = proseOnly
        let parsedCard: PendingQuiz | null = null
        try { parsedCard = JSON.parse(full.slice(qIdx + QUIZ_MARK.length).trim()) as PendingQuiz } catch { parsedCard = null }
        // On a [NODE_CHECKPOINT] continue turn the prompt directed Bob at the
        // next undone facet — stamp it if he forgot the tag, so the answer
        // credits the right facet (never on free-chat/quiz-me/review/intro,
        // where no single facet was directed — stamping there would recreate
        // the blind-credit bug).
        if (parsedCard && isCheckpoint && node.status !== 'understood' && !String(parsedCard.facet ?? '').trim()) {
          const directed = quizStateNow.facets?.find(f => !f.done)?.name
          if (directed) parsedCard.facet = directed
        }
        if (parsedCard && cardShapeValid(parsedCard)) {
          // ── DIFFERENTIATOR LINT ──
          // A checkpoint answerable by copying from Bob's own text tests
          // recall, not understanding. Strict-only and fail-open: lint
          // errors never block a checkpoint.
          let recitable = false
          try {
            const Anthropic = (await import('@anthropic-ai/sdk')).default
            const { getBackgroundModel } = await import('@/lib/model-resolver')
            const lintModel = await getBackgroundModel()
            const lintClient = new Anthropic({ apiKey })
            const prevBob = [...(conv!.messages ?? [])].reverse().find(m => m.role === 'assistant')?.content ?? ''
            const lint = await lintClient.messages.create({
              model: lintModel,
              max_tokens: 60,
              ...NO_THINKING,
              messages: [{
                role: 'user',
                content: `Quality lint for a tutoring checkpoint (the Differentiator Principle: it must separate understanding from recall).

TUTOR'S CURRENT MESSAGE (the checkpoint follows it):
"${proseOnly.slice(-1200)}"
TUTOR'S PREVIOUS MESSAGE:
"${prevBob.slice(0, 800)}"

CHECKPOINT QUESTION: "${parsedCard.question.slice(0, 400)}"
${parsedCard.kind === 'mcq' && Array.isArray(parsedCard.options) ? `OPTIONS: ${parsedCard.options.map(o => String(o)).join(' | ').slice(0, 400)}` : ''}

Could a student answer this correctly PURELY by copying or recalling sentences from the two tutor messages above, without understanding (the answer is stated or strongly implied verbatim in the text)? Be strict only when it is clearly recitable — transfer questions that merely share vocabulary are fine.
Return ONLY JSON: {"recitable": true|false}`,
              }],
            })
            try {
              const { recordAnthropicUsage } = await import('@/lib/usage')
              recordAnthropicUsage(lint.usage, { userId, model: lintModel, feature: 'tree-verify' })
            } catch { /* non-critical */ }
            recitable = /"recitable"\s*:\s*true/.test((lint.content[0] as { text?: string })?.text ?? '')
          } catch { /* lint unavailable — fail open, keep the checkpoint */ }

          if (!recitable) {
            await shipCard(parsedCard)
          } else {
            // Lint rejected it — REPLACE, never drop: author a transfer-level
            // card; if authoring fails, ship Bob's original anyway. A slightly
            // recitable checkpoint beats a broken promise (the lint also has
            // false positives right after a detailed answer discussion).
            const regen = await authorCheckpoint(parsedCard.question)
            if (!(regen && await shipCard(regen))) await shipCard(parsedCard)
          }
        } else {
          // Malformed card JSON, but the prose already promised a checkpoint
          // — author a replacement instead of dangling.
          const regen = await authorCheckpoint()
          if (regen) await shipCard(regen)
        }
      } else {
        forwardSafe()
        if (full.length > sentLen) {
          // Flush the final holdback window.
          try { controller.enqueue(encoder.encode(full.slice(sentLen))) } catch { /* closed */ }
          sentLen = full.length
        }
      }

      // ── CHECKPOINT GUARANTEE ──
      // Turns that DEMAND a card ship one even if Bob emitted none at all:
      // the [NODE_CHECKPOINT] auto-continue, retention reviews, the "Quiz me"
      // button (EN/中文), and prose that ends by announcing a checkpoint
      // ("…here's the checkpoint:"). Never on the intro (no quiz in openers),
      // and never on a remediation turn — Bottleneck-Triggered Teaching
      // (FOUNDATION.md) forbids a checkpoint riding the same turn as the
      // explainer; enforced in code here, not just by prompt instruction.
      if (!quizShipped && !isIntro && !isRemediate) {
        const msgNorm = msgText
        // On a VERIFIED node the system-solicited [NODE_CHECKPOINT] continue
        // must NOT force a card (the review is one question, not a chain);
        // reviews and explicit "quiz me" / can't-see-card requests still do.
        const demanded = (isCheckpoint && node.status !== 'understood') || isReview
          || /^quiz me on this node[.!。]?$/i.test(msgNorm)
          || /^出一道检查题考考我[。.!！]?$/.test(msgNorm)
          // "I can't see the card/options" — ship a fresh card instead of
          // letting Bob narrate around a rendering gap.
          || /(don'?t|can'?t|cannot|no longer|not)\s.{0,15}(see|find|show)\S*\s.{0,25}(quiz|card|checkpoint|options?)/i.test(msgNorm)
          || /(看不到|没看到|没有看到|找不到).{0,12}(题|选项|卡片|检查)/.test(msgNorm)
          || (/[:：]\s*$/.test(proseOnly) && /(checkpoint|quick check|quiz|检查点|考考|测一测)/i.test(proseOnly.slice(-160)))
        if (demanded) {
          const regen = await authorCheckpoint()
          if (regen) await shipCard(regen)
          if (!quizShipped) {
            // Absolute last resort — say so instead of dangling silently.
            const zhSession = (tree.language ?? lang) === 'zh'
            const note = zhSession
              ? '\n\n（这道检查题没能生成——点「出一道检查题考考我」再试一次。）'
              : '\n\n(That checkpoint didn’t generate — hit “Quiz me” to try again.)'
            try { controller.enqueue(encoder.encode(note)) } catch { /* closed */ }
            persistContent = `${persistContent}${note}`
          }
        }
      }

      // The verified turn ships a NEXT-NODE button (persisted, so it survives
      // reload — the payoff moment must route somewhere, not evaporate).
      if (isVerifiedTurn && nextOnPath) {
        const marker = `\n\n[[NEXT_NODE]]${JSON.stringify({ nodeId: nextOnPath.id, title: nextOnPath.title })}`
        try { controller.enqueue(encoder.encode(marker)) } catch { /* closed */ }
        persistContent = `${persistContent}${marker}`
      }

      // The remediation turn settles the persisted remediation debt
      // (deep-audit §5: the law-mandated teaching used to evaporate with the
      // tab; now the debt survives until a remediation actually RUNS — and
      // only a remediation clears it; the verified turn no longer does,
      // qa-findings-4 №8).
      if (isRemediate) {
        try {
          for (let attempt = 0; attempt < 3; attempt++) {
            const freshRow = await prisma.treeNode.findUnique({ where: { id: nodeId }, select: { quizState: true } }).catch(() => null)
            const base = freshRow ? freshRow.quizState : node.quizState
            const qs = parseQuizState(base)
            if (!qs.remediationOwed) break
            qs.remediationOwed = null
            const w = await prisma.treeNode.updateMany({
              where: { id: nodeId, quizState: base },
              data: { quizState: JSON.stringify(qs) },
            }).catch(() => null)
            if (w && w.count > 0) break
          }
        } catch { /* non-critical */ }
      }

      // ── ATTENTION ARBITER: at most ONE interactive card per turn ──
      // Priority: checkpoint card > discovery/move card. XP toasts are
      // ambient (not CTAs) and exempt. A yielded discovery card resurfaces
      // on a later turn via the reflection pass if it still matters.
      if (suggestion && !quizShipped) {
        try { controller.enqueue(encoder.encode(`\n\n[[TREE_SUGGEST]]${JSON.stringify(suggestion)}`)) } catch { /* closed */ }
      }
      // XP earned during this turn (perseverance) — trailing marker, the
      // client toasts it; never persisted as message content.
      if (turnXp.length > 0) {
        try { controller.enqueue(encoder.encode(`\n\n[[XP]]${JSON.stringify(turnXp)}`)) } catch { /* closed */ }
      }

      // ── STREAM COMPLETION CONTRACT ──
      // [[INCOMPLETE]] is PERSISTED: it survives reload so a half-written
      // answer always carries its Continue/Regenerate controls, instead of
      // reading as something the learner failed to understand.
      // [[DONE]] is transient — its ABSENCE tells the client the connection
      // dropped mid-answer (a dead socket produces no marker at all).
      if (truncated) {
        try { controller.enqueue(encoder.encode('\n\n[[INCOMPLETE]]')) } catch { /* closed */ }
        persistContent = `${persistContent}\n\n[[INCOMPLETE]]`
      }

      if (persistContent) {
        await store.addMessage(convId, 'assistant', persistContent).catch(() => null)
        // Keep the insight moat: background extraction every ~5th message.
        // Skip trigger turns ([NODE_INTRO]/[NODE_REVIEW]) — the control token
        // is not a student utterance, and feeding it as the "student message"
        // alongside Bob's topic-rich reply is exactly the tutor→student
        // mis-attribution shape the anti-hallucination rule guards against.
        try {
          const count = await prisma.message.count({ where: { conversationId: convId } })
          const { inBackground } = await import('@/lib/background')
          if (!isTrigger && count % 5 === 0) {
            const { extractInsightsBackground } = await import('@/lib/insight-extraction')
            // waitUntil-wrapped: the stream closes right after this, and a
            // frozen lambda would silently starve the insight moat.
            // turnContent (message + attachment-analysis digest), never the
            // bare 📎 chip label — a voice-note-only turn's transcript is
            // the student's actual utterance. Session language rides along so
            // insights are written in the tree's language, not the UI's.
            inBackground(extractInsightsBackground(apiKey, turnContent || userRecord, persistContent, userId, tree.language ?? undefined, id))
          }
          // Keep THIS node's CONTEXT SUMMARY fresh so its descendants read a
          // current, distilled digest (never raw messages) via branchCoverage —
          // the per-node redundancy law without the token bloat. Cheap Haiku
          // pass, fully backgrounded. Seed it on the intro (captures the
          // syllabus at once), then refresh on a light cadence as real teaching
          // accumulates. Skip other pure trigger turns (review/checkpoint
          // auto-continues carry no new teaching worth re-summarizing for).
          // The modulus MUST be odd: a free-form turn persists BOTH a user and
          // an assistant message (+2, parity-preserving) and the intro seeds an
          // odd count, so a run of pure Q&A keeps `count` odd — an even modulus
          // would never fire there, leaving the summary stuck at the intro seed.
          if (isIntro || (!isTrigger && count % 3 === 0)) {
            // ONE merged Haiku call refreshes BOTH digests (context summary
            // for upper-node prompts + the learner's Mastery Board) from one
            // shared fetch — the old pair narrated the same conversation
            // twice on the same cadence (qa-findings-4 №6).
            inBackground(refreshNodeDigests(userId, id, nodeId, tree.language ?? undefined))
          }
        } catch { /* non-critical */ }
      }
      // Final handshake: a stream that ends WITHOUT this marker was cut off
      // by the network/lambda, and the client offers Continue/Regenerate.
      try { controller.enqueue(encoder.encode('\n\n[[DONE]]')) } catch { /* closed */ }
      try { controller.close() } catch { /* already closed */ }
    },
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Conversation-Id': convId },
  })
}
