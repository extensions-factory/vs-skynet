# Interactive Codex Adapter — Design

**Date:** 2026-07-04
**Epic:** Adapters · **US:** Interactive (terminal) mode — Codex

## Goal

Drive `codex` as a **live interactive TUI session inside a VSCode terminal**. The
orchestrator writes prompts to files, pastes a tiny ping *into* the terminal, and
reads results *out* of files the agent writes. This gives **multi-turn steering
(paused/resumed turns toward one task completion), pause/resume in one session**,
and a human-visible execution surface, while keeping parsing robust.

Interactive mailbox is the **only** run mode. A "fast task" is a **single-turn**
session: one work turn, the agent returns `done`, dispose. Multi-turn and
single-turn are the same mechanism at different turn counts.

The core is CLI-agnostic; each CLI supplies a **profile**. This spec specifies the
**codex** profile.

## Prerequisites

Interactive mode consumes a small shared adapter layer:

- `src/adapters/types.ts` — `ErrorClass` (`"limit" | "transport" | "terminal"`),
  `WorkerEvent`, `WorkerUsage`
  (`{ inputTokens, outputTokens, cachedInputTokens?, cacheWriteTokens?, reasoningTokens?, costUsd? }`),
  `WorkerResult`, `RunOpts`, `WorkerRun`, `AgentAdapter`.
- `src/adapters/classify.ts` — pure `classifyError(text): ErrorClass`.

These are a hard prerequisite: without them interactive mode does not compile.

## Ground truth (real CLI)

`codex` is a Rust/ratatui TUI. Verified against a real `codex-cli 0.142.4` install
via a terminal probe (mailbox pause/resume/done cycle, submit key, and `/status`
all confirmed).

- **Launch:** `codex -C <cwd> -m <model> -s workspace-write -a never`
  plus process-local overrides `-c disable_paste_burst=true`,
  `-c 'tui.keymap.composer.submit="tab"'`, `-c 'tui.keymap.composer.queue="ctrl-q"'`.
  Flags are global (shared by `codex` and `resume`).
  > [!NOTE]
  > **Verified:** this exact argv launches and completes a two-turn
  > pause/resume/done cycle with no stuck approval prompt. `-a never` is
  > *auto-approve within sandbox*, not *deny everything*.
- **Submit key:** terminal injection is paste-like; plain Enter (`\r`) and kitty
  Enter (`[13u`) both land as newlines in the composer. With the keymap overrides
  above, submit is `sendSequence("\t")`.
- **Session rollout file:** `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl`
  (default `~/.codex`). JSONL of `RolloutLine` envelopes `{ "type", "payload" }`,
  written incrementally during the session:
  - `session_meta` → session **id**, cwd, cli version, git info.
  - `event_msg` with `payload.type === "token_count"` → **cumulative** usage in
    `payload.info.total_token_usage.{input_tokens,cached_input_tokens,output_tokens,reasoning_output_tokens,total_tokens}`;
    `last_token_usage` for the last turn; `model_context_window`; and
    `payload.rate_limits` (5h/weekly). Per-turn = current cumulative − previous.
- **`/status`** prints session id, model, cwd, permissions, account, and limit
  status; the `Session:` value matches `session_meta.id` and the rollout filename
  UUID. Diagnostic only; production reads rollout JSONL.
- **Resume:** `codex resume <id>` / `--last` / `/resume` in-TUI; the id is the
  rollout UUID.
- **`CODEX_HOME`** relocates the whole home (config + `sessions/`), so per-account
  isolation via `opts.configDir` moves the rollout files too.

## Architecture

CLI-agnostic core in `src/adapters/interactive/`; each CLI supplies a profile.

```
ORCHESTRATOR (extension host)              TERMINAL (codex TUI — human-visible)
─────────────────────────────             ─────────────────────────────────────
0. write .skynet/<id>/protocol.md
   + inbox/turn-0.md (readiness)
   ping "Read protocol.md, then     ──────►  agent reads protocol.md (its own tools)
   inbox/turn-0.md and follow it"          agent writes outbox/turn-0.json = ready
   + sendSequence(submitSequence)          (idempotent: safe to re-ping if lost)
1. write inbox/turn-N.md  ───────┐
2. ping "Read inbox/turn-N.md     └──────►  agent reads inbox file, does the work
   and follow it"                          agent works…  ◄── user may watch / take over
   + sendSequence(submitSequence)
3. poll outbox/turn-N.json  ◄──────────── agent writes outbox/turn-N.json on stop
4. read + parse outbox → TurnResult
5. harvest newest rollout-*.jsonl   ◄──── codex appends rollout-*.jsonl itself
   → sessionId + usage
6. next turn:
   · pause  = withhold next ping
   · resume = write inbox/turn-(N+1) + ping
   · fast task = one work turn, expect done, dispose
──────────────────────── SAD PATH ────────────────────────
· no outbox within turnTimeout        → status 'timeout'
· no codex descendant while turn open → status 'crashed'
· onDidCloseTerminal / exitStatus     → terminal died
```

### Components

1. **`TerminalSession`** — wraps `vscode.window.createTerminal({ name, cwd, env })`
   running the launch argv. Captures shell PID via `terminal.processId`. Owns
   disposal + `onDidCloseTerminal`.
2. **`Mailbox`** — per-run dir `<cwd>/.skynet/<workerId>/` holding `inbox/`,
   `outbox/`, and `protocol.md`. Writes `inbox/turn-N.md`; resolves the turn by
   **polling** `outbox/turn-N.json` every ~500ms up to the turn timeout. The poll
   is also the parse-error retry: on `ENOENT` or invalid JSON (file mid-write) it
   keeps polling until the file is valid or the turn times out. Ensures `.skynet/`
   is in the repo `.gitignore` (appends if absent). `dispose()` removes the
   `<workerId>` dir. `workerId` in the path is the only multi-worker affordance.
3. **`Doorbell`** — `terminal.show(false)` → `sendText(pingLine, false)` →
   `sendSequence(profile.submitSequence)`. The ping is tiny
   (`Read .skynet/<id>/inbox/turn-N.md and follow it.`) so it survives paste.
4. **Protocol file** — the mailbox protocol (see *Protocol contract*) is written
   once to `.skynet/<workerId>/protocol.md` at session start and delivered by the
   turn-0 readiness ping. The project's own instruction file (`AGENTS.md`, …) is
   never read or written. Because the codex session is one continuous TUI, reading
   `protocol.md` at turn-0 keeps the contract in context for later turns; each
   `inbox/turn-N.md` also closes with a one-line reminder
   (`write outbox/turn-N.json per protocol`) as belt-and-suspenders.
   `dispose()` removes it with the mailbox dir.
5. **`SessionHarvester`** — finds the newest `rollout-*.jsonl` under
   `profile.sessionDir(configDir)` (recursing `YYYY/MM/DD`), parses `session_meta`
   + latest `token_count` into `{ sessionId, usage, rateLimits? }`. Read on each
   turn and at dispose.
6. **`SessionInfoProbe`** (optional) — for CLIs without a useful transcript, asks
   the agent to write `outbox/session-info.json`. Not used for codex; rollout JSONL
   is authoritative.
7. **`InteractiveSession`** — the state machine driving turns.

### Per-CLI profile

```ts
interface InteractiveCliProfile {
  id: "codex" | "claude" | "agy";
  launchArgv(opts: InteractiveOpts): string[];
  configEnv(configDir?: string): Record<string, string>;   // CODEX_HOME / CLAUDE_CONFIG_DIR / HOME
  submitSequence: string;                                    // Codex: "\t" (submit bound to Tab)
  sessionDir(configDir?: string): string;                    // absolute path
  harvest(sessionFileText: string): { sessionId?: string; usage?: WorkerUsage; rateLimits?: unknown };
  sessionInfoPrompt?(outboxPath: string): string;            // fallback when harvest() has no session id
}

const codexInteractive: InteractiveCliProfile = {
  id: "codex",
  launchArgv: (o) => ["-C", o.cwd, ...(o.model ? ["-m", o.model] : []),
                      "-s", o.sandbox ?? "workspace-write", "-a", "never",
                      "-c", "disable_paste_burst=true",
                      "-c", 'tui.keymap.composer.submit="tab"',
                      "-c", 'tui.keymap.composer.queue="ctrl-q"'],
  configEnv: (dir) => dir ? { CODEX_HOME: dir } : {},
  submitSequence: "\t",
  sessionDir: (dir) => dir ? path.join(dir, "sessions")
                           : path.join(os.homedir(), ".codex", "sessions"),
  harvest: (text) => parseCodexRollout(text),
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

type TurnResult =
  | { status: "paused";  summary: string }
  | { status: "done";    summary: string; usage?: WorkerUsage; filesTouched?: string[] }
  | { status: "error";   reason: string; errorClass?: ErrorClass }
  | { status: "timeout" }
  | { status: "crashed" };

interface InteractiveSession extends AsyncIterable<WorkerEvent> {
  send(prompt: string): Promise<TurnResult>;        // write inbox + ring doorbell; resolve on outbox / timeout / crash
  readonly sessionId: Promise<string | undefined>;   // from rollout harvest
  dispose(): Promise<void>;                          // remove mailbox dir, kill terminal
}

interface AgentAdapter {
  readonly id: "codex" | "claude" | "agy";
  runInteractive(opts: InteractiveOpts): Promise<InteractiveSession>;
}
```

`send()` is the active driver. After a turn resolves `done`, the session is
complete: further `send()` calls **reject** (`session already completed`) and
`dispose()` is the only valid next call. The terminal stays open for inspection /
human takeover until `dispose()`.

`TurnResult` maps to `WorkerResult` at the adapter boundary: `done → success`,
`error → failed`, `timeout → failed` (`errorClass:"transport"`),
`crashed → failed` (`errorClass:"terminal"`). `paused` is not a `WorkerResult`; it
keeps the session open. Pause/resume is orchestrator-side: to pause, do not call
`send` again; to resume, call `send` with the next prompt.

The `events` async-iterable is passive observation, single-consumer, and emits a
sparse stream: `started`, one `message` per turn (the outbox `summary`), and
`usage` from the harvest when present (also copied onto the resolving
`TurnResult`). It completes on `done` / `error` / `timeout` / `crashed` /
`dispose()`.

`started` carries `sessionId`, but that id comes from the asynchronous rollout
harvest, not synchronously at launch: `started` is emitted once the first harvest
yields a `sessionId` (or with `sessionId` empty if harvest has not resolved by the
first turn's completion). The readonly `sessionId` promise is the authoritative
accessor; consumers must not assume `started` precedes the first `send()`.

## Protocol contract

Written once to `.skynet/<workerId>/protocol.md`; the turn-0 ping tells the agent
to read it.

> For each `inbox/turn-N.md` I give you: do the work it asks, then **write
> `outbox/turn-N.json` before you stop**, matching the same `N`:
> - Readiness (turn 0), after reading this file → `{ "status": "paused", "summary": "ready" }`
> - Pausing / need the next instruction → `{ "status": "paused", "summary": "<what you did>" }`
> - Whole task complete → `{ "status": "done", "summary": "...", "filesTouched": ["..."] }`
> - Unrecoverable error → `{ "status": "error", "reason": "..." }`
>
> Never delete inbox files. Write the outbox file in a **single operation** as the
> **last action** of a turn (write `turn-N.json.tmp`, then rename to `turn-N.json`)
> so the orchestrator rarely sees a half-written file.

The outbox **existence** is the turn boundary; its `status` decides the next move.
Usage and session id never come from the agent — they come from the rollout
harvest. The mailbox poll retry is mandatory regardless, because the agent may
ignore the single-operation instruction.

## Readiness & sad path

- **Readiness is turn-0.** A synthetic turn-0 asks the agent only to read
  `protocol.md` and write `outbox/turn-0.json = {"status":"paused","summary":"ready"}`.
  If none appears within `readyTimeoutMs` (30s), the turn-0 ping is **re-sent
  once** before declaring failure. A ~1.5s pre-ping delay reduces the sendText
  startup race.
- **Real-work turns (N ≥ 1) are never re-sent.** Their only guard is
  `turnTimeoutMs` (default 5 min): no outbox → `timeout`.
- **Crash:** every ~3s, walk the descendants of `terminal.processId` on
  macOS/Linux (`ps -Ao pid,ppid,comm`); no `codex` descendant while a turn is open
  → `crashed`. Best-effort; terminal close and turn timeout are the hard signals.
- **Terminal death:** `onDidCloseTerminal` / `exitStatus` → `crashed`.
- On `timeout`/`crashed`, the status is surfaced; automated recovery is out of
  scope for v1.

## Error classification

Reuse the pure `classifyError(text)` (`limit`/`transport`/`terminal`). Inputs: the
agent-written `error.reason` plus any stderr from terminal close. A rate-limit
error mid-TUI may kill the session before the agent writes an error outbox; that
surfaces as `crashed`.

## Toolchain

- **pnpm** only: `pnpm run test:unit`, `pnpm run test:integration`, `pnpm test`,
  `pnpm run lint` (`biome check .`).
- **Unit tests (vitest):** colocated as `src/adapters/interactive/<module>.test.ts`.
  `vitest.config.ts` includes `src/**/*.test.ts` and excludes `src/test/**`, so
  unit tests do not live under `src/test/`. vitest aliases `vscode` →
  `src/test-utils/vscode-mock.ts`, so pure-logic and fake-`TerminalTransport` tests
  run headless.
- **Integration tests (`@vscode/test-cli`):** under `src/test/**`, run inside a
  real VSCode instance — the real `vscode.Terminal` transport and the real-CLI e2e.
- **Biome** only; TypeScript strict; kebab-case filenames.
- **Real-CLI e2e** is gated behind an env flag (e.g. `CODEX_INTERACTIVE_E2E`) so
  `pnpm test` does not burn quota by default.

## Proof of function

The terminal and clock sit behind a `TerminalTransport` interface so the core is
testable without a real CLI.

| Test | Runner | Asserts |
|------|--------|---------|
| readiness (turn-0) | vitest unit, fake transport | turn-0 ping fires; fake writes `outbox/turn-0.json = ready` → ready. Withheld → re-pinged once after `readyTimeoutMs`, then fails ready. |
| no-resend on real turns | vitest unit, fake transport | fake delays a real turn past `readyTimeoutMs` → the doorbell ping for that turn fires **exactly once**; resolves via `turnTimeoutMs` only. |
| turn cycle | vitest unit, fake transport | `paused` / `done` (usage from a fake rollout) / `error` TurnResults. |
| timeout | vitest unit | no outbox → `timeout` after `turnTimeoutMs`. |
| partial outbox | vitest unit | invalid then valid JSON → resolves on the valid content. |
| crash | vitest unit | no child PID → `crashed`. |
| protocol file | vitest unit | start writes `.skynet/<id>/protocol.md`; `dispose()` removes it; the project `AGENTS.md` is byte-identical before/after (including the absent-file case). |
| rollout parser | vitest unit, pure | `parseCodexRollout(sample)` extracts `sessionId`, usage, and `rate_limits` from a captured real JSONL sample. |
| doorbell | vitest unit, pure | exact `sendText(ping,false)` + `sendSequence("\t")` calls. |
| terminal transport | @vscode/test-cli | real `vscode.Terminal` resolves a `processId` and disposes cleanly. |
| integration | @vscode/test-cli, real codex, env-gated | `runInteractive()` drives turn-0 + two real turns → outbox `TurnResult`s + harvested usage from the real rollout file; a live human can still type in the terminal. |

## Decisions (rationale)

- **pty/terminal only.** Skynet drives CLIs through a real terminal, never headless
  flags or a provider SDK, so there is no `codex exec --json` path. The
  mailbox-over-terminal is the sole mechanism; single-turn is the fast path, not a
  separate code path.
- **Files, not screen scraping.** The public VSCode API cannot read a full-screen
  TUI's output — `onDidWriteTerminalData` is permanently proposed (needs
  `--enable-proposed-api`, unusable on Marketplace) and there is no screen-buffer
  API. All output flows through files.
- **No `node-pty`.** Its native ABI must match VSCode's Electron and breaks on
  VSCode updates, so we use VSCode's own `createTerminal`.
- **Metadata from the rollout file, not agent self-report.** Reading codex's own
  `rollout-*.jsonl` gives accurate usage and session id without trusting the agent.
- **Protocol in the mailbox dir, not the project instruction file.** Appending to a
  project's real `AGENTS.md` mutates a tracked file and can leak on crash;
  `protocol.md` in the disposable, gitignored `.skynet/` dir avoids both and needs
  no bootstrap/teardown.
- **Readiness is a separate turn-0.** Reusing a real work turn as the readiness
  probe means a first task slower than `readyTimeoutMs` gets re-pinged and can
  re-execute (duplicate work). An idempotent synthetic turn-0 makes the resend
  safe; real turns are never re-sent.
- **Poll, not `FileSystemWatcher`.** A watcher would still need a poll fallback for
  mid-write and parse errors, so a single poll loop covers both detection and
  retry — one mechanism, not two.
- **No anti-ban machinery.** Ban risk is precautionary only; the human-visible
  surface is a by-product of running in a real terminal, not a goal we pay
  complexity for.

## Out of scope (v1)

- The shared adapter layer (types + `classifyError`) — a prerequisite, not this US.
- Multi-worker fleet / scheduler (only `workerId` path naming is reserved).
- claude / agy profiles (same core, different profile).
- Automated crash/timeout recovery via `codex resume`.
- Windows child-PID polling (macOS/Linux only in v1).
- Webview panel rework for the sparse event stream (smoke log only).
