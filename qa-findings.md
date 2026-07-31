# Agentic QA Run — 4 Personas, Live Production (Jul 31 2026)

Four personas from `persona.md` driven through `release-edu.vercel.app` in four
independent browsers/accounts (Maya · David · 林小雨 · Robert), each starting as a
true beginner with memory building forward. Judged against FOUNDATION.md and the
question *"did this get the learner to real understanding efficiently?"*

**Coverage:** onboarding (all 5 steps, incl. skip + 中文 paths) · tree seeding ·
canvas + learning path · node workspace intro & syllabus contract · chat Q&A ·
checkpoints incl. confident-wrong and correct own-words · remediation ·
explainer generation · Copilot proposals + reorder · Settings language switch ·
XP/badge panel.
**Not covered:** voice recording (headless), generated images, merge/split/spinoff,
review flow (needs a verified node + elapsed days), portfolio (needs mastery).

---

## What genuinely worked (do not regress)

- **Misconception repair is excellent.** Every persona's planted misconception was
  named explicitly and refuted before re-teaching ("The misconception: low entropy =
  one photo"; "bubbles are a chemical reaction — half right, and the wrong half is
  this node"). Confident-wrong answers triggered the hypercorrection path exactly as
  designed.
- **Calibration to the learner is real.** Robert (58, no science since school) got
  "they are pets — very small pets"; David got his own project's numbers ("day 9, the
  basil is dead, the pin vaporises"); Maya got FRQ-framed language throughout.
- **Checkpoints pass the differentiator bar** in all four domains — transfer scenarios
  (two students disagree; two loaves differ; battery dead on day 4), not recall.
- **Redundancy law visibly holds:** "Closing that gap is the next branch's job, not
  this one's" / "Who holds the gas is the gluten net's branch."
- **Goal-necessity survived a direct challenge.** David's "do I actually need this?"
  produced a concrete necessity argument, not a lecture.
- **Session content honours 中文** — Xiaoyu's whole tree, syllabus and checkpoints
  were native-quality Chinese.
- **New machinery works in prod:** first-read gift, purpose chips, construction
  screen, make-it-yours, learning path + "Start here", effort anchors, Copilot
  reorder + proposals (Apply chip present), journey strip.

---

## Improvement suggestions (ranked by impact on the app's purpose)

### 1. Progressive disclosure — the intro and the remediation are walls of text
- Node intros run ~600 words (big idea + why it matters + building-on + 5 syllabus
  facets + 4 outcomes + a trap) **before the first question**. Post-wrong-answer
  remediation ran 700+ words with a worked enumeration.
- FOUNDATION says the default mode is ASKING and remediation should be full-depth —
  both are technically honoured, but a 16-year-old skimmer bails before the first
  probe, and the "ask first" law is undermined by how much precedes the ask.
- **Suggestion:** lead with the one-sentence big idea + the first probe; collapse
  "What you'll cover / You'll be able to / The trap" behind a toggle (the syllabus
  contract still stored, just not dumped). For remediation: short corrected model
  first, then "Show me the full walk-through" to expand.

### 2. Choosing 中文 in onboarding should switch the whole interface
- Picking 中文 sets only the *session* language. The entire shell — login, dashboard,
  New Session stepper, and the language question itself — stays English until the
  user separately discovers Settings → Language. A zero-English learner cannot
  navigate to the switch that fixes their experience.
- Inside a 中文 session the checkpoint card chrome is still English: **CHECKPOINT ·
  💡 Hint · How sure are you? · Sure / Not sure · Submit answer** — English controls
  wrapped around Chinese content.
- **Suggestion:** onboarding's language answer sets app language too (or offers
  "also switch the interface"); alternatively make checkpoint/workspace chrome follow
  the *tree's* language rather than the global UI setting.

### 3. Verification counters contradict each other (trust-critical)
- Between opening a node and the syllabus being stored, the card reads *"Prove every
  point … (3 in total …)"* — then the contract appears with **5 facets + own-words =
  6 rows**. First impression "3 questions", reality 6.
- After one correct answer the header read **"1/5 proven"** while **two rows showed
  ✅** (the own-words row is listed but excluded from the denominator). Learners count
  ticks, not facets.
- "Syllabus set" in the journey strip doesn't tick when the syllabus actually lands.
- **Suggestion:** one number, one denominator — count own-words as a row or drop it
  from the list; suppress the fallback "3 in total" until the contract exists.

### 4. The Copilot is invisible to the people who need it most
- Robert (low tech fluency) would finish an entire session never learning the Copilot
  exists: it lives on the canvas, not the workspace, and nothing in the workspace
  hints at what it can do.
- Explainer **Download PDF** and **Fullscreen** are icon-only (tooltips exist, but a
  hover-averse user never sees them); one workspace icon button has **no accessible
  label at all**.
- **Suggestion:** a one-line "Ask the Copilot to reshape this tree" affordance in the
  workspace side panel, labels (not just tooltips) on the explainer actions, and an
  aria-label audit pass.

### 5. After the intro, a beginner doesn't know what to do next
- The workspace offers "Quiz me" as the only visible action; the intro ends with a
  probe in prose. Robert's literal reading style stalls here — is he meant to answer
  in chat, click Quiz me, or read the explainer first?
- **Suggestion:** make Bob's closing probe a visually distinct "answer this" affordance
  (same treatment as a checkpoint card), so the next action is never ambiguous.

### 6. Gamification copy mismatches on a fresh account
- A brand-new account shows **"Next badge: Kindling · 1/3"** paired with the line
  *"Your first badge is one verified node away"* — Kindling is the 3-day-streak badge;
  the copy promises a node-based unlock. Two different badge stories in one card.
- **Suggestion:** the spotlight sub-line should describe the *spotlit* badge's own
  criterion.

### 7. Smaller items
- Greeting takes the first token of the display name ("Good morning, QA") — odd for
  names with titles/prefixes or single-token names.
- The root node truncates the problem statement mid-thought on the canvas; the full
  text should at least be available on hover/side panel (it currently is in the panel —
  worth confirming for long statements).
- Node intro promises "The full explainer is a click away" — good; but the explainer
  button sits below the fold in the side panel on a 900px viewport.

---

## Operational note

The run used the env-gated `agent-test` credentials provider with per-persona
accounts (`maya|david|xiaoyu|robert@qa.tree-edu.internal`). **Remove
`TEST_LOGIN_TOKEN` from Vercel (and redeploy) to disable that path when testing is
done.** QA data lives only in those four accounts.
