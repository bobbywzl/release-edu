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
- **Auth**: NextAuth 4 with Google OAuth + a `demo-mode` cookie fallback
- **AI**: Anthropic SDK — Opus (`claude-opus-4-8`) for teaching-quality output (tree
  seeding, node explainers, workspace chat), Sonnet (`claude-sonnet-4-6`) for
  structured proposals/judging, Haiku (via `pickBackgroundModel()`) for background
  passes (reflection, insight extraction). Gemini for image/file analysis.
- **UI**: Tailwind CSS, Radix primitives, Framer Motion, React Flow (the tree canvas),
  KaTeX.

## The Product Model (what everything serves)

One **ProblemTree** per problem-mastery **session**: root (the problem) → solution
branches → component/leaf nodes (pain points). Growth is permission-based only:
learner questions → AI proposals (pending ghost nodes) → explicit approval; plus
AI discovery cards in chat and manual add. Mastery is AI-verified via
Differentiator-principle mini problem sets — no self-marking. Each session carries its
own language / difficulty / personal background, set by a stepper at tree creation.

## Key Code Map

- `src/lib/tree-engine.ts` — seeding, expansion proposals (with clarify), explainers,
  verification, `sessionDirectives()`. The heart of the product.
- `src/app/api/tree/**` — tree CRUD, expand, per-node explainer/verify/chat routes.
  The node chat route holds Bob's workspace prompt, the Haiku contextual pre-pass
  (gap/wrong-streak/directive + node-discovery + move-recommendation + project-progress
  detection), the `[NODE_INTRO]` hook, and `[[TREE_SUGGEST]]` stream markers.
- `src/app/dashboard/tree/**` — tree list + session-onboarding stepper; the canvas
  (organic layout, string-tension drag physics, shape-preserving subtree follow,
  hierarchy clamps) and the searchable list view.
- `src/app/dashboard/workspace/page.tsx` — per-node work area: Bob chat,
  explainer, editable notes, highlight-based annotations, file evidence.
- `src/lib/insight-memory.ts` + `src/lib/insight-extraction.ts` — the personalization
  moat. PRESERVE in every change; extraction runs from workspace chats.
- `src/lib/xp-engine.ts`, `src/lib/badges.ts`, `src/components/xp-panel.tsx` — XP,
  daily goal, streaks, badges, sounds (`src/lib/sfx.ts`).
- `src/app/api/portfolio/generate` — session-pure portfolio (version-stamped ≥2;
  older caches are treated as absent so Release EDU data can never surface).
- `src/lib/usage.ts` + admin panel — cost telemetry. Feature taxonomy: `tree-seed`,
  `tree-expand`, `tree-explainer`, `tree-verify`, `node-chat`, `reflection`,
  `insight`, `onboarding`, `portfolio`, `title`, `image`, `other` (legacy values
  render with "(legacy)" labels). Every new AI call MUST record usage with a fitting
  feature tag.

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

## The Differentiator Principle (assessment ideology — still law)

Every verification question must separate a student who MEMORIZED content from one who
TRULY UNDERSTANDS it: transfer to unseen contexts, why/what-if probes, edge cases where
the memorized rule breaks. A question answerable by reciting an explainer is a failed
question. Implementation: `generateVerification` in `src/lib/tree-engine.ts`.

## Database Rules

- **Legacy Release EDU tables (Track, Chapter, Homework, Quiz, CurriculumPlan,
  CurriculumModule, SubjectProject, CurriculumBlock…) are DORMANT, not gone.** They
  stay in `prisma/schema.prisma` because the build runs `prisma db push` against the
  shared production database — dropping them is a deliberate, separate migration
  decision. Never build new features on them.
- Active models: ProblemTree, TreeNode (status/pending/notes/annotations/progressLog),
  Conversation (workspace chats use `context = "tree-node:<nodeId>"`), Message,
  MessageHighlight (annotations), LinkedFile (`workType = "tree-node"`), Insight,
  UserBadge, UsageEvent, StudentProfile, PortfolioCache.
- JSON-in-string columns are read with safe parsers — always tolerate malformed JSON.

## Code Style

- TypeScript strict; no `any` shortcuts unless commented why.
- Errors in non-critical paths: `try { … } catch { /* non-critical */ }`.
- Streaming responses use `ReadableStream` + `TextEncoder` (see the node chat route).
- Background AI work must never block the user's response.

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
- Does this still work with `demo-mode=true` (no auth session)?
- Does it respect the session's language/difficulty (never leak English into a 中文 session)?
- Does tree growth stay permission-based (nothing joins the tree without a click)?
- Does every new AI call record usage with the right feature tag?
- Does it handle empty arrays / null / malformed JSON fields gracefully?
