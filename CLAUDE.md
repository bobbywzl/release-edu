# Tree EDU — Project Conventions for Claude Code

This file documents conventions, architecture, and rules for working in this codebase.
Read this before making changes.

> **⚠️ THIS IS TREE EDU, NOT RELEASE EDU.** The repo name (`release-edu`) and Vercel
> project are historical. In July 2026 the product pivoted completely: Release EDU's
> big-to-small structure (subjects → tracks → courses → chapters, generated curricula,
> chat modes, lesson phase machines, curriculum locks) was **deleted from the product**.
> Tree EDU is small-to-big: one specific problem grows into a tree of understanding
> through the learner's own questions. The two have completely different structures —
> never design features here using Release EDU concepts.

## Working style (user preference — important)

- **When you are not sure what the user means, ALWAYS clarify before acting.** Do not
  guess at ambiguous intent and build the wrong thing. Ask a focused question, then proceed.
- Any user-facing text Bob generates (greetings, fallbacks, errors) must respect the
  student's chosen language — never hard-code English where a Chinese (or other) learner
  could see it. Every UI string gets EN + 中文 keys in `src/lib/i18n.tsx`.

## Canonical Documents

- **`FOUNDATION.md`** is the canonical source for the Tree EDU vision and product
  model (the user's verbatim vision paragraph lives there). Read it before changing
  the tree engine, prompts, or growth mechanics.

## Stack

- **Framework**: Next.js 14.2 (App Router), TypeScript strict mode
- **Database**: PostgreSQL (Supabase) via Prisma 6
- **Auth**: NextAuth 4 with Google OAuth — login is REQUIRED product-wide
  (demo mode was removed July 2026; middleware 401s every unauthenticated
  user-data API call and redirects /dashboard to /login)
- **AI**: Anthropic SDK — the teaching tier (tree seeding, node explainers, workspace
  chat, grow-box proposals) and judging tier (checkpoint judging) resolve through
  `src/lib/model-resolver.ts`, which auto-adopts the NEWEST Opus/Sonnet release from
  the /v1/models catalog (6h cache; pinned `CHAT_MODELS` fallback — never hardcode
  a model id in a new Bob feature, use `getTeachingModel()`/`getJudgeModel()`).
  Haiku (via `pickBackgroundModel()`) stays pinned for background passes (reflection,
  insight extraction). Gemini for image/file analysis AND generated visuals: Bob
  emits ```image fenced blocks (chat + explainers) that `MarkdownRenderer` →
  `GeneratedVisual` turns into diagrams via `/api/image/generate` (latest Gemini
  flash image first, durable prompt-hash cache, usage tag `image`; needs
  `GEMINI_API_KEY`).
- **UI**: Tailwind CSS, Radix primitives, Framer Motion, React Flow (the tree canvas),
  KaTeX.

## The Product Model (what everything serves)

One **ProblemTree** per problem-mastery **session**: root (the problem) → solution
branches → component/leaf nodes (pain points). Growth is permission-based only:
learner questions → AI proposals (pending ghost nodes) → explicit approval; plus
AI discovery cards in chat and manual add. Mastery is AI-verified — no self-marking —
through **in-chat checkpoint questions**: Bob emits `[[QUIZ]]` blocks (MCQ /
short-answer cards) in the workspace chat. Verification is SYLLABUS COVERAGE, not a
count: the node intro emits a `[[SYLLABUS]]` facet contract (its "What you'll cover"
sub-points, stored in `quizState.facets`); every checkpoint carries a `facet` tag and
the node flips only when EVERY facet is proven correct incl. ≥1 own-words short
answer (`masteryMet` in `src/lib/mastery.ts`; static `MASTERY_TARGET`=3 is the
fallback for contract-less nodes). There is no separate verify screen.
Each session carries its own language / difficulty / personal background / PURPOSE
(why the learner wants mastery — it defines "relevant" for the session), set by a
5-question stepper at tree creation (never more than 5).

## Key Code Map

- `src/lib/tree-engine.ts` — seeding, expansion proposals (with clarify), explainers,
  checkpoint verification (`judgeCheckpointAnswer`, `markNodeVerified`),
  `sessionDirectives()`, `ANSWER_STANDARD`, `NO_REDUNDANCY` + `branchCoverage()`
  (ancestor-workspace digest + `nodePositionBlock()` "where this node sits toward the
  root" → node chat/explainer prompts: every node builds on the branch below, never
  re-teaches it — law in FOUNDATION.md). `branchCoverage()` reads each ancestor's
  persisted `TreeNode.contextSummary` — a continuously-updated, distilled per-node
  digest written by the cheap background pass `refreshNodeContextSummary()` (Haiku,
  usage tag `tree-summary`; triggered after substantive node chat and on
  verification) — INSTEAD of re-deriving each ancestor from raw conversation messages
  every turn (that's the token/context-bloat fix); it falls back to a live derivation
  only for a node not yet summarized. The heart of the product.
- `src/lib/mastery.ts` — client-safe single source of truth: `MASTERY_TARGET`
  (fallback), `masteryTarget`/`masteryFilled`/`masteryMet` (syllabus-coverage
  verification over `QuizState.facets`), `parseQuizState`, the `PendingQuiz`
  shape. UI strings interpolate `{n}` from it.
- `src/app/api/tree/**` — tree CRUD, expand, per-node explainer/quiz/chat/review
  routes. The node chat route holds Bob's workspace prompt, the Haiku contextual
  pre-pass (gap/wrong-streak/directive + node-discovery + move-recommendation +
  project-progress detection), the `[NODE_INTRO]`/`[NODE_REVIEW]`/`[NODE_CHECKPOINT]`
  hooks (the last keeps checkpoints coming until the node verifies; checkpoints
  are scoped to THIS node's content, using the full tree only for boundaries), and
  `[[TREE_SUGGEST]]`/`[[XP]]` stream markers. Bob's `[[QUIZ]]` blocks are captured
  server-side: the full quiz (answer key) lives in `TreeNode.quizState.pending`,
  clients only ever see a sanitized `{kind, question, options}` marker (stream AND
  persisted message). The quiz route judges against the stored copy; verified-node
  grinding pays ~25% XP (reviews pay full and stamp `reviewedAt`).
- `src/app/dashboard/tree/**` — tree list + session-onboarding stepper; the canvas
  (organic layout, string-tension drag physics, shape-preserving subtree follow,
  hierarchy clamps) and the searchable list view; the TREE COPILOT (floating
  chatbox combining every tree-level function: teach, propose branches under ANY
  node via `copilotTurn()` in tree-engine, approval-gated purpose refinement via
  `PATCH /api/tree/[id]` `set_purpose`, multimodal input — file/camera/video
  capture inputs + MediaRecorder voice → Gemini `analyzeImage` analysis, stored
  as `LinkedFile` workType `tree` — and generated visuals via ```image blocks;
  thread persisted as Conversation context `tree-copilot:<treeId>`).
- `src/app/dashboard/workspace/page.tsx` — per-node work area: Bob chat,
  explainer, editable notes, highlight-based annotations, file evidence.
- `src/lib/insight-memory.ts` + `src/lib/insight-extraction.ts` — the personalization
  moat. PRESERVE in every change; extraction runs from workspace chats.
- `src/lib/xp-engine.ts`, `src/lib/badges.ts`, `src/components/xp-panel.tsx` — XP,
  daily goal, streaks, badges, sounds (`src/lib/sfx.ts`). Checkpoint answers pay
  `quiz_correct` / `quiz_attempt` / tiered `combo_bonus`; showing up pays via
  `updateStreak` (daily streak + first session), fired by `/api/xp/checkin` from
  `DailyCheckin` in the dashboard layout. Streak day boundaries use the USER's
  timezone (`StudentProfile.lastCheckinDay`, compare-and-set so parallel tabs can't
  double-award); all XP writes are atomic increments. `getRank(level)` returns the
  learning-journey rank (`RankInfo`: tier/division/color/emblem/vfx,
  a UNIQUE title per level via `LEVEL_TITLES` (74 names through 10 tier families,
  Rookie→…→Transcendent→A Real Beginner at 75+, derived from level — no schema;
  every level-up is a rank-up, tier changes escalate the ceremony); `awardXp`/`awardXpBatch` attach `rankUp`/`tierUp`/`rank`
  so the client fires `playRankUp(vfx, tierUp)` (`src/lib/sfx.ts`, escalating
  synthesized fanfare) + the rank-colored `RankUpOverlay` (`xp-toast.tsx`).
- `src/app/api/portfolio/generate` — session-pure portfolio (version-stamped ≥2;
  older caches are treated as absent so Release EDU data can never surface).
- `src/lib/usage.ts` + admin panel — cost telemetry. Feature taxonomy: `tree-seed`,
  `tree-expand`, `tree-explainer`, `tree-verify`, `tree-digest`, `tree-summary`,
  `tree-copilot`, `node-chat`, `reflection`, `insight`, `onboarding`, `portfolio`,
  `title`, `image`, `other` (legacy values render with "(legacy)" labels). Every new
  AI call MUST record usage with a fitting feature tag.

## The Insight Constellation (the moat — grounded in learning-science research)

Bob's memory of the learner is Tree EDU's core moat. Types now include `knowledge`
(verifiably ACQUIRED understanding — verified nodes, correct own-words explanations)
and `misconception` (systematic wrong beliefs). The constellation:

**Gathering:** chat extraction (anti-hallucination rules, reinforce-over-duplicate);
verification outcomes (pass → `knowledge` insight + struggles resolved; fail →
specific `struggle`); Haiku reflection (wrong-streak, misconception detection,
project progress); consolidation keeps the set curated.

**Use:** ANALOGY BRIDGE — at 2+ confused turns Bob receives the learner's verified
knowledge/strengths and must teach the new concept as an explicit analogy from them;
PREREQUISITE BACKWARD-CHAIN — unverified ancestor nodes are surfaced as the likely
real gap (research: deficits are usually upstream); MISCONCEPTION REFUTATION —
systematic wrong beliefs are refuted directly (repair theory), never drilled;
WHEEL-SPINNING ESCAPE — at 4+ confused turns Bob must switch intervention entirely;
HYPERCORRECTION — verify answers carry a sure/unsure confidence tap, and
confident-wrong answers get direct, memorable refutation first; OPEN LEARNER MODEL —
the dashboard shows "What Bob knows about you" (legible models improve learning).

Key research anchors (see the learner-insight research doc): performance ≠ learning
(delayed, first-attempt, unhinted correctness is ground truth); adapt on estimated
knowledge per skill, not presumed learner speed; wheel-spinning is predictable and
means change-the-intervention; learning-styles adaptation is debunked — never adapt
on it.

## The Answer Standard (Relevant & Informative — law)

Every workspace answer must be BOTH: **Relevant** (answers the asked question at the
depth THIS problem needs — no generic field lectures, no uncalled-for depth) and
**Informative** (never a bare answer — always carries the scientific background /
mechanism that makes it transferable understanding). Canonical wording lives in
FOUNDATION.md; prompts consume it via `ANSWER_STANDARD` in `src/lib/tree-engine.ts`.
Apply it to any new answer-producing feature.

Companion law — **Per-Node Redundancy Avoidance** (FOUNDATION.md): every node's
syllabus/explainer/chat sees the whole tree AND what ancestor workspaces already
taught (`branchCoverage()`), builds on that in one-clause callbacks, and teaches
only this node's NEW ground. Wire both laws into any new teaching prompt.

Companion law — **Bottleneck-Triggered Teaching / Capability-Oriented Learning**
(FOUNDATION.md): the default mode is ASKING (checkpoint questions), not lecturing;
full textbook-depth teaching deploys reactively, only once a wrong/shaky answer
proves exactly where the gap is. On correct → brief bridge + next question (no
bottleneck, keep asking). On wrong → the very next turn is a full explainer of
precisely that gap (`[NODE_REMEDIATE]` trigger) — never a one-line correction, and
never a checkpoint riding the same turn (let it land before re-probing).

Companion law — **Goal-Necessity & Plan-First Growth** (FOUNDATION.md): the tree
exists to thoroughly explain a concept/product or solve the root problem — every
node must be ABSOLUTELY NECESSARY for that goal (necessity test: would the goal
have a hole without it? merely related/interesting nodes are rejected), and the
AI deeply analyzes the goal and forms a plan BEFORE laying out any nodes (the
seed prompt runs an explicit PLAN pass first). Wire `GOAL_NECESSITY`
(`src/lib/tree-engine.ts`) into any new node-producing prompt — seeding,
expansion, copilot, discovery.

## The Differentiator Principle (assessment ideology — still law)

Every verification question must separate a student who MEMORIZED content from one who
TRULY UNDERSTANDS it: transfer to unseen contexts, why/what-if probes, edge cases where
the memorized rule breaks. A question answerable by reciting an explainer is a failed
question. Implementation: the CHECKPOINT QUESTIONS section of the node chat prompt
(Bob authors every `[[QUIZ]]` under this law) + `judgeCheckpointAnswer` in
`src/lib/tree-engine.ts` (short answers judged against the same bar).

## Database Rules

- **Legacy Release EDU tables (Track, Chapter, Homework, Quiz, CurriculumPlan,
  CurriculumModule, SubjectProject, CurriculumBlock…) are DORMANT, not gone.** They
  stay in `prisma/schema.prisma` because the build runs `prisma db push` against the
  shared production database — dropping them is a deliberate, separate migration
  decision. Never build new features on them.
- Active models: ProblemTree, TreeNode (status/pending/notes/annotations/progressLog/quizState),
  Conversation (workspace chats use `context = "tree-node:<nodeId>"`), Message,
  MessageHighlight (annotations), LinkedFile (`workType = "tree-node"`), Insight,
  UserBadge, UsageEvent, StudentProfile, PortfolioCache.
- JSON-in-string columns are read with safe parsers — always tolerate malformed JSON.

## Code Style

- TypeScript strict; no `any` shortcuts unless commented why.
- Errors in non-critical paths: `try { … } catch { /* non-critical */ }`.
- Streaming responses use `ReadableStream` + `TextEncoder` (see the node chat route).
- Background AI work must never block the user's response — AND it must be
  passed through `inBackground()` (`src/lib/background.ts`, Vercel `waitUntil`):
  a bare un-awaited promise is silently killed when the serverless instance
  freezes after the response/stream closes (this was starving insight
  extraction and stranding portfolio generation).

## Shipping (deploy workflow)

Hosted on **Vercel**, repo `bobbywzl/release-edu`. Push to `main` → Production
(`release-edu.vercel.app`); any other branch → Preview. The build runs
`prisma generate && prisma db push && next build` — schema changes apply to the shared
DB on deploy, so keep them additive.

Pre-flight before any push: `npx tsc -p tsconfig.json --noEmit` clean (ignore
`scripts/`), then `npx next build` compiles. Development happens on the session's
designated `claude/...` branch; production ships by merging that branch into `main`
(`--no-ff`) and pushing — only with the user's go-ahead.

## Quick Sanity Checks Before Shipping

- Does this work for a brand-new user (no profile, no trees, no insights)?
- Is every new user-facing API under the middleware login gate (no
  unauthenticated path — demo mode no longer exists)?
- Does it respect the session's language/difficulty (never leak English into a 中文 session)?
- Does tree growth stay permission-based (nothing joins the tree without a click)?
- Does every new AI call record usage with the right feature tag?
- Does it handle empty arrays / null / malformed JSON fields gracefully?
