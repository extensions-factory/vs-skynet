# Interactive Codex Adapter — Design (canonical frame)

**Date:** 2026-07-04
**Epic:** Adapters · **Feature/US:** Interactive (terminal) mode — Codex
**Status:** Ported into the `active` lane (this repo/worktree — there is no
`active/` directory) from the prior worktree (`6/`) spec dated
2026-06-30. Architecture is unchanged; the deltas are active-specific
(prerequisite base layer, `active` toolchain, cross-links dropped). Probe
evidence from the source worktree is retained as-is (see *Verified ground
truth*) — no fresh re-probe was run for this port.

## Goal

A **second run mode** for the codex adapter that drives `codex` as a **live
interactive TUI session inside a VSCode terminal**, instead of the one-shot
`codex exec --json` path. The orchestrator pastes prompts *into* the terminal and
reads results *out* of files the agent writes. This buys **multi-turn steering
(paused/resumed turns toward one task completion) + pause/resume in one
session** and a human-like execution surface, while keeping parsing robust.

This document is the **canonical frame** for interactive mode across all three
CLIs. The claude and agy interactive specs (skeletons that restate their
CLI-specific deltas against this one) are **not yet ported to `active/`**; only
codex is in scope here.

**Add alongside, do not replace.** Interactive mode is a new sibling of the
one-shot `runCodex` (`codex exec --json`, the base codex adapter — see *Depends
on*). It adds a run mode; it does not replace the one-shot path, which stays for
fast tasks.

## Depends on (prerequisite)

`active/` is currently a bare scaffold (only `src/extension.ts`); the base
adapter layer this spec builds on **does not exist yet** and must land first as
its own upstream US:

- **Shared adapter types** — `src/adapters/types.ts`: `ErrorClass`
  (`"limit" | "transport" | "terminal"`), `WorkerEvent`, `WorkerUsage`
  (`{ inputTokens, outputTokens, cachedInputTokens?, cacheWriteTokens?,
  reasoningTokens?, costUsd? }`), `WorkerResult`, `RunOpts`, `WorkerRun`,
  `AgentAdapter`.
- **Error classifier** — `src/adapters/classify.ts`: pure
  `classifyError(text): ErrorClass`.
- **One-shot codex adapter** — `src/adapters/codex/codex-adapter.ts`:
  `runCodex` / `codexAdapter.run` (`codex exec --json`). Interactive mode extends
  this same adapter with `runInteractive()`.

This spec references those symbols as given. It does **not** re-specify them —
that is the base codex adapter US (source: prior worktree
`6/docs/superpowers/specs/2026-06-29-codex-adapter-design.md`, not yet ported).
If the base layer is not present, interactive mode does not compile; it is a
hard prerequisite, not a soft one.

**Reconciliation constraint for the base port:** interactive mode consumes
`WorkerEvent` as its event-stream type and needs `started` (carrying
`sessionId`), per-turn `message`, and `usage` variants. When the base spec is
ported, its `WorkerEvent` definition must be reconciled with these kinds —
otherwise the prerequisite can land in a shape this US cannot use.

## Why this shape (recorded decisions)

- **Ban risk is precautionary only** (no observed bans). So we build **no
  anti-ban machinery**; the human-like surface is a cheap by-product of running
  interactively in a real terminal, not a goal we pay complexity for.
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
  approvals). `codex exec` is the non-interactive path we already use. Flags are
  global (shared by `codex`, `exec`, `resume`).
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
  (`\r`) and kitty Enter (`[13u`) both land as newlines in the composer.
  The verified automation path is to launch Codex with process-local config
  overrides: `-c disable_paste_burst=true`,
  `-c 'tui.keymap.composer.submit="tab"'`, and
  `-c 'tui.keymap.composer.queue="ctrl-q"'`, then submit with
  `sendSequence("\t")`. The `queue` remap moves the composer's queue action
  onto Ctrl-Q so it cannot collide with the Tab submit binding; the probe
  verified this trio **as a unit** — keep all three overrides together, do not
  cherry-pick.

## Architecture (canonical — shared by all three CLIs)

CLI-agnostic core in `src/adapters/interactive/`; each CLI supplies a **profile**.

```
ORCHESTRATOR (extension host)              TERMINAL (codex TUI — human-visible)
─────────────────────────────             ─────────────────────────────────────
1. write inbox/turn-N.md
2. sendText("Read inbox/turn-N.md ──────►  agent at prompt receives the ping
   and follow it", false)              agent touches outbox/turn-N.ack (receipt)
   + sendSequence(submitSequence)      agent reads inbox file (its own tools)
                                       agent works…  ◄── user may watch / take over
3. poll outbox/turn-N.json  ◄──────────── agent writes outbox/turn-N.json on stop
4. read+parse outbox → TurnResult
5. SessionHarvester reads newest    ◄──── codex appends rollout-*.jsonl itself
   rollout-*.jsonl → sessionId+usage
   (CLI fallback: ask agent to write session-info.json)
6. decide next turn:
   · pause  = withhold next ping
   · resume = write inbox/turn-(N+1) + ping
──────────────────────── SAD PATH ────────────────────────
· timeout: no outbox within T  → status 'timeout'
· poll descendants of terminal.processId: no codex → status 'crashed'
· onDidCloseTerminal / exitStatus → terminal died
```

### Components

1. **`TerminalSession`** — wraps `vscode.window.createTerminal({ name, cwd, env,
   shellPath, shellArgs })` with `shellPath` set to the `codex` binary and
   `shellArgs` to the interactive launch argv — **no wrapper shell**. This is a
   recorded decision: launching codex directly means `terminal.processId`
   relates to the codex process itself (no shell/job-control process-group
   indirection), and codex exiting closes the terminal, so
   `onDidCloseTerminal` is the primary, reliable crash signal. Owns disposal +
   `onDidCloseTerminal`. *(The prior-worktree probe drove the same argv; the
   `shellPath` launch shape is re-verified when the probe is ported and re-run.)*
2. **`Mailbox`** — per-run dir `<cwd>/.skynet/<workerId>/{inbox,outbox}/`. Writes
   `inbox/turn-N.md`; resolves the turn by **polling** `outbox/turn-N.json` (no
   `vscode.FileSystemWatcher`). (`workerId` in the path is the only multi-worker
   affordance in v1.) On first run, ensure `.skynet/` is in the repo `.gitignore`
   (append if absent) so the mailbox never shows in `git status`. `dispose()`
   removes the `<workerId>` dir. The protocol teaches tmp+rename; the read is a
   **poll loop (every ~500ms) with the same timeout as the turn** — it is the
   only detection mechanism, and it doubles as the parse-error retry when the
   agent writes directly or the poll sees a file mid-write: on `ENOENT` or a
   JSON parse error it keeps polling until the file is valid or the turn times
   out. *(ponytail: `terminal-probe.test.ts` proved a plain poll loop end-to-end
   for both codex and agy-ultra; a `FileSystemWatcher` would still need this same
   poll as its parse-retry fallback, so it buys nothing — one mechanism, not two.
   Poll interval is a tuning knob, not load-bearing.)*
3. **`Doorbell`** — `terminal.show(false)` → `sendText(pingLine, false)` →
   `commands.executeCommand("workbench.action.terminal.sendSequence", { text: profile.submitSequence })`.
   The ping is tiny (`Read .skynet/<id>/inbox/turn-N.md and follow it.`) so it
   dodges large-paste corruption.
   **Known limitation (recorded):** `workbench.action.terminal.sendSequence`
   has no terminal argument — it targets the *active* terminal, and
   `show(false)` steals focus on every ping. Between `show()` and
   `executeCommand` the user can focus another terminal or an editor, sending
   the sequence to the wrong place. Mitigation: immediately before
   `sendSequence`, check `window.activeTerminal === terminal`; if not, re-`show`
   and re-check once before sending, and log a warning if it still mismatches
   (the readiness/timeout machinery then catches the lost ping). This gets
   worse with multiple workers — revisit before any multi-worker US.
4. **Protocol bootstrap** — the target `cwd` is often a real project that
   already has its own `profile.instructionFile` (e.g. a real `AGENTS.md` with
   project-specific instructions the CLI reads on every launch, ours or not).
   **Never overwrite it.** Read the existing content (empty string if the file
   doesn't exist), and if it does not already contain the
   `<!-- skynet-interactive:BEGIN -->` marker, **append** the mailbox protocol
   (below) wrapped in `<!-- skynet-interactive:BEGIN -->` / `<!-- skynet-interactive:END -->`
   markers before launch. `dispose()` **re-reads the file's current content
   and strips only the marker block** — it must never write back a cached
   pre-session snapshot, because the user (or the agent, doing its actual
   task) may have legitimately edited the file during the session; a snapshot
   restore would destroy those edits. This is idempotent: a leftover marker
   block from a crashed prior session is replaced, not duplicated.
   **Tracked-file caveat (recorded):** unlike the gitignored `.skynet/` dir,
   `AGENTS.md` and the `.gitignore` append are *tracked* files that stay dirty
   for the whole session — an agent that commits broadly (`git commit -am`)
   mid-task could commit the marker block. The protocol text therefore
   explicitly forbids committing it (see *Protocol contract*), and after a
   crash the block lingers in the working tree until the next session launch
   or a manual strip — an accepted v1 residue.
5. **`SessionHarvester`** — locates the newest `rollout-*.jsonl` under
   `profile.sessionDir(configDir)`, parses `session_meta` + latest `token_count`
   into `{ sessionId, usage, rateLimits? }`. Read on each turn and at dispose.
   **Wrong-file guard:** "newest" is ambiguous when the session dir is shared —
   no `configDir` means the user's own `~/.codex/sessions`, where a concurrent
   manual codex session (or a future second worker) also writes. Candidates
   must pass two checks before being accepted: file mtime ≥ our launch time,
   and `session_meta.cwd` equal to `opts.cwd`. If no candidate passes, harvest
   returns empty rather than guessing.
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
  instructionFile: string;                             // "AGENTS.md" | "CLAUDE.md" | ?
  submitSequence: string;                              // Codex uses "\t" with submit bound to Tab
  sessionDir(configDir?: string): string;              // absolute path; no "~" shorthand
  harvest(sessionFileText: string): { sessionId?: string; usage?: WorkerUsage; rateLimits?: unknown };
  sessionInfoPrompt?(outboxPath: string): string;       // fallback when harvest() cannot provide session id
}
```

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
  instructionFile: "AGENTS.md",
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
  readyTimeoutMs?: number;  // default 30_000 (per-turn receipt window: no ack/outbox → one re-ping)
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
  dispose(): Promise<void>;                     // strip instruction-file marker block,
                                                 // remove mailbox dir, kill terminal (async cleanup)
}
```

**Integration seam.** Interactive mode is a *second run mode on the existing
adapter*, not a parallel API. `AgentAdapter` (base layer) gains an optional
method; the standalone `startInteractive(profile, opts)` is the shared core the
codex adapter delegates to.

```ts
interface AgentAdapter {
  readonly id: "codex" | "claude" | "agy";
  run(opts: RunOpts): WorkerRun;                                  // existing one-shot exec
  runInteractive?(opts: InteractiveOpts): Promise<InteractiveSession>; // new; delegates to startInteractive(codexInteractive, opts)
}
```

**Session lifecycle rules (explicit):**

- After a turn resolves `done`, the session is complete: further `send()` calls
  **reject** (`session already completed`) and `dispose()` is the only valid
  next call. The terminal stays open for inspection / human takeover until
  `dispose()`; interactive mode does not auto-kill it on `done`.
- `timeout` and `crashed` are equally terminal in v1: subsequent `send()` calls
  reject the same way. A timeout can be a false alarm (the agent may still be
  working and may even finish after we gave up), but v1 does not reattach —
  the terminal stays open for the human, and automated recovery
  (`codex resume`) is a later US.
- At most **one turn in flight**: calling `send()` while a previous `send()`
  is unresolved rejects (`turn already in flight`) — it does not queue.
- `dispose()` during an in-flight turn rejects the pending `send()` promise
  (`session disposed`) before tearing down; dispose itself never throws for
  cleanup failures (log and continue).

`TurnResult` maps back to the base-layer `WorkerResult` only at the final adapter
boundary: `done → success`, `error → failed`, `timeout → failed` with
`errorClass:"transport"`, `crashed → failed` with `errorClass:"terminal"`.
`paused` is not a `WorkerResult`; it keeps the same `InteractiveSession` open.
Mode selection is orchestrator/UI policy and out of scope for this US; the
adapter supports one-shot `run()` and interactive `runInteractive()` concurrently.

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

## Protocol contract (taught via the instruction file)

> For each `inbox/turn-N.md` I give you: **first create the empty file
> `outbox/turn-N.ack`** (so I know you received the turn), then do the work it
> asks, then **write `outbox/turn-N.json` before you stop**, matching the same `N`:
> - Pausing / need the next instruction → `{ "status": "paused", "summary": "<what you did>" }`
> - Whole task complete → `{ "status": "done", "summary": "...", "filesTouched": ["..."] }`
> - Unrecoverable error → `{ "status": "error", "reason": "..." }`
>
> Never delete inbox files. Write the outbox file in a **single operation** as the
> **last action** of a turn (write `turn-N.json.tmp`, then rename to `turn-N.json`)
> so the orchestrator rarely sees a half-written file. The mailbox retry remains
> mandatory because the agent may ignore this instruction.
>
> Never commit the `.skynet/` directory, the `.gitignore` line that mentions it,
> or the `<!-- skynet-interactive:BEGIN/END -->` block in the instruction file —
> they are session plumbing, not part of the task.

The outbox **existence** is the turn boundary; its `status` decides the next move.
The `.ack` file is *only* a receipt signal for the readiness/re-ping logic below —
it never resolves a turn, and a missing ack with a present outbox is fine (the
agent may skip the ack; the outbox always wins). For Codex, usage/session-id
never come from the agent — they come from the rollout harvest. For CLIs without
rollout-equivalent metadata, `session-info.json` is an explicit degraded fallback.

## Readiness handshake & sad path

- **Readiness:** after launch we cannot read the terminal, so the receipt signal
  is the protocol's `outbox/turn-N.ack` — created by the agent *before* doing the
  work, which separates "ping received" from "turn finished". A turn's outbox can
  legitimately take minutes; the ack should appear in seconds. If **neither**
  `turn-N.ack` **nor** `turn-N.json` appears within `readyTimeoutMs` (default
  30s), re-send the ping **once** (mitigates the documented sendText startup
  race); the re-ping does not reset any clock. A short fixed pre-ping delay
  (~1.5s) on turn 1 reduces the race further. *(ponytail: delay is a tuning
  knob, not load-bearing. The ack is best-effort — an agent that skips it may
  eat one duplicate ping, which is benign: the duplicate names the same
  `turn-N.md`, and the orchestrator accepts one `turn-N.json` regardless.)*
- **Turn timeout** (`turnTimeoutMs`, default 5 min): no outbox → `timeout`. The
  clock runs from the first ping of the turn; `readyTimeoutMs` is a sub-window
  of it, not additive.
- **Crash:** `onDidCloseTerminal` / `exitStatus` is the primary signal — with the
  `shellPath` launch (no wrapper shell), codex dying closes the terminal. As
  best-effort defense in depth on macOS/Linux, poll every ~3s that a `codex`
  process still exists at/under `terminal.processId` (walk descendants; do
  **not** use `pgrep -g` on a shell pgid — job control gives a foreground child
  its own process group, so that finds nothing). No codex process while a turn
  is open → `crashed`. Terminal close and turn timeout remain the hard signals.
  *(ponytail: Windows child-PID polling is TBD; macOS/Linux only in v1.)*
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

- **turn cycle** *(vitest unit, fake transport, fast):* `send()` → fake writes
  `outbox/turn-N.json` → assert `TurnResult` for each of `paused` / `done` (with
  usage from a fake rollout) / `error`.
- **timeout** *(vitest unit, fast):* fake never writes outbox → `status:'timeout'` after `turnTimeoutMs`.
- **partial outbox** *(vitest unit, fast):* fake writes invalid JSON then valid → reader
  retries and resolves on the valid content, not the half-written one.
- **crash** *(vitest unit, fast):* fake reports no child PID → `status:'crashed'`.
- **readiness re-ping** *(vitest unit, fast):* fake writes neither `turn-1.ack`
  nor `turn-1.json` within `readyTimeoutMs` → exactly one re-ping; fake writes
  the ack early but the outbox late (after `readyTimeoutMs`, within
  `turnTimeoutMs`) → **no** re-ping and the turn still resolves.
- **rollout parser** *(vitest unit, pure, fast):* `parseCodexRollout(sample)` extracts `sessionId`
  from `session_meta`, usage from `token_count.info.total_token_usage`, and
  optional `rate_limits`, using a real sample JSONL captured from `codex`.
- **doorbell** *(vitest unit, pure, fast):* asserts the exact `sendText(ping,false)` +
  `sendSequence("\t")` calls, plus the active-terminal guard: when the fake's
  `activeTerminal` is not ours, one re-`show` happens before the sequence is sent.
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
  the probe proves the *mechanism* (mailbox + doorbell + pause/resume/done)
  against a real CLI, but drives it with probe-local helpers, not the production
  `InteractiveSession` code. A remaining task: an integration test that calls
  `startInteractive(codexInteractive, opts)` directly, `send()`s two turns, and
  asserts outbox-derived `TurnResult`s + harvested usage from the real rollout
  file + a live human can still type in the terminal.

## Out of scope (v1)

- Base codex adapter (shared types + `classifyError` + one-shot `runCodex`) — a
  **prerequisite** US, not this one (see *Depends on*).
- Multi-worker fleet / scheduler (only `workerId` path naming is reserved).
- claude / agy interactive (their skeleton specs; same frame, different profile;
  not yet ported to `active/`).
- Automated crash/timeout **recovery** via `codex resume` (later US).
- Windows child-PID polling.
- Webview panel rework for the sparse interactive event stream (smoke log only).
- Replacing `codex exec --json` (it stays for one-shot tasks).
