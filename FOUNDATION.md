# Tree EDU — Foundation

This is the canonical vision and product document for **Tree EDU**. It supersedes the
Release EDU foundation entirely.

> **⚠️ Tree EDU and Release EDU have COMPLETELY DIFFERENT structures.**
> Release EDU was big-to-small: broad subjects → tracks → courses → chapters, taught
> top-down from a generated curriculum. Tree EDU is small-to-big: ONE specific problem
> grows into a tree of understanding, expanding only through the learner's own
> questions. Do not reason about this product using Release EDU concepts (tracks,
> chapters, curriculum plans, L&C mode, lesson phase machines) — they no longer exist
> in the product. Legacy database tables remain only as dormant storage and must not
> shape new features.

## Vision (verbatim — the founding paragraph)

I want to create a revolutionary form of education. The point is to make a beginner at
a specific problem a thorough expert by the end of a session. This form of education
begins at a specific problem to solve, instead of a broad subject under which subtopics
and problems are taught. In other words, it goes from small to big rather than big to
small, like a growing tree — the meaning of this is expanded on below. This problem is
the root. Initial solutions are the base branches from the root. The user does not know
the specifics of these initial solution(s), and given many solutions they need
knowledge to give evaluative comparisons. The resolution is then scrutinized. Each part
of the resolution may touch on different fields and technical understandings, which
form the further branches of the trees. Technical knowledge or specific pain point
solutions are the leaves. In this sense, the app is not only project oriented but
should design an expanding tree as a "curriculum" to solve this specific problem, with
each "chapter" teaching the relevant topic to every point of a solution that is not
understood by a beginner. An example of this is a user curious on how to produce sweet
and plump strawberries consistently, or to design a mobile FPS game, or to fully
comprehend how one might implement a QFT gate on k-bits in real life. For the last one,
you would need the full solution, and then you would need sub-branches considering QEC
practical methods, the QFT logic gate theory and connection to classical fourier
transform (starting from Hadamard gate), etc. You need this entire tree to understand
the full answer to this problem.

## Mode (verbatim)

Tree EDU is an educative visualiser and a portfolio, respectively empowering and
recording specific problem-based learning.

The app is this tree creator expanding from one problem and one or a few solutions to
compare. This tree should be fully interactive with each node being a "pain point
explainer", including the user's own files and products as an answer to "do you
understand this point". It should look like a summative logic diagram (each node or
vertex should have its own simplified description), and should expand as users ask
more questions and give permission for it to be added to the tree, with freedom to
annotate AI generated comprehensive explainers/ summaries.

## The Goal (law — the master criterion)

> The goal should be to solve your issue and produce complete understanding as
> simply and efficiently as possible.

Stated verbatim. Everything below serves this sentence; every feature, prompt,
and learner-facing step is judged against its three parts:

- **Solve your issue** — the session exists to solve the learner's stated
  problem, not to cover a subject.
- **Complete understanding** — mastery of everything the solution needs,
  verified (syllabus coverage), never assumed — and nothing beyond what it
  needs.
- **As simply and efficiently as possible** — the shortest honest path there.
  Whatever doesn't move the learner toward solved-and-understood is waste:
  unnecessary nodes, repeated teaching, uncalled-for depth, extra steps,
  bloated context, redundant AI calls.

The laws in this document are its enforcement arms: Goal-Necessity (no
unnecessary nodes), the Answer Standard (no irrelevant or empty answers),
Per-Node Redundancy Avoidance (nothing taught twice), Bottleneck-Triggered
Teaching (no lecturing without a proven gap), syllabus-coverage verification
(completeness proven, not assumed). Before adding or changing anything, ask:
does it shorten or strengthen the path from problem to complete understanding?
If not, it's waste — leave it out.

## The Tree Model

- **Root** — the learner's specific problem, stated in their own words at session start.
- **Base branches** — the candidate solutions or founding concepts that answer it
  (1–3; seeded by AI, nothing deeper).
- **Branches** — components of a solution a beginner would not yet understand.
- **Leaves** — specific technical knowledge or concrete pain-point resolutions.
- **Growth is permission-based and discovery-driven.** The tree NEVER grows ahead of
  the learner's curiosity: new nodes come from (a) the learner's explicit
  "grow this branch" questions, (b) AI discovery — repeated questions circling an
  uncovered field produce a suggestion card the learner must approve, (c) manual
  add. Vague growth requests get ONE clarifying question back, not guesses.
- **Mastery is verified, never self-declared — and verification is SYLLABUS
  COVERAGE, not a count.** Verification lives IN the workspace chat: Bob asks
  Differentiator-principle **checkpoint questions** (MCQ and own-words short
  answers, AI-judged) as interactive cards while teaching. Each node's opening
  syllabus emits its sub-points as a **verification contract** (the facet map):
  every promised facet must be proven by a correct checkpoint before the node
  flips to "understood" — the syllabus may promise nothing it won't deliver, and
  the node may verify nothing the syllabus promised but never probed. The number
  of checkpoints is therefore dynamic — it tracks the syllabus (typically 3-5),
  never a static quota (3 correct remains the fallback only for nodes without a
  contract). At least one correct answer must be an own-words short answer —
  recognition alone never verifies. There is no separate test screen. A fully
  verified tree = a mastered problem.

## Goal-Necessity & Plan-First Growth (law — how the tree takes shape)

The tree exists for exactly one thing: to **thoroughly explain a concept or
product, or to solve a problem** — the GOAL the learner stated at the root.
That purpose disciplines every node the AI ever lays out:

- **Every node must be absolutely necessary for the goal.** The test, applied to
  each candidate node before it is proposed: *if the learner mastered everything
  else on the tree except this node, would the goal have a hole in it?* If not —
  if the node is merely related, interesting, adjacent, or "good background" —
  it does not belong on the tree. Nodes are load-bearing, never decorative.
  Fewer essential nodes always beat more nodes: every unnecessary node dilutes
  the learner's time and buries the path to the goal.
- **The plan comes before the nodes.** Whenever the AI lays out nodes — seeding
  a new tree, proposing growth under a node, copilot restructuring, discovery
  suggestions — it first **deeply analyzes the goal**: what does achieving it
  actually require? What would an expert name as the irreducible pillars? What
  does THIS learner (their purpose, background, target depth) need that a
  generic treatment would miss? Only after that deliberate plan exists are
  nodes laid out — and each node must be traceable to a requirement in the
  plan, never generated by free association from the topic.
- The two failure modes to design against: **topic-shaped trees** (nodes that
  survey the subject the way a textbook's table of contents would, regardless
  of the goal) and **unplanned growth** (nodes emitted directly from the ask
  without first working out what the goal requires).

Implementation: the `GOAL_NECESSITY` rule text in `src/lib/tree-engine.ts`,
injected into every node-producing prompt (seed, grow-box expansion passes,
tree copilot, discovery); the seed prompt additionally demands a written
PLAN pass — goal analysis first, nodes second — in the same call.

## The Answer Standard — Relevant & Informative (law)

Every answer Bob gives in the workspace must pass BOTH tests before it ships:

- **Relevant** — it answers the question the learner actually asked, scoped to THIS
  node and in service of the root problem. Not a survey of the field, not a lecture
  at a depth the question never called for. Depth is calibrated to what this problem
  needs — going deeper than the pain point is as irrelevant as staying too shallow
  to touch it.
- **Informative** — it always teaches the science underneath. A bare verdict, recipe,
  or fact ("use variety X", "yes, that works") is a failed answer even when correct:
  every answer carries enough of the mechanism or principle behind it (the WHY) that
  the learner gains transferable understanding, not a disconnected fact.

The two failure modes to design against: **too general** (a textbook chapter dumped
on a specific question) and **too specific** (an answer with no scientific background
that resolves the moment but teaches nothing). Every prompt that produces
learner-facing answers (node chat, explainers) embeds this standard — see
`ANSWER_STANDARD` in `src/lib/tree-engine.ts`.

## Plain Language, Intuition First (law — user directive, Aug 2026)

Everything Bob produces for the learner — node summaries, syllabi, explainers,
chat answers, checkpoint questions, the answer document — is written in the
simplest words that still carry the full idea:

- Short sentences, everyday wording, concrete pictures before abstractions.
  Build the intuition first (what it IS, plainly, with one concrete example),
  then name it precisely.
- Every technical term that must appear gets a plain-words unpacking in the
  same breath ("entropy — how spread out the energy is"). Never a hard word
  where a simple one carries the same meaning; never a word that doesn't earn
  its place.
- The goal is the FEWEST, SIMPLEST words that produce complete understanding —
  less and precise always beats more and complex.
- The session's depth calibrator raises DEPTH and rigor, never jargon density
  or wordiness: an advanced session still reads plainly, it just goes deeper.

**Structured & Short (companion clause, Aug 2026):** plain words alone are not
enough — a plain-worded four-page essay is still a wall. Everything Bob writes
is shaped for scanning:

- Bullets with bold lead-ins are the default body; prose paragraphs only where
  one flowing thought needs them, max ~3 short sentences, never stacked.
- Visible hierarchy in every substantial reply: one `##` title for the turn's
  topic, `###` subheads for its parts, bullets under them.
- Say it once: one explanation, ONE example or analogy per concept — never the
  same story retold; no preamble, no recap, no closing summary.
- Length budgets: a typical teaching turn ~150 words; a remediation deep-dive
  ~250; the explainer document 300-450. More only when the learner asks.

Implementation: `PLAIN_LANGUAGE` + `STRUCTURED_BREVITY` in
`src/lib/tree-engine.ts`, injected through `sessionDirectives()` so every
content-producing prompt in the session carries both automatically. The
renderer enforces the visual half: headers, subheaders (uppercase accent
kickers), and body text are typographically distinct on desktop
(`markdown-renderer.tsx`) and /m (`mobile.css`).

## Per-Node Redundancy Avoidance (law — the Answer Standard's companion)

Every node teaches ONLY its own new ground. A node's workspace — the opening
syllabus, the explainer, every chat answer — is aware of the WHOLE tree and of what
the workspaces of the nodes below it on the branch (its ancestors, root → parent)
already covered, and it **builds on** that material instead of repeating it:

- Material the branch below already established is referenced in one clause ("you
  already verified how water pressure swells the fruit at 'Soil, Water & Nutrients'
  — building on that…") and the teaching goes straight to what is NEW at this node.
- Re-explaining an ancestor's material is a failed syllabus and a failed answer —
  it wastes the learner's time, buries this node's actual content, and makes the
  tree read as a pile of disconnected lessons instead of ONE curriculum growing
  upward.
- The boundary holds upward too: material owned by a child or sibling node is
  pointed to, never absorbed (checkpoint SCOPE already enforces this for
  verification).

Implementation: `branchCoverage()` — a digest of what each ancestor's workspace
actually taught, plus `nodePositionBlock()` (where this node sits on the way to
solving the root), injected into the node chat and explainer prompts — and the
`NO_REDUNDANCY` rule text, both in `src/lib/tree-engine.ts`. To keep this awareness
from bloating every conversation with re-derived context, each node carries a
**continuously-updated context summary** (`TreeNode.contextSummary`): a distilled
digest of what that node proved and taught and its role toward the root, written by
a cheap background pass (`refreshNodeContextSummary()`, Haiku) after substantive
chat and on verification. `branchCoverage()` reads each ancestor's stored summary
instead of re-slicing its raw conversation messages on every turn (falling back to a
live derivation only for a node not yet summarized) — so a descendant's workspace
stays fully aware of the branch below and its own position without paying the token
cost of the whole history each turn.

## Bottleneck-Triggered Teaching — Capability-Oriented Learning (law)

Traditional education teaches first and tests after: a fixed lecture or chapter is
delivered to everyone regardless of what any individual already knows, and a quiz
at the end checks who was paying attention. That order exists because a human
teacher cannot continuously, individually diagnose thirty students in real time —
so content gets front-loaded to the whole group as a practical necessity, not
because it's the better way to learn.

**Personalized AI tutoring removes that constraint, so Tree EDU inverts the
order.** The default mode is ASKING, not lecturing: Bob probes with checkpoint
questions to find the exact edge of what the learner can already do, and only
teaches when a question reveals a genuine bottleneck — a wrong or shaky answer.
This is capability-oriented learning: competence is established by demonstration
first; explanation is deployed reactively, exactly where — and only where — a gap
was just proven to exist. This is only possible because an AI tutor can run this
diagnostic loop continuously, for every learner, at zero marginal cost; a human
teacher structurally cannot, which is why this order was never the default before.

**The mechanism, concretely:**
- **On a correct answer**: no lecture — there was no bottleneck to teach into. Bob
  bridges briefly and asks the next question. Asking continues until it hits a wall.
- **On a wrong or shaky answer**: the wall. That single answer is diagnostic — it
  names precisely which piece of understanding is missing. Bob's very next turn is
  a full, TEXTBOOK-STYLE explainer of exactly that piece — the misconception the
  answer reveals, the correct mechanism taught in real depth with a worked example,
  and the exact point where the learner's reasoning diverged from it. Not a
  one-line correction, not a re-explanation of the whole node — this is real
  teaching, scoped tightly to the one gap just found, under the Answer Standard
  (Relevant & Informative) and Per-Node Redundancy Avoidance above.
- **No checkpoint rides on that same teaching turn.** The learner needs room to
  actually absorb the explanation before being probed on it again — testing
  immediately after explaining defeats both the Differentiator Principle and the
  point of teaching at all. Asking resumes once the learner re-engages.

Implementation: the `[NODE_REMEDIATE]` client trigger (alongside `[NODE_CHECKPOINT]`)
in the node chat route — the workspace fires it instead of the next-checkpoint
trigger whenever the answer just judged was wrong, in `src/app/dashboard/workspace/page.tsx`.

## Visual Confidence & Honest Redirect (law — a chat-wide directive)

A bad diagram is worse than no diagram: it teaches the error. So every visual
Bob produces is governed by an honesty loop, in all cases:

- **Self-evaluation with a visible confidence bar.** Every generated diagram is
  scored by the AI itself — does this image accurately and clearly deliver
  exactly what was requested, well enough to teach from? The score ships to the
  learner as a confidence bar under the image; wrong geometry, mislabeled
  arrows, clutter, or missing elements pull it down hard.
- **Below the threshold, research and redirect.** When the diagram can't
  confidently answer the request (complex visuals: many interacting elements,
  animation, interactivity, precise geometry), the system researches the best
  REAL visual resource for exactly that need — an interactive simulation,
  animation, or video from reliable sources (PhET, GeoGebra, Desmos, Falstad,
  3Blue1Brown, Wikipedia animations…) — and leads with it; the weak generated
  attempt is tucked behind a toggle instead of being taught from.
- **The choice is always explicit.** The learner is told plainly that Bob
  judged a generated diagram insufficient and deliberately chose the real
  resource — never a silent swap. Bob also pre-judges at authoring time: a
  request one static image cannot confidently deliver gets the resource link
  directly, with the reasoning stated, instead of an image block at all.

Implementation: `evaluateGeneratedVisual` + `recommendVisualResource`
(`src/lib/gemini.ts`), scored and cached per image in `/api/image/generate`
(threshold 60), rendered by `GeneratedVisual` (bar + redirect card); the
VISUAL CONFIDENCE rule in the node-chat, copilot, and explainer prompts.

## Sessions

Every tree is a self-contained **session**. Setup is ONE screen with ONE required
question — **"What is the specific problem you want to master?"** — plus four
optional calibrators collapsed behind an "add context" toggle: language (EN/中文),
the **purpose** behind the problem (what the learner will do with mastery — this
defines "relevant" for the whole session, per the Answer Standard), personal
background, and target depth on the **explainable ↔ deployable axis** (beginner
"general understanding you can explain" → professional "real-life deployable
understanding"). The calibrators pre-fill from the app language and the previous
session, so most sessions start from the problem alone — The Goal applied to
setup: the bare minimum stands between the learner and their tree. These
calibrate every AI output inside the session. There is no separate first-run
interview; a new user's first session setup IS their onboarding.

## Product Surfaces

1. **Tree** — the interactive visualiser: organic upward-growing graph (cursive
   branches, bud nodes, drag physics with string tension and shape-preserving subtree
   follow) plus a searchable list view carrying each node's full record.
2. **Workspace** — the per-node work area: Bob's chat (syllabus-style opening hook,
   Socratic where earned, Haiku contextual pre-pass each turn, in-chat checkpoint
   question cards that carry mastery), the cached comprehensive explainer, editable
   notes, conversation highlights as annotations, and file evidence Bob can
   actually read.
3. **Dashboard** — XP status, rank, daily goal, streak, badges, per-tree node
   progress.
4. **Portfolio** — the record: the Forest of completed trees, verified-node evidence,
   featured badges. Built ONLY from Tree EDU session data; it certifies verified
   understanding, not attendance.

## Retention & Moat

- **XP system**: every checkpoint answer pays (correct answers most, attempts a
  little, escalating combo bonuses at 3/5/10 in a row, perseverance rewarded during
  struggle); showing up pays (daily check-in streak XP that scales with streak
  length + first-session bonus); daily goal ring, streak with loss-aversion at-risk
  state, tiered badges (incl. verified-node and mastered-tree ladders), an
  learning-journey **rank ladder** with a UNIQUE TITLE AT EVERY LEVEL (74
  per-level names flowing through 10 tier families — Rookie → Seeker → Scholar →
  Prodigy → Virtuoso → Luminary → Guru → Grandmaster → Transcendent — and at
  level 75 the full-circle pinnacle **A Real Beginner**): every level-up hands
  the learner a fresh name and fires the rank-up celebration; tier promotions
  (new color/emblem family) fire the escalating synthesized fanfares and the
  rank-colored overlay that grows grander with the tier, reward
  sounds — small steps ding (node verified = the core unit of progress).
- **Insight memory** (the moat): Bob's curated long-term memory of the learner —
  extracted from workspace conversations with anti-hallucination rules, consolidated,
  reinforced — personalizes seeding, explainers, and the portfolio's portrait.
  Preserve it in every future change.
- **Project execution awareness**: Bob detects concrete real-world progress on the
  problem (code written, experiments run) and flags it per node.
- **Review loop**: verified knowledge fades, so completed trees carry a **Review**
  action — Bob revisits the stalest verified node with one fresh transfer checkpoint
  at full XP. Learners close out a tree with **Mark as complete**, which consolidates
  it (golden panel) into the Forest while keeping it reviewable forever.

## What survives from Release EDU

Login/auth + demo mode, admin panel, XP engine, insight memory, i18n (every
user-facing string EN + 中文), the Differentiator assessment principle, and the
highlight/annotation system (now anchored to node conversations). Everything else —
curriculum generation, tracks/chapters, lesson phase machine, L&C mode, chat modes —
is gone from the product.
