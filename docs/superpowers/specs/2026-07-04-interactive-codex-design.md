# Interactive Codex Adapter — Design (canonical frame)

**Date:** 2026-07-04
**Epic:** Adapters · **Feature/US:** Interactive (terminal) mode — Codex
**Status:** Ported into `active/` from the prior worktree (`6/`) spec dated
2026-06-30, then reconciled with `active`'s newer `CONSTITUTION.md`. The
reconciliation is not cosmetic: the constitution mandates **pty/terminal only,
never headless flags**, so the /6 "second run mode alongside `codex exec --json`"
framing is dropped — interactive mailbox is now the *only* run mode. Probe
evidence from the source worktree is retained as-is (see *Verified ground
truth*) — no fresh re-probe was run for this port.

## Goal

Drive `codex` as a **live interactive TUI session inside a VSCode terminal**. The
orchestrator pastes prompts *into* the terminal and reads results *out* of files
the agent writes. This buys **multi-turn steering (paused/resumed turns toward one
task completion) + pause/resume in one session** and a human-like execution
surface, while keeping parsing robust.

This is the **only** codex run mode. Per `CONSTITUTION.md` (pty/terminal only, no
headless flags, no provider SDK), there is **no `codex exec --json` path**. A
"fast task" is simply a **single-turn** mailbox session: one inbox turn, the agent
returns `done`, dispose. Multi-turn and single-turn are the same mechanism at
different turn counts.

This document is the **canonical frame** for interactive mode across all three
CLIs. The claude and agy interactive specs (skeletons that restate their
CLI-specific deltas against this one) are **not yet ported to `active/`**; only
codex is in scope here.

## Depends on (prerequisite)

`active/` is currently a bare scaffold (only `src/extension.ts`); the base adapter
layer this spec builds on **does not exist yet** and must land first as its own
upstream US. Reconciled with the constitution, the base layer is **types +
classifier only — no headless one-shot adapter**:

- **Shared adapter types** — `src/adapters/types.ts`: `ErrorClass`
  (`"limit" | "transport" | "terminal"`), `WorkerEvent`, `WorkerUsage`
  (`{ inputTokens, outputTokens, cachedInputTokens?, cacheWriteTokens?,
  reasoningTokens?, costUsd? }`), `WorkerResult`, `RunOpts`, `WorkerRun`,
  `AgentAdapter`.
- **Error classifier** — `src/adapters/classify.ts`: pure
  `classifyError(text): ErrorClass`.

There is deliberately **no** `runCodex`/`codex exec --json` dependency; the /6
one-shot adapter (`6/…/2026-06-29-codex-adapter-design.md`) is superseded by
single-turn interactive mode. If the two symbols above are absent, interactive
mode does not compile; they are a hard prerequisite.

## Why this shape (recorded decisions)

- **pty/terminal only (constitution).** No headless `exec`, no provider SDK. The
  mailbox-over-a-real-terminal design is the *only* mechanism; single-turn is the
  fast path, not a separate headless code path.
- **Ban risk is precautionary only** (no observed bans). So we build **no
  anti-ban machinery**; the human-like surface is a cheap by-product of running
  interactively in a real terminal.
- **Control is the real win:** multi-turn, pause/resume, live human takeover.
- **Public VSCode API cannot read a full-screen TUI's output.** Shell Integration
  only segments normal command/output pairs; a TUI is one endless execution.
  `onDidWriteTerminalData` is permanently proposed (needs `--enable-proposed-api`,
  unusable on Marketplace); there is no screen-buffer API. → **Output flows
  through files, never screen scraping.** VSCode's terminal `selectAll` +
  `copySelection` can dump the visible terminal into the clipboard for a manual
  diagnostic probe, but the result is noisy, mutable screen text, not a production
  data source.
- **No `node-pty`.** Native ABI must match VSCode's Electron, officially
  unsupported, breaks on VSCode updates. → Use VSCode's own `createTerminal`.
- **Session metadata is read from the CLI's own rollout file, not the screen** —
  accurate usage/session-id without trusting agent self-report.
- **Protocol never touches the project's real instruction file.** It lives in the
  disposable, gitignored mailbox dir and is delivered by the readiness ping (see
  *Protocol contract*). Rationale in the readiness/component notes below.

## Verified ground truth (real CLI)

`codex` (Rust/ratatui TUI). Sources: developers.openai.com/codex, github.com/openai/codex,
and the prior worktree's `src/test/terminal-probe.test.ts` (`TERMINAL_PROBE=1`,
run 2026-07-01 against a real `codex-cli 0.142.4` install — mailbox
pause/resume/done cycle, submit key, and `/status` all passed). This port
**trusts that evidence** rather than re-probing; when the base layer is
implemented in `active/`, the probe test is ported alongside and re-run per the
CONSTITUTION's "probe the real binary" rule.

- **Launch interactive:** `codex -C <cwd> -m <model> -s workspace-write -a never`
  (or `--dangerously-bypass-approvals-and-sandbox` / `--yolo` to never block on
  approvals). Flags are global (shared by `codex`, `resume`).
  > [!NOTE]
  > **VERIFIED** (prior worktree) — `terminal-probe.test.ts` (`TERMINAL_PROBE=1`,
  > run 2026-07-01) launches with this exact `-a never` argv and completes a
  > two-turn pause/resume/done cycle with no stuck approval prompt. `-a never`
  > is confirmed *auto-approve within sandbox*, not *deny everything*; the
  > `--yolo` fallback is not needed.
- **Session rollout file:** `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl`
  (default `~/.codex`). JSONL of `RolloutLine` envelopes `{ "type", "payload" }`,
  **written incrementally** during the session. Relevant lines:
  - `session_meta` → conversation/session **id**, cwd, cli version, git info.
  - `event_msg` with `payload.type === "token_count"` → **cumulative** usage:
    `payload.info.total_token_usage.{input_tokens,cached_input_tokens,output_tokens,reasoning_output_tokens,total_tokens}`;
    `payload.info.last_token_usage` for the last turn; `payload.info.model_context_window`;
    and `payload.rate_limits` with 5h/weekly usage. Per-turn = current cumulative − previous cumulative
    unless `last_token_usage` is sufficient for the caller.
- **`/status` slash command:** verified in a real VSCode terminal. It prints the
  session id, model, cwd, permissions, AGENTS.md path, account, collaboration
  mode, context-window usage, and 5h/weekly limit status. The `Session:` value
  matches both `session_meta.id` and the rollout filename UUID. Treat this as a
  diagnostic/human-visible check only; production harvest still reads rollout
  JSONL.
- **Resume:** `codex resume <id>` / `codex resume --last` / `/resume` in-TUI. The
  id is the rollout UUID. Native resume is our **crash-recovery fallback**.
- **`CODEX_HOME`** relocates the whole home (config + `sessions/`), so per-account
  isolation (via `opts.configDir`) moves the rollout files too.
- **Submit key:** VSCode terminal injection is paste-like to Codex. Plain Enter
  (`\r`) and kitty Enter (`[13u`) both land as newlines in the composer.
  The verified automation path is to launch Codex with process-local config
  overrides: `-c disable_paste_burst=true`,
  `-c 'tui.keymap.composer.submit="tab"'`, and
  `-c 'tui.keymap.composer.queue="ctrl-q"'`, then submit with
  `sendSequence("\t")`.

## Architecture (canonical — shared by all three CLIs)

CLI-agnostic core in `src/adapters/interactive/`; each CLI supplies a **profile**.

```
ORCHESTRATOR (extension host)              TERMINAL (codex TUI — human-visible)
─────────────────────────────             ─────────────────────────────────────
0. write .skynet/<id>/protocol.md
   + inbox/turn-0.md (readiness)
   sendText("Read protocol.md, then ──────►  agent reads protocol.md (its own tools)
   inbox/turn-0.md and follow it")       agent writes outbox/turn-0.json = ready
   + sendSequence(submitSequence)        (idempotent: safe to re-ping if lost)
1. write inbox/turn-N.md  ───────┐
2. sendText("Read inbox/turn-N.md└──────►  agent at prompt receives the ping
   and follow it", false)              agent reads inbox file, does the work
   + sendSequence(submitSequence)      agent works…  ◄── user may watch / take over
3. poll outbox/turn-N.json  ◄──────────── agent writes outbox/turn-N.json on stop
4. read+parse outbox → TurnResult
5. SessionHarvester reads newest    ◄──── codex appends rollout-*.jsonl itself
   rollout-*.jsonl → sessionId+usage
   (CLI fallback: ask agent to write session-info.json)
6. decide next turn:
   · pause  = withhold next ping
   · resume = write inbox/turn-(N+1) + ping
   · single-turn "fast task" = one real turn, expect done, dispose
──────────────────────── SAD PATH ────────────────────────
· timeout: no outbox within T  → status 'timeout'
· poll process group / recursive descendants: no codex → status 'crashed'
· onDidCloseTerminal / exitStatus → terminal died
```

### Components

1. **`TerminalSession`** — wraps `vscode.window.createTerminal({ name, cwd, env })`
   running the interactive launch argv. Captures shell PID via `terminal.processId`.
   Owns disposal + `onDidCloseTerminal`.
2. **`Mailbox`** — per-run dir `<cwd>/.skynet/<workerId>/{inbox,outbox}/` plus
   `<cwd>/.skynet/<workerId>/protocol.md`. Writes `inbox/turn-N.md`; resolves the
   turn by **polling** `outbox/turn-N.json` (no `vscode.FileSystemWatcher`).
   (`workerId` in the path is the only multi-worker affordance in v1.) On first
   run, ensure `.skynet/` is in the repo `.gitignore` (append if absent) so the
   mailbox never shows in `git status`. `dispose()` removes the `<workerId>` dir
   (protocol + inbox + outbox all vanish together). The protocol teaches
   tmp+rename; the read is a **poll loop (every ~500ms) with the same timeout as
   the turn** — it is the only detection mechanism, and it doubles as the
   parse-error retry when the agent writes directly or the poll sees a file
   mid-write: on `ENOENT` or a JSON parse error it keeps polling until the file is
   valid or the turn times out. *(ponytail: `terminal-probe.test.ts` proved a
   plain poll loop end-to-end for both codex and agy-ultra; a `FileSystemWatcher`
   would still need this same poll as its parse-retry fallback, so it buys nothing
   — one mechanism, not two. Poll interval is a tuning knob, not load-bearing.)*
3. **`Doorbell`** — `terminal.show(false)` → `sendText(pingLine, false)` →
   `commands.executeCommand("workbench.action.terminal.sendSequence", { text: profile.submitSequence })`.
   The ping is tiny (`Read .skynet/<id>/inbox/turn-N.md and follow it.`) so it
   dodges large-paste corruption.
4. **Protocol file** — the mailbox protocol (below) is written **once** to
   `.skynet/<workerId>/protocol.md` at session start and delivered by the turn-0
   readiness ping (`Read .skynet/<id>/protocol.md, then …`). **The project's real
   instruction file (`AGENTS.md`, `CLAUDE.md`, …) is never touched** — no
   marker-block append, no teardown, no crash-leftover in a tracked project file.
   Because the codex session is one continuous TUI, reading `protocol.md` at
   turn-0 keeps the contract in context for every later turn; each `inbox/turn-N.md`
   also closes with a one-line reminder (`write outbox/turn-N.json per protocol`)
   as belt-and-suspenders. `dispose()` removes `protocol.md` with the rest of the
   mailbox dir. *(ponytail: this deletes the /6 instruction-file
   bootstrap/teardown component and its marker machinery entirely — a file in a
   disposable dir needs neither.)*
5. **`SessionHarvester`** — locates the newest `rollout-*.jsonl` under
   `profile.sessionDir(configDir)`, parses `session_meta` + latest `token_count`
   into `{ sessionId, usage, rateLimits? }`. Read on each turn and at dispose.
6. **Optional `SessionInfoProbe`** — for CLIs without a useful transcript, sends a
   tiny prompt asking the agent to write `outbox/session-info.json` with stable
   fields such as `conversationId`, `model`, `workspace`, and `artifactDirectory`.
   Codex does not need this for production because rollout JSONL is authoritative.
7. **`InteractiveSession`** (orchestrator) — the state machine driving turns.

### Per-CLI profile (the seam the skeletons fill)

```ts
interface InteractiveCliProfile {
  id: "codex" | "claude" | "agy";
  launchArgv(opts: InteractiveOpts): string[];        // interactive TUI launch
  configEnv(configDir?: string): Record<string, string>; // CODEX_HOME / CLAUDE_CONFIG_DIR / HOME
  submitSequence: string;                              // Codex uses "\t" with submit bound to Tab
  sessionDir(configDir?: string): string;              // absolute path; no "~" shorthand
  harvest(sessionFileText: string): { sessionId?: string; usage?: WorkerUsage; rateLimits?: unknown };
  sessionInfoPrompt?(outboxPath: string): string;       // fallback when harvest() cannot provide session id
}
```

*(The `/6` profile had an `instructionFile` field for the AGENTS.md-append
delivery; it is removed — protocol now ships via `protocol.md` in the mailbox
dir, so no per-CLI instruction-file knowledge is needed.)*

**Codex profile (fully specified):**

```ts
const codexInteractive: InteractiveCliProfile = {
  id: "codex",
  launchArgv: (o) => ["-C", o.cwd, ...(o.model ? ["-m", o.model] : []),
                      "-s", o.sandbox ?? "workspace-write", "-a", "never",
                      "-c", "disable_paste_burst=true",
                      "-c", 'tui.keymap.composer.submit="tab"',
                      "-c", 'tui.keymap.composer.queue="ctrl-q"'],
  configEnv: (dir) => dir ? { CODEX_HOME: dir } : {},
  submitSequence: "\t",                                // probe-verified VSCode submit path
  sessionDir: (dir) => dir ? path.join(dir, "sessions")
                           : path.join(os.homedir(), ".codex", "sessions"),
                           // recurse YYYY/MM/DD, newest rollout-*.jsonl
  harvest: (text) => parseCodexRollout(text),          // session_meta.id + token_count.info
};
```

## Public shape

```ts
// src/adapters/interactive/types.ts
interface InteractiveOpts {
  cwd: string;
  workerId: string;
  model?: string;
  configDir?: string;
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  turnTimeoutMs?: number;   // default 300_000
  readyTimeoutMs?: number;  // default 30_000 (turn-0 readiness probe)
}

// TurnResult is an interactive-private per-turn state. WorkerUsage/ErrorClass are shared (base layer).
type TurnResult =
  | { status: "paused";  summary: string }                                  // simple JSON
  | { status: "done";    summary: string; usage?: WorkerUsage; filesTouched?: string[] } // rich
  | { status: "error";   reason: string; errorClass?: ErrorClass }
  | { status: "timeout" }
  | { status: "crashed" };

interface InteractiveSession extends AsyncIterable<WorkerEvent> {
  send(prompt: string): Promise<TurnResult>;   // write inbox + doorbell; resolve on outbox / timeout / crash
  readonly sessionId: Promise<string | undefined>;  // from rollout harvest or CLI fallback
  dispose(): Promise<void>;                     // remove mailbox dir, kill terminal (async cleanup)
}
```

**Integration seam.** Interactive mailbox is the *only* mechanism. `AgentAdapter`
(base layer) exposes it; there is no separate headless `run()`.

```ts
interface AgentAdapter {
  readonly id: "codex" | "claude" | "agy";
  runInteractive(opts: InteractiveOpts): Promise<InteractiveSession>; // multi-turn or single-turn
  // A "fast task" is a convenience over the same session: start, send one turn,
  // expect `done`, dispose. It is not a separate code path.
}
```

After a turn resolves `done`, the session is complete: further `send()` calls
**reject** (`session already completed`) and `dispose()` is the only valid next
call. The terminal stays open for inspection / human takeover until `dispose()`;
interactive mode does not auto-kill it on `done`.

`TurnResult` maps back to the base-layer `WorkerResult` only at the final adapter
boundary: `done → success`, `error → failed`, `timeout → failed` with
`errorClass:"transport"`, `crashed → failed` with `errorClass:"terminal"`.
`paused` is not a `WorkerResult`; it keeps the same `InteractiveSession` open.

`pause`/`resume` is orchestrator-side: to pause, do not call `send` again; to
resume, call `send` with the next prompt. The `events` async-iterable emits a
sparse stream for the panel (`started`, and one `message` per turn carrying the
outbox `summary`); `usage` events are emitted from the harvest when present and
also copied onto the resolving `TurnResult`.

> **Enrichment note (ordering contract):** the `started` event carries
> `sessionId`, but the session id is produced by the **asynchronous rollout
> harvest**, not synchronously at launch. The contract: `started` is emitted
> once the first harvest yields a `sessionId` (or with `sessionId` empty if
> harvest has not resolved by the first turn's completion — the readonly
> `sessionId` promise is the authoritative accessor). Consumers must not assume
> `started` precedes the first `send()`; the iterator is passive.

`send()` is the active driver; the iterator is passive observation,
single-consumer like `WorkerRun`, and completes on `done` / `error` / `timeout` /
`crashed` / `dispose()`. *(ponytail: no custom backpressure in v1; event volume
is one or two events per turn.)*

## Protocol contract (delivered via `.skynet/<workerId>/protocol.md`)

Written once to the mailbox dir at session start; the turn-0 readiness ping tells
the agent to read it. Contents:

> For each `inbox/turn-N.md` I give you: do the work it asks, then **write
> `outbox/turn-N.json` before you stop**, matching the same `N`:
> - Readiness (turn 0) → `{ "status": "paused", "summary": "ready" }` after reading this file
> - Pausing / need the next instruction → `{ "status": "paused", "summary": "<what you did>" }`
> - Whole task complete → `{ "status": "done", "summary": "...", "filesTouched": ["..."] }`
> - Unrecoverable error → `{ "status": "error", "reason": "..." }`
>
> Never delete inbox files. Write the outbox file in a **single operation** as the
> **last action** of a turn (write `turn-N.json.tmp`, then rename to `turn-N.json`)
> so the orchestrator rarely sees a half-written file. The mailbox retry remains
> mandatory because the agent may ignore this instruction.

The outbox **existence** is the turn boundary; its `status` decides the next move.
For Codex, usage/session-id never come from the agent — they come from the rollout
harvest. For CLIs without rollout-equivalent metadata, `session-info.json` is an
explicit degraded fallback.

## Readiness handshake & sad path

- **Readiness is turn-0, separate from real work.** After launch we cannot read
  the terminal, so a **synthetic turn-0** is the readiness probe: it only asks the
  agent to read `protocol.md` and write `outbox/turn-0.json = {"status":"paused",
  "summary":"ready"}`. If no `outbox/turn-0.json` appears within `readyTimeoutMs`
  (default 30s), **re-send the turn-0 ping once** before declaring failure
  (mitigates the documented sendText startup race). This resend is safe *because
  turn-0 does no real work* — re-reading `protocol.md` and re-writing `ready` is
  idempotent. A short fixed pre-ping delay (~1.5s) reduces the race further.
  *(ponytail: delay is a tuning knob, not load-bearing.)*
  > **Why not re-ping real turns:** the /6 spec used turn-1 as *both* readiness
  > probe and first real task, so a first task slower than `readyTimeoutMs` got
  > re-pinged and the agent could re-execute it (duplicate work). Splitting
  > readiness into an idempotent turn-0 removes that hazard; **real-work turns
  > (N ≥ 1) are never resent** — their only guard is `turnTimeoutMs`.
- **Turn timeout** (`turnTimeoutMs`, default 5 min): no outbox → `timeout`. This
  is the sole guard for real-work turns.
- **Crash:** poll the terminal process group (`pgrep -g <pgid>`) or recursively
  walk descendants of `terminal.processId` on macOS/Linux every ~3s; no `codex`
  descendant while the turn is open → `crashed`. This is best-effort; terminal
  close and turn timeout are still the hard signals.
  *(ponytail: Windows child-PID polling is TBD; macOS/Linux only in v1.)*
- **Terminal death:** `onDidCloseTerminal` / `exitStatus` → `crashed`.
- On `timeout`/`crashed`, the orchestrator may attempt `codex resume <sessionId>`
  (recovery is **out of scope for v1** — we surface the status; recovery is a later US).

## Error classification

Reuse the base-layer pure `classifyError(text)` (`limit`/`transport`/`terminal`).
Inputs available to it in interactive mode: the agent-written `error.reason`, plus
any stderr from terminal close. *(ponytail: a real 429 mid-TUI may kill the session
before the agent writes `error.json`; then we report `crashed`, and a later
fallback US classifies from the rollout/last-known state.)*

## Toolchain (active)

Reconciled with `active/`'s `CONSTITUTION.md` and real config — this replaces the
prior worktree's npm/mocha conventions:

- **Package manager:** pnpm only. Commands: `pnpm run test:unit`,
  `pnpm run test:integration`, `pnpm test`, `pnpm run lint` (`biome check .`).
- **Unit tests (vitest):** colocated next to source as
  `src/adapters/interactive/<module>.test.ts`. `vitest.config.ts` includes
  `src/**/*.test.ts` and **excludes `src/test/**`**, so unit tests must *not*
  live under `src/test/`. vitest aliases `vscode` → `src/test-utils/vscode-mock.ts`,
  so pure-logic and fake-`TerminalTransport` tests run headless with no VSCode host.
- **Integration tests (`@vscode/test-cli`):** live under `src/test/**` (excluded
  from vitest), run by `pnpm run test:integration` inside a real VSCode instance.
  The real `vscode.Terminal` transport test and the opt-in real-CLI e2e go here.
- **Linter/formatter:** Biome only (no ESLint/Prettier). TypeScript strict.
  Filenames kebab-case; `*.test.ts` colocated (unit) or under `src/test/`
  (integration).
- **Real-CLI e2e gate:** gated behind an env flag (e.g. `CODEX_INTERACTIVE_E2E`)
  so `pnpm test` does not burn quota by default.

## Proof of function (acceptance gate)

Abstract the terminal + clock behind a `TerminalTransport` interface so the core is
testable without a real CLI. Each test's runner is called out (vitest unit vs.
`@vscode/test-cli` integration) per the toolchain above.

- **readiness (turn-0)** *(vitest unit, fake transport):* `send`-less start → the
  synthetic turn-0 ping fires; fake writes `outbox/turn-0.json = ready` → session
  becomes ready. If the fake withholds turn-0, the ping is **re-sent once** after
  `readyTimeoutMs`, then the session fails ready.
- **no-resend on real turns** *(vitest unit, fake transport):* fake delays a real
  turn past `readyTimeoutMs` → assert the doorbell ping for that turn fires
  **exactly once** (no duplicate execution); the turn resolves via `turnTimeoutMs`
  only.
- **turn cycle** *(vitest unit, fake transport):* `send()` → fake writes
  `outbox/turn-N.json` → assert `TurnResult` for each of `paused` / `done` (with
  usage from a fake rollout) / `error`.
- **timeout** *(vitest unit):* fake never writes outbox → `status:'timeout'` after `turnTimeoutMs`.
- **partial outbox** *(vitest unit):* fake writes invalid JSON then valid → reader
  retries and resolves on the valid content, not the half-written one.
- **crash** *(vitest unit):* fake reports no child PID → `status:'crashed'`.
- **protocol file** *(vitest unit):* start writes `.skynet/<id>/protocol.md` with
  the contract text; `dispose()` removes it with the mailbox dir; **the project's
  `AGENTS.md` is never created or modified** (assert byte-identical before/after,
  including the absent-file case).
- **rollout parser** *(vitest unit, pure):* `parseCodexRollout(sample)` extracts `sessionId`
  from `session_meta`, usage from `token_count.info.total_token_usage`, and
  optional `rate_limits`, using a real sample JSONL captured from `codex`.
- **doorbell** *(vitest unit, pure):* asserts the exact `sendText(ping,false)` +
  `sendSequence("\t")` calls.
- **terminal transport** *(`@vscode/test-cli` integration):* real
  `vscode.Terminal` resolves a `processId` and disposes cleanly.
- **submit-key gate** *(manual, pre-plan):* **DONE (prior worktree)** —
  `terminal-probe.test.ts` (`TERMINAL_PROBE=1`, run 2026-07-01) proves Codex
  launched with the process-local keymap/paste-burst overrides submits via
  `sendSequence("\t")` in a real VSCode integrated terminal. Ported alongside the
  base layer and re-run in `active/`.
- **slash-status diagnostic** *(manual, non-production):* **DONE (prior worktree)** —
  the same probe run sends `/status`, copies the terminal selection, and asserts
  the raw text contains session/model/sandbox/approval/account/cwd hints. Proves
  the human-visible status surface; does not replace rollout harvesting.
- **session-info fallback** *(manual/CLI-specific):* **N/A for codex** (rollout
  harvest is authoritative); the same probe mechanism is proven for agy-ultra,
  which needs the fallback.
- **integration** *(`@vscode/test-cli`, real codex, slow, uses quota, env-gated):*
  calls `startInteractive(codexInteractive, opts)` directly, `send()`s a turn-0
  readiness plus two real turns, and asserts outbox-derived `TurnResult`s +
  harvested usage from the real rollout file + a live human can still type in the
  terminal.

## Out of scope (v1)

- Base adapter layer (shared types + `classifyError`) — a **prerequisite** US, not
  this one (see *Depends on*).
- Multi-worker fleet / scheduler (only `workerId` path naming is reserved).
- claude / agy interactive (their skeleton specs; same frame, different profile;
  not yet ported to `active/`).
- Automated crash/timeout **recovery** via `codex resume` (later US).
- Windows child-PID polling.
- Webview panel rework for the sparse interactive event stream (smoke log only).
