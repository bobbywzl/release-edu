<!-- Deep Audit round 2 — produced by a 20-agent workflow (9 lenses -> adversarial verify -> synthesis -> critic; 53 findings survived verification). Complements qa-findings.md and qa-findings-deep.md; overlapping findings were deduplicated by the synthesizer.

Already addressed by the fix batch shipped 2026-07-31 (before this doc landed):
- §15 'chat auto-scrolls on every token with no user-scrolled-up guard' — the stream tail now only follows when the reader is already near the bottom (fix 25).
- §11 'the canvas hides the learning-path number on every verified node' — verified nodes now keep a dim #label (fix 34).
- The header Quiz-me button became Bob's in-chat readiness invitation (fix 25); §15's 1500ms force-fire timer and swallowed-Enter points still stand.
- §14 note: copilot restructures no longer invert kinds going FORWARD (kind-by-depth normalization, fix 35) — the findings about lost work in delete/merge/spinoff still stand.
-->

# Tree EDU — Deep Audit Synthesis

*Nine audit lenses over the code, read against FOUNDATION.md and the four personas. Consolidated, deduplicated, and ranked by impact on the founding goal: **a beginner at a specific problem becomes a thorough expert by the end of a session**. Line numbers verified where cited; where a lens's numbers had drifted I re-grepped and corrected them.*

---

## The three structural misalignments

**1. The tree does not grow — and then the app certifies the ungrown tree as mastery.**

> *"…should expand as users ask more questions and give permission for it to be added to the tree"* (Mode, verbatim) · *"You need this entire tree to understand the full answer to this problem."* (Vision, verbatim)

`seedTree()` emits root + 1–3 branches and "NOTHING deeper" (`src/lib/tree-engine.ts:318`). From the workspace — where every learner spends their session — there is **no growth affordance at all**: `POST /api/tree/[id]/expand` has zero client callers (verified: `grep -rn "/expand" src/` returns only the route itself), the four `tree.grow*` i18n keys have no consumer, and Bob's prompt still tells learners to *"press the \"Grow branch\" button"* (`chat/route.ts:518`) — a control that was deleted. The one automatic path, AI discovery, is dropped by the attention arbiter on any turn that ships a checkpoint (`chat/route.ts:995`, `if (suggestion && !quizShipped)`) and then **blocks itself next turn**, because the suppressed suggestion is still persisted into `lastReflection` and read back as `suggestedLastTurn` (`chat/route.ts:375`). Then `markNodeVerified` completes the tree on `remaining === 0` over whatever nodes happen to exist (`tree-engine.ts:1558-1573`) — no depth floor, no goal-coverage check — flips the root green, pays `chapter_completed`, and awards the gold 🏆 "Mastered an entire problem tree end-to-end."

Net: a 2–3 node tree, ~12–18 correct answers, certified as a mastered problem. Every incentive then points away from growth (verified nodes pay 25% XP; approving a node re-opens the tree and delays the one-time completion bonus).

**2. The vision's core intellectual act — comparison and scrutiny — exists nowhere in the product.**

> *"given many solutions they need knowledge to give evaluative comparisons. The resolution is then scrutinized."*

`kind: 'solution'` is written at seed time and read only for a dot size and an uppercase label (`src/app/dashboard/tree/[id]/page.tsx`). There is no comparison surface, no choice, no "why this one." Completion requires **all** branches verified, so 2–3 candidate solutions are 2–3 mandatory curricula rather than alternatives. The one place a comparison could be tested is explicitly banned: the checkpoint SCOPE rule — *"a correct answer here must NEVER require the student to explain another node's mechanism"*. And `GOAL_NECESSITY` selects against alternatives by construction: a rejected approach is not load-bearing, so the necessity test pushes the seeder toward one decomposition.

**3. The learner's own files and products can never answer "do you understand this point."**

> *"including the user's own files and products as an answer to 'do you understand this point'"* (Mode, verbatim)

`PendingQuiz.kind` admits only `'mcq' | 'short'` (`src/lib/mastery.ts`), the answer channel is `string | number`, `judgeCheckpointAnswer` receives no evidence block, and `masteryMet` reads only quiz tallies. Uploads reach *teaching* (the node chat inlines the Gemini analysis, `chat/route.ts:401-441`) but have **no channel into judging**. Meanwhile the Files tab says *"upload your work as evidence of understanding"* (`i18n.tsx:674` / `:1442`) and a badge pays for the upload count.

Everything below is ranked against these.

---

## 1 · Growth is unreachable from the place curiosity actually fires

**The moment.** 林小雨, mid-node, asks her third 为什么 — genuinely new ground. Bob answers and tells her (in Chinese) to press 「生长此分枝」. She scans the workspace: chat box, Quiz me, notes/annotations/files, explainer. No such control exists anywhere in the app. Robert hits the same wall and, per his persona, stalls at "what am I supposed to click?"

**Vision.** *"new nodes come from (a) the learner's explicit 'grow this branch' questions, (b) AI discovery…, (c) manual add"* (Tree Model, L58-62).

**Code.**
- Phantom affordance: `chat/route.ts:518` (verified verbatim).
- `proposeExpansion()` (`tree-engine.ts:742-967`, ~175 lines with clarify forks and a forced-proposal pass) and its route are fully built and **unreachable**: no client fetches `/expand`; `tree.growBranch/growHint/growPlaceholder/growReplyPlaceholder` (`i18n.tsx:513-515`, zh `:1284-1286`) have no `.tsx` consumer.
- Discovery: dropped at `chat/route.ts:995`, self-blocked at `:375`, and client-side it is pure ephemeral `useState` — cleared on node switch, cleared when a quiz arms, gone on reload. It is the only proposal in the product that is not persisted as a ghost.
- The fallbacks are worse for the personas who need them: the Copilot's `chipGaps` ("Check my tree for gaps") renders only while `thread.length === 0` (`tree-copilot.tsx`, both shells) — one message and it is gone for the life of the tree; manual `add_child` requires typing the **title of the concept the learner does not know exists**.

**Fix.** (a) One line now: rewrite `chat/route.ts:518` to name the Tree Copilot by its real name — Bob must not name UI that doesn't exist. (b) Real fix: an "Ask this into the tree" action on the learner's own chat bubble, POSTing that message to the still-working `/expand`. (c) Only set `suggestedLastTurn` when a card actually shipped; strip `suggestNode`/`moveToTitle` from `r` before the `conversation.update`. (d) Persist a yielded discovery as a pending ghost node, so it is permission-gated like everything else and survives reload. (e) Keep the gap-check chip visible whenever there are no unapproved ghosts.

---

## 2 · Completion certifies seed depth as mastery

**The moment.** Maya, one 20-minute burst: two seeded branches, ~8–12 checkpoints, crown on the root, 🏆 badge, golden "Consolidated" card, Forest entry, "1 problem mastered" on the dashboard. She has never met microstates counted quantitatively or Gibbs free energy. 林小雨 gets the same seal on 神经网络 without ever seeing 链式法则.

**Vision.** *"The point is to make a beginner at a specific problem a thorough expert by the end of a session."* / *"A fully verified tree = a mastered problem."*

**Code.**
- No growth floor and no coverage check: `tree-engine.ts:1558` `if (remaining === 0)` → `:1569` `status: 'completed'` → `:1573` `awardXp('chapter_completed')` (CAS, once ever). `countMasteredTrees` (`badges.ts:194-201`) qualifies on `nodes.length > 0 && every(understood)` — one verified node qualifies.
- Per-node ceiling: syllabus promises 3-5 sub-points, hard-capped at 6 by `parseQuizState` (`mastery.ts`, `.slice(0,6)`), and the contract is frozen on first intro (`chat/route.ts`, `// contract already set — keep its progress`) — an hour of deep chat cannot raise the bar.
- Depth-blind: `masteryMet`/`markNodeVerified`/the completion count never read `tree.difficulty`. A **professional** ("real-life deployable understanding") tree completes with an empty `progressLog` and zero artifacts. (`sessionDirectives` does raise the judge's bar on short answers — it changes how hard the *words* must be, never the *kind* of evidence, and never what completion requires.)
- Self-declaration door: `dashboard/tree/page.tsx:214-228` PATCHes `{status:'completed'}` with **no verification precondition**, and `dashboard/page.tsx:73` counts `status === 'completed'` for the "Problems mastered" tile — the one counter that does *not* apply the all-verified predicate that `portfolio/page.tsx:114` and `badges.ts:196` both enforce. No UI ever writes `status:'active'` back, so the tree is stuck; `POST /review` then 404s ("No verified nodes to review yet") for exactly the trees marked early.
- One correction to an earlier read: the Forest entry is computed live, so approving a new node makes it *transiently* disappear and self-heal — a trust wobble, not destruction. What is genuinely one-way is the completion XP and the card losing its progress affordance.

**Fix.** Persist the seed's PLAN pillars on the tree and gate completion on pillar coverage, not node-table exhaustion. Minimum viable today: no auto-complete for a tree that never grew past its seed; replace the silent flip with a learner-facing "every branch you grew is verified — is the problem actually solved?" with a Copilot gap-check as the primary action. Exclude self-declared trees from "Problems mastered." Add a Reopen action. Label the Forest by depth: **Explained** vs **Deployed**.

---

## 3 · The syllabus facet list *replaces* the branches instead of becoming them

**The moment.** David opens "Sensors & the Watering Trigger." The syllabus promises five bolded sub-points — capacitive vs resistive, ADC ranges, calibration drift, hysteresis, duty cycle. In the vision those are five branches, each with its own workspace, notes and evidence. Instead they are five bullets; five answers later the node is green and the tree still has no children. He asks the Copilot what's next; there is nothing below.

**Vision.** *"Each part of the resolution may touch on different fields and technical understandings, **which form the further branches of the trees**."*

**Code.** The `[NODE_INTRO]` prompt (`chat/route.ts:567`) says: *"If this node already has child nodes in the tree above, use those as the sub-points; otherwise **lay out the facets an expert would break this into**"* — on a fresh seed the second clause always applies, and the expert decomposition is spent as prose + `[[SYLLABUS]]` verification contract. **No code path ever promotes a facet to a node** (creators are: seed, copilot ghosts, split/rebalance/add_child). The AI performs exactly the decomposition the vision asks for and then discards its structure.

Same prompt also contradicts itself: the contract is declared to contain *"no facets belonging to other nodes"* while clause one tells it to build the contract *from child titles* — and the SCOPE rule then forbids testing child-owned material. Frozen contracts mean any node the learner later grows leaves its parent permanently unprovable-as-written; `branchCoverage()` reads ancestors only (`nodePath(...).slice(0,-1)`), so Bob cannot even see the overlap.

**Fix.** When `[[SYLLABUS]]` lands, offer its facets as one-tap **pending ghost children** ("these are the pieces — grow any into its own branch"). Facets the learner grows leave the parent's contract (the `rebalance` machinery in `node/[nodeId]/route.ts:209-241` already does this move); facets they don't stay as in-node checkpoints. Drop the child-title clause; add children's `contextSummary` to the prompt as a "covered ABOVE" block.

---

## 4 · Verification can advance without the evidence it claims

Verification *is* the product's trust asset ("certifies verified understanding, not attendance"). Six independent ways it currently advances on something other than a proven facet:

1. **Blind facet stamping.** On every `[NODE_CHECKPOINT]` turn, an untagged card gets `quizStateNow.facets?.find(f => !f.done)?.name` stamped onto it server-side (`chat/route.ts`, and again in `authorCheckpoint`). Nothing checks that the question probes that facet. The route runs a whole Haiku call to lint whether a checkpoint is *recitable*, and never once asks whether it probes what it's tagged with.
2. **The untagged backstop flips facets outright.** `quiz/route.ts:228-232`: two consecutive `unresolved` correct answers → `tally.facets.find(f => !f.done).done = true`, with `coverageAdvanced = true` suppressing the honesty note. Maya's "Quiz me" and free-chat turns are not `isCheckpoint`, so this is a common path, not an edge case.
3. **Hinted and massed credit are indistinguishable from earned credit.** The 💡 Hint is pure client state and is **not in the POST body**; `attempts` is tallied and never consulted by `masteryMet`. A wrong answer fires `[NODE_REMEDIATE]` — a 700-word textbook explainer of exactly that gap — and the very next checkpoint targets "the NEXT UNDONE facet," often the one just taught. This directly contradicts the app's own stated anchor: *"delayed, first-attempt, unhinted correctness is ground truth."* The flip is one-directional by design and writes a `knowledge` insight at **confidence 0.95** that the analogy bridge and portfolio then build on.
4. **The contract itself is one best-effort shot.** `[[SYLLABUS]]` must be the **last line** of the longest turn Bob ever writes, under `max_tokens`; capture is `if (names.length >= 2)` + `catch { /* malformed — static fallback governs */ }`, and the intro can never re-run (`workspace/page.tsx` fires `[NODE_INTRO]` only when `messages.length === 0`). A truncated 中文 intro silently downgrades that node to the 3-answer fallback — while the UI keeps promising "Prove every point of this node's syllabus." Contrast the CHECKPOINT GUARANTEE, which gets retries and a visible fallback note; the artifact the whole model rests on gets none.
5. **Copilot structural ops corrupt contracts.** Merge builds a combined facet map and writes it raw, but every read runs `.slice(0,6)` — merge 4+4 and two unproven promises vanish, then `GET /api/tree/[id]` promotes the node on the next load. Rebalance may leave 1 facet; below 2 the contract nulls and the node falls back to `qs.correct >= 3` where `correct` was inflated by deepening/unresolved answers — a stuck node can verify from a single chip tap with zero new answers.
6. **Two of three promotion paths skip every side effect.** Everything that makes verification *mean* something (the `knowledge` insight, `markStrugglesResolved`, `objective_mastered` XP, and the **only** tree-completion check) lives inside `markNodeVerified`, called from exactly one site — `quiz/route.ts`. The GET reconciliation path and merge write `status: 'understood'` directly. So a learner can verify their last node via merge and get no crown, no completion, no insight; and the reconciliation path — the designated repair for a failed `markNodeVerified` — permanently loses the effects it exists to repair.

**Fix.** Never stamp a facet the model didn't name (ask the cheap model which facet a card probes, or re-author with the facet embedded). Replace the untagged backstop with a stall directive to Bob and a visible note to the learner, never an automatic flip. Send `hintUsed`; store `{firstAttempt, hinted, msSinceRemediationOnThisFacet}`; a hinted or immediately-post-remediation credit becomes `provisional` and needs one clean re-probe (the 3-hour retest machinery already exists). Emit `[[SYLLABUS]]` **first** in the intro, add a re-derive pass + a learner-visible "Rebuild syllabus" action. Enforce the 6-facet cap at write time; require rebalance to leave ≥2; reset `correct` when a contract is dropped. Extract `applyVerificationEffects(nodeId)` and call it from all three promotion sites, idempotently.

---

## 5 · The adaptive layer is switched off during the exact loop the product designs

**The moment.** Robert answers four checkpoints wrong in a row on "What the yeast is doing" — textbook wheel-spinning. He gets four cold, identical-feeling remediations: no analogy from anything he's proven, no check of the unverified parent node, no "I'm changing approach," and not one perseverance XP toast. Maya, who types "wait what" twice between two *correct* MCQs, gets the full support cascade she doesn't need.

**Vision.** *"On a wrong or shaky answer: the wall. That single answer is diagnostic."* Plus the constellation's own thresholds — analogy bridge at 2+, wheel-spinning escape at 4+.

**Code.** Two compounding defects:
- `chat/route.ts:262` — `if (!isTrigger) {` wraps the **entire** reflection block. `isTrigger` covers `[NODE_INTRO] | [NODE_REVIEW] | [NODE_CHECKPOINT] | [NODE_REMEDIATE]`. So the analogy bridge, prerequisite backward-chain, misconception refutation, wheel-spinning escape, SUPPORT-FIRST and perseverance XP are all dead on the remediation turn — the one turn the bottleneck law exists to produce. `reflectionBlock` is `''` there. And `getTopInsights` is the *only* route from insight memory into the workspace prompt, so remediation runs with **zero learner memory attached**.
- `streakWrong` — the integer every threshold reads — is produced **only** by `haikuReflect` from a typed message (`"<prior+1 if this message shows confusion…>"`). `QuizState` has `combo`, `sureWrong`, `missed`, `untaggedStreak` and **no consecutive-wrong field**; `quiz/route.ts` never writes reflection state. Wrong checkpoint answers — the app's own ground truth — cannot move it. The 4+ escape is effectively unreachable from the primary loop.

**Related:** the remediation itself is owed by a **client `setTimeout`** (`workspace/page.tsx:675-696`, cleared at `:262` on node switch, guarded on `nodeIdRef`). Close the tab, click another node, or lose the judge response (`catch` at `:697-711` returns before scheduling) and the law-mandated textbook explainer never happens — while the miss is durably recorded as tally, XP, struggle insight and retest debt. (The learner does still get the persisted 1–2 sentence distractor refutation; what's lost is specifically the full-depth teaching the law promises.)

**Fix.** Two lines of leverage: add `wrongStreak` to `QuizState` (increment in `applyOutcome`, zero on correct — one line next to `tally.combo = 0`), and compute `streakWrong = max(reflection.streakWrong, quizState.wrongStreak)` in the chat route. Then let trigger turns — `[NODE_REMEDIATE]` above all — consume the analogy/prereq/misconception/wheel blocks, assembled from persisted state (no student utterance needed). Pay perseverance XP on consecutive wrong checkpoints. Persist `quizState.remediationOwed` server-side and fire `[NODE_REMEDIATE]` on mount when a debt exists.

---

## 6 · The learner's work reaches teaching but never judging

**The moment.** David uploads the photo of his wired breadboard: *"pump runs off the relay now, sensor reads 620 dry / 310 wet."* Bob reads it and praises it. Then asks him a multiple-choice question about Ohm's law to decide whether he understands the node. His churn trigger, verbatim from persona.md, is "being taught what he already proved."

**Vision.** Mode, verbatim — files and products *as an answer to* "do you understand this point."

**Code.**
- Judging path: `quiz/route.ts` rejects anything not `mcq`/`short`; the checkpoint card (`workspace/page.tsx:868-965`) has no attach control; `judgeCheckpointAnswer` gets no evidence block; `markNodeVerified` (`tree-engine.ts:1443-1520`) never queries `LinkedFile` or `progressLog`.
- Nothing solicits it: `uploadEvidence()` (`workspace/page.tsx:527-557`) POSTs and re-fetches the list — no chat turn, no Bob reaction, no toast. The workspace prompt's only mention of files is defensive (`:509`). The "BE A BUILD PARTNER… ground every proposal in the student's actual artifacts" instruction exists **only in the Copilot prompt** — the surface qa-findings §4 says Robert would never discover.
- Worse: the syllabus's "You'll be able to" section (3-4 doing-objectives, `chat/route.ts:570`) is **never part of the contract** — `:580` builds facets from the "What you'll cover" sub-points only. So the node makes doing-promises that are never probed at all.
- Cross-node blindness: `evidenceLocker()` selects `{name, content, workId}` and **drops `analysis`**, rendering every image as *"binary/image, content not inlined"* — beneath a header ordering Bob to *"ground every number and claim in these; NEVER invent measurements when evidence exists."* Photos are the dominant artifact for three of four personas, so the tree-wide evidence layer is blind to nearly all real evidence, and the strongest anti-hallucination instruction in the codebase is issued over an empty table. (It also fetches multi-MB base64 `content` purely to discard it, on every chat turn, explainer and digest.)
- `progressLog` is write-only: it feeds a read-only Build log tab (`workspace/page.tsx:1277-1292`), the side panel, copilot recall and the digest — and reaches no XP, facet, badge or portfolio. `xp-engine.ts:118-119` already defines `project_milestone: 75` and `project_completed: 400`; **neither is ever awarded anywhere**. A lucky MCQ guess pays 15 XP; shipping the thing pays 0.
- The portfolio inherits all of it: `linkedFile.findMany` selects `{name, workId, addedAt, workType}` (`portfolio/generate/route.ts:92-95`), renders `Evidence files: IMG_2013.jpg`, and instructs the model to cite *"a real artifact"* — the one place this otherwise rigorous prompt is set up to fabricate. `progressLog` is never queried. The schema has no artifacts key. (Also: `model: 'claude-opus-4-8'` hardcoded at `:176`/`:248` — that's currently the same id `CHAT_MODELS.opus` falls back to, so not broken today, but it violates CLAUDE.md's resolver rule and will silently miss the next Opus release.)

**Fix.** Add a third checkpoint kind — `artifact`. The pieces already exist: mount `useAttachments` on the card, run uploads through `analyzeAndPersistAttachments` with `workType: 'tree-node'`, pass the analyses into `judgeCheckpointAnswer` as an EVIDENCE block with a rubric clause, and let a pass flip its facet exactly like a short answer. Gate by depth: optional at Beginner, at least one artifact facet at Intermediate+, and require a non-empty build log before a **professional** tree flips to completed. Add `analysis: true` to `evidenceLocker`'s select and split the query so base64 stops crossing the wire. Post uploads as chat turns so Bob reacts. Award `project_milestone` on genuinely new progress entries; feed the aggregated log into the portfolio with an `artifacts[]` section.

---

## 7 · The full answer is never assembled, and the moment of mastery has no author

**The moment.** Robert verifies his last node. A green "Node verified! 🎉" flashes and is **destroyed after 2200 ms**. Bob — who narrated every other turn — says nothing. He clicks the root expecting the payoff (*how do I actually bake a reliably good loaf, given everything I just learned*) and gets a title, a summary, and nothing to open. He asks the Copilot; it answers in two sentences and points him at a node he already finished.

**Vision.** *"For the last one, you would need the full solution… You need this entire tree to understand the full answer to this problem."*

**Code.**
- The root is denied every teaching surface by law: chat 400s, quiz 400s, no Open-workspace button. Its 'understood' status is set by an `updateMany` as bookkeeping — no learner-facing act.
- The only whole-tree surface is prompt-capped against synthesis: *"RADICAL CONCISENESS… 'reply' is 1-2 SHORT sentences MAXIMUM… NO teaching in the reply"* (`tree-engine.ts:1048`), plus *"Never re-teach what an existing node already owns — point to that node instead."*
- The near-miss, the Tree Digest, is built from **node titles, statuses and checkpoint counters** — it never reads `summary`, `explainer` or `contextSummary` (contrast `branchCoverage()`, which reads `contextSummary` precisely because FOUNDATION defines it as "a distilled digest of what that node proved and taught") — yet it is ordered to write *"Findings — what has been established"* with *"no invented data."* Only `## Key numbers` is hard-guarded. This is the only artifact a learner can hand to another human.
- Verification-moment code: `workspace/page.tsx` gates the continuation on `if (!verified)`, so the prompt branch telling Bob to *"congratulate briefly and point to the next unverified node"* is **unreachable dead text**. `treeCompleted` is returned by the quiz route and read **nowhere** in any client file. `evaluateAndAwardBadges` runs only from `/api/xp/summary`, called only by `XpPanel`, mounted only on `/dashboard` — so verified-node badges never fire where they're earned. There is no next-node affordance in the workspace; the only exit is a 16px back arrow.

**Fix.** (a) Fire a `[NODE_VERIFIED]` trigger turn — mirror of `[NODE_REMEDIATE]` — where Bob restates the proven facets as capabilities, ties them to the root problem, and names the next node with a button. Make the verified card persistent. (b) Generate a **ROOT ANSWER** on completion from the verified nodes' `contextSummary` digests: the resolution assembled in the session's language/purpose/depth, each claim tagged to the node that proved it, with an honest boundary of what is still unproven. Exempt it from the Copilot's concision cap; render it as a document, annotatable and exportable; feed it to the portfolio. (c) Feed the digest each node's `contextSummary` and hard-guard `## Findings` the way `## Key numbers` is guarded. (d) Read `treeCompleted` in the client.

---

## 8 · The order is still teach-then-test

**The moment.** David (Intermediate, real spreadsheet fluency) opens "Power budgeting." The intro commits five facets **before asking him anything**; his prose reply already demonstrates two of them. He still sits through five judged checkpoints, two of which re-prove what he just showed.

**Vision.** *"competence is established by demonstration first; explanation is deployed reactively, exactly where — and only where — a gap was just proven to exist."*

**Code.** The contract is authored on the turn where *"the student just arrived; they have NOT spoken"* (`chat/route.ts:550`), from `node.title`/`summary` alone, then frozen (`// contract already set`). Coverage advances only via a tagged correct checkpoint; nothing can pre-satisfy or prune a facet. Meanwhile the only code-level enforcement of the bottleneck law runs the *opposite* way: the route **drops** any checkpoint Bob emits on the intro and excludes the intro from the checkpoint guarantee — so the first probe is guaranteed to be un-judged prose. Combined with qa-findings §1 (~600-word intros), the ask-first law is implemented as: lecture the plan, then ask a fixed quota derived from the lecture.

**Fix.** Let the diagnostic write the contract. Lift the intro suppression for a single opening *real* checkpoint; allow a facet to close on any judged answer that proves it; make the contract amendable once, post-first-probe; add a credit path so a facet already proven in an ancestor's `contextSummary` closes without a redundant card.

---

## 9 · The moat never touches the workspace

**The moment.** 林小雨, day 20, sixth tree, twelve verified nodes. She opens a node and asks 「那在数学上到底发生了什么？」. Bob's prompt contains her session-start sentence 「金融专业，会一点Excel…」 verbatim, exactly as on day 1, and **nothing** about the eleven concepts she has since transfer-proven.

**Vision.** *"Insight memory (the moat): Bob's curated long-term memory of the learner… Preserve it in every future change."*

**Code.**
- `studentGrounding()` — the only function that injects insights into a Tree EDU prompt — is called at **exactly two sites** (verified: `grep -rn "studentGrounding" src/` → `tree-engine.ts:139` def, `:297` seed, `:1354` explainer, which early-returns a cached explainer so it runs once per node ever). Zero calls from the node chat route, `copilotTurn`, `judgeCheckpointAnswer`, `proposeExpansion`. The workspace's entire learner-specific content is `sessionDirectives(tree, lang)` — four immutable columns from the onboarding stepper. The QA run's "calibration to the learner is real" was measuring the onboarding form, not the moat.
- `misconception` is **write-only**: rows are created, reinforced and resolved, but no teaching prompt reads them back. The only typed fetch is `['knowledge','strength','interest']`. Worse, `markStrugglesResolved` clears misconceptions by **node-title keyword match**, so verifying an adjacent node retires a belief no checkpoint ever probed. Repair theory's whole claim is that these survive practice.
- Acquisition is negatively biased: a struggle is written on **every** wrong short answer; a `knowledge` row only on **full node verification**. `scoreInsight` ranks a 3×-observed struggle (~0.90) above fresh verified knowledge (~0.80). So the analogy bridge queries `knowledge/strength/interest` and finds nothing for exactly the learners it exists for — and the "What Bob knows about you" panel renders a beginner's portrait as a misses-first deficit report, with no dismiss or dispute control.
- Extraction is gated on `count % 5 === 0` over the conversation's **total** message count — and `quiz/route.ts` writes two messages per checkpoint into that same conversation while never calling the extractor. Checkpoint traffic inflates the gate it can never satisfy. Trace of the designed loop: intro→1, typed answer→3, checkpoint→5 (quiz route, no extraction), trigger→6, →8, →9, →11. The extractor is evaluated once and fires zero times across a complete node. Over 30 days the memory converges to "Verified understanding of \<node title\>" ×N — a moat containing nothing a `SELECT` on TreeNode couldn't reproduce.

**Fix.** Call `studentGrounding(userId)` (token-clamped, ~8 rows) in the node chat prompt and in `copilotTurn`, next to `coverageBlock` — same purpose, and budget is not the obstacle against a prompt already carrying 2500 chars of explainer. Add a standing misconception block (unconditional, not gated on `isTrigger`). Write a `knowledge` insight on every **correct own-words short answer** — a rubric-judged pass is the lowest-hallucination input the extractor will ever see, and today it is the one input it never receives. Gate extraction on substantive turns, not total messages. Require a correct tagged checkpoint before resolving a misconception.

---

## 10 · Depth-seeking is scored as confusion

**The moment.** 林小雨, 18 minutes into 「反向传播到底在算什么」, asks her third 为什么: 「那在数学上到底发生了什么？链式法则是怎么把误差传回去的？」 She understands the analogy; she is refusing to stop there. Haiku reads three probing questions as three confused turns. Bob opens with 「别担心，这部分确实不容易」 (condescension — churn trigger #1), re-teaches with **another analogy** instead of the mathematics she asked for (churn trigger #2), ships **no checkpoint** that turn so her node cannot advance, suggests she move *down* a node, and a rose-pink 「坚持不懈 +15 XP」 toast rewards her for struggling.

**Vision.** *"The default mode is ASKING… only teaches when a question reveals a genuine bottleneck — a wrong or shaky answer."* A follow-up question is not a wrong answer.

**Code.** One integer decides all of it: `"streakWrong": <prior+1 if this message shows confusion/an incorrect idea, else 0>` — no distinction between "cannot follow" and "wants the mechanism." At ≥2 it fires SUPPORT-FIRST (*"No checkpoint question this turn"* — verified in the reflection block above), the analogy bridge (*mandates* an explicit analogy), the prerequisite chain (recommends leaving the node), and perseverance XP. At ≥4 it forces "switch intervention entirely." Independently, one Haiku read of one message can persist a `misconception` Insight row tagged with the node title. Her under-confident 不确定 taps push the same interpretation.

**Fix.** Split the signal in `haikuReflect`'s schema: `confusion: 0-3` vs `depthPush: boolean`. Gate every escalation on `confusion` only; on `depthPush` do the opposite — go deeper in the same representation, keep checkpoints coming, never open with reassurance. Require `timesObserved ≥ 2` or a wrong checkpoint before *creating* a misconception row.

---

## 11 · The visualiser isn't a summative logic diagram, and the annotation promise has no writer

**Vision.** *"It should look like a summative logic diagram (each node or vertex should have its own simplified description)… with freedom to annotate AI generated comprehensive explainers/summaries."*

**Code.**
- The seed prompt tells the model the summary *"appears ON the node in a logic diagram"* (`tree-engine.ts:328`). The canvas renders **title only**, deliberately: `// Title only — the summary lives in the side panel on click`. Node *kind* — the root/solution/component/leaf taxonomy that carries the vision's semantics — is conveyed by dot size and colour with no legend. `tree.framing` is never rendered on the tree page at all. The workspace header shows node title + tree title: no ancestor path, no parent, no summary — `nodePositionBlock()` computes "where this node sits toward the root" **exclusively for the model's prompt**. Robert sees six unlabelled dots with 3-word captions.
- The list view — the only workable phone surface, and the one FOUNDATION calls "a searchable list view carrying each node's full record" — sorts by `depth → title.localeCompare`, interleaving unrelated branches alphabetically, and renders **no `pathIndex` at all**. Meanwhile the canvas *hides* the learning-path number on every verified node, so the numbered sequence disintegrates precisely as the learner succeeds. (Supporting: `X_GAP = 185` < `NODE_W = 190`, so adjacent leaf cards touch by construction before jitter; client-side branch collapse mitigates but doesn't fix.)
- Explainers **cannot be annotated**. Chat messages are wrapped in `HighlightableText`; both explainer renderers (side panel and fullscreen) render `<MarkdownRenderer>` bare. `case 'annotate'` in `node/[nodeId]/route.ts` has **no caller**, so `TreeNode.annotations` has no writer — and three surfaces read it: the copilot work catalog counts `${ann} explainer-notes` (always 0), copilot recall serves `**Explainer annotations**` → `(none)`, and the portfolio builds `Annotations:` from it while never querying `MessageHighlight` at all. 林小雨's persona says verbatim: "annotates explainers."

**Fix.** Render `summary` on the node (2-line clamp at readable zoom), add a kind legend and the framing as a root caption, put the root→parent breadcrumb in the workspace header. Order the list view by the `pathIndex` pre-order and show step numbers; keep the number on verified nodes (dim + ✓). Wrap both explainer renderers in `HighlightableText` writing through `action: 'annotate'`, and let the portfolio read `MessageHighlight` comments.

---

## 12 · The first tree every user ever grows has no purpose

**Vision.** *"the **purpose** behind it (what the learner will do with mastery — this defines 'relevant' for the whole session)"* · *"The global first-run interview ends with the bolded question… whose answer plants the first tree."*

**Code.** `dashboard/onboarding/page.tsx` posts `{ problem, lang, difficulty, personalContext }` — **`purpose` is never sent**, and the interview prompt never asks for one. `difficulty` is substituted with the interview's *global rigor* answer, not this problem's explainable↔deployable target; `personalContext` is aspirations + strengths. `sessionDirectives` emits the purpose block only `if (tree.purpose)` — so for the first and most-used tree of 100% of accounts, the sentence defining RELEVANT is **absent from every seed, chat, explainer and checkpoint prompt forever**, while `GOAL_NECESSITY` and the seed PLAN pass are asked to reason from it. `handleBuildFromConversation` will fall back to "the student's last substantial message" as the root problem. The only repair is the Copilot's `set_purpose` — the surface qa-findings §4 says these users never find. Separately: nothing ever vets the root problem (`api/tree/route.ts` rejects only an empty string), and the product's only `clarify` mechanism lives inside `proposeExpansion` — the function with zero callers. Tree EDU will clarify a 15-minute branch request and never the root that governs the whole session.

**Fix.** Add the purpose question and the depth question (in explainable↔deployable terms) to the first-run interview and pass both to `/api/tree`. Refuse to seed a vague root — one clarifying question back, reusing the existing `clarify` contract. Surface a lightweight "set the purpose" prompt on any tree with `purpose === null`.

---

## 13 · Continuity across days

- **No compaction anywhere.** Node chat loads 40 messages and hands the model `.slice(-20)`; nothing summarizes what falls off, and the node's own `contextSummary` is never injected into its own prompt (`branchCoverage()` walks ancestors only). A returning learner gets an old transcript scrolled to the bottom and no orientation turn — `[NODE_INTRO]` fires only when `messages.length === 0`. (Mitigating: the cached explainer and the ✅/⬜ facet map *are* injected every turn, so the node's contract survives; what's lost is everything **taught and asked** in messages 1..n-20.)
- **`Conversation.summary` is hijacked.** The only writer for `tree-node:` conversations is `chat/route.ts:391-394`, storing `JSON.stringify({ lastReflection: r })`. `tree-context.ts:194` then reads that exact field and pushes it to the Copilot labelled *"Earlier-conversation summary"* — so recall spends up to 900 chars per node on `{"lastReflection":{"state":…,"gapDepth":"partial","streakWrong":1,"directive":"re-explain from a new angle"…}}`, in English, including tutor-facing directives every other prompt insists Bob never mention. (`node.contextSummary` is pushed first, so recall isn't empty — it's confusing and leaky.) The Copilot is the last reliable growth path in the product, and it is planning the tree's future shape from a stale one-turn diagnostic.
- **Abandoned nodes manufacture gaps** *(inference, not verified at runtime)*. `refreshNodeContextSummary` is scheduled on the intro turn, when the only assistant message is the syllabus and `teachingExcerpts = []`, and asks Haiku for *"**Established here** — the specific concepts this node actually TAUGHT (what an upper node may reference in one clause and must not re-explain)."* That result is read verbatim by descendants under the header *"ALREADY COVERED BELOW ON THIS BRANCH — the ground the student climbed to get here"* + `NO_REDUNDANCY`. Counterweights exist (the prompt is told "opened, not yet verified," and demands separate **Proven** / **Still open** sections). Confirming requires inspecting stored `contextSummary` rows where `quizState.attempts === 0`. Either way the structural fix is right: render unverified ancestors under a **"PROMISED BUT NOT YET PROVEN — teach it if this node needs it"** header, and scope `NO_REDUNDANCY` to verified ancestors.
- **Redundancy fires over ancestors that taught nothing.** `nodePositionBlock` returns `''` only at the root, so `coverageBlock` is truthy for **every** workspace node, and the intro prompt gates on it: *"**Building on what you've covered** — 1-2 sentences that NAME the specific points the branch below already established… quote its actual content."* On Maya's very first node, 30 seconds in, Bob is required to open by naming specific points she has never covered, sourced from a section whose only entry is the root (which by law can never have a workspace). Fabrication pressure at the highest-stakes moment, invisible to QA because a plausible fake callback reads as the law working. Gate that section on `sections.length > 0` and exclude the root from the ancestor list.
- **Review decay is disarmed.** The nudge selects nodes on `TreeNode.updatedAt > 7 days` — a row timestamp bumped by the background `contextSummary` refresh and the pending-card CAS, so *non-learning* activity silently resets the decay clock. The nudge and `POST /review` also pick **different nodes** (`updatedAt` vs `quizState.reviewedAt`). And review XP bypasses the anti-grinding discount with no due/spacing gate — `isVerifiedNode && !isReview ? base*0.25 : base` — so a consolidated 30-node tree is a repeatable full-rate XP source, exactly what the 25% discount was built to prevent. Derive `dueAt` from `reviewedAt ?? verifiedAt` with an expanding interval; unify both pickers on it; pay full XP only when actually due.

---

## 14 · Destructive ops lose learner work

- **Spin-off** — sold as the *preservation* alternative to delete — sets the node `parentId: null, kind: 'root'`. The record stays readable in the list view (which expands any node), but three things are permanently lost: **continuation** (chat route 400s, workspace bounces the deep link), **any further verification or review** (quiz route 400s), and **all progress accounting** — every counter excludes `parentId: null` (`api/tree/route.ts:51`, `badges.ts:198`, the tree page), so a node verified *before* spin-off silently stops counting toward node progress, mastered-tree badges and the Forest. The new tree also copies `language, difficulty, personalContext` but **not `purpose`** — so `sessionDirectives` reports no purpose forever and the Copilot is told "(not yet stated)". Fix: keep the spun-off node as the first child of a fresh root, and add `purpose` (+`accentColor`) to the create call.
- **Delete** removes the subtree's `notes`, `annotations`, `progressLog`, `explainer`, `quizState` and `contextSummary` with no soft-delete and no undo — while **orphaning** the conversations, highlights and `LinkedFile`s (not recoverable by the learner, not cleaned up either). The entire warning is *"Delete this node and every branch under it?"* — it names branches, never the notes, chat, files or verified status. Robert "sometimes double-clicks buttons."
- **Merge** transfers work correctly but clips silently: `annotations.slice(-40)`, `progressLog.slice(-40)`, `notes.slice(0, 20000)`, `missed.slice(-5)`, and the source node's cached **explainer is never copied** — it dies with the row. (The confirm *does* disclose re-proving; it discloses none of the clipping.) 林小雨's churn trigger is "lost notes"; the AI can regenerate an explainer, it cannot regenerate her marginalia.
- **Staleness:** `merge` correctly nulls `contextSummary`; `split`, `rebalance` and `edit` do not — and `rebalance` moves facets out without dropping the cached `explainer`, while the chat prompt orders Bob to "stay CONSISTENT with the node's explainer shown above."
- **No egress.** Settings → Export data still offers Release EDU categories ("Curriculum & Roadmap", "Projects & Assignments"), exports no tree/node/note/annotation/verification/file, returns `'Activity log export — full implementation pending'`, names the file `release-edu-export-….json`, and ignores the `format` param while advertising "Spreadsheet-friendly, includes files." Half the Mode paragraph is "a portfolio… recording"; the record cannot leave the app.

---

## 15 · Moments that break trust cheaply

- **The notes panel is a dead end below 1024px.** `showNotes` renders `fixed inset-y-0 right-0 z-40 w-full max-w-sm` while the only toggle sits in a normal-flow header row with no z-index — covered by the overlay. No close button in the panel, no backdrop, no Esc handler (the only Esc listener is scoped to the fullscreen explainer). On a 390px phone, one deliberate tap hides the chat — the only place mastery can be proven — with no exit. *(Geometric inference from the Tailwind classes; a 390px screenshot with `showNotes` true confirms it in seconds.)*
- **The turn's rhythm is wrong in both directions.** The card is hidden behind 1–3 model calls *after* the visible prose finishes: prose flushes at the `[[QUIZ]]` marker, then a **blocking** Haiku lint, then possibly `authorCheckpoint` (judge model, 2 attempts), then up to 4 sequential CAS round-trips — and the client can't render until the stream closes. On a `[NODE_CHECKPOINT]` continue the prompt orders a "3-6 word bridge," so Maya sees six words and a blinking cursor for seconds. Then the *opposite*: a 1500 ms timer force-fires the next probe, chat auto-scrolls on every token with no "user scrolled up" guard (Robert cannot re-read the question he missed), and `if (streaming) return` **silently swallows Enter**. FOUNDATION says "the learner needs room to actually absorb the explanation… Asking resumes once the learner re-engages" — a timer is not re-engagement.
- **The Honest Redirect hands out unverified URLs.** `recommendVisualResource` is a plain Gemini call with **no search grounding**, whose own prompt concedes *"if unsure of a deep link, give the site's search/landing URL that gets closest."* The only validation is `/^https?:\/\//`. The result is cached forever keyed by `sha256(fullPrompt)` — content-based, not user-scoped — and served to every learner who reaches the same teaching moment, with no revalidation and no expiry. The UI gives it maximum authority: primary amber card explaining Bob's deliberate judgment, generated image hidden behind "show anyway." Robert clicks it and gets a 404 at the exact moment the app made a point of being honest with him. A low-confidence image became a high-confidence dead end — strictly worse than the failure the law prevents.
- **The differentiator lint is blind to the explainer.** It compares the card against the last two *chat* messages only. `node.explainer` — the largest body of text the learner just read, and the artifact the law names ("a question answerable by reciting an explainer is a failed question") — is never passed, even though the repair-path author *does* receive it with the right instruction. Three fail-open paths: `catch { /* fail open */ }`, a bare `content[0].text` read (the hazard `responseText()` exists to avoid), and shipping a lint-**rejected** card verbatim when re-authoring fails. 林小雨's churn trigger is verbatim "checkpoints answerable by copying the explainer."

---

## 16 · Nothing enforces the laws, and nothing bounds the spend

- **Zero tests, zero evals.** No `*.test.*`, `*.spec.*`, `__tests__` or eval files anywhere; `package.json` scripts are dev/build/start/lint/seed. The only runtime law checks are the two checkpoint suppressions (which enforce *lecturing*) and the fail-open lint. `ANSWER_STANDARD`, `NO_REDUNDANCY`, `GOAL_NECESSITY`, remediation depth and facet-tag discipline are pure prompt text with no validator and no telemetry — while `getTeachingModel()` **auto-adopts the newest Opus/Sonnet** from the catalog. A model upgrade can silently change compliance with every law and no signal fires; the standing ship-to-prod directive means there is no gate between a prompt edit and a learner receiving lecture-first, recitable teaching.
- **Discovery — a node-producing decision — never sees the session.** `haikuReflect`'s parameters carry no `purpose`, `difficulty`, `personalContext` or `framing`, and `GOAL_NECESSITY` appears only as a compressed paraphrase inside a JSON field description. An approved card writes a **real node immediately** (`action: 'add_child'`), not a ghost re-validated by the teaching model.
- **No prompt caching, no rate limiting.** `grep -rn "cache_control\|ephemeral" src/` returns no call site — only the *pricing table* in `usage.ts` knows about caching. The node-chat system template is ~20.5k static chars, re-billed at full Opus rate on every turn. `grep -rn "rateLimit\|429\|throttle" src/` returns one unrelated client-side hit; middleware only checks that a NextAuth token exists; `usage.ts` is write-only telemetry read by an admin dashboard after the fact. The reflection pass — the most frequent call — records `userId: null`, so per-user spend can't even be attributed. Rough order of magnitude: ~$0.30/Opus turn → a verified node ≈ $3–5, a 3-node seed tree ≈ $10–15, the 10–15 node tree the founding paragraph actually describes ≈ $45–75, per learner, on a free consumer product with a Google login and no ceiling. **The cheapest learner is the one who stops at the seed; the most expensive is the one who does exactly what the vision asks.** Whatever throttle gets added under cost pressure will land on depth — the only thing separating this from a chatbot.

---

## Cheapest high-leverage moves, in order

1. **`chat/route.ts:518`** — stop naming a button that doesn't exist. One line, today. It is the app lying to a learner at the moment of curiosity.
2. **Wire the wrong-streak to the checkpoint loop.** Add `wrongStreak` to `QuizState` (one line beside `tally.combo = 0`), and `streakWrong = max(reflection.streakWrong, quizState.wrongStreak)` in the chat route. This alone makes the analogy bridge, prerequisite chain, wheel-spinning escape and perseverance XP reachable for Robert-type learners for the first time.
3. **Let trigger turns carry the adaptive blocks.** Move the analogy/prereq/misconception/wheel assembly out of the `if (!isTrigger)` guard and build it from persisted state — the remediation turn is precisely the turn those blocks were written for.
4. **Stop the two blind-credit doors.** Never stamp an unnamed facet; delete the untagged-streak auto-flip and replace it with a directive to Bob plus a visible note. Small diff, directly protects the product's central claim.
5. **Call `studentGrounding()` in the node chat prompt.** One call site. Turns the moat on in the surface where 95% of learning happens.
6. **Add `analysis: true` to `evidenceLocker`'s select** (and split the base64 query). One line makes the learner's photos legible tree-wide and stops multi-MB payloads on every turn, explainer and digest.
7. **Add the purpose + depth questions to the first-run interview** and pass them to `/api/tree`. Every account's most-used tree currently runs with the sentence that defines "relevant" missing from every prompt.
8. **Emit `[[SYLLABUS]]` first, not last**, and add a re-derive pass when a node ends up contract-less. Removes the silent downgrade to quota testing — worst for 中文 sessions.
9. **Fire a `[NODE_VERIFIED]` turn** and read `treeCompleted` in the client. The product's payoff moment currently has no author and lasts 2200 ms.
10. **Persist `remediationOwed` server-side** and fire it on mount. Stops the law-mandated teaching from evaporating with a tab.
11. **Close button + backdrop + Esc on the notes panel below `lg`.** One dead-end tap on the first screen, on the device half the audience uses.
12. **Add `cache_control` breakpoints and a per-user daily budget.** The ~20.5k-char static prefix is genuinely constant across a node's session; caching drops that input 10×, and the budget is what makes depth affordable rather than something you throttle later.

Then the two that require design, in this order: **a growth affordance in the workspace** (facets-as-ghost-children is the highest-fidelity version — it turns every node opening into a growth moment instead of a terminal one), and **a completion gate tied to the goal plan plus a ROOT ANSWER document**. Those two are what convert the current product — a well-instrumented, honestly-judged 3-node quiz engine — into the thing the founding paragraph describes.
