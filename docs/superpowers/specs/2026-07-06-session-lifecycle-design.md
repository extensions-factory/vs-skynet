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
export type SessionStatus =
  | "launching" | "ready" | "busy" | "awaiting-input"
  | "done" | "failed" | "stopped";

export type SessionEvent =
  | "readyOutbox" | "startupFailed" | "send"
  | "paused" | "doneOutbox" | "turnFailed"
  | "terminalClosed" | "dispose";

export class AgentSessionStateMachine {
  constructor(onChange?: (from: SessionStatus, to: SessionStatus) => void);
  get state(): SessionStatus;      // starts at "launching"
  get isTerminal(): boolean;       // done | failed | stopped
  transition(event: SessionEvent): void;
}
```

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
| busy | paused | awaiting-input |
| busy | doneOutbox | done |
| busy | turnFailed | failed |
| busy | dispose | stopped |
| busy | terminalClosed | failed |
| awaiting-input | send | busy |
| awaiting-input | dispose | stopped |
| awaiting-input | terminalClosed | failed |

`done` / `failed` / `stopped` are absorbing: every event is a no-op once
terminal. `done` is terminal — a completed task ends the session;
multi-turn continues only through `awaiting-input → send`.

### Surfacing (`src/adapters/types.ts`, `interactive/types.ts`)

- New `WorkerEvent` kind: `{ kind: "status"; status: SessionStatus }`.
- `InteractiveSession` interface gains `readonly status: SessionStatus`
  (sync getter → `machine.state`).
- Session constructs the machine with
  `onChange: (_, to) => this.pushEvent({ kind: "status", status: to })`,
  so every transition auto-emits into the existing async stream.

### Wiring: `InteractiveSessionImpl`

The machine replaces the ad-hoc booleans. Transition fires at each
existing lifecycle point:

| Lifecycle point | Event |
|-----------------|-------|
| construct (`startInteractive`) | initial `launching` |
| `ready()` success (after `harvestInto`) | `readyOutbox` |
| `ready()` timeout / crashed (before dispose) | `startupFailed` |
| `send()` entry | `send` (covers ready→busy and awaiting-input→busy) |
| `afterTurn`: `paused` | `paused` (fired **after** the `message` event) |
| `afterTurn`: `done` | `doneOutbox` (fired after the `message` event) |
| `afterTurn`: `error` / `timeout` / `crashed` | `turnFailed` |
| `transport.onDidClose` | `terminalClosed` (no-op if already terminal) |
| `dispose()` | `dispose` |

- `send()`'s current `if (this.closed) throw` guard becomes
  `if (machine.isTerminal) throw new Error("session already completed")`.
- `finish()` folds into machine terminality; the async iterator ends when
  `machine.isTerminal`. `_sessionId` handling (emit `undefined` on finish
  without a harvested id) is preserved.
- The `terminalClosed` transition replaces the `closedByTerminal` boolean;
  `waitForOutbox` still returns `"crashed"` from the same signal.

### Edge notifier: `src/notify-awaiting-input.ts`

```ts
export function notifyOnAwaitingInput(
  session: InteractiveSession,
  label: string, // worker id, for the message text
  win: Pick<typeof import("vscode").window, "showInformationMessage">,
  reveal: () => void,
): Promise<void>;
```

Iterates `session`, buffering the text of the most recent `message` event.
On a `status` event with `status === "awaiting-input"` it shows an
information message — `` `${label} is waiting on you: ${lastMessage}` `` —
with a **"Focus terminal"** action that calls `reveal()`. `session`
doesn't expose the worker id, so it's passed as `label`. The pause summary
is the buffered `message` text: `afterTurn` emits the `message` event
*before* firing the `paused` transition, so it's always seen first.
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
  `session.status` progression and ordered `status` `WorkerEvent`s across a
  full turn (`launching → ready → busy → awaiting-input → busy → done`),
  plus the crash path (`… → failed`) and startup-timeout path
  (`launching → failed`).
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
