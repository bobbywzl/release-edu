<!-- Autoloop round 4 — 2026-08-04. Four audit lenses (practical product development ·
cost & enforcement · longitudinal/day-20 · feature-fit & deletions) run as parallel
agents over the post-d2c514f tree, every finding adversarially re-verified at the
cited lines by a second pass. Live persona SIMULATE was armed (relay + Chromium rig
validated end-to-end against prod) but blocked: TEST_LOGIN_TOKEN is not currently set
in Vercel, so this round's live evidence is logged-out probes only. Never re-report
these findings; check status and re-observe instead. -->

# Tree EDU — Autoloop Round 4: Practical-Use, Cost, Longitudinal & Feature-Fit

Ranked by impact on the founding goal: **"make a beginner at a specific problem a
thorough expert by the end of a session."** Owner directives this round: examine the
app as a tool for **practical product development**, and propose **deletions** of
features that don't serve the vision. Each item: the felt moment → the verbatim
canon quote → code evidence (file:line, re-verified in the current tree) → fix
direction.

---

## Status of the July-31 fix batch (d2c514f) — re-observed in code

**Landed and real:** growth affordance in the workspace (header Grow + per-message
grow → `/expand` now has real callers; the phantom "Grow branch" prompt line is
gone); `[NODE_VERIFIED]` turn + persisted `[[NEXT_NODE]]`; `treeCompleted`/
`seedComplete` read by the client; seed-only completion gate (origin-based);
THE ROOT ANSWER (`generateRootAnswer` + `/api/tree/[id]/answer` + root panel);
`studentGrounding()` (with standing misconception block) in node chat + copilot;
`evidenceLocker` reads Gemini analyses and stops shipping base64; untagged-streak
auto-flip deleted; syllabus re-derive repair pass; `wrongStreak`/`remediationOwed`
persisted with mount-fire; notes-panel close/backdrop/Esc; purpose question in the
first-run interview; one prompt-cache breakpoint; daily AI budget at 3 doors;
cache-tier usage recording.

**Partial / with new defects introduced:** completion gate is depth-blind (№2);
the seed-complete card is ephemeral with a dead-end CTA (№7); the wrong-streak
wiring created a deadlock (№1); budget rests on a mispriced table (№4); the cache
split point is wrong (№18).

**Still open from prior rounds (spot-verified, not re-reported):** artifact
checkpoints / evidence into judging; "You'll be able to" objectives unprobed;
portfolio file-names-only + hardcoded `claude-opus-4-8`; discovery drop/self-block
+ ephemeral card; hint/massed credit indistinguishable; promotion paths skipping
side effects; spinoff losing purpose; no compaction; `Conversation.summary`
hijack; review decay on `updatedAt`; zero tests/evals; model auto-adoption
ungated; 中文 shell/login language gap (live-confirmed at 390px: no language
control, zero 中文 on the front door).

---

## The findings

### 1 · The wrong-streak ratchet: after two misses, Bob is forbidden to ask — and the learner can't earn the answer that would unforbid him

- **Moment.** Robert (~55% accuracy) misses two checkpoints, reads his remediation,
  replies "Okay, I think I follow now." Bob opens with reassurance and no question —
  that turn, the next, and when Robert returns on day 20. 林小雨 returning after two
  weeks with an old 2-miss tail types 「我们继续吧」 and gets 「别担心，这部分确实不
  容易」— her verbatim churn trigger — for misses she made 14 days ago.
- **Canon.** *"The default mode is ASKING, not lecturing"* · *"Asking resumes once
  the learner re-engages."*
- **Evidence.** `quizState.wrongStreak` is zeroed **only** by a correct checkpoint
  answer (`src/app/api/tree/[id]/node/[nodeId]/quiz/route.ts:207`), never decays
  with time, and the remediation debt-clear block nulls only `remediationOwed`
  (`…/chat/route.ts:1240-1255` — re-read this round: `qs.remediationOwed = null`,
  `wrongStreak` untouched). Every typed turn pins
  `streakWrong = max(reflection, wrongStreak)` (`chat/route.ts:375`); at ≥2 that
  fires SUPPORT-FIRST ("No checkpoint question this turn"), suppresses
  `[[QUIZ_OFFER]]`, and the auto-continue `[NODE_CHECKPOINT]` only fires after a
  **correct** answer (`workspace/page.tsx:761-763`). Deadlock: the only exits are
  Bob disobeying his prompt or the learner typing the exact "quiz me" phrase whose
  button is suppressed. Introduced by the fix batch that made `wrongStreak` real.
- **Fix.** Zero `wrongStreak` in the same debt-clear block when `[NODE_REMEDIATE]`
  completes (the bottleneck was just taught; the streak's diagnostic value is
  spent), and/or stamp `wrongStreakAt` and ignore the counter after a few hours.

### 2 · The "deployable" end of the depth axis is prompt seasoning: verification, completion, and THE ANSWER are identical to "beginner" — the completion gate measures growth, never build

- **Moment.** David finishes every node of his watering-system tree with MCQs and
  typed answers. The pump is still in its box; his build log is empty. Tree
  completed, trophy fired, THE ANSWER generated, portfolio says mastered. His
  purpose — *"actually build a working watering system I can leave running for
  2 weeks"* — was never checked against anything.
- **Canon.** *"target depth on the **explainable ↔ deployable axis** (… professional
  'real-life deployable understanding')"* · Mode: *"including the user's own files
  and products as an answer to 'do you understand this point'."*
- **Evidence.** `DIFFICULTY_GUIDE` (`src/lib/tree-engine.ts:33-38`) is consumed only
  by `sessionDirectives`; repo-wide grep shows no verification/completion read of
  `tree.difficulty`. `masteryMet` (`src/lib/mastery.ts:67-72`) is facets +
  shortCorrect only. The new completion gate (`tree-engine.ts:1592-1610`) checks
  only `origin` — it reads neither difficulty nor `progressLog` nor `LinkedFile`,
  so a professional-depth tree completes with zero artifacts.
- **Fix.** For `difficulty ∈ {advanced, professional}`, completion additionally
  requires ≥1 cited `progressLog` entry or analyzed evidence file tree-wide;
  otherwise return a `buildPending` flag and an honest "explained, not yet
  deployed — show me it running" card. Label Forest/portfolio entries
  **Explained** vs **Deployed** from the same predicate.

### 3 · THE ROOT ANSWER is build-blind by construction and has no egress

- **Moment.** David completes the tree. THE ANSWER discusses mechanisms "proven at"
  nodes — but his measured 620-dry/310-wet calibration, the relay-vs-MOSFET
  decision, and the parts he ordered (all captured in `progressLog` with verbatim
  citations, and in Gemini file analyses) appear nowhere: the generator never reads
  them. He wants to hand the plan to the friend helping him build; the panel has no
  copy, print, download, or share — while the lesser artifacts both have egress
  (digest → copy, explainer → PDF).
- **Canon.** *"You need this entire tree to understand the full answer to this
  problem."* · purpose *"defines 'relevant' for the whole session."*
- **Evidence.** `generateRootAnswer` (`tree-engine.ts:1664-1694`) builds its source
  block from `contextSummary ?? summary` only and declares it "the ONLY source you
  may draw claims from"; `refreshNodeContextSummary` never reads `progressLog` or
  file analyses (grep: the only `progressLog` read in tree-engine is the digest at
  `:1738`). `RootAnswerPanel` (`tree/[id]/page.tsx:740-787`) has expand/regenerate
  only — grep for copy/print/export in the file: nothing.
- **Fix.** Feed the cited `progressLog` lines + `evidenceLocker(…, {maxFiles:8})`
  into the generator (the digest already does exactly this); for deployable-depth
  sessions demand a "What was actually built & measured / What remains to build"
  section. Add copy-markdown and reuse the explainer print-to-PDF machinery.

### 4 · The budget's dollar is not a dollar: Opus is billed 3× its real price, and the auto-adopted newest model has no price row at all

- **Moment.** Maya, mid-verification-streak, hits "You've used today's AI learning
  budget" barely two nodes in — during a models-catalog blip the teaching tier fell
  back to pinned `claude-opus-4-8`, whose row bills $15/$75 per MTok when the real
  price is **$5/$25** (verified against the current authoritative Anthropic pricing
  reference this round). On a healthy day the resolver adopts `claude-opus-5`
  (real price $5/$25) which has **no row**, so spend records at the Sonnet-tier
  fallback ($3/$15) and the ceiling silently stretches. Same learner, same env
  var, ~5× swing; the admin cost panel is wrong in both directions.
- **Canon.** CLAUDE.md: the resolver *"auto-adopts the NEWEST Opus/Sonnet release"*
  while `usage.ts` declares itself *"the one source of truth for cost math"* — the
  two contracts collide by construction.
- **Evidence.** `src/lib/usage.ts:27-28` (`claude-opus-4-8/4-7: input 15, output
  75, cacheRead 1.5, cacheWrite 18.75` — correct values are 5/25/0.5/6.25); no
  `claude-opus-5` row (`:25-35`); `FALLBACK_PRICE` is flat Sonnet-tier (`:38-39`);
  `ai-budget.ts:26-32` gates learners on the resulting `costUsd`.
- **Fix.** Correct the Opus rows; add `claude-opus-5`; make the fallback
  family-aware (id contains `opus` → Opus-tier); surface an admin badge when a
  resolved model id is missing from `MODEL_PRICING`.

### 5 · The budget perimeter gates 3 doors and leaves ~7 open — including seeding, the priciest single call — and a whole class of spend counts toward nobody

- **Moment.** The owner sets `DAILY_AI_BUDGET_USD=15` and believes spend is
  bounded. A scripted or merely enthusiastic user loops `POST /api/tree` — every
  seed is a teaching-tier Opus PLAN-pass with no budget check, no per-user tree
  cap, no rate limit. Meanwhile David's balcony photos — the priciest Gemini
  inputs — never count toward his $15, because every attachment analysis records
  `userId: null`.
- **Canon.** CLAUDE.md: *"Every new AI call MUST record usage with a fitting
  feature tag"* — attribution is the point; ai-budget's own charter: *"without a
  ceiling, the most expensive learner is the one doing exactly what the vision
  asks."*
- **Evidence.** `checkDailyBudget` has exactly 3 call sites (grep: chat:272,
  copilot:63, answer:40). Unmetered client-reachable AI doors: seed (`POST
  /api/tree`), `/expand` (now UI-reachable via `grow-branch.tsx:64`), explainer,
  digest, portfolio, `/api/image/generate` (up to 3 Gemini calls per prompt, no
  quota), onboarding chat. Unattributable: `haikuReflect` (`chat/route.ts:114`
  `userId: null`) and every `gemini.ts` recorder (`:94,:137,:175` omit userId —
  re-verified).
- **Fix.** Call `checkDailyBudget` at the top of seed/expand/explainer/digest/
  portfolio/image (judging stays exempt by design); thread `userId` through the
  gemini recorders and `haikuReflect`; add a trivial per-user daily seed cap.

### 6 · Real-world progress pays 0 XP and reaches nothing: the fraud-proofed build log is still worthless to the builder

- **Moment.** David tells the Copilot — his primary surface — "ordered the pump and
  relay today, wired the sensor, reads 620 dry." The Copilot answers well and
  records nothing (no progress detection on that route). Had he said it in node
  chat, the citation-gated write fires — and still pays nothing, feeds no facet,
  no completion, no portfolio line. A lucky MCQ guess pays 15 XP; shipping the
  thing pays 0.
- **Canon.** *"Project execution awareness: Bob detects concrete real-world
  progress on the problem (code written, experiments run) and flags it per node."*
  The flag exists and is trustworthy; everything it should drive doesn't.
- **Evidence.** `progressLog` writers: chat-route reflect pass
  (`chat/route.ts:488-497`) + merge transfer only. `project_milestone: 75` /
  `project_completed: 400` (`xp-engine.ts:119-120`) have **zero award sites**
  (grep re-verified this round). Copilot route: no progress detection. Build-log
  tab read-only. Portfolio never queries `progressLog`.
- **Fix.** `awardXp(userId, 'project_milestone')` at the cited-write site, toasted
  via the existing `[[XP]]` marker; `project_completed` inside the №2 deployable
  gate; a manual "log progress" input (flagged unconfirmed unless evidence rides
  along); feed the log into the portfolio as `artifacts[]`.

### 7 · The completion gate's honest question evaporates: an ephemeral card whose CTA drops the learner on the canvas without opening the Copilot

- **Moment.** David verifies the last seeded branch; the emerald "Every seeded
  branch verified — is the root problem actually answered?" card appears once. The
  CTA navigates to the canvas — the Copilot stays a collapsed pill, and its "Check
  my tree for gaps" chip is gone (chips render only while `thread.length === 0`).
  Next visit: an all-green tree, no crown, no card, no explanation of what state
  the tree is in. Related: the facet-grow chips — the other new growth path — are
  `opacity-0 group-hover:opacity-100` (`workspace/page.tsx:1400`), i.e. invisible
  on every touch device.
- **Canon.** d2c514f's own contract ("the client shows the honest card with a
  Copilot gap-check CTA") in service of *"…should expand as users ask more
  questions."*
- **Evidence.** `treeOutcome` is `useState` set once from the quiz response
  (`workspace/page.tsx:153, :769`), never persisted; CTA is a bare
  `router.push('/dashboard/tree/'+treeId)` (`:1194`); `TreeCopilot` has no
  external-open prop and chips are virgin-thread-gated (`tree-copilot.tsx`).
- **Fix.** Derive seed-complete server-side on tree GET and render a persistent
  banner on the tree page; CTA opens the Copilot pre-filled with the gap check
  (`?copilot=gaps` + an `initialPrompt` prop); show chips whenever no ghosts are
  pending; give facet chips a touch-visible variant.

### 8 · The new resume card asserts two false facts: a "last visit" that isn't a visit, and "ended on a miss" that didn't

- **Moment.** David asks the copilot to reorder his branch (his signature move),
  then clicks a node he hasn't opened in nine days: "last visit just now." 林小雨
  ends a session miss → correct → correct; two weeks later the card says 「上次以
  一道错题结束」 about a visit that ended on a streak.
- **Canon.** Mode: *"…and a portfolio, respectively empowering and **recording**
  specific problem-based learning"* — a record that mis-states when and how the
  learner last worked is a false record.
- **Evidence.** `tree/[id]/page.tsx:637` renders `tree.lastTouched` from
  `node.updatedAt` — a Prisma `@updatedAt` bumped by copilot reorders (which
  rewrite `order` on every sibling), pending-CAS repairs, and background
  summaries, while a genuine read-only visit bumps nothing. `leftOffMissed`
  (`:623`) shows whenever an un-retested `missed[]` entry exists; `missed`
  survives subsequent corrects (only a `retestOf`-tagged correct clears it).
- **Fix.** Derive last-visit from the node conversation's newest message timestamp
  (already fetched for the copilot catalog) and use it for the card, the 7-day
  decay nudge, and the review tiebreak — retiring `updatedAt` as a learner-facing
  signal. Reword `leftOffMissed` EN+中文 to the true claim ("a missed checkpoint
  awaits a fresh retest").

### 9 · The standing misconception block broadcasts unvalidated, unexpirable rows into every turn of every future tree

- **Moment.** 林小雨, day 20, tree six. A misconception recorded once by a single
  Haiku read in an abandoned earlier tree now rides every workspace and copilot
  turn of her 神经网络 session — "refute it directly and memorably… never assume
  it self-corrected" — steering Bob to refute a belief she never held, or held
  three trees ago.
- **Canon.** *"Insight memory (the moat): Bob's **curated** long-term memory…
  consolidated, reinforced."* Curation is the promise; this path has none.
- **Evidence.** `tree-engine.ts:147-161` (re-read this round): unconditional
  `getTopInsights(limit 3, ['misconception'])` in `studentGrounding`, injected
  every node-chat and copilot turn. Creation is still single-observation at
  confidence 0.7 (`chat/route.ts:434-441`); recency scoring floors at 0.25 so
  with few rows they serve forever; extraction-sourced rows carry no node-title
  tag, so title-match resolution can never retire them; consolidation only fires
  above 45 rows.
- **Fix.** Gate the standing block on `timesObserved ≥ 2`, and skip rows last
  confirmed before the current tree's creation unless reinforced since.

### 10 · The sidebar tells every user they are Level 1, forever

- **Moment.** Maya — "loves XP, checks the panel" — is Level 12 "Theorist" in the
  XpPanel; the sidebar footer 40px away says "Level 1", and has said so since the
  day she signed up. It will say Level 1 for every Tree EDU user for the life of
  the product. Her churn trigger, verbatim: "progress that doesn't visibly move."
- **Canon.** Product Surfaces: *"Dashboard — XP status, rank, daily goal, streak,
  badges…"* — a permanently wrong level under the learner's name reads as a broken
  product.
- **Evidence.** `sidebar.tsx:218/:289` render `mockStudent.level` from
  `/api/student-data`; Tree EDU users never have a CurriculumPlan, so 100% hit the
  no-curriculum branch which hardcodes `xp: 0, level: 1, streak: 0`
  (`api/student-data/route.ts:281`, re-read this round) — while assembling a full
  Release EDU payload (defaultTracks, assignments, curriculumPlan) on every
  dashboard load, of which consumers read only name/email/avatar/level.
- **Fix (delete + replace).** Point the sidebar at `/api/xp/summary` (already
  fetched by XpPanel) and replace `/api/student-data` with a ~30-line identity
  route; delete `mock-data.ts` (1191 lines) + `default-curriculum.ts` with it.

### 11 · "Review what I learned yesterday" has no path: review is unreachable on active trees for the first 7 days, and forever on phones

- **Moment.** Robert, day 2, taps yesterday's verified node to review it — his
  persona's canonical return. The side panel offers "Open workspace" and a
  checkmark; no Review. The list-page Review button requires a consolidated tree
  (his is 1/3); the fading nudge needs 7 days of staleness and a ≥md viewport.
  Typing "quiz me" gets unmarked grinding: 25% XP, no `reviewedAt` stamp.
- **Canon.** *"**Review loop**: verified knowledge fades"* — the fade starts day 1.
- **Evidence.** Review gated on `tree.status === 'completed'`
  (`tree/page.tsx:585`, re-verified); nudge `hidden md:` + 7-day threshold;
  verified-node side panel has no review affordance; typed quiz on a verified
  node pays `base*0.25` and stamps nothing.
- **Fix.** "Review this node" on every verified node's side panel and list row,
  routing to the existing `workspace?review=1` machinery; pay full XP only when
  due (deriving `dueAt` from `reviewedAt ?? verifiedAt` — same change retires the
  §13e decay gaps).

### 12 · The evidence pipeline bounces the builder's dominant artifact: phone photos are rejected at 1 MB / 3 MB with no downscaling

- **Moment.** David photographs his breadboard with the workspace's own 📷 button.
  A modern phone JPEG is 3–8 MB; staging rejects it. The Files tab — "upload your
  work as evidence of understanding" — hard-rejects at 1 MB with an `alert()`,
  telling him to go screenshot his own photo.
- **Canon.** Mode: *"including the user's own files and products…"* — a cap that
  excludes default camera output excludes the products.
- **Evidence.** `MAX_FILE_BYTES = 3_000_000` (`multimodal-input.tsx:28,:75,:106`);
  Files tab `file.size > 1_000_000 → alert` (`workspace/page.tsx:616-617`);
  repo-wide grep: no upload downscale primitive exists.
- **Fix.** One shared client-side canvas downscale for `image/*` (longest edge
  ~1600px, JPEG q≈0.8 → ~200-400 KB, more than Gemini needs) used by both paths;
  keep the visible reject for non-image binaries.

### 13 · DELETE the Google Drive scopes, the two dead Drive routes, and the false login promise

- **Moment.** Robert clicks Sign in and Google shows the restricted-scope consent —
  "See and download all your Google Drive files" — for a sourdough-learning app,
  under the app's own promise "We'll connect to Google Drive to save your project
  files & assignments" (live-confirmed on prod this round; "assignments" is dead
  Release EDU vocabulary). The app then never touches Drive, ever.
- **Canon.** Necessity test applied to features: nothing in Vision/Mode/Surfaces
  requires Drive; *"What survives from Release EDU"* doesn't list it.
- **Evidence.** Scopes at `src/lib/auth.ts:31` (`drive.file` + `drive.readonly` +
  offline); only consumers are `api/drive/list|read/route.ts` with **zero client
  callers** (grep re-verified); no Drive write exists anywhere, so the "save your
  files" claim is false in both directions. Bonus cost: the oversized Google JWT
  is the admitted cause of the chunked-cookie machinery (`session-slots.ts:19-27`),
  and `drive.readonly` is a Google *restricted* scope (verification/security-
  assessment liability) held for an unused permission.
- **Fix (deletion).** Reduce scopes to `openid email profile`, drop
  `access_type: "offline"`, delete `src/app/api/drive/**`, delete the login-page
  line. Rebuild later with incremental auth if a Drive import is ever wanted.

### 14 · Settings is compliance theater: fake privacy toggles write one global cross-user file; connected-accounts, password, and avatar controls simulate success — and export deserves delete-and-rebuild

- **Moment.** Robert toggles "Allow parent view" off — his choice is written to a
  single **global** JSON file shared by every user on the instance and lost on the
  next cold start; no code ever reads any toggle back. Maya clicks Connect GitHub
  and gets a fake "connected-github@example.com" success. David — whose persona
  literally says "will try the export to share with a friend helping him build" —
  gets "Curriculum & Roadmap" / "Projects & Assignments" categories and a
  `release-edu-export-*.json` containing none of his tree.
- **Canon.** Mode: *"…and a portfolio, respectively empowering and **recording**"*;
  trust is the product's stated currency ("certifies verified understanding").
- **Evidence.** `api/account/privacy/route.ts:5,:27` writes
  `prisma/privacy-settings.json` via `writeFileSync` — unscoped by user, ephemeral
  on Vercel, zero consumers (grep). Connected accounts route returns
  `connected-${provider}@example.com` ("TODO: Initiate OAuth flow"). Password
  route "simulates success"; avatar is a blob URL that dies on reload. Export:
  deep-2 §14 reported it broken; the decision this round is **rebuild
  Tree-shaped** ("Export this session": root problem/purpose, THE ANSWER, digest,
  per-node status/facets/notes/cited build log/file analyses — assembled from
  data already loaded, zero AI calls) and **delete** the fake controls outright.
- **Fix.** Delete privacy-file route + fake toggles, connected-accounts page +
  route, password route, avatar control (or wire it for real). Rebuild export as
  the per-tree bundle above; rename the file `tree-edu-export-…`.

### 15 · Settings promises "Daily reminders to keep your streak alive"; nothing can send one

- **Moment.** Robert enables Streak Reminders (default-on, confirming toast). No
  reminder ever arrives; his 6-day streak dies silently; on day 20 he returns to a
  flame reading 1. The product's whole comeback story ran while he wasn't looking,
  in an app that said it would reach out.
- **Canon.** Retention & Moat: every mechanic pays *in-app* — the single surface
  claiming an out-of-app channel is a dead switch, the same trust-breach class as
  the fake export.
- **Evidence.** Toggles + copy: `settings/page.tsx:83,:376`, `i18n.tsx:87-88` (re-
  verified: `streakReminders` has zero consumers outside the settings page; no
  mail/push library anywhere; the only cron is prompt-evolution).
- **Fix.** Remove the notification card until a sender exists — or ship the
  minimal real thing: one daily cron emailing opted-in users whose
  `lastCheckinDay < today`, which would also be the product's first actual
  answer to "what schedules a learner to come back."

### 16 · The list view (and every non-canvas entry) opens on amnesia — or on a cold, weeks-old remediation wall

- **Moment.** Robert returns "the next day," finds his node via the searchable
  list — no progress pips, no resume state, a link still reading "Open
  workspace." He clicks it, and before he says a word Bob mounts a 700-word
  walkthrough of a question he doesn't remember missing: `[NODE_REMEDIATE]`
  fires on mount with no staleness gate and no re-anchor.
- **Canon.** Product Surfaces: the list view is *"a searchable list view carrying
  each node's full record"*; Bottleneck-Triggered Teaching teaches into a gap
  *just* proven — a 14-day-old debt delivered before re-engagement is teaching
  outside its diagnostic moment.
- **Evidence.** `NodeProgressCard` mounts only in the graph side panel
  (`tree/[id]/page.tsx:1281`); ListView link unconditional (`:459-464`);
  mount-fire `workspace/page.tsx:252-257` (`remediationOwed && !pending`, any
  age).
- **Fix.** Mount `NodeProgressCard` in the ListView expanded panel (component is
  standalone); for debts older than ~24h, prefix the mount-fired remediation with
  a one-line re-anchor ("Last time, this checkpoint tripped you: … — here's the
  full walkthrough").

### 17 · Per-tab account slots: keep the mechanism, DELETE the silent account-resurrection path

- **Moment.** Robert logs out on a library computer. `slotSignOut()` kills only
  his tab's slot; other signed sessions survive as 30-day cookies. The next
  person opens the site: `AccountSlotGate` finds no main session, **auto-binds to
  the first surviving slot and reloads signed in as Robert** — trees, "what Bob
  knows about you," portfolio, all readable. No surface lists parked accounts; no
  control ends them all.
- **Canon.** *"Insight memory (the moat)… Preserve it in every future change"* — a
  memory that intimate makes silent session survival a privacy failure.
- **Evidence.** Auto-adopt branch `account-slots.tsx:100-108`; per-tab-only logout
  `:57-77`; 30-day slot cookie `api/auth/slot/route.ts:39`. (Adversarial check
  kept the feature itself: the header-selects-cookie security model is sound,
  "Switch account" is real UI, and multi-account users get real value.)
- **Fix.** Delete the auto-resurrect branch (an unbound tab with no main session
  lands on /login showing parked accounts as *choices*); add "Sign out of all
  accounts"; drop MAX_SLOTS 5→3 and cookie age 30d→7d; skip the gate spinner when
  no slot cookies exist.

### 18 · The words that label the learner's mind are untranslated English clinical terms

- **Moment.** 林小雨 expands 「Bob 对你的了解」on her fully-Chinese dashboard.
  Every row of her portrait is chipped in uppercase English: MISCONCEPTION,
  STRUGGLE, WEAKNESS — the only English words on the page are the ones
  categorizing her deficits.
- **Canon.** *"every user-facing string EN + 中文"* (survival list, verbatim).
- **Evidence.** `dashboard/page.tsx:221` renders raw `{i.type}`; `:120` tries
  `t('insight.type.'+i.type, i.type)` but **no `insight.type.*` keys exist**
  (grep: zero matches) — both surfaces fall back to raw English for all 11 types.
- **Fix.** Add 11 `insight.type.*` EN+中文 keys with learner-kind wording
  (misconception → "belief to revisit"/「需修正的理解」; weakness → "growing
  edge"/「待提升」), route line 221 through `t()`. ~30 minutes. (The absent
  dispute/dismiss control remains deep-2 §9's open item; this key pass is its
  natural moment.)

### 19 · The cache split point is not where the bytes stop changing, and retry calls ignore the cache entirely

- **Moment.** The owner reads d2c514f's "~10x on the repeated prefix" and budgets
  accordingly — but ~11k source bytes of mostly-fixed prose (CHECKPOINT rules,
  VISUAL rules, `sessionDirectives`) sit in `systemDynamic`, re-billed at full
  Opus input every turn because small volatile interpolations are woven mid-text.
  On young trees the cached block can hover at the pinned model's 1,024-token
  cacheable minimum and silently no-op. `copilotTurn`'s retry/recall passes and
  `authorCheckpoint`'s 2 attempts re-send byte-identical prefixes with zero
  breakpoints.
- **Canon.** The fix batch's own claim, and CLAUDE.md's cost-telemetry intent.
- **Evidence.** Single `cache_control` site (`chat/route.ts:884`, grep re-verified
  this round); dynamic template `chat/route.ts:727-772`; copilot call sites
  `tree-engine.ts:1174,:1181-1184,:1213-1222`.
- **Fix.** Move the fixed rule prose into `systemStatic` (end of block) and emit
  volatile state as a compact CURRENT-STATE section in `systemDynamic`; pass the
  copilot system as a block array with a breakpoint so retries cache-read what
  pass 1 wrote.

### 20 · The QA backdoor is publicly advertised, takes unlimited attempts, and its kill switch is human memory

- **Moment.** Anyone curling `/api/auth/providers` sees `"agent-test": "Agent Test
  Login"` with its callback URL (live-confirmed on prod this round) — on a product
  whose stated posture is Google-login-only. The last run's cleanup step ("remove
  TEST_LOGIN_TOKEN from Vercel") is a human-memory op nothing in code enforces.
- **Evidence.** `auth.ts:45-68` registers the CredentialsProvider unconditionally —
  the env check lives inside `authorize`, so the provider is listed publicly even
  when inert; no rate limiting exists anywhere (middleware, vercel.json).
- **Fix.** Conditionally register the provider only when
  `process.env.TEST_LOGIN_TOKEN?.length >= 16` — one edit; the public listing then
  exists only while QA is deliberately on. Optional: constant-time compare.

### 21 · Purge the dead Release EDU surface still mounted: 15+ orphan routes, 5 orphan libs, a live no-op weekly cron, ~340 dead i18n keys

- **Moment.** Every learner's phone parses two products' worth of strings on every
  load; a scheduled Monday cron analyzes feedback tables no Tree EDU surface
  writes, to improve a 560-line system prompt with **zero importers**; and every
  future feature written near this code risks resurrecting Release EDU vocabulary
  (the login page already does — №13).
- **Canon.** CLAUDE.md: dormant *tables* were the deal — dormant reachable routes,
  scheduled crons, and UI strings were not.
- **Evidence (spot-verified).** `vercel.json` schedules `/api/cron/prompt-evolution`
  (Mon 09:00); `system-prompt.ts` has zero importers (grep); orphan routes incl.
  `/api/conversations/**` (8), `/api/pdf`, `/api/clock`, `/api/cron/auto-lock`,
  `/api/user/completion-stats` (whose `status-cascade.ts` still pays Track/Chapter
  XP); orphan libs `work-data.ts`, `clock.ts`, `refresh-bus.ts`, `mock-data.ts` +
  `default-curriculum.ts` (via №10); ~340 dead i18n keys (curriculum.* 107,
  chat.* 85, projects.* 38…) plus the superseded `tree.grow*` family; 8 legacy
  badge defs and dead XP sources (`capstone_passed`, `track_completed`…).
- **Fix (deletion PR).** One sweep: the route folders, five libs, the cron entry,
  dead XP sources/badges, i18n sweep. No schema changes — tables stay dormant
  exactly as CLAUDE.md instructs.

### 22 · THE ROOT ANSWER's spend is booked as `tree-digest`; the budget message promises a reset that isn't real

- **Evidence.** `tree-engine.ts:1697` records the answer generation under
  `'tree-digest'` — the flagship artifact is invisible in cost telemetry as
  itself (CLAUDE.md: *"Every new AI call MUST record usage with a fitting feature
  tag"*). And `ai-budget.ts:26` windows a rolling 24h while the learner-facing
  message says "resets automatically tomorrow / 明天会自动恢复" — Robert comes
  back at 9am still 429'd (his churn trigger: being made to feel slow), at the one
  moment the app chose to be honest about limits.
- **Fix.** Add a `tree-answer` tag (type union + labels + CLAUDE.md taxonomy);
  either window the budget from the user's local midnight (the streak system
  already stores timezone) or reword the message to match the mechanism.

---

## Feature-fit verdicts (owner directive: deletions allowed)

**Delete:** Drive scopes + `api/drive/**` + login promise (№13) · fake privacy/
connected/password/avatar controls (№14) · dead notification toggles or ship the
cron (№15) · `/api/student-data` mock pipeline + `mock-data.ts` +
`default-curriculum.ts` (№10) · slot auto-resurrection branch (№17) · the Release
EDU purge list incl. the prompt-evolution cron (№21).

**Rebuild:** data export, Tree-shaped ("Export this session" — it is the Mode
paragraph's "recording" half and David's persona reaches for it) (№14/№3).

**Keep (adversarially confirmed as earning their place):** the 74-title rank
ladder + tier fanfares (sanctioned verbatim by FOUNDATION; edge cases clean; all
titles carry 中文) · streak accelerator + week boost · XP sounds (toggleable,
asset-free) · badge taxonomy (legacy defs hidden; prune in №21) · the
generated-visual pipeline (implements the Visual Confidence law; owed only the
already-reported URL-liveness check) · per-tab slots mechanism (minus №17's
resurrection path) · teacher API routes (admin-consumed) · `NodeProgressCard`
(zero extra fetches — needs №8's honest signal).

---

## Cheapest high-leverage moves, in order

1. **Zero `wrongStreak` in the remediation debt-clear block** (`chat/route.ts`
   ~:1240) — one line; un-deadlocks the ask-first loop for every learner who
   misses twice (№1).
2. **Fix `MODEL_PRICING`** — Opus rows to $5/$25 (+cache tiers 0.5/6.25), add
   `claude-opus-5`, family-aware fallback (№4). ~20 lines; fixes the admin panel
   and the 3×-early learner throttle at once.
3. **Award `project_milestone` at the cited build-log write** + `[[XP]]` toast —
   two lines; the only XP that rewards doing the actual project (№6).
4. **Sidebar level from `/api/xp/summary`** — ends a product-wide permanent
   counter lie (№10).
5. **11 `insight.type.*` EN+中文 keys** + `t()` at `dashboard/page.tsx:221` —
   ~30 minutes (№18).
6. **One honest last-visit signal** (node conversation's newest message time) for
   resume card + decay nudge + review tiebreak, and truthful `leftOffMissed`
   copy (№8, retires §13e's clock too).
7. **Feed `progressLog` + evidence into `generateRootAnswer`** + copy button on
   the panel (№3).
8. **Close the budget perimeter** — 6 route gates + thread `userId` through
   gemini/haikuReflect recorders (№5).
9. **Client-side image downscale** shared by both upload paths (№12).
10. **Persist seed-complete server-side; CTA opens the Copilot pre-filled; facet
    chips touch-visible** (№7).
11. **Cut OAuth scopes to `openid email profile`** + delete dead Drive routes +
    login line (№13).
12. **Conditionally register `agent-test`** only when the token env exists (№20).

Then the two that need design: **deployable-depth completion** (build evidence
gating + Explained/Deployed labels — №2) and **"Export this session"** (№14) —
together they make the product's practical-development promise real: a builder
finishes with a verified understanding, a build record, and an artifact they can
take with them.

---

## Operational notes

- Live SIMULATE was armed but blocked: the relay + Chromium rig validated
  end-to-end against prod (login page renders through the relay, CSRF passes,
  cookie translation works), but `TEST_LOGIN_TOKEN` is not currently set in the
  Vercel environment — agent-test login 401s. Set it + redeploy to enable persona
  runs; **remove it again when testing ends** (and №20 makes that self-enforcing).
- No fixes shipped this round: per the autoloop contract, everything above is
  gated awaiting the owner's picks.
