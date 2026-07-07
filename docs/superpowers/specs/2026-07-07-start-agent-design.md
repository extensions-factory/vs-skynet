---
title: Start Agent + Codex Preflight
date: 2026-07-07
status: draft
---

# Start Agent + Codex Preflight — Design Spec

- **Roadmap:** E1 · F1.1 (US1.1.1 start in one command, US1.1.2 detect missing / signed-out CLI)
- **Depends on:** the released interactive codex adapter (`src/adapters/interactive/`, `src/adapters/codex/`) and the F1.3 single-session holder (`setActiveSession` in `src/extension.ts`).

## 1. Overview

Skynet already has a fully built, released interactive codex adapter — it can drive a codex TUI session through the mailbox, harvest usage, and expose `send()` / `dispose()`. What it lacks is a way for a developer to *start* one. Today the command palette has `Skynet: Send Task` and `Skynet: Stop Agent`, but nothing ever calls `setActiveSession`, so both always report "No running agent." This feature adds `Skynet: Start Agent`: one command that launches a codex session in a VSCode terminal, gated by a preflight that confirms codex is installed and signed in and gives a clear fix when it is not.

## 2. Context & Assumptions

- The adapter layer is done and released: `codexAdapter.runInteractive(opts)` returns an `InteractiveSession`, and readiness (turn-0) runs inside it. This spec adds no adapter code.
- `codexAdapter.runInteractive` **requires an isolated `CODEX_HOME`**: it reads `opts.configDir ?? process.env.CODEX_HOME` and throws if neither is set. Per-account isolation moves the whole codex home (config + `sessions/`), so a real run needs a dedicated home, not the global account.
- The composition root (`src/extension.ts`) already holds the single active session and exports `setActiveSession`. This feature is its first caller.
- **A1 — single active session (MVP).** Parallel agents are E2. If a session is already active, Start Agent refuses rather than replacing it.
- **A2 — codex login status surface (probed against `codex-cli 0.142.5`).** `codex login status` exits `0` whether signed in or not; the two are distinguished by stdout (`Logged in using ChatGPT` vs `Not logged in`). `codex --version` fails to spawn when codex is not on `PATH`. The preflight parses stdout and treats spawn failure as not-installed.
- **A3 — preflight is a diagnostic, not orchestration.** Running `codex --version` / `codex login status` as child processes does not violate the constitution's pty-only rule (which governs *driving the agent*); `CONSTITUTION.md` §CLI-integration explicitly requires confirming installed + signed-in before use.
- **A4 — the walking-skeleton "one turn result" is already covered.** F1.3's `Skynet: Send Task` drives a turn against the active session, so Start Agent only launches + reaches readiness; it does not itself send a work turn.

## 3. Scope

### Goals

- A `Skynet: Start Agent` command that launches a codex interactive session in a terminal and registers it as the active session, with no per-run prompts on the happy path.
- A preflight that detects codex-not-installed and codex-not-signed-in **before** opening a terminal, and surfaces an actionable fix.
- Configuration via VSCode settings (`skynet.codex.home`, `skynet.codex.model`, `skynet.codex.sandbox`) with sensible silent defaults.

### Non-Goals

- No standalone `Check Codex` command — the preflight lives inside Start Agent (add a separate command later if wanted).
- No session replace / multi-session / worker fleet (E2).
- No model or sandbox quick-pick UI — settings only.
- No changes to the adapter, mailbox, session state machine, or the existing send/stop commands.
- No automated recovery, no Windows-specific preflight tuning (child-process spawn is cross-platform; we do not shell out to `command -v`).

## 4. User Stories

### US-1: Start an agent in one command (Priority: P1)

As a developer, I want to start a coding agent in a VSCode terminal with one command, so that I can begin without any per-run setup.

**Acceptance criteria:**

- GIVEN codex is installed and signed in, a workspace folder is open, and a codex home is configured, WHEN I run `Skynet: Start Agent`, THEN a codex session launches in a terminal, becomes the active session (`setActiveSession` is called), and the terminal is revealed.
- GIVEN a session is already active, WHEN I run `Skynet: Start Agent`, THEN it refuses with "An agent is already running — stop it first." and does not launch a second session.
- GIVEN no workspace folder is open, WHEN I run `Skynet: Start Agent`, THEN it aborts with a message telling me to open a folder, and no terminal opens.
- GIVEN no codex home is configured (neither `skynet.codex.home` nor `CODEX_HOME`), WHEN I run `Skynet: Start Agent`, THEN it aborts with a message telling me to set `skynet.codex.home`, and no terminal opens.

### US-2: Detect a missing or signed-out CLI (Priority: P1)

As a developer, I want Skynet to tell me when codex is not installed or not signed in, so that I know how to fix it instead of staring at a broken terminal.

**Acceptance criteria:**

- GIVEN codex is not on `PATH`, WHEN I run `Skynet: Start Agent`, THEN the preflight reports "not installed" with an install hint, and no terminal opens and `runInteractive` is never called.
- GIVEN codex is installed but `codex login status` (with the configured `CODEX_HOME`) reports `Not logged in`, WHEN I run `Skynet: Start Agent`, THEN the preflight reports "not signed in" with `Run: codex login`, and no terminal opens and `runInteractive` is never called.
- GIVEN codex is installed and `codex login status` reports `Logged in`, WHEN the preflight runs, THEN it returns ok with the parsed version and Start Agent proceeds to launch.

## 5. Approach

Add two small, pure, dependency-injected units and wire them in the composition root — the same shape as the repo's existing `task-handoff.ts` and `notify-awaiting-input.ts` handlers (no `vscode` import in the logic; the root injects `vscode.window`, config, the adapter, and a child-process runner). `preflight.ts` takes an injected `run(cmd, args, env)` so it is unit-testable with no real spawn; `start-agent.ts` takes a `deps` bag so it is unit-testable with no real terminal. The composition root generates the `workerId` and supplies the real implementations.

The preflight parses `codex login status` stdout rather than relying on exit codes, because the probe showed both states exit `0`. Config resolution is layered — `skynet.codex.home` setting, then `CODEX_HOME` env, then an actionable error — matching how the adapter already reads its home.

### Alternatives considered

| Option | Why rejected |
|--------|--------------|
| Env-var-only home (no setting) | Forces the user to launch VSCode with `CODEX_HOME` set; a setting is more discoverable and still falls back to env. |
| Prompt / quick-pick to pick or create a home on start | More UI code for a first-run step that a one-time setting covers; breaks the "one command" promise. |
| Quick-pick model/sandbox each start | Breaks the one-command promise and adds UI; silent settings defaults are truer to US-1. |
| Standalone `Check Codex` command | Speculative surface; the preflight inside Start Agent already satisfies US-2. Add later if a use case appears. |
| Rely on `codex login status` exit code | Probe showed exit `0` in both signed-in and signed-out states; must parse stdout. |
| Reuse a real work turn as the readiness/health signal | Adapter already runs an idempotent turn-0 readiness; the CLI-level preflight is about install/auth, a different failure class caught before any terminal opens. |

## 6. Design

### Architecture

```
extension.ts (composition root)
  registers "skynet.startAgent"
  injects: getConfig (vscode.workspace.getConfiguration)
           getWorkspaceCwd (vscode.workspace.workspaceFolders[0])
           checkCodex (preflight bound to a real execFile runner)
           runInteractive (codexAdapter.runInteractive)
           setActiveSession, getActiveSession
           window (vscode.window)
           genWorkerId
        │
        ▼
start-agent.ts  startAgentCommand(deps)
  1. active session already set?     → refuse, return
  2. resolve cwd                      → none → error, return
  3. resolve codexHome (setting→env)  → none → error, return
  4. checkCodex(run, codexHome)       → not ok → show fix, return   ◄─ no terminal yet
  5. build InteractiveOpts from settings
  6. runInteractive(opts)             → session
  7. setActiveSession(session); reveal terminal
        │
        ▼
preflight.ts  checkCodex(run, codexHome): Promise<PreflightResult>
  run("codex", ["--version"])                    spawn fail → not-installed
  run("codex", ["login","status"], {CODEX_HOME}) stdout has "Not logged in" → not-signed-in
                                                  else → ok(version)
```

### Components & Interfaces

**`src/adapters/codex/preflight.ts`**
- `type RunResult = { code: number; stdout: string; stderr: string }`
- `type Run = (cmd: string, args: string[], env?: Record<string, string>) => Promise<RunResult>` — rejects (or is caught) when the binary cannot be spawned.
- `type PreflightResult =`
  - `{ ok: true; version: string }`
  - `| { ok: false; reason: "not-installed"; message: string }`
  - `| { ok: false; reason: "not-signed-in"; message: string }`
- `async function checkCodex(run: Run, codexHome: string): Promise<PreflightResult>` — runs `codex --version` (spawn failure → not-installed with an install hint), then `codex login status` with `CODEX_HOME=codexHome` (stdout contains `Not logged in` → not-signed-in with `Run: codex login`), else ok with the trimmed version string.
- Depends on: nothing but the injected `run`. No `vscode`, no `child_process` import.

**`src/commands/start-agent.ts`**
- `interface StartAgentDeps {`
  - `getActiveSession(): InteractiveSession | undefined`
  - `setActiveSession(s: InteractiveSession | undefined): void`
  - `getWorkspaceCwd(): string | undefined`
  - `getConfig(): { home?: string; model?: string; sandbox?: Sandbox }` (reads `skynet.codex.*`)
  - `checkCodex(codexHome: string): Promise<PreflightResult>` (preflight already bound to the real runner)
  - `runInteractive(opts: InteractiveOpts): Promise<InteractiveSession>`
  - `genWorkerId(): string`
  - `window: Pick<typeof vscode.window, "showErrorMessage" | "showInformationMessage">` (structural, mirrors `HandoffWindow`)
  - `}`
- `async function startAgentCommand(deps: StartAgentDeps): Promise<void>` — the guard/launch flow above. Reveals the terminal via the session (the adapter's Doorbell already calls `terminal.show`; readiness turn-0 does the reveal, so no extra terminal handle is needed here).
- Depends on: `preflight.ts` types, `interactive/types.ts`. No direct `vscode` import (structural `window` only), matching `task-handoff.ts`.

**`src/extension.ts`** (edit)
- Add a real `Run` backed by `node:child_process` `execFile` (resolves a `RunResult`, catches ENOENT into a non-spawn result the preflight treats as not-installed).
- Register `skynet.startAgent` calling `startAgentCommand` with real deps; generate `workerId` (e.g. `codex-<short-unique>`).

**`package.json`** (edit)
- `contributes.commands`: `{ command: "skynet.startAgent", title: "Start Agent", category: "Skynet" }`.
- `contributes.configuration`: `skynet.codex.home` (string), `skynet.codex.model` (string), `skynet.codex.sandbox` (enum `read-only|workspace-write|danger-full-access`, default `workspace-write`).
- `activationEvents`: `onCommand:skynet.startAgent` (plus the existing send/stop as applicable).

### Data Model & Flow

Config → `InteractiveOpts`:

```
{ cwd:        getWorkspaceCwd(),
  workerId:   genWorkerId(),
  configDir:  home,                       // setting → env; required
  model:      config.model || undefined,  // omit → codex default
  sandbox:    config.sandbox ?? "workspace-write" }
```

`runInteractive` returns the session; `setActiveSession(session)` publishes it so `Skynet: Send Task` / `Skynet: Stop Agent` operate on it.

### Error Handling

- **Already active:** `showErrorMessage("An agent is already running — stop it first.")`, return without launching.
- **No workspace:** `showErrorMessage("Open a folder before starting an agent.")`, return.
- **No home:** `showErrorMessage("Set skynet.codex.home (or the CODEX_HOME env var) to an isolated codex home.")`, return.
- **Preflight not-installed / not-signed-in:** show the `PreflightResult.message`, return — before any terminal opens and before `runInteractive` is called.
- **`runInteractive` throws** (e.g. readiness timeout surfaced as a rejection): catch, `showErrorMessage`, and leave the active session unset.

### Edge Cases

- `codex login status` stdout in an unexpected format (neither `Logged in` nor `Not logged in`): treat absence of `Not logged in` as ok (fail-open to launch; the adapter's readiness turn-0 catches a genuinely broken session as a timeout).
- Empty/whitespace `skynet.codex.home` setting is treated as unset → env fallback.
- Terminal reveal is delegated to the adapter; Start Agent does not hold a terminal handle.

## 7. Testing Strategy

All unit tests are vitest, colocated `*.test.ts`, using injected deps — no real spawn, no real terminal (matches the existing `task-handoff.test.ts` / `notify-awaiting-input.test.ts` style).

| Test | Asserts | Story |
|------|---------|-------|
| preflight: not-installed | injected `run` throws/ENOENT on `--version` → `{ ok:false, reason:"not-installed" }` with install hint | US-2 |
| preflight: not-signed-in | `login status` stdout = captured `Not logged in` → `{ ok:false, reason:"not-signed-in" }` with `Run: codex login` | US-2 |
| preflight: ok | `--version` = `codex-cli 0.142.5`, `login status` = captured `Logged in using ChatGPT` → `{ ok:true, version }` | US-2 |
| start: happy path | preflight ok → `runInteractive` called with opts derived from config, `setActiveSession` called with the session | US-1 |
| start: already active | `getActiveSession` returns a session → error shown, `runInteractive` **not** called | US-1 |
| start: no workspace | `getWorkspaceCwd` undefined → error shown, `runInteractive` not called | US-1 |
| start: no home | config home + env both unset → error shown, `runInteractive` not called | US-1 |
| start: preflight fail | `checkCodex` returns not-signed-in → `PreflightResult.message` shown, `runInteractive` **not** called, `setActiveSession` not called | US-2 |

The two `codex login status` outputs (`Logged in using ChatGPT`, `Not logged in`) are captured as fixtures from the real `codex-cli 0.142.5` probe so an upstream wording change breaks a test, not a user (per `CONSTITUTION.md` §CLI-integration).

## 8. Success Criteria

- SC-1: With codex installed, signed in, a folder open, and a home configured, one invocation of `Skynet: Start Agent` results in a running active session that `Skynet: Send Task` can drive — end to end, no per-run prompts.
- SC-2: Each of the three failure classes (not installed, not signed in, no home / no folder) produces a distinct actionable message and **never opens a terminal or calls `runInteractive`**.
- SC-3: All units are covered by injected-dependency unit tests that run headless under `pnpm run test:unit`; no test requires a real codex install or a real terminal.
- SC-4: No new provider-SDK/API dependency and no adapter change is introduced — the constitution's pty-only rule holds and the preflight is the only new child-process use, confined to install/auth diagnostics.
