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
- **Mastery is verified, never self-declared.** A node flips to "understood" only by
  passing a Differentiator-principle mini problem set (transfer/what-if questions that
  separate understanding from memorization). A fully verified tree = a mastered
  problem.

## Sessions

Every tree is a self-contained **session**, onboarded at creation: language (EN/中文),
the learner's personal background for this problem, and target difficulty
(beginner/intermediate/advanced/professional, mapped to university course tiers).
These calibrate every AI output inside the session. The global first-run interview
ends with the bolded question — **"What is the specific problem you want to master?"**
— whose answer plants the first tree.

## Product Surfaces

1. **Tree** — the interactive visualiser: organic upward-growing graph (cursive
   branches, bud nodes, drag physics with string tension and shape-preserving subtree
   follow) plus a searchable list view carrying each node's full record.
2. **Workspace** — the per-node work area: Bob's chat (syllabus-style opening hook,
   Socratic where earned, Haiku contextual pre-pass each turn), the cached
   comprehensive explainer, editable notes, conversation highlights as annotations,
   and file evidence Bob can actually read.
3. **Dashboard** — XP status, rank, daily goal, streak, badges, per-tree node
   progress.
4. **Portfolio** — the record: the Forest of completed trees, verified-node evidence,
   featured badges. Built ONLY from Tree EDU session data; it certifies verified
   understanding, not attendance.

## Retention & Moat

- **XP system**: daily goal ring, streak with loss-aversion at-risk state, tiered
  badges, named ranks, reward sounds — small steps ding (node verified = the core
  unit of progress).
- **Insight memory** (the moat): Bob's curated long-term memory of the learner —
  extracted from workspace conversations with anti-hallucination rules, consolidated,
  reinforced — personalizes seeding, explainers, and the portfolio's portrait.
  Preserve it in every future change.
- **Project execution awareness**: Bob detects concrete real-world progress on the
  problem (code written, experiments run) and flags it per node.

## What survives from Release EDU

Login/auth + demo mode, admin panel, XP engine, insight memory, i18n (every
user-facing string EN + 中文), the Differentiator assessment principle, and the
highlight/annotation system (now anchored to node conversations). Everything else —
curriculum generation, tracks/chapters, lesson phase machine, L&C mode, chat modes —
is gone from the product.
