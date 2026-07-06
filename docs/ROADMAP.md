# Skynet — Product Roadmap

Development direction for the product: vision, release plan, and the
backlog broken down as **Epics → Features → User Stories**. Grounded in
the discovery research
([superpowers/specs/2026-07-02-skynet-discovery.md](superpowers/specs/2026-07-02-skynet-discovery.md)).
The target technical architecture and design patterns are in
[ARCHITECTURE.md](ARCHITECTURE.md).

**Tracked backlog:** the per-User-Story status board lives in the
superpowers format at [superpowers/roadmap.json](superpowers/roadmap.json)
(source of truth) rendered to
[superpowers/ROADMAP.html](superpowers/ROADMAP.html). This file
is the narrative (vision, release plan, risk gates); the JSON is the
trackable board. Regenerate the HTML after editing the JSON:
`node docs/superpowers/scripts/render-roadmap.mjs`.

**Current status (2026-07-04):** scaffold complete (tooling, CI, walking
"Hello World" command). No product User Story started yet — every entry
below is `open`. Next up: **F1.1**, the E1 walking skeleton.

## Product vision

Skynet is a VSCode extension that turns CLI coding agents (Codex CLI,
Antigravity CLI, Claude Code) into a real Scrum team — with the
developer as Scrum Master.

The core discipline is **agent harness engineering**: Skynet doesn't
just *run* agents, it makes them *better*. Every agent is a **worker =
model + role + soul**:

- **Model** — the underlying provider/CLI and its strengths.
- **Role** — the job: PM, dev, QA, PO — responsibilities, permissions,
  definition of done, position in the workflow.
- **Soul** — the identity: personality, values, coding taste, quality
  standards, communication style, and a persistent memory that grows
  with every sprint.

Every task is processed by the **best-suited worker** for it — matched
on model strengths × role fit × soul track record, with remaining
subscription capacity as the tiebreaker — and the Scrum ceremonies are
real control loops, not theater: review gates enforce quality, and
retrospectives write lessons back into workers' souls, so the team gets
measurably better sprint over sprint.

**Differentiators to build toward:** ① worker engineering (role + soul +
memory — depth no orchestrator has; the answer to discovery's finding
that Scrum *framing* alone isn't novel), ② best-worker task matching
including quota-aware capacity (no competitor routes by live headroom),
③ ceremonies as functional control gates, ④ polished VSCode-native
multi-account management. Ordering principle: nail sessions →
parallelism → workers → matching → the full Scrum loop. Each release is
independently useful.

## Release plan

| Release | Theme | Epics | Definition of done |
| --- | --- | --- | --- |
| **v0.1 (MVP)** | One agent, end to end | E1 (+E7 baseline) | Assign a task to one agent from the command palette; watch it complete in a terminal |
| **v0.2** | Parallel agents, safe isolation | E2 | 3 agents work 3 tasks concurrently in separate worktrees; review each diff before merge |
| **v0.3** | Workers: role + soul | E3 | Two workers with different roles/souls produce visibly different, consistent work on the same provider |
| **v0.4** | Best-worker matching + accounts/quota | E4, E5 | New tasks land on the best-suited worker automatically, capacity-aware, with a "why this worker" explanation |
| **v0.5** | The full Scrum loop | E6 | Sprint planning → board → gates → standup → retro, with retro lessons persisted into souls |
| **v1.0** | Marketplace GA | E8 | Published, documented, CI-hardened, adapter contract tests |

---

## E1 — Single agent session (MVP core)

> Prove the terminal + file-mailbox architecture (probe-verified; see
> ARCHITECTURE.md → Interaction mechanism) end to end with one provider
> before any breadth. Start with Codex CLI (most permissive provider
> posture per discovery). **F1.1 is the walking skeleton and the first
> feature built**: pure core session state machine + `AgentProvider`
> port + one codex adapter + a smoke command — send one task, get one
> turn result. F1.2–F1.4 follow as their own spec.

**F1.1 — Provider adapter: Codex CLI (terminal + file-mailbox)**
- US1.1.1 — As a developer, I want to start a coding agent in a VSCode
  terminal with one command, so that I can begin without any setup or
  API key.
- US1.1.2 — As a developer, I want Skynet to tell me when the CLI is not
  installed or not signed in, so that I know how to fix it instead of
  staring at a broken terminal.

**F1.2 — Session lifecycle tracking**
- US1.2.1 — As a developer, I want to see the agent's coarse live status
  (launching / ready / busy / awaiting my input / done / stopped),
  derived from the mailbox lifecycle, so that I know when I'm needed
  without reading the terminal scrollback. *(Keystroke-level "thinking
  right now" status is deferred: it needs output streaming via node-pty,
  a fragility we don't pay up front — revisit only if coarse status
  proves insufficient.)*
- US1.2.2 — As a developer, I want a notification when the agent is
  waiting on my input, so that a parked agent never silently wastes my
  time.

**F1.3 — Task hand-off**
- US1.3.1 — As a developer, I want to send a task/prompt to the running
  agent from the command palette, so that I can delegate work without
  switching context.
- US1.3.2 — As a developer, I want to stop an agent at any time, so that
  I always stay in control.

**F1.4 — Transparency (also a ToS-posture requirement)**
- US1.4.1 — As a developer, I want the agent's full conversation visible
  in a normal terminal tab, so that I can read everything it does and
  take over by typing at any moment.

*Acceptance for the epic:* task assigned in a scratch repo completes;
state transitions verified against fixture-recorded session files
(rollout JSONL / outbox JSON).

## E2 — Parallel orchestration

> Multiple agents at once without them trampling each other. Worktree
> isolation is table stakes in this category (per discovery).

**F2.1 — Session manager**
- US2.1.1 — As a developer, I want to run several agents concurrently and
  see them listed in a sidebar with their status, so that I can supervise
  a team at a glance.

**F2.2 — Git worktree isolation**
- US2.2.1 — As a developer, I want each agent to work in its own git
  worktree/branch, so that agents never overwrite each other's changes.
- US2.2.2 — As a developer, I want to review a diff of exactly what an
  agent changed before it's merged, so that nothing lands without my
  review.

**F2.3 — Concurrency limits**
- US2.3.1 — As a developer, I want a configurable cap (low by default) on
  simultaneous sessions per account, so that my usage pattern stays
  reasonable for my subscription.

## E3 — Worker engineering: Role & Soul ⭐ (agent harness engineering core)

> The product's heart. A raw CLI agent is a generalist with amnesia;
> Skynet's harness turns it into a named colleague with a job, a
> character, and a memory. Because the pty-only rule bars API system
> prompts, the harness works the way a human lead would: it engineers
> the agent's instruction files and briefings.

**F3.1 — Roles (the job)**
- US3.1.1 — As a Scrum Master, I want to define roles (PM / dev / QA /
  PO / architect) with responsibilities, permissions, workflow position,
  and a definition of done, so that each agent knows its job — not just
  its prompt.
- US3.1.2 — As a new user, I want a starter set of well-engineered role
  templates out of the box, so that I get a working team before writing
  a single role myself.

**F3.2 — Souls (the identity)**
- US3.2.1 — As a Scrum Master, I want to give each worker a soul —
  personality, values, coding taste, quality bar, communication style —
  so that its work is as consistent and recognizable as a real
  colleague's.
- US3.2.2 — As a Scrum Master, I want souls to be files I can read,
  edit, version-control, and share, so that a great worker is a
  portable asset, not vendor-locked state.

**F3.3 — Harness compilation (role + soul → agent instructions)**
- US3.3.1 — As a Scrum Master, I want Skynet to compile role + soul +
  project conventions (e.g. CONSTITUTION.md) + task briefing into each
  CLI's native instruction files (CLAUDE.md / AGENTS.md / GEMINI.md) and
  kickoff prompt at session start, so that the same worker behaves the
  same no matter which provider runs it.
- US3.3.2 — As a Scrum Master, I want to preview exactly what harness
  material a worker receives before its session starts, so that I can
  debug the harness the way I'd review an onboarding doc.

**F3.4 — Worker memory & growth**
- US3.4.1 — As a Scrum Master, I want each worker to keep a persistent
  memory of lessons learned (from retros, review rejections, repeated
  mistakes), so that the same feedback never has to be given twice.
- US3.4.2 — As a Scrum Master, I want each worker's track record (tasks
  completed, rework rate, review pass rate) recorded and visible, so
  that I can see who is actually good at what.

*Acceptance for the epic:* the same task given to two workers with
different souls on the same provider produces visibly different,
soul-consistent output; a lesson written after a rejected review changes
the worker's behavior on the next comparable task.

## E4 — Best-worker task matching ⭐

> A task isn't routed to "a provider" — it's assigned to the best-suited
> worker: model strengths × role fit × soul track record, with remaining
> capacity as the tiebreaker.

**F4.1 — Task profiling**
- US4.1.1 — As a Scrum Master, I want tasks tagged by type and required
  skills (feature / bugfix / refactor / tests / review; frontend /
  backend / infra), auto-suggested and editable, so that matching has
  something real to match on.

**F4.2 — Suitability matching**
- US4.2.1 — As a Scrum Master, I want each task assigned to the
  best-suited worker — scoring model strengths, role fit, and the
  worker's own track record on similar tasks — so that work quality is
  the routing criterion, not just availability.
- US4.2.2 — As a Scrum Master, I want to see *why* a worker was chosen
  (the scoring breakdown), so that I can trust and tune the matching.
- US4.2.3 — As a Scrum Master, I want to override any assignment and
  have the override feed back into future matching, so that the system
  learns my judgment.

**F4.3 — Pluggable matching policy**
- US4.3.1 — As a developer, I want to switch matching policy (best-suited
  ↔ fixed provider priority ↔ quota-first ↔ manual), so that the tool
  matches how I work today, not only the ideal end state.

**F4.4 — LLM Reasoner (advisory port)** — the deterministic Mediator
consults an **API-key** LLM (over HTTP, one OpenAI-compatible adapter:
GLM-5.2 / DeepSeek / OpenRouter / NIM / Ollama / OpenAI) for
judgment-heavy sub-decisions — first suitability scoring (F4.2), later
standups (F6.4) and retro-replan (F6.5). State machine, ceremony gates,
and turn boundaries stay hardcoded; every Reasoner call has a
deterministic fallback. HTTP is permitted **only** behind the Reasoner
port — the `AgentProvider` (worker) port stays pty-only and the Reasoner
never touches subscription auth. Research:
[superpowers/research/2026-07-05-llm-reasoner-research.md](superpowers/research/2026-07-05-llm-reasoner-research.md).
Research-stage — no spec yet.

## E5 — Multi-account & capacity

> Accounts and quota are the *capacity* dimension of matching: the best
> worker is only best if its account has headroom left.

**F5.1 — Account profiles**
- US5.1.1 — As a developer with multiple accounts, I want to register
  several named accounts per provider (isolated CLI config directories),
  so that each worker can run under a specific login.
- US5.1.2 — As a developer, I want to see the sign-in status of every
  profile in one place, so that I catch an expired login before it fails
  a task mid-sprint.
- US5.1.3 — As a developer, I want any sensitive profile data kept in
  VSCode SecretStorage — never in settings.json — so that my credentials
  don't leak via dotfile sync or screen shares.

**F5.2 — Quota tracking (passive)**
- US5.2.1 — As a developer, I want Skynet to track remaining headroom per
  account from the CLIs' own session logs (e.g. codex `rollout-*.jsonl`)
  — no extra API calls, no screen scraping — so that capacity awareness
  comes for free.
- US5.2.2 — As a developer, I want a status-bar meter of remaining
  headroom per account, so that I can see the team's remaining capacity
  at a glance.
- US5.2.3 — As a developer, I want a warning when an account nears its
  limit, so that running workers aren't cut off mid-task.

*Positioning guardrail (from discovery):* market as "use your existing
login, no API key to manage" — never as a rate-limit or billing
workaround.

## E6 — The Scrum loop: ceremonies as control gates ⭐

> The process should feel like a real Scrum team working together —
> and each ceremony is a functional control primitive, not dashboard
> theater. The retro closes the harness-engineering flywheel: process
> output becomes worker improvement.

**F6.1 — Backlog & sprint planning**
- US6.1.1 — As a Scrum Master, I want a PM-role worker to draft and
  refine backlog items (with my approval), so that the team helps me
  plan, not just execute.
- US6.1.2 — As a Scrum Master, I want sprint planning to consider the
  team's remaining capacity (from E5 quota tracking), so that we commit
  to what the subscriptions can actually deliver.

**F6.2 — Kanban board (webview; UI framework decided here in its own spec)**
- US6.2.1 — As a Scrum Master, I want a kanban board showing tasks
  (backlog / in progress / review / done) with the worker on each one,
  so that I run the sprint from inside the IDE.

**F6.3 — Review gates**
- US6.3.1 — As a Scrum Master, I want a dev worker's completed diff to
  require review by a QA/PO worker (or me) before it proceeds, so that
  quality gates are enforced, not suggested.
- US6.3.2 — As a Scrum Master, I want rejected reviews to go back to the
  same worker with the reviewer's feedback attached, so that hand-offs
  work like a real team's, not a reset button.

**F6.4 — Standups**
- US6.4.1 — As a Scrum Master, I want an on-demand digest of what every
  worker did since the last summary — done / doing / blocked — so that I
  catch up in one read instead of scrolling terminals.

**F6.5 — Retrospectives → soul updates (the flywheel)**
- US6.5.1 — As a Scrum Master, I want a retro at sprint end that turns
  what went wrong into concrete lessons written into the responsible
  workers' souls (with my approval), so that the team improves sprint
  over sprint.
- US6.5.2 — As a Scrum Master, I want retro outcomes to also trigger
  replanning of the remaining backlog, so that the team course-corrects
  instead of repeating mistakes.

## E7 — Trust & ToS posture (cross-cutting, every release)

> The load-bearing product risk (discovery → Risks → Legal/ToS). These
> are requirements, not features to sell.

- US7.1 — As a user, I want session concurrency and input cadence kept
  within what a human power user plausibly produces (throttles designed
  in), so that my personal paid accounts aren't put at risk.
- US7.2 — As a user, I want a per-provider kill-switch, so that if a
  provider changes its policy I can disable that leg instantly.
- US7.3 — As a user, I want everything Skynet sends to an agent to be
  visible in the terminal (no hidden traffic), so that I can trust the
  tool with my accounts.

## E8 — Quality & distribution

**F8.1 — CI hardening** — integration-test leg (xvfb) for
`test:integration`, already noted as a TODO in `ci.yml`.
**F8.2 — Adapter contract tests** — runnable against live CLIs to catch
upstream breaking changes early (the top technical risk: CLI surfaces
are unversioned and unstable).
**F8.3 — Harness evaluation suite** — replayable benchmark tasks to
measure whether a role/soul/harness change actually improves worker
output (harness engineering needs evals, or it's guesswork).
**F8.4 — Marketplace release** — packaging (`vsce`), README + demo,
CHANGELOG discipline; telemetry only if explicitly opt-in.

---

## Explicitly out of scope

- Headless / `-p` / Agent-SDK integration — prohibited by
  CONSTITUTION.md (pty only). Harness engineering therefore happens
  through instruction files and typed briefings — the same channel a
  human uses.
- A hosted/cloud service — Skynet is local-first inside VSCode.
- Marketing any feature as a way to save on metered billing.

## Standing risk gates (re-check before every release)

1. **ToS drift:** re-read provider policies; keep cadence human-plausible;
   be ready to flip a provider kill-switch (US7.2).
2. **Platform absorption:** if VS Code's native Agents Window or GitHub
   Agent HQ ships a planned feature natively, cut it and double down on
   E3, E4, and E6 — worker engineering and the retro flywheel are the
   parts platforms are least likely to copy.
3. **CLI instability:** an adapter breakage taking >1 day to fix pulls
   F8.2 (contract tests) forward.
