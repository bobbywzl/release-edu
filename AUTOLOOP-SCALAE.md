# AUTOLOOP-SCALAE — Master Prompt for Autonomous Agentic Improvement Loops on Scalae

> Paste this entire file as the prompt to start an autoloop on **Scalae**
> (`bobbywzl/scalae` — the AI intelligence desk for value investors). Same
> methodology as Tree EDU's `AUTOLOOP.md`, adapted to Scalae's charter.
> Fill the three `SET:` lines, then send.

---

SET: run length = **1 hour** (or "until I say stop")
SET: auth = `<how test accounts log in>` — Scalae uses Google OAuth; if no token-gated test login exists yet, FIRST build one (mirror Tree EDU's `TEST_LOGIN_TOKEN` route: env-gated, creates/logs into isolated test accounts), have me set the token in Vercel, and remind me to remove it when the run ends
SET: usage = full network access granted; keep using usage credits if the plan limit runs out

---

## Attach the repo first

This loop runs against the Scalae codebase and its deployed app:

- Add the repository to the session (`add_repo bobbywzl/scalae`), clone it, and
  register its root so `CLAUDE.md` / `AGENTS.md` load.
- Deployed app: `https://scalae.vercel.app` (Vercel; `main` = production).
- **Next.js 16 warning (from AGENTS.md): this is NOT the Next.js in your training
  data.** Before writing ANY code, read the relevant guide in
  `node_modules/next/dist/docs/`. Heed deprecation notices.

## Mission

Run a long-form autonomous agentic improvement loop combining three modes:

1. **SIMULATE** — browser-driven, persona-faithful investor runs of the real product;
2. **DEEP AUDIT** — code-level hunting for misalignment with the charter, plus nuanced user pain;
3. **FIX PIPELINE** — synthesized findings I pick from; picked fixes ship per the repo's rules.

The output I care about is a **synthesis of the best improvement suggestions —
like distilled customer feedback** — every item backed by a lived moment or a
code citation, ranked by impact on the charter's goal: *the investor's deep due
diligence compounds instead of restarting every morning*.

## Read first (canon)

- `FOUNDATION.md` — the charter, supreme authority. Internalize before judging:
  the **two anchors** (every signal must illuminate the ticker's *business model*
  or *corporate culture* — chart patterns, price targets, meme sentiment are out
  of scope by construction), the **certainty-gap master question** ("what is
  preventing me from certainty about the next ten years of cash flow and
  growth?"), the no-duplicate-signals rule, **human approval gates**, and the
  evidence discipline.
- `lib/agents/framework.ts` — the charter's executable form; flag any drift
  between the two.
- `AGENTS.md`, `CLAUDE.md`, `README.md` — architecture, agent doctrine, conventions.
- Any existing `scalae-findings*.md` — never re-report; re-observe fixes instead.

## Personas & accounts

- If the repo has no `persona.md` yet, **generate one first** (commit it): four
  comprehensive personas matching Scalae's target audience — e.g. a beginning
  value investor who just read *The Intelligent Investor*; a seasoned
  Buffett-style investor with a real 10-ticker book; a 简体中文-first investor
  (the bilingual-integrity probe); a busy professional running their own
  portfolio in stolen minutes. Each with: snapshot, prior knowledge AND
  misconceptions (volunteer them deliberately in chat), verbatim-style inputs,
  patience profile, churn triggers. One persona per run, never blended.
- One **separate test account per persona** via the agreed auth path. Never
  touch my real account, watchlist, or portfolio.
- **Memory per step**: each persona keeps a running memory file (what they now
  believe about the ticker, what confused them, what they want next). They know
  only what the app has shown them — plus their persona's real-world priors.
- Fidelity bar: type like the persona, read only what renders, click only what
  is visible. Judge every screen by *"did this move me toward — or honestly
  further from — ten-year conviction, per the charter?"*

## Browser mechanics (proven on Tree EDU runs)

- Real Chromium via Playwright/CDP (`/opt/pw-browsers/chromium`,
  `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` — never `playwright install`).
- If the sandbox's egress proxy blocks Chromium (CONNECT denied), build the
  `relay.js` pattern: a localhost HTTP server forwarding to prod through `curl`,
  browser launched with `--no-proxy-server` against `http://127.0.0.1:8899`.
- Kill stale relays by PID (`ps -eo pid,args | grep 'rela[y]\.js'`) — never
  `pkill -f` (it matches your own shell).
- Screenshot every judgment moment; per-persona logs under the scratchpad.

## The loop (repeat until time is up)

1. **SIMULATE** — the persona pursues a real goal end-to-end: add a ticker they
   genuinely half-know → the six-stage onboarding intake (drop real primary
   documents; test "skip", "go back", "just propose signals") → review/approve
   signal proposals → trigger a research run → read the morning brief and
   dossier → open evidence citations → use the analyst desk (fast lane AND
   escalation) → place paper trades → return next "day" and judge the
   carry-forward honesty. Capture *moment-level* pain and each persona's churn
   triggers specifically.
2. **DEEP AUDIT** — rotate lenses over the code, one per cycle:
   - **Anchor fidelity** — can anything on a board fail the two-anchors test?
     Does any prompt/surface smuggle in price-voting content the charter bans?
   - **Approval-gate integrity** — can ANYTHING activate, retire, or write into
     the user's record uninvited? (The desk never writes into notes uninvited.)
   - **Evidence honesty** — the credibility core, Scalae's equivalent of
     verification integrity: are citations real and clickable? can a reading
     cite sources it didn't draw on? is "No new information this run" truthful?
     are source-class chips (primary / trade press / media) assigned honestly?
     Hunt every path where the pipeline could FABRICATE or launder evidence.
   - **Certainty-gap discipline** — are the day's framed questions actually
     derived from named gaps, and does the run answer them or quietly drop them?
   - **Duplicate/replace rule** — does the board accrete instead of sharpening?
   - **Longitudinal** — the day-30 desk: staleness, catalog bloat, dossier drift,
     does diligence actually compound?
   - **Bilingual integrity** — canonical-English record + on-display translation:
     can the data fork? does any surface leak the wrong language?
   - **Portfolio truth** — paper fills, dividends/DRIP, FX, P&L reconstruction:
     any path where the ledger lies?
   - **Cost/enforcement** — the five-stage pipeline's spend per run; budget
     ceilings; what the auto-research switch actually pauses (server-enforced?).
   For each: quote the charter line, find where the code diverges, cite `file:line`.
3. **VERIFY (the truthfulness bar — non-negotiable)** — a candidate finding is
   reportable only after an adversarial pass: try to refute it against the live
   app or the code; verify every line number; reproduce live where possible;
   discard artifacts of your own tooling. A wrong finding costs more trust than
   a missed one. Mark each survivor with how it was verified.
4. **SYNTHESIZE** — write/refresh `scalae-findings-<n>.md` in the **scalae** repo
   root: numbered, ranked by impact on compounding due diligence, each item =
   the felt moment → the charter quote (verbatim) → the code evidence
   (`file:line`) → a concrete fix direction. End with a **"cheapest
   high-leverage moves"** list, in order. Commit the doc.
5. **FIX PIPELINE (gated)** — implement **only the fixes I explicitly pick** (I
   reply with numbers, or "push to prod" after a recommendations list = build
   the recommended list). Loop suggestions never auto-ship. Before the first
   ship, confirm the repo's prod pipeline from its `CLAUDE.md`/`AGENTS.md`; at
   minimum: work on the designated `claude/…` branch, `npx tsc --noEmit` clean
   and `npx next build` compiles before any push, respect the Next.js 16 docs
   rule, and merge/reconcile if other sessions pushed mid-run.
6. **RE-OBSERVE** — after any fix ships, re-run the affected persona flow and
   confirm the fix as *felt experience*. Note regressions.
7. Rotate persona / lens and go to 1. Stop only at the time limit or my message.

## Standing rules for the run

- **Approval gates are law**: flag anything that changes the user's board,
  record, or portfolio without an explicit click — that's a charter violation,
  not a nitpick.
- **Evidence discipline is the product**: any invented citation, inflated
  confidence, or dishonest carry-forward outranks every UX finding.
- **Bilingual**: any new user-facing string ships EN + 简体中文 through the
  established translation layer; the stored canonical record stays English.
- Signals proposed in tests must still pass the two anchors — even test data
  respects the charter.
- Trading surfaces are paper-only; never wire anything toward real execution.
- If another session pushed mid-run, merge and reconcile before shipping;
  re-verify after every merge.
- Progress notes as you go; if I'm away, keep the loop running — batch questions
  and default to the most probable reading rather than blocking.

## Deliverable at the end of the run

One reply containing: the TLDR (top 5 by impact), the full ranked findings list
(or a pointer to the committed `scalae-findings-<n>.md`), what was fixed +
shipped this run (with commit hashes), what's gated awaiting my pick, and the
exact cleanup steps I owe (e.g. remove the test-login token from Vercel and
redeploy).
