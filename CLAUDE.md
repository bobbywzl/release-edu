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

- **ALWAYS ask clarifying questions — every session, every input (user directive,
  July 2026).** Open every session and every new request by asking the user focused
  clarification questions (batched, via AskUserQuestion) covering scope, intent, and
  any decision you would otherwise guess at — then act on the answers. Never build on
  a guessed interpretation. This applies even when a request looks unambiguous:
  confirm the key assumptions first, then proceed.
- Any user-facing text Bob generates (greetings, fallbacks, errors) must respect the
  student's chosen language — never hard-code English where a Chinese (or other) learner
  could see it. Every UI string gets EN + 中文 keys in `src/lib/i18n.tsx`.
- **Text production style (user directive, Aug 2026).** In text production, do not
  use different phrases and sentence structures for the sake of using different
  phrases and sentence structures. The goal is to be simple, concise, and straight
  to the point — most easily interpretable and suitable for the target audience.
  Use as few words and as simple wording as possible — always less and more
  precise over more and complex. Casual language is fine — the bar is that the
  writing conveys a nuanced, logical view effectively, not that it sounds
  formal. Applies to everything Claude writes: replies, docs, commit messages,
  code comments, and UI copy.

## Canonical Documents

- **`FOUNDATION.md`** is the canonical source for the Tree EDU vision and product
  model (the user's verbatim vision paragraph lives there). Read it before changing
  the tree engine, prompts, or growth mechanics.

## Stack

- **Framework**: Next.js 14.2 (App Router), TypeScript strict mode
- **Database**: PostgreSQL (Supabase) via Prisma 6
- **Auth**: NextAuth 4 with Google OAuth — login is REQUIRED product-wide
  (demo mode was removed July 2026; middleware 401s every unauthenticated
  user-data API call and redirects /dashboard to /login). PER-TAB ACCOUNT
  SLOTS (`src/lib/session-slots.ts` + `src/components/account-slots.tsx` +
  `/api/auth/slot`): up to 5 parallel sessions live in signed httpOnly
  cookies `tree-session-slot-N`; each tab binds its slot in sessionStorage
  and stamps `x-account-slot` on /api fetches (patched window.fetch). The
  header only SELECTS which signed cookie to verify — never a credential.
  Identity resolves slot-first then main NextAuth session via
  `getSlotAwareSession()`; ALWAYS go through it (or getUserId/getUserInfo) in
  user-data routes — a raw getServerSession ignores the tab's account.
  Logout = slotSignOut() (per-tab); "Switch account" = /login?switch=1.
- **AI**: Anthropic SDK — the teaching tier (tree seeding, node explainers, workspace
  chat, grow-box proposals) and judging tier (checkpoint judging) resolve through
  `src/lib/model-resolver.ts`, which auto-adopts the NEWEST Opus/Sonnet release from
  the /v1/models catalog (6h cache; pinned `CHAT_MODELS` fallback — never hardcode
  a model id in a new Bob feature, use `getTeachingModel()`/`getJudgeModel()`).
  EVERY tier auto-adopts its family's newest release (user directive, Aug 2026):
  the background tier via `getBackgroundModel()` (newest Haiku, same resolver,
  pinned fallback — JSON-parsing background calls pin `NO_THINKING` so upgrades
  stay parse-safe), Gemini multimodal via `getMultimodalModel()` in
  `src/lib/gemini.ts` (newest plain-flash from ListModels, pinned fallback),
  image generation via the ordered latest-first ladder in `/api/image/generate`.
  Gemini for image/file analysis AND generated visuals: Bob
  emits ```image fenced blocks (chat + explainers) that `MarkdownRenderer` →
  `GeneratedVisual` turns into diagrams via `/api/image/generate` (latest Gemini
  flash image first, durable prompt-hash cache, usage tag `image`; needs
  `GEMINI_API_KEY`).
- **UI**: Tailwind CSS, Radix primitives, Framer Motion, React Flow (the tree canvas),
  KaTeX.

## The Product Model (what everything serves)

Master criterion — **The Goal** (law, FOUNDATION.md, user-stated verbatim): *solve
your issue and produce complete understanding as simply and efficiently as
possible.* Judge every feature, prompt, and step against it; what doesn't serve
it is waste.

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
ONE-SCREEN session setup: the problem is the only required question; the four
calibrators (language/purpose/background/depth) sit in an optional "add context"
expander pre-filled from the app language and the last session. The legacy
Release EDU first-run interview is deleted — first-run onboarding IS the setup.

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
  routes. The node chat route holds Bob's workspace prompt with the FOLDED
  ASSESSMENT (the blocking Haiku pre-pass is gone: the main teaching call
  self-assesses — wrong-streak, analogy bridge, wheel-spinning, SUPPORT FIRST —
  and reports discovery/move/progress/misconception on a trailing `[[ASSESS]]`
  line, captured server-side and processed exactly as the old pre-pass output
  was), the PROMPT-CACHING LAYOUT (two cached system blocks — core laws, tree
  sketch — a chunk-anchored history window whose tail carries a third
  breakpoint, and ALL per-turn material inside the final user message as
  `<turn_context>`; keep stable text out of that message and volatile text out
  of the system blocks), the `[NODE_INTRO]` (barebones bullet syllabus, ~120
  words max + the `[[SYLLABUS]]` contract)/`[NODE_REVIEW]`/`[NODE_CHECKPOINT]`
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
  FULL STRUCTURAL CONTROL via the ONE-TAP REWIRE PLAN (`src/lib/rewire.ts`
  types + `simulateRewire` pure validator): the model returns
  `plan.ops` — add (with `ref` handles later ops reference as `new:<ref>`),
  edit, move, delete, merge, reorder, split (drift → new child + message
  move), rebalance (unproven facets → new child), spinoff (subtree → new
  tree) — server-validated in `copilotTurn` (invalid ops get ONE corrective
  re-pass with the errors; still-invalid → honest failure note appended to
  the reply, never a silent drop — the "claimed it in words, tree unchanged"
  fix), rendered as ONE card (per-op checkboxes), applied atomically by
  `POST /api/tree/[id]/rewire` → `executeRewirePlan` (`src/lib/tree-ops.ts`,
  the shared op executors: snapshot first, any failure restores it). Plus
  insert-a-layer proposals (`adoptChildren` → `TreeNode.pendingPlan`, applied
  on approve), reorder = the canvas LEARNING PATH (numbered stops + "start
  here" pill, pre-order parent-before-child), client-side branch collapse
  (localStorage, view-only);
  thread persisted as Conversation context `tree-copilot:<treeId>`).
  MANUAL EDIT MODE (canvas toolbar toggle): every node grows edit/add/delete
  handles, drag-a-node-onto-another re-parents it (server re-validates), the
  side panel gains a rename form; destructive ops (manual delete/merge/move/
  edit + rewire plans) snapshot to `TreeSnapshot` first and the toolbar UNDO
  pill (`POST /api/tree/[id]/undo`) restores the last one — node ids are
  preserved so workspace records survive a delete → undo round trip. COPILOT
  CONTEXT RECALL (`src/lib/tree-context.ts`): every turn carries a token-light
  STORED WORK CATALOG (counts/names per node: workspace chats, notes, files +
  analyses, highlights, explainer annotations, progress logs, syllabus state,
  explainers, digests); the model recalls actual content ON DEMAND via a
  `contextRequest` JSON (only when the student asks about their history or
  recall would materially change the answer — never for small talk), served
  digest-first (contextSummary + rolling conversation summary + last messages,
  clamped, 14k-char budget), ONE recall round per turn, surfaced to the
  student as a `tree.recalledNote` line.
- `src/app/dashboard/workspace/page.tsx` — per-node work area: Bob chat,
  explainer, editable notes, highlight-based annotations, file evidence.
- `src/lib/insight-memory.ts` + `src/lib/insight-extraction.ts` — the personalization
  moat. PRESERVE in every change; extraction runs from workspace chats.
- `src/lib/xp-engine.ts`, `src/lib/badges.ts`, `src/components/xp-panel.tsx` — XP,
  daily goal, streaks, badges, sounds (`src/lib/sfx.ts`). Checkpoint answers pay
  `quiz_correct` / `quiz_attempt` / tiered `combo_bonus`; showing up pays via
  `updateStreak` (daily streak + first session), fired by `/api/xp/checkin` from
  `DailyCheckin` in the dashboard layout. STREAK ACCELERATOR
  (`src/lib/streak-accel.ts`, client-safe, shared by engine + panel): daily
  streak XP ramps 10 → 25 → 50 on days 1/2/3 and holds the day-3 max, plus a
  `week_streak` +500 XP boost every 7th consecutive day — streak payouts are
  EXACT (exempt from the global streak multiplier). Streak day boundaries use the USER's
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
  `tree-copilot`, `node-chat`, `insight`, `onboarding`, `portfolio`,
  `title`, `image`, `other` (`reflection` and other legacy values have no live
  writer and render with "(legacy)" labels). Every new AI call MUST record usage
  with a fitting feature tag.

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

Companion law — **Plain Language, Intuition First** (FOUNDATION.md, user
directive Aug 2026): all learner-facing content uses the fewest, simplest words
that produce complete understanding — intuition first, every technical term
unpacked in plain words in the same breath; the depth calibrator raises depth,
never jargon. Its **Structured & Short** clause: bullets with bold lead-ins as
the default body, `##`/`###` hierarchy on substantial replies, one example per
concept told once, hard word budgets (~150 teaching turn / ~250 remediation /
300-450 explainer). `PLAIN_LANGUAGE` + `STRUCTURED_BREVITY` in
`src/lib/tree-engine.ts` ride inside `sessionDirectives()`, so any prompt using
session directives gets both free; `markdown-renderer.tsx` + `mobile.css` keep
headers / subheader kickers / body visually distinct.

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
- Active models: ProblemTree, TreeNode (status/pending/notes/annotations/progressLog/quizState/origin — origin = seed|copilot|question|manual, the IKEA-effect attribution),
  TreeSnapshot (the undo layer: full node-set JSON per destructive structural
  change, restored with ORIGINAL node ids so workspace records re-attach),
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
designated `claude/...` branch. **STANDING DIRECTIVE (user, July 2026): completed,
build-verified work ships to PROD DIRECTLY — no per-change go-ahead.** Pipeline:
commit on the branch → push → cherry-pick onto `main` → re-verify (tsc + build)
→ `git push origin main` → merge `origin/main` back into the branch. Exceptions:
auto-loop suggestions stay gated on the branch until the user picks them, and
destructive/irreversible data operations still get a confirm first.

## Quick Sanity Checks Before Shipping

- Does it shorten or strengthen the path from problem to complete understanding
  (The Goal, FOUNDATION.md)? If it serves nothing on that path, drop it.
- Does this work for a brand-new user (no profile, no trees, no insights)?
- Is every new user-facing API under the middleware login gate (no
  unauthenticated path — demo mode no longer exists)?
- Does it respect the session's language/difficulty (never leak English into a 中文 session)?
- Does tree growth stay permission-based (nothing joins the tree without a click)?
- Does every new AI call record usage with the right feature tag?
- Does it handle empty arrays / null / malformed JSON fields gracefully?
