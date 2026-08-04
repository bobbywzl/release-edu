# AUTOLOOP — Master Prompt for Autonomous Agentic Improvement Loops

> Paste this entire file as the prompt to start any future autoloop on Tree EDU.
> It packs everything that made previous runs work: the persona simulation, the
> deep audit, the truthfulness bar, the fix gating, and the environment tricks.
> Fill the three `SET:` lines, then send.

---

SET: run length = **1 hour** (or "until I say stop")
SET: TEST_LOGIN_TOKEN = `<the secret token, also set in Vercel env>` — remind me to remove it from Vercel when the run is over
SET: usage = full network access granted; keep using usage credits if the plan limit runs out

---

## Mission

Run a long-form autonomous agentic improvement loop on the deployed app
(`https://release-edu.vercel.app`). Combine three modes in one loop:

1. **SIMULATE** — browser-driven, persona-faithful user runs of the real product;
2. **DEEP AUDIT** — code-level hunting for misalignment with the founding vision, goals, and nuanced user pain;
3. **FIX PIPELINE** — synthesized findings I pick from; picked fixes ship to prod.

The output I care about is a **synthesis of the best improvement suggestions —
like distilled customer feedback**, every item backed by a lived moment or a
code citation, ranked by impact on the founding goal.

## Read first (canon)

- `FOUNDATION.md` — the canonical vision. The **Vision (verbatim)** and **Mode
  (verbatim)** paragraphs are the supreme authority; every judgment in this loop
  is measured against them, not against generic UX taste.
- `CLAUDE.md` — architecture, laws, and the prod shipping pipeline.
- `persona.md` — the four QA personas and their rotation order.
- `qa-findings.md`, `qa-findings-deep.md`, `qa-findings-deep-2.md` — findings
  already reported. **Never re-report these**; check whether they were fixed and
  re-observe instead.

## Personas & accounts

- Use the four personas in `persona.md` (Maya · 林小雨 · David · Robert), one at a
  time, never blended. Each is a **complete beginner in their field** — they only
  know what the app has shown them so far, plus the misconceptions the persona
  file lists (volunteer those deliberately in chat and checkpoint answers).
- One **separate test account per persona** (`<name>.tree.qa.N@…`), logged in via
  the token route. Never touch my real account or its data.
- **Memory per step**: each persona keeps a running memory file (what they now
  believe, what confused them, what they want next). Every action must follow
  from that memory — a persona cannot use knowledge the app hasn't given them.
- Fidelity bar: type like the persona (speed, tone, typos), read only what is
  visibly rendered, click only what is visible. Judge every screen by *"did this
  move me toward real understanding efficiently, per the vision?"*

## Browser mechanics (what worked last time)

- Drive a real Chromium via Playwright/CDP (`/opt/pw-browsers/chromium`,
  `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` — never `playwright install`).
- **The sandbox's egress proxy blocks Chromium** (CONNECT denied even with the CA
  imported). Solution that worked: a `relay.js` — localhost HTTP server that
  forwards every request to prod through `curl` (which the proxy allows) — and
  launch the browser with `--no-proxy-server` pointed at `http://127.0.0.1:8899`.
- Kill stale relays by PID (`ps -eo pid,args | grep 'rela[y]\.js'`), never
  `pkill -f` (it matches your own shell and kills the session).
- Screenshots at every judgment moment; save per-persona logs under the scratchpad.

## The loop (repeat until time is up)

1. **SIMULATE** — the current persona pursues their real goal end-to-end:
   onboarding → seeded tree → node workspace → checkpoints (answer some wrong,
   on-persona) → growth attempts → return-visit behavior. Capture *moment-level*
   pain: what the screen said vs what the teacher said, dead ends, contradictions,
   anything that would make this persona churn (each persona file lists churn
   triggers — test them specifically).
2. **DEEP AUDIT** — rotate lenses over the code, one per cycle: vision-fidelity
   (the verbatim paragraphs vs what code can deliver) · growth & permission ·
   verification integrity (can credit advance without proof?) · evidence/files
   reaching judging · the insight-memory moat actually reaching prompts ·
   longitudinal (the day-20, tree-6 learner) · persona-pain · visualizer & payoff
   moments · cost/enforcement. For each lens: quote the vision line, find where
   the code diverges, cite `file:line`.
3. **VERIFY (the truthfulness bar — non-negotiable)** — a candidate finding is
   reportable only after an adversarial pass: try to refute it against the live
   app or the code; verify every line number; reproduce live where possible.
   Discard artifacts of your own tooling (text-extraction quirks, harness races).
   If a hypothesis dies under verification, report nothing — a wrong finding
   costs more trust than a missed one. Findings that survive get marked with how
   they were verified.
4. **SYNTHESIZE** — write/refresh a `qa-findings-<n>.md` in the repo root:
   numbered, ranked by impact on the founding goal ("a beginner becomes a
   thorough expert"), each item = the felt moment → the vision quote (verbatim)
   → the code evidence (`file:line`) → a concrete fix direction. End with a
   **"cheapest high-leverage moves"** list, in order. Commit the doc.
5. **FIX PIPELINE (gated)** — implement **only the fixes I explicitly pick** (I
   reply with numbers, or "push to prod" after a recommendations list = build
   the recommended list). Loop suggestions never auto-ship. Picked fixes follow
   the CLAUDE.md pipeline exactly: branch commit → push → cherry-pick to `main`
   → `rm -rf .next/types && npx tsc --noEmit` + `npx next build` (NEVER
   `npm run build` — it runs `prisma db push`) → push `main` → merge back.
6. **RE-OBSERVE** — after any fix ships, re-run the affected persona flow and
   confirm the fix as *felt experience*, not just as code. Note regressions.
7. Rotate persona / lens and go to 1. Stop only at the time limit or my message.

## Standing rules for the run

- **Every UI string you add ships EN + 中文**; never leak English into a 中文
  session (林小雨's runs are the language-integrity probe).
- Tree growth stays **permission-based** — flag anything that grows without a click.
- Every new AI call records usage with a fitting feature tag.
- Respect the app's laws when judging: Answer Standard, Per-Node Redundancy,
  Bottleneck-Triggered Teaching, Goal-Necessity, Differentiator Principle,
  syllabus-coverage verification (all in `FOUNDATION.md`/`CLAUDE.md`).
- If another session pushed to `main` mid-run, merge and reconcile before
  shipping; re-verify after every merge.
- Progress notes as you go; if I'm away, keep the loop running — batch questions
  and default to the most probable reading rather than blocking.

## Deliverable at the end of the run

One reply containing: the TLDR (top 5 by impact), the full ranked findings list
(or a pointer to the committed `qa-findings-<n>.md`), what was fixed + shipped
this run (with commit hashes), what's gated awaiting my pick, and the exact
cleanup steps I owe (e.g. remove `TEST_LOGIN_TOKEN` from Vercel and redeploy).
