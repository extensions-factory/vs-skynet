# Session Lifecycle Tracking — Design

- **Date:** 2026-07-06
- **Roadmap:** E1 · F1.2 (US1.2.1 coarse live status, US1.2.2 awaiting-input notification)
- **Depends on:** F1.1 interactive codex adapter (`src/adapters/interactive/`)

## Goal

Make an interactive session's lifecycle **explicit and observable**. A
developer supervising an agent should know its coarse status
(launching / ready / busy / awaiting-input / done / failed / stopped)
without reading terminal scrollback, and get a notification the moment an
agent parks waiting on their input.

Today `InteractiveSessionImpl` tracks lifecycle with ad-hoc booleans
(`turn`, `closed`, `closedByTerminal`) and emits no status. ARCHITECTURE.md
(line 103) prescribes an explicit `AgentSessionStateMachine` transition
table so legal lifecycles are declared in one place and inference bugs
become loud "illegal transition" errors instead of silent board
corruption. This spec builds that machine and wires it in.

Keystroke-level "thinking right now" status stays deferred (needs output
streaming via node-pty); coarse status is derived purely from the existing
mailbox/turn lifecycle.

## Scope

- **In:** pure `AgentSessionStateMachine` unit; new `status` `WorkerEvent`
  + sync `status` getter on `InteractiveSession`; rewire
  `InteractiveSessionImpl` to drive the machine; edge notifier unit for
  awaiting-input.
- **Out:** the command-palette wiring that starts a session and subscribes
  the notifier (no start command exists yet — `extension.ts` is still
  boilerplate). The notifier ships as a testable edge unit; real wiring
  lands with the F1.1/F1.3 start command. Reply-from-notification is F1.3.

## Architecture

Approach: a **pure state-machine unit** (no `vscode`, no I/O) owned by
`InteractiveSessionImpl`, which fires transition events at each existing
lifecycle point. Status surfaces two ways from one source of truth: a sync
getter for at-a-glance reads, and a `status` `WorkerEvent` auto-emitted on
every transition for reactive consumers.

Rejected alternatives: an inline `status` field on the session (violates
the explicit-machine rule; no illegal-transition detection; untestable
without a full session harness) and a free reducer function (no natural
home for the on-change hook and terminal-absorb logic).

### Unit: `src/adapters/interactive/session-state-machine.ts`

```ts
// SessionStatus is defined in src/adapters/types.ts (beside WorkerEvent) and
// imported here — see Surfacing for why. SessionEvent is machine-internal.
import type { SessionStatus } from "../types";

export type SessionEvent =
  | "readyOutbox" | "startupFailed" | "send"
  | "turnPaused" | "turnDone" | "turnFailed"
  | "terminalClosed" | "dispose";

export class AgentSessionStateMachine {
  constructor(onChange?: (from: SessionStatus, to: SessionStatus) => void);
  get state(): SessionStatus;      // starts at "launching"
  get isTerminal(): boolean;       // done | failed | stopped
  transition(event: SessionEvent): void;
}
```

`turnPaused` / `turnDone` / `turnFailed` are named in parallel — the three
mutually-exclusive outcomes `afterTurn` classifies (M2).

- Table is a `Record<SessionStatus, Partial<Record<SessionEvent, SessionStatus>>>`.
- `transition(event)`:
  - if `isTerminal` → **return** (absorb — swallows the done/crash race).
  - else look up `table[state][event]`; if defined → set state, fire
    `onChange(prev, next)`; else `throw new Error("illegal transition:
    <state> -/<event>")`.
- No I/O, no timers, no `vscode`. Fully unit-testable against the table.

### Transition table

| From | Event | To |
|------|-------|-----|
| launching | readyOutbox | ready |
| launching | startupFailed | failed |
| launching | dispose | stopped |
| launching | terminalClosed | failed |
| ready | send | busy |
| ready | dispose | stopped |
| ready | terminalClosed | failed |
| busy | turnPaused | awaiting-input |
| busy | turnDone | done |
| busy | turnFailed | failed |
| busy | dispose | stopped |
| busy | terminalClosed | failed |
| awaiting-input | send | busy |
| awaiting-input | dispose | stopped |
| awaiting-input | terminalClosed | failed |

`done` / `failed` / `stopped` are absorbing: every event is a no-op once
terminal. `done` is terminal — a completed task ends the session;
multi-turn continues only through `awaiting-input → send`.

### Surfacing (`src/adapters/types.ts`, `src/adapters/interactive/types.ts`)

- `SessionStatus` is defined **in `src/adapters/types.ts`** (beside
  `WorkerEvent`), not in the machine file. Reason: `WorkerEvent` gains a
  `status` kind that references it, and `interactive/types.ts` already
  imports from `../types` — so defining `SessionStatus` there and importing
  it *up* into `adapters/types.ts` would make the two type modules
  circular. Defining it in the parent and importing it *down* into
  `session-state-machine.ts` and `interactive/types.ts` keeps the existing
  child→parent flow. (Declines finding S2's suggested location; keeps its
  concern.)
- New `WorkerEvent` kind: `{ kind: "status"; status: SessionStatus }`.
- `InteractiveSession` interface gains `readonly status: SessionStatus`
  (sync getter → `machine.state`).
- Session constructs the machine with
  `onChange: (_, to) => this.pushEvent({ kind: "status", status: to })`,
  so every transition auto-emits into the existing async stream. The
  initial `launching` status has no transition, so it is **not** emitted as
  an event — it is readable only via the sync getter. The first `status`
  event a consumer sees is `ready`. (Because the async iterator replays
  `this.buffered` from index 0, a consumer that starts iterating after
  `startInteractive()` resolves still sees `ready` and every later status
  in order — B1.)

### Wiring: `InteractiveSessionImpl`

The machine replaces the ad-hoc booleans. Transition fires at each
existing lifecycle point:

| Lifecycle point | Event |
|-----------------|-------|
| construct (`startInteractive`) | initial `launching` (getter only, no event) |
| `ready()` success (after `harvestInto`) | `readyOutbox` |
| `ready()` timeout / crashed (**before** `dispose()`) | `startupFailed` |
| `send()` entry | `send` (covers ready→busy and awaiting-input→busy) |
| `afterTurn`: `paused` | `turnPaused` (fired **after** the `message` event) |
| `afterTurn`: `done` | `turnDone` (fired after the `message` event) |
| `afterTurn`: any other status (`error` / `timeout` / `crashed` / unknown) | `turnFailed` |
| `transport.onDidClose` | `terminalClosed` (no-op if already terminal) |
| `dispose()` | `dispose` |

- **`afterTurn` classification (B2):** `toTurnResult` only ever yields
  `paused`, `done`, or `error` (its unknown-outbox fallback returns
  `error`), plus the `timeout` / `crashed` sentinels. `afterTurn` fires
  exactly one of `turnPaused` / `turnDone` / `turnFailed`; anything that is
  not `paused` or `done` is `turnFailed`. No result escapes the machine.
- **Readiness event ordering (S5):** `ready()` runs `harvestInto()` (which
  may emit `started` then `usage`) and *then* fires `readyOutbox`. So a
  consumer sees `started`, `usage`, `status: ready` — status last, after the
  session id and first usage are known.
- **Startup-failure ordering (S4):** in `ready()`'s failure branch, fire
  `machine.transition("startupFailed")` **before** calling `this.dispose()`.
  The machine is then terminal (`failed`), so `dispose()`'s `dispose` event
  is absorbed and status stays `failed` — not overwritten to `stopped`.
- `send()`'s current `if (this.closed) throw` guard becomes
  `if (machine.isTerminal) throw new Error("session already completed")`.
- **Iterator termination (S3):** `finish()` is removed; the async iterator
  ends when `machine.isTerminal`. Reaching a terminal state always goes
  through a transition whose `onChange` calls `pushEvent` (which does
  `emitter.emit("event")`), so the terminal `status` event is what wakes the
  iterator for its final `isTerminal` check — replacing the explicit
  `emitter.emit("event")` in today's `finish()`. `_sessionId` handling
  (emit `undefined` if no id was harvested by the time the session goes
  terminal) is preserved, moved to where `finish()` used to run.
- The `terminalClosed` transition replaces the `closedByTerminal` boolean;
  `waitForOutbox` still returns `"crashed"` from the same signal.

### Edge notifier: `src/adapters/interactive/notify-awaiting-input.ts`

Co-located with the interactive adapter (S1): it operates on
`InteractiveSession`. It imports **no** `vscode` — instead it takes an
injected, structurally-`vscode.window`-compatible window object (a minimal
`NotifyWindow` interface), which keeps it fully unit-testable with a fake;
the real composition root passes `vscode.window`. It sits next to
`vscode-terminal-transport.ts` (the interactive adapter's other edge unit)
rather than at the `src/` root, which holds only the composition root
(`extension.ts`).

```ts
export interface NotifyWindow {
  showInformationMessage(
    message: string,
    ...items: string[]
  ): Thenable<string | undefined>; // structurally compatible with vscode.window
}

export function notifyOnAwaitingInput(
  session: InteractiveSession,
  label: string, // worker id, for the message text
  win: NotifyWindow,
  reveal: () => void,
): Promise<void>;
```

Iterates `session`, buffering the text of the most recent `message` event.
On a `status` event with `status === "awaiting-input"` it shows an
information message — `` `${label} is waiting on you: ${lastMessage}` `` —
with a **"Focus terminal"** action that calls `reveal()`. `session`
doesn't expose the worker id, so it's passed as `label`. The pause summary
is the buffered `message` text: `afterTurn` emits the `message` event
*before* firing the `turnPaused` transition, so it's always seen first.
`win` and `reveal` are injected so it is testable with fakes and holds the
only `vscode` dependency at the edge. Palette wiring is deferred (see
Scope).

## Error handling

- Illegal transition (non-terminal) → throw. This is a real inference bug,
  surfaced loudly per ARCHITECTURE.md.
- Terminal states absorb all further events, so genuine races
  (terminal closes as a turn resolves; dispose after done) never throw.
- Startup failure (`ready()` timeout/crash) transitions to `failed`, then
  `dispose()`'s `dispose` event is absorbed — status stays `failed`, not
  overwritten to `stopped`.

## Testing

- `session-state-machine.test.ts` — pure, no fixtures: assert every legal
  edge in the table, `throw` on a sampled illegal edge from each
  non-terminal state, and terminal absorption (event after done/failed/
  stopped is a no-op).
- Extend `interactive-session.test.ts` — with the fake transport, assert
  the `session.status` getter progression through
  `launching → ready → busy → awaiting-input → busy → done`, and that the
  emitted `status` `WorkerEvent`s are the transitions only —
  `ready, busy, awaiting-input, busy, done` (no `launching` event; getter
  reads it before the first event — B1). Plus the crash path (`… → failed`)
  and startup-timeout path (getter `launching → failed`, event `failed`).
  Keep the existing "send() rejects once completed" test green — it now
  exercises the `machine.isTerminal` guard that replaced `this.closed`
  (M3).
- `notify-awaiting-input.test.ts` — fake session emitting a `message` then
  an `awaiting-input` status; assert `showInformationMessage` called with
  the label + buffered summary, and that selecting the action invokes
  `reveal`.

## Acceptance

- `AgentSessionStateMachine` exists as a pure unit with the table above and
  throw/absorb semantics.
- `InteractiveSession` exposes `status` (sync) and emits `status`
  `WorkerEvent`s; ad-hoc lifecycle booleans removed.
- A parked (`awaiting-input`) session triggers the notifier with a
  Focus-terminal action.
- All new/changed units covered by the tests above; `pnpm run test:unit`
  green.
