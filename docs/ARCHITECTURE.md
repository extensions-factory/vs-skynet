# Skynet — Target Architecture & Design Patterns

The technical direction for implementing the [ROADMAP.md](ROADMAP.md)
backlog. Nothing here is built yet — this document exists so every
feature lands in a pre-agreed structure instead of accreting ad hoc.
Coding standards live in [CONSTITUTION.md](../CONSTITUTION.md).

## Style: hexagonal (ports & adapters)

The core domain — sessions, routing, orchestration, accounts — is plain
TypeScript with **no `import "vscode"` and no pty dependency**. Everything
touching the outside world sits behind an interface (a *port*) that a
thin *adapter* implements at the edge:

```
        ┌────────────────────────────────────────────┐
        │  Adapters (edge, integration-tested)       │
        │                                            │
        │  extension.ts (composition root, Facade)   │
        │  VSCode commands / tree views / webviews   │
        │  Terminal + file-mailbox provider adapters │
        │  Git worktree adapter                      │
        └───────────────┬────────────────────────────┘
                        │ depends on ↓ (never ↑)
        ┌───────────────┴────────────────────────────┐
        │  Core domain (pure TS, vitest-tested)      │
        │                                            │
        │  sessions · workers (role+soul+memory) ·   │
        │  harness compiler · matching · accounts ·  │
        │  quota · ceremonies · events               │
        └────────────────────────────────────────────┘
```

**The dependency rule:** core modules import other core modules only;
only adapter-layer files may import `vscode`. This keeps all
orchestration logic unit-testable in milliseconds without an extension
host, and quarantines each unstable CLI surface (discovery doc → Risks →
Technical) in one adapter file per provider.

## Interaction mechanism (probe-verified constraint)

An earlier draft of this document assumed adapters could stream terminal
output (`sendInput`/`onOutput` byte chunks). **Probe work against the
real codex CLI (harness 6, 2026-07-01) falsified that:** a Marketplace
extension cannot read a TUI's output through VSCode's public API —
`onDidWriteTerminalData` is a permanently-proposed API (requires
`--enable-proposed-api`, not shippable), there is no screen-buffer API,
and `node-pty` is rejected as ABI-fragile. Writing *to* a terminal
(`Terminal.sendText`) is public; reading from it is not.

**Decision — file-mailbox behind the port, no screen scraping, ever:**

- Each CLI runs its normal interactive TUI in a visible
  `vscode.window.createTerminal` the user can watch and type into
  (this is also what keeps the CONSTITUTION.md interactive-terminal
  rule and the ToS posture intact).
- Structured I/O goes through files: doorbell ping → agent reads
  `inbox/turn-N.md` → writes `outbox/turn-N.json`; **turn boundary =
  the outbox file appearing**.
- Session id and usage/quota are harvested from the CLI's own session
  logs (e.g. codex `rollout-*.jsonl`), never parsed from screen text.

**Consequences:**

- The `AgentProvider` port is a **turn-level interactive-session
  contract** — `send(prompt) → TurnResult`, a coarse event stream,
  `sessionId`, `dispose()` — not a raw byte stream.
- Live status is **coarse**, derived from the mailbox lifecycle
  (launching → ready → busy = awaiting outbox → awaiting-input →
  done / stopped / failed). Keystroke-level "it's thinking right now"
  status would require output streaming via `node-pty`; we do not pay
  that fragility up front — revisit only if coarse status proves
  insufficient in real use.

## Planned module map

| Path | Responsibility | Roadmap epic |
| --- | --- | --- |
| `src/extension.ts` | Composition root: `activate()` constructs adapters, registers providers, wires commands. The only place concrete classes meet. | E1 |
| `src/core/` | Session state machine, typed events, task model | E1 |
| `src/providers/` | `AgentProvider` port, `ProviderRegistry`, one adapter per CLI (`codex-provider.ts`, …) using the terminal + file-mailbox mechanism | E1, E2 |
| `src/workers/` | Worker model (role + soul + memory + track record), `HarnessCompiler` turning worker + project conventions + task briefing into per-CLI instruction payloads | E3 |
| `src/matching/` | `MatchingStrategy` port + suitability, priority, and quota-first implementations | E4 |
| `src/accounts/` | Account-profile store behind a port; secrets via VSCode SecretStorage at the edge | E5 |
| `src/quota/` | Quota snapshots harvested from the CLIs' own session logs (e.g. codex `rollout-*.jsonl`) | E5 |
| `src/orchestration/` | Orchestrator (ceremonies, board state, review gates, retro flywheel) | E6 |
| `src/ui/` | Webview panels (kanban board) | E6 |
| `src/test-utils/` | Fakes/mocks for unit tests (excluded from the extension build) | — |
| `src/test/` | Mocha integration tests inside a real VSCode instance | — |

Create each directory when its epic starts — not before (no speculative
scaffolding).

## Design patterns and why each fits this product

| Pattern | Component | Why it fits |
| --- | --- | --- |
| **Adapter** | `AgentProvider` port; one file-mailbox adapter per CLI | Each CLI (Codex, Antigravity, Claude Code) has a different, *unversioned and unstable* surface (mailbox conventions, session-log formats, launch flags). One port isolates each CLI's quirks in one file: a provider shipping a breaking change means fixing one adapter, not the orchestrator. The port is the turn-level interactive-session contract (`send(prompt) → TurnResult`, coarse events, `sessionId`, `dispose`) — honestly implementable with the probe-verified mechanism, and with no SDK/HTTP shape for a headless implementation to sneak in through. |
| **Registry** | `ProviderRegistry` | Adapters register once at activation; everything else resolves providers by id. Adding a fourth provider = one adapter file + one `register()` line (Open/Closed). |
| **Strategy** | `MatchingStrategy` | "Which worker gets this task" is a top differentiator and is guaranteed to change: fixed provider priority → quota-first → full suitability scoring (model strengths × role fit × soul track record, capacity as tiebreaker) → user-selectable policies (US4.3.1). Swapping the algorithm must not touch callers. |
| **Builder** | `HarnessCompiler` (E3) | A worker's briefing is assembled in layers — project conventions (CONSTITUTION.md) + role + soul + memory/lessons + task briefing — then rendered into each CLI's native instruction format (CLAUDE.md / AGENTS.md / GEMINI.md) and kickoff prompt. Layered assembly with per-CLI rendering delegated to the provider adapter keeps one worker portable across providers, and makes the compiled harness previewable (US3.3.2). |
| **Repository** | `WorkerStore` / soul & memory persistence (E3) | Roles, souls, lessons, and track records are plain versionable files behind a port, so a great worker is a portable, shareable asset. Storage location (workspace vs. global) is an edge concern the core never sees. |
| **State** (explicit state machine) | `AgentSessionStateMachine` | Session state is *inferred* — from turn-boundary files appearing, session-log harvest, and process watch — so inference bugs are inevitable. A transition table (launching → ready → busy → awaiting-input → done/stopped/failed) makes legal lifecycles explicit and turns those bugs into loud "illegal transition" errors instead of silently corrupting the board. |
| **Observer** | Typed event emitter in core; `vscode.EventEmitter` at the edge | Many observers (sidebar, board, standup summarizer, quota tracker) react to one session's events. Subscriptions return `Disposable` to match VSCode's lifecycle idiom. |
| **Facade / Composition root** | `extension.ts` `activate()` | VSCode commands stay thin: parse arguments, delegate to core, render results. All construction and wiring happens in one place via plain constructor injection — no DI framework. |
| **Mediator** | `Orchestrator` (E6) | Workers never talk to each other directly; the orchestrator routes hand-offs (dev → QA review, PO approval gates, retro → soul updates and replanning) so ceremony rules live in one place instead of being scattered across sessions. |
| **Interpreter/parser as pure function** | Session-file parsers (E1) | The riskiest code in the product — but it consumes *structured files* (the CLI's own `rollout-*.jsonl`, outbox JSON), never ANSI screen text. Built as pure functions tested against fixture-recorded real session files, so an upstream format change is caught by re-recording fixtures, not by users. |

## Practices (enforced by review)

- **Constructor injection, no DI container.** Dependencies arrive as
  constructor parameters typed as ports. Defaults allowed, hidden
  singletons not.
- **No speculative abstraction.** Ports exist only where a real seam is
  needed (provider surface, routing policy, account store). No interface
  for a class with a single conceivable implementation.
- **Everything disposable.** Anything holding a subscription, terminal,
  file watcher, or timer implements `dispose()` and is pushed onto
  `context.subscriptions` at the root.
- **Fail fast in core, degrade gracefully at the edge.** Core throws on
  contract violations (duplicate registration, illegal transition);
  adapters catch and surface friendly VSCode notifications.
- **Tests:** every core module gets a colocated `*.test.ts` (vitest);
  adapter behavior is covered by `src/test/` integration tests in a real
  VSCode instance; parsers get transcript-fixture tests.
- **ToS posture as a design constraint** (discovery → Risks →
  Legal/ToS): session concurrency and input cadence per account must
  stay within what a human power user plausibly produces. Any feature
  that raises either (parallel fan-out, auto-retry storms) needs an
  explicit throttle designed in, not bolted on.
