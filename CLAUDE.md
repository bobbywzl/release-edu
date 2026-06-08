# Release EDU — Project Conventions for Claude Code

This file documents conventions, architecture, and rules for working in this codebase. Read this before making changes.

## Working style (user preference — important)

- **When you are not sure what the user means, ALWAYS clarify before acting.** Do not
  guess at ambiguous intent and build the wrong thing. Ask a focused question, then proceed.
- Any user-facing text Bob generates (greetings, fallbacks, errors) must respect the
  student's chosen language — never hard-code English where a Chinese (or other) learner
  could see it.

## Canonical Documents

- **`FOUNDATION.md`** is the canonical source for pedagogy, product decisions, and curriculum logic. Read it before changing system prompts, the curriculum engine, or onboarding flows. Other spec docs may have drifted.
- The two PDFs in `~/Downloads/` (`Release EDU - Compiled Research Notes.pdf`, `Release EDU - Business Outline.pdf`) are the underlying vision. FOUNDATION.md synthesizes them.

## Stack

- **Framework**: Next.js 14.2 (App Router), TypeScript strict mode
- **Database**: PostgreSQL (Supabase) via Prisma 6 with `@libsql/client` adapter
- **Auth**: NextAuth 4 with Google OAuth + a `demo-mode` cookie fallback
- **AI**: Anthropic SDK (Claude Sonnet 4 / Opus 4 / Haiku 4.5) + Google Gemini 3.1 Pro
- **UI**: Tailwind CSS, Radix UI primitives, Framer Motion, Mermaid, KaTeX, React Flow, Recharts

## Dev Server

- `npm run dev` → port **3000** by default. The main worktree often runs on a custom port.
- This worktree's launch.json uses port **3001** (`npm run dev -- -p 3001`).
- The dev script does `rm -rf .next && next dev`, so the first compile after every restart is slow.
- Always check for port conflicts before launching — multiple worktrees can collide.

## Path Conventions

- TypeScript path alias: `@/*` → `src/*`. Use `@/lib/...`, `@/components/...`, never relative `../../..`.
- App Router pages live under `src/app/`. API routes under `src/app/api/`.
- Shared business logic in `src/lib/`. Components in `src/components/`.

## Terminology

- **UI/User-facing terms**: track → course → chapter (Foundations track / Interest-Based track).
- **Internal code**: stays as `Track`, `Chapter` (don't rename Prisma models or variables to match UI labels).
- **Bob** = the AI mentor; **Motivator** / **TM** (Tutor-Mentor) = human educators.

## Architectural Rules

### 1. Implement at the boundary, not per-instance

Formatting, normalization, and quality fixes go in a shared normalizer at the boundary (e.g. `student-context.ts`, `system-prompt.ts`, `db-store.ts`) — **not as one-off string edits** in every call site. If you find yourself fixing the same thing in three places, that's a signal to lift it.

### 2. Universal application

Instructions and behavior apply to **all users**, not just the developer's localhost dashboard.
- Implement at the dbStore / context / prompt layer
- Handle empty/new-user state explicitly (no profile yet, no insights, no curriculum)
- **Never hardcode a specific account, email, or userId** in business logic

### 3. Lean and scalable

The complexity budget is reserved for Bob's personalization. Everything else should be:
- Compatible / standard solutions over bespoke
- Lean memory + compute per user (this runs at scale)
- No clever-but-fragile abstractions

### 4. Bob's system prompt is sacred

The dynamic prompt builder is in `src/lib/system-prompt.ts`. It composes from:
1. Identity / philosophy
2. Teaching approach (Socratic intensity, mistakes, exploration)
3. Tone + visualization rules
4. Student profile + progress + projects
5. Recent conversation summary + accumulated insights
6. Stage-specific instructions (Stages 1–4)
7. Mentor config overrides (`MentorConfig` table)
8. Curriculum control abilities + evolution policy

When adding new behavior, ask: does this go in the prompt, the context engine, or as a background job? Don't bolt rules onto a single API route.

## Chat Modes

Three user-selectable modes, each with strict separation of authority. Other code paths force their own model regardless of mode.

| Mode / Path | Provider | Model | Authority |
|---|---|---|---|
| `tutoring` | Anthropic | `claude-opus-4-8` | No curriculum changes — redirect to L&C |
| `research` | Google | `gemini-3.1-pro-preview` | No curriculum changes — redirect to L&C |
| `logistics` (L&C) | Anthropic | `claude-sonnet-4-6` | **ONLY mode that can modify curriculum** |
| Onboarding chat | Anthropic | `claude-opus-4-8` | Pre-curriculum interview (`/api/chat/onboarding`) |
| Chapter / project sessions | Anthropic | `claude-opus-4-8` | Forced regardless of selected mode when a chapter or project is active (`/api/chat/route.ts:931`) |
| Insight extraction, title generation | Anthropic | `claude-haiku-4-5-20251001` | Background micro-tasks |

Source of truth: `CHAT_MODES` in `src/lib/system-prompt.ts` and per-route model strings under `src/app/api/`. When you change a model, grep both.

Curriculum changes in L&C mode are extracted post-hoc by Sonnet parsing Bob's response — don't try to change this without understanding `extractAndApplyCurriculumChanges` in `src/app/api/chat/route.ts`.

## Lesson Sessions

Chapter sessions follow a strict phase machine driven by `sessionScore` (0–100):

1. **SYLLABUS** (first message) — output objectives + plan, then begin teaching
2. **TEACHING** (score < 60) — one objective at a time
3. **PROBLEM SET** (score ≥ 60) — application-level problems
4. **SUBMISSION REVIEW** — per-problem 0–10 scoring
5. **COMPLETION** — Opus does rigorous mastery eval, emits `[CHAPTER_MASTERED]`

Special block formats Bob outputs (rendered as UI):
- ` ```quiz ` — interactive quiz
- ` ```problem ` — problem set item
- ` ```progress ` — silent progress update (after each student response)
- ` ```submission-review ` — per-problem evaluation
- ` ```mermaid ` / ` ```chart ` — visualizations (charts must use real data only)

## Curriculum Lock

After major curriculum changes, the curriculum is **locked for 14 days** (`CurriculumPlan.lockedAt`). While locked:
- Bob refuses all curriculum changes in L&C mode (enforced in system prompt + extraction skip)
- Admins can force-unlock via the admin panel
- The lock UI message must include the unlock date

## Database Schema Highlights

- `User` → `StudentProfile`, `MentorConfig`, `CurriculumPlan`
- `Track` (the Prisma model — represents a **course** in user-facing language) → `Chapter` (lessons) → optional `Homework`, `Quiz` + `QuizQuestion`, `SubjectProject`
- `Conversation` → `Message` → `MessageFeedback`, `MessageHighlight`
- `Insight` (extracted async by Haiku) — types: personality, interest, strength, weakness, preference, aspiration, breakthrough, struggle, style
- `SessionOutcome` + `TrainingExample` + `PromptEvolutionProposal` — feedback flywheel for prompt improvement

When schema changes: edit `prisma/schema.prisma`, then `npx prisma migrate dev` (or `npx prisma db push` in dev). Never edit migrations manually.

## Background Jobs (don't block responses)

In `src/app/api/chat/route.ts`, after the response stream closes:
- Insight extraction (Haiku, every ~5th message)
- Curriculum action extraction (Sonnet, L&C mode only, **skipped if locked**)
- Training example collection (high-rated lesson sessions only)

Daily cron: prompt evolution analysis (admin-triggered or scheduled).

## Known Hardcoded Things to Watch

- `student-context.ts:70-89` — `deriveSubjectBreakdown()` is **hardcoded to CS / Math / Psychology / Finance** with fixed totals. Currently gives wrong mastery numbers for any student whose tracks differ. Needs replacement with a real DB query against the student's actual tracks.

## Code Style

- TypeScript strict mode is on — no `any` shortcuts unless wrapped with a comment explaining why
- Prefer Prisma's typed client over raw SQL
- Errors in non-critical paths use `try { ... } catch { /* non-critical */ }` — keep this pattern for background work that shouldn't break the user's request
- Streaming responses use `ReadableStream` + `TextEncoder` — see `src/app/api/chat/route.ts` for the canonical pattern
- JSON columns in Prisma are stored as strings; use `safeParseJSON<T>(str, fallback)` (defined in multiple files) when reading

## Commit / Git

- Commits should be small, focused, and describe the **why** more than the **what**
- Don't commit `.env` or anything in `.next/`
- Worktrees live under `.claude/worktrees/`. Git creates each as an independent checkout; `node_modules` and `.next` are not shared by default — but if you symlink them to save space, be aware of cross-contamination (Next.js caches per-worktree paths inside `.next`)

## Quick Sanity Checks Before Shipping

- Does this work for a brand-new user with no profile, no insights, no curriculum?
- Does this still work with `demo-mode=true` (no auth session)?
- Does the system prompt still fit in token budget after my additions?
- Does this respect the 14-day curriculum lock?
- Does this handle empty arrays / null fields gracefully?

## Shipping an update (deploy workflow)

The app is hosted on **Vercel**, connected to the GitHub repo `bobbywzl/release-edu`.
Vercel auto-deploys on every push: **push to `main` → Production**, **push to any
other branch → a temporary Preview URL** (production untouched). Production domain:
`https://release-edu.vercel.app`.

**Trigger phrases** — when the user says any of: "ship it", "ship this", "ship this
update", "deploy this", "push it live", or "redeploy" → follow the matching workflow
below WITHOUT re-asking for the steps. Always confirm with the user before the final
`git push` (push to a remote is a publish action).

### Pre-flight (ALWAYS run before any push)
1. `npx tsc -p tsconfig.json --noEmit` (ignore `scripts/` + `downlevelIteration` noise) — must be clean.
2. `npm run build` — must reach "Compiled successfully" / full route table. A red build
   locally = a red build on Vercel, so never push a failing build.
3. Confirm `git status` shows only intended files; never stage `.env` or `.next/`.

### Workflow A — Quick ship (small, low-risk change → straight to production)
Use for copy tweaks, bug fixes, prompt edits, anything you're confident in.
```bash
git add -A
git commit -m "<why-focused message>

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git push                      # pushes main → Vercel auto-deploys to production
```
Then tell the user it's deploying and that `release-edu.vercel.app` updates in ~2-3 min.

### Workflow B — Branch & preview (anything risky → test before production)
Use for schema/Prisma changes, auth/env changes, big refactors, new features.
```bash
git checkout -b feat/<short-name>
git add -A && git commit -m "<message>  (+ Co-Authored-By trailer)"
git push -u origin feat/<short-name>     # Vercel builds a PREVIEW deploy, prod untouched
gh pr create --fill                      # optional: open a PR (preview URL posts on it)
```
Give the user the Vercel **Preview URL** to verify. After they approve:
```bash
git checkout main && git merge feat/<short-name> && git push   # → production
```

### Notes / guardrails
- **Env-var or Google-OAuth changes don't ship via git** — they're set in the Vercel
  dashboard and require a manual **Redeploy** (Deployments → ⋯ → Redeploy) to take effect.
- Default to **Workflow A** for routine changes; escalate to **B** when the pre-flight or
  the nature of the change suggests real risk (DB migrations, auth, payment, deletes).
- Branch naming: `feat/…`, `fix/…`, `chore/…`. Keep `main` always deployable.
- If a Vercel build fails after push, read the build log, fix locally, re-run pre-flight, push again.
