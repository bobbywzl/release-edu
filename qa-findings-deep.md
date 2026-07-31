# Deep Audit — Structural Misalignments with the Founding Vision

Second pass, after the four-persona QA run (`qa-findings.md`). This one hunts
misalignment between what **FOUNDATION.md's founding paragraph promises** and what
the code can actually deliver. Every claim below is backed by code I read or by a
live production session I drove. Findings already in `qa-findings.md` are not
repeated.

Live evidence base: Maya verified a complete node end-to-end (6 checkpoint
exchanges), Robert was driven into genuine wheel-spinning, David tested
goal-necessity and comparison, Xiaoyu tested 中文 integrity.

---

## A. The three structural gaps

### A1. The tree never produces the answer to the problem

> *"You need this entire tree to understand the full answer to this problem."*
> *"The resolution is then scrutinised."* — founding paragraph

Nothing in the product ever assembles the verified nodes into **the answer**. The
root deliberately has no workspace (root guard in the node chat/explainer/quiz
routes), the digest is a *status report*, and the portfolio counts verified nodes.

Live proof — Maya's own digest, after verifying her first node, says:
*"Root problem (formula-without-understanding gap) **remains unresolved**."* The
product can tell her what is unfinished but has no surface that ever says
*"here is why entropy always increases"* — the thing she came for.

**Fix direction:** a ROOT ANSWER artifact, generated from the verified nodes'
`contextSummary` digests when the tree completes (and on demand): the resolution
in the learner's own session language/purpose/depth, each claim tagged to the node
that proved it, with an honest boundary of what is still unproven. Make it the
completion moment, annotatable and exportable, and feed it to the portfolio.

### A2. "Candidate solutions to compare" quietly became "conceptual pillars"

> *"Initial solutions are the base branches from the root… given many solutions they
> need knowledge to give **evaluative comparisons**."*

The seed prompt (`src/lib/tree-engine.ts`, `seedTree`) says: *"Base branches are the
CANDIDATE SOLUTIONS **or FOUNDING CONCEPTS** … (real, distinct approaches **or
conceptual pillars** an expert would name)"*. That "or" is an escape hatch, and the
model takes it every time. All four live trees produced **decompositions, not
competing solutions**:

| persona | seeded branches | competing solutions? |
|---|---|---|
| Maya | Counting arrangements / Why increase / Reading reactions | no |
| David | Power budgeting / Switching / Sensing | no |
| Xiaoyu | 可调旋钮 / 损失函数 / 梯度下降 | no |
| Robert | Living colony / Gluten net / Reading the curve | no |

There is also **no comparison or decision surface anywhere** — no node type, no
chip, no artifact that records "I evaluated A vs B and chose B because…".

The capability is *proven to exist*: when David explicitly asked *"relay vs mosfet
vs something else? which should i pick and why?"*, the Copilot returned an
excellent evaluative comparison — three options with mechanisms, holding-current
tradeoffs, and a recommendation grounded in his 14-day battery constraint. **The
structure simply never asks for it.** A beginner who does not know that "relay vs
MOSFET" is a question never gets that moment — which is precisely the learner the
vision describes ("The user does not know the specifics of these initial
solutions").

**Fix direction:** when a problem genuinely has competing approaches, seed them as
competing branches and add a first-class **comparison node** (or a decision the
learner records on the root) that must be resolved before the tree can complete.

### A3. "Mastered" can certify the seed alone

`markNodeVerified` (tree-engine.ts ~1475) completes a tree when
`remaining === 0`, counting non-root, non-pending nodes. The seed prompt caps the
tree at depth 1 on purpose (*"Generate ONLY the root and these first branches —
NOTHING deeper"*), and growth only happens if the learner asks.

So a learner who verifies the three seeded branches and asks nothing gets: tree
`completed`, root auto-flipped green, the "Tree Mastered" XP bonus, the golden
Forest trophy, the *Problem Master* badge, and a portfolio line certifying a
mastered problem — **for a tree that never grew past its seed**. The vision's
branches and leaves ("technical knowledge or specific pain point solutions are the
leaves") never happened.

Measured cost of that certification: **~6 checkpoint exchanges per node** (Maya:
1 wrong + 5 correct on a 5-facet node), so a "mastered problem" is reachable in
roughly **18 exchanges**.

**Fix direction:** completion should require depth, not just coverage of what was
seeded — e.g. every seeded branch verified **and** each branch grown to at least
one learner-driven child, or an explicit "is the root question actually answered?"
gate before the trophy.

---

## B. Mechanism-level findings

### B1. "Thorough expert by the end of a session" is arithmetically out of reach

> *"make a beginner at a specific problem a thorough expert **by the end of a
> session**"*

Measured live: one 5-facet node = 6 checkpoint exchanges; each exchange is a
~80-word question + the learner's answer + ~30–40 s of judging + a verdict that
can run to ~700 words on a miss. The 3-node seed alone ≈ 45–75 minutes. A
vision-grade tree (root → solutions → components → leaves, 10–15 nodes) is
**3–6 hours**, necessarily spread over sittings.

The product has no concept of that campaign: no "you are 40% of the way to
answering your problem", no session boundaries, no resume plan, no estimate at
onboarding of what mastery will actually cost the learner. The founding sentence
sets an expectation the architecture cannot meet, and nothing manages that
expectation.

**Fix direction:** either scope "session" explicitly as a multi-sitting campaign
with visible progress toward *the answer* (not toward node counts), or add a
genuine express path (fewer, larger nodes) for learners who want the one-sitting
experience the sentence promises.

### B2. Sibling awareness is label-deep — personalization resets at each step of the path

`branchCoverage()` (tree-engine.ts:572) carries what a node's workspace actually
taught and proved — via each ancestor's `contextSummary` — but it walks
**ancestors only** (`nodePath(...).slice(0, -1)`). Siblings reach the prompt only
through `sketchTree()` (tree-engine.ts:409), which exposes `kind, status, title,
summary(100 chars)`.

Seeded trees are **flat siblings**, and the learning path walks them in order
(#1 → #2 → #3) — so *every consecutive step on the recommended path is a sibling*.

Live proof, both halves: node 2 opened with a perfect label-level callback —
*"You already verified at 'Entropy As Counting Arrangements' that entropy is a
count of microscopic arrangements"* — which reads beautifully. But Maya's actual
journey in node 1 (her "spread out vs counting" misconception, the confident-wrong
answer, the photos/gauge-reading analogy that finally landed, her own phrasing)
lives in node 1's conversation and `contextSummary`, and node 2 never reads it.

Consequence: the tree reads as one curriculum at the *label* level while the
learner model resets at each step — Bob can re-trigger a misconception that was
repaired next door, and cannot build on the analogy that just worked.

**Fix direction:** include verified **siblings' `contextSummary`** (they are cheap,
already written) alongside ancestors in `branchCoverage`, at least for nodes on the
same learning-path segment.

### B3. Growth has no engine for the learner who cannot formulate questions

The vision's growth sources are (a) explicit learner questions, (b) AI discovery
from *repeated* questions circling an uncovered field, (c) manual add. All three
require initiative. Robert-type learners ask no growth questions and repeat
nothing, so (a)–(c) never fire; the seed is capped at depth 1 by design.

The least self-directed learners — exactly the beginners the vision most wants to
carry to expertise — end with a permanently 3-node tree **and a mastery trophy**
(compounding A3).

**Fix direction:** the missing fourth source — after a node verifies, Bob knows
precisely what the next necessary pain point is (goal-necessity already computes
it). Offer it as a permission-gated ghost at the moment of verification, so the
tree grows from the *goal* when the learner cannot grow it from curiosity.

---

## C. Moment-level pain (only visible in live use)

### C1. The verification moment is a dead end
After *"🎉 Node verified — you proved genuine understanding through checkpoints"*,
the workspace offers **no next step**. The full interactive inventory at that
moment is: nav links, notes, files, annotations, build log, "Generate the
explainer". No next node, no return-to-tree, no "continue". The canvas *does*
update correctly (path advances to #2, progress 1/3) — but the learner must know
to leave. The highest-motivation moment in the product routes nowhere.

### C2. The interface contradicts the teacher during struggle
Robert's three confused turns produced an excellent wheel-spinning escape: Bob
dropped the abstraction, built a concrete three-jars model, and wrote **"Don't
answer any quiz yet. Just tell me back in your own rough words…"** — while the
pending **CHECKPOINT** card with a *Submit answer* button stayed on screen the
whole time. At the learner's most fragile moment, the screen and the teacher give
opposite instructions.

**Fix direction:** let a remediation/de-escalation turn visibly *suspend* the
pending checkpoint (dim it, or replace with "we'll come back to this").

### C3. Counters disagree across surfaces
Canvas reads **1/3**, the digest reads **"1 of 4 nodes verified"** (the root is
counted in one and excluded from the other); the coverage header reads **1/5
proven** while **two** rows carry ✅ (the own-words row is listed but outside the
denominator). Three different denominators for one learner's progress.

### C4. Teaching quality is not the bottleneck — reading load is
The bottleneck law is honoured in *order* (ask → teach on a miss) but not in
*volume*: ~600 words of intro before the first probe, ~700 words of remediation
after a miss. Bob's actual pedagogy is the strongest thing in this product; the
packaging is what will lose Maya.

---

## D. Cheapest high-leverage moves

1. **Route the win** — a next-step affordance on node verification (C1). Hours of
   work, protects the single best moment in the product.
2. **Suspend the checkpoint card when Bob de-escalates** (C2). Small, and it lands
   exactly where learners quit.
3. **One denominator** across canvas/digest/coverage (C3).
4. **Sibling `contextSummary` in `branchCoverage`** (B2) — one query change; makes
   the learning path feel like one continuous teacher.
5. **Post-verification growth offer** (B3) — reuses goal-necessity, fixes the
   passive-learner dead end and softens A3.
6. **The ROOT ANSWER artifact** (A1) — the largest of these, and the one that makes
   the product finally deliver what the founding paragraph promises.
