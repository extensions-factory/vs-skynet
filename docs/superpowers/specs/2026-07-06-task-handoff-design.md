---
title: Task hand-off
date: 2026-07-06
status: draft
---

# Task hand-off — Design Spec

## 1. Overview

A developer running a Skynet agent needs to (a) hand it a follow-up
task/prompt without leaving the editor, and (b) stop it at any moment. This
spec defines F1.3 (roadmap E1 / v0.1 MVP): a thin command layer over the
already-built interactive session. Its central design decision is a framing
one — **hand-off is a channel, not a UI.** The channel is
`InteractiveSession.send(prompt)`, which already exists. The VSCode command
palette is merely the MVP *trigger* of that channel; at E6 the Orchestrator
drives the *same* channel. Naming the seam now gives E6 an obvious plug-in
point and keeps "who talks to the worker" answerable in one sentence.

## 2. Context & Assumptions

Current state (probed 2026-07-06):

- `InteractiveSession` (`src/adapters/interactive/types.ts`) exposes
  `send(prompt) → TurnResult`, `status`, `sessionId`, `dispose()`. F1.1/F1.2
  built and merged this layer.
- `AgentSessionStateMachine`
  (`src/adapters/interactive/session-state-machine.ts`) transition table:
  `send` is legal only from `ready` and `awaiting-input` (both → `busy`).
  From `busy` there is **no** `send` edge — calling it throws
  `illegal transition: busy -/send`. `dispose` is legal from every
  non-terminal state and yields `stopped`. Terminal states: `done`,
  `failed`, `stopped`.
- `send()` also throws `"session already completed"` when the machine is
  terminal.
- There is **no** mid-turn interrupt in the code — `dispose()` (kill
  terminal + close mailbox + machine `stopped`) is the only stop mechanism.
- `src/extension.ts` is still the scaffold (`skynet.helloWorld`); no real
  command wiring or session-holding exists yet.

Assumptions:

- **A1 — single active session at MVP.** Parallel sessions are E2. F1.3
  targets one running session held in the composition root.
- **A2 — session-holder ownership.** F1.1 logically owns *starting* the
  session and holding its reference. Because `extension.ts` is still a
  scaffold, F1.3 is permitted to establish the single-session holder
  (a `getActiveSession()`-style accessor in the composition root) if F1.1
  has not landed it yet. F1.3 does not own *start*; it only consumes the
  active session. *(Confirmed with product owner during brainstorming.)*
- **A3 — stop means dispose.** "Stop at any time" maps to `dispose()`: a
  hard stop, session not resumable. Continuing work means starting a new
  session. *(Confirmed.)*

## 3. Scope

### Goals

- Send a follow-up task/prompt to the running agent from the command
  palette, routed through `InteractiveSession.send(prompt)`.
- Stop the running agent from the command palette via `dispose()`.
- Frame `send()` explicitly as the shared hand-off seam so the future
  Orchestrator (E6) plugs into the same call with no rework.

### Non-Goals

- **Multi-session selection / picker** — deferred to E2 (parallel agents).
  MVP has one session.
- **Orchestrator routing** — E6. This spec only guarantees the seam; it does
  not build the mediator.
- **Mid-turn interrupt** (ESC/Ctrl-C into a busy turn keeping the session
  alive) — not in the code; explicitly out. Stop = dispose.
- **Prompt queueing** while busy — rejected (YAGNI). A send attempt while
  busy is refused with a message, not buffered.
- **Resume after stop** — a stopped session is terminal; start a new one.

## 4. User Stories

### US-1: Send a task to the running agent (Priority: P1)

As a developer, I want to send a task/prompt to the running agent from the
command palette, so that I can delegate work without switching context.

**Acceptance criteria:**

- GIVEN a session in `ready` or `awaiting-input`, WHEN I run
  `skynet.sendTask` and enter a prompt, THEN `session.send(prompt)` is called
  and its `TurnResult.summary` is surfaced to me.
- GIVEN a session in `busy`, WHEN I run `skynet.sendTask`, THEN `send()` is
  **not** called and I see an informational message that the agent is busy.
- GIVEN no active session, or a terminal session (`done`/`failed`/
  `stopped`), WHEN I run `skynet.sendTask`, THEN I see an informational
  message that there is no running agent and nothing is sent.
- GIVEN the input box is dismissed with no text, WHEN I cancel, THEN nothing
  is sent.

### US-2: Stop the running agent (Priority: P1)

As a developer, I want to stop an agent at any time, so that I always stay in
control.

**Acceptance criteria:**

- GIVEN a session in any non-terminal state (`launching`/`ready`/`busy`/
  `awaiting-input`), WHEN I run `skynet.stopAgent`, THEN `session.dispose()`
  is called and the session status becomes `stopped`.
- GIVEN no active session, or an already-terminal session, WHEN I run
  `skynet.stopAgent`, THEN I see an informational message and `dispose()` is
  not called a second time.

## 5. Approach

Add two thin VSCode commands (`skynet.sendTask`, `skynet.stopAgent`) that
resolve the single active session from the composition root and delegate to
the existing `InteractiveSession` methods. No new core class: the hand-off
seam is `session.send()` itself, already present and already the contract the
Orchestrator will call. The command handlers guard on `session.status`
before acting so the state machine's illegal-transition throw never fires in
normal use.

### Alternatives considered

| Option | Why rejected |
|--------|--------------|
| Add a `TaskDispatcher.handOff()` core abstraction for both command and orchestrator to call | One caller today (the command). The seam already exists as `session.send()`; a wrapper class is speculative until E6 actually needs routing/logging. YAGNI. |
| MVP mini-orchestrator: all hand-off always routed through an orchestrator, no direct command→session path | Pulls E6 (v0.5) work into v0.1. The direct command path is the honest MVP; the seam framing already reserves the orchestrator's future entry. |
| Keep "command palette" as the worker-comms concept | Conflicts with the ARCHITECTURE Mediator rule ("workers never talk directly; the orchestrator routes hand-offs"). Reframing to a channel resolves it. |
| Stop = mid-turn interrupt (ESC), session survives | No interrupt in the code; requires a new transport sequence + new transitions. Deferred; dispose is the MVP stop. |
| Queue a prompt sent while busy | Adds buffering + ordering semantics for a case the user can just retry. YAGNI. |

## 6. Design

### Architecture

```
Command palette (human, MVP)  ─┐
Orchestrator   (machine, E6)  ─┴─→ InteractiveSession.send(prompt) → TurnResult
                                    InteractiveSession.dispose()    → stopped

extension.ts (composition root)
  ├─ holds the single active InteractiveSession (A2)
  ├─ registers skynet.sendTask  → guard on status → session.send()
  └─ registers skynet.stopAgent → guard on status → session.dispose()
```

The dependency rule holds: the command handlers live in the adapter/edge
layer (they touch `vscode`); the session and its state machine stay pure
core, untouched by this feature.

### Components & Interfaces

- **Active-session accessor (composition root).** A single
  `getActiveSession(): InteractiveSession | undefined` in `extension.ts`
  (or a tiny holder it owns). *Does:* returns the one running session or
  `undefined`. *Used by:* both command handlers. *Depends on:* whatever F1.1
  sets when it starts a session; if F1.1 hasn't landed, F1.3 introduces the
  holder (A2). No new abstraction beyond a variable + accessor.
- **`skynet.sendTask` handler.** *Does:* resolves the active session; if
  absent/terminal → info message; if `busy` → info message; else prompts via
  `window.showInputBox`, and on non-empty input calls `session.send(prompt)`,
  awaiting `TurnResult`. *Depends on:* the accessor, `vscode.window`.
- **`skynet.stopAgent` handler.** *Does:* resolves the active session; if
  absent/terminal → info message; else calls `session.dispose()`. *Depends
  on:* the accessor, `vscode.window`.
- Both commands are declared in `package.json` `contributes.commands` and
  pushed to `context.subscriptions` in `activate()`.

### Data Model & Flow

`sendTask`: command → resolve session → check `status` → `showInputBox` →
(non-empty) `session.send(prompt)` → await `TurnResult` →
`showInformationMessage(summary or reason)`. The interactive terminal stays
visible (F1.4), so the human reads full detail there; the message is a
coarse confirmation only.

`stopAgent`: command → resolve session → check non-terminal →
`session.dispose()` → status transitions to `stopped` (observable via F1.2).

### Error Handling

- Status is checked **before** every `send()`/`dispose()`, so the state
  machine's `illegal transition` / `session already completed` throws are not
  reachable on the normal path.
- `session.send()` is still wrapped in try/catch as a belt-and-braces guard;
  a thrown error, or a `TurnResult` of `error` / `timeout` / `crashed`, is
  surfaced via `showInformationMessage` (or `showErrorMessage` for `error`/
  `crashed`). No unhandled rejection escapes the command handler.
- `dispose()` is idempotent-safe by the guard: the terminal-state check
  prevents a second dispose; the state machine also no-ops transitions once
  terminal.

### Edge Cases

- Input box dismissed / empty string → no send, no message noise.
- Session transitions `ready → busy` between the status check and the
  send (a real turn started underneath the user). `send()` throws
  `illegal transition`; the try/catch converts it to a "busy, try again"
  message. Accepted: a narrow race, no queue.
- Stop pressed while `launching` (before first outbox) → `dispose` is legal
  from `launching` → `stopped`. Works.
- Stop pressed twice quickly → first disposes; second sees terminal status →
  message, no double dispose.

## 7. Testing Strategy

Unit tests (vitest), no VSCode extension host — the handlers take the
active-session accessor and are exercised against a **fake
`InteractiveSession`** (stub `send`/`dispose`/`status`) with
`window.showInputBox` / `showInformationMessage` mocked (existing
`src/test-utils/vscode-mock.ts` pattern).

- US-1: `ready` + entered prompt → `send` called once with the prompt;
  summary shown. `busy` → `send` not called, busy message shown. no
  session / terminal → `send` not called, message shown. empty input →
  `send` not called.
- US-2: non-terminal → `dispose` called once, status `stopped`. terminal /
  no session → `dispose` not called, message shown.
- Error path: fake `send` throwing → caught, message shown, no rejection.

Location: colocated `extension.test.ts` (or a `commands.test.ts` beside the
handler file), per CONSTITUTION `*.test.ts` convention.

## 8. Success Criteria

- SC-1: From the command palette, a developer sends a prompt to a running
  agent and sees its turn summary, without the terminal losing focus of the
  work — verified by US-1 acceptance tests passing.
- SC-2: From the command palette, a developer stops a running agent and its
  status becomes `stopped` — verified by US-2 acceptance tests passing.
- SC-3: No command handler can trigger an `illegal transition` or
  `session already completed` throw on the documented paths — verified by the
  busy/terminal-guard tests.
- SC-4: The hand-off seam is `InteractiveSession.send(prompt)` with zero new
  core classes added by this feature — verified by inspection of the diff
  (adapter/edge-only changes).
