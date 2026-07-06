# Session Lifecycle Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an interactive session's lifecycle explicit and observable — a coarse `status` on the session plus an awaiting-input notification — via an explicit `AgentSessionStateMachine`.

**Architecture:** A pure state-machine unit (no `vscode`, no I/O) is owned by `InteractiveSessionImpl`, which fires a transition event at each existing lifecycle point. Status surfaces from one source of truth: a sync `status` getter and a `status` `WorkerEvent` auto-emitted on every transition. An edge notifier iterates the session and pops a VSCode message when it parks on `awaiting-input`.

**Tech Stack:** TypeScript, vitest (`pnpm run test:unit`), Biome (`pnpm run lint`), pnpm. VSCode extension. Spec: `docs/superpowers/specs/2026-07-06-session-lifecycle-design.md`.

## Global Constraints

- TypeScript only. Package manager: pnpm only.
- Naming: camelCase vars/functions, PascalCase types/classes, kebab-case filenames. Test files `*.test.ts` colocated with source.
- Formatter/linter: Biome only. Run `pnpm run lint` before each commit; tabs for indentation (match existing files).
- Commits: Conventional Commits (`feat:`, `test:`, `refactor:`), enforced by commit-msg hook.
- Core (`session-state-machine.ts`) imports **no** `vscode` and does **no** I/O. The notifier holds no `vscode` import either — it takes an injected window object.
- `SessionStatus` is defined in `src/adapters/types.ts` (beside `WorkerEvent`) — never in `interactive/types.ts` (that file already imports from `../types`; the reverse would make the two type modules circular).

---

## US-1: Coarse live status (US1.2.1)

A developer reads an interactive session's coarse status
(`launching / ready / busy / awaiting-input / done / failed / stopped`)
without reading terminal scrollback — via a sync `session.status` getter and
ordered `status` `WorkerEvent`s on the session's async stream, backed by an
explicit state machine.

### Task 1: `AgentSessionStateMachine` pure unit

**Files:**
- Modify: `src/adapters/types.ts` (add `SessionStatus` type export)
- Create: `src/adapters/interactive/session-state-machine.ts`
- Test: `src/adapters/interactive/session-state-machine.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `SessionStatus` (in `src/adapters/types.ts`): `"launching" | "ready" | "busy" | "awaiting-input" | "done" | "failed" | "stopped"`.
  - `SessionEvent` (in `session-state-machine.ts`): `"readyOutbox" | "startupFailed" | "send" | "turnPaused" | "turnDone" | "turnFailed" | "terminalClosed" | "dispose"`.
  - `class AgentSessionStateMachine`: `constructor(onChange?: (from: SessionStatus, to: SessionStatus) => void)`; `get state(): SessionStatus` (starts `"launching"`); `get isTerminal(): boolean`; `transition(event: SessionEvent): void`.

- [ ] **Step 1: Add `SessionStatus` to `src/adapters/types.ts`**

At the top of `src/adapters/types.ts`, below the existing `ErrorClass` line, add:

```ts
export type SessionStatus =
	| "launching"
	| "ready"
	| "busy"
	| "awaiting-input"
	| "done"
	| "failed"
	| "stopped";
```

- [ ] **Step 2: Write the failing test**

Create `src/adapters/interactive/session-state-machine.test.ts`:

```ts
import { describe, expect, test, vi } from "vitest";
import { AgentSessionStateMachine } from "./session-state-machine";

describe("AgentSessionStateMachine", () => {
	test("starts at launching, not terminal", () => {
		const m = new AgentSessionStateMachine();
		expect(m.state).toBe("launching");
		expect(m.isTerminal).toBe(false);
	});

	test("walks a full turn lifecycle and fires onChange with from/to", () => {
		const changes: Array<[string, string]> = [];
		const m = new AgentSessionStateMachine((from, to) => {
			changes.push([from, to]);
		});
		m.transition("readyOutbox");
		expect(m.state).toBe("ready");
		m.transition("send");
		expect(m.state).toBe("busy");
		m.transition("turnPaused");
		expect(m.state).toBe("awaiting-input");
		m.transition("send");
		m.transition("turnDone");
		expect(m.state).toBe("done");
		expect(m.isTerminal).toBe(true);
		expect(changes).toEqual([
			["launching", "ready"],
			["ready", "busy"],
			["busy", "awaiting-input"],
			["awaiting-input", "busy"],
			["busy", "done"],
		]);
	});

	test("throws on an illegal transition from a non-terminal state", () => {
		const m = new AgentSessionStateMachine();
		expect(() => m.transition("turnDone")).toThrow(
			/illegal transition: launching -\/turnDone/,
		);
	});

	test("terminal states absorb further events without throwing or firing onChange", () => {
		const onChange = vi.fn();
		const m = new AgentSessionStateMachine(onChange);
		m.transition("readyOutbox");
		m.transition("send");
		m.transition("turnFailed");
		expect(m.state).toBe("failed");
		onChange.mockClear();
		m.transition("dispose");
		m.transition("terminalClosed");
		expect(m.state).toBe("failed");
		expect(onChange).not.toHaveBeenCalled();
	});

	test("dispose from launching goes to stopped; terminalClosed goes to failed", () => {
		const a = new AgentSessionStateMachine();
		a.transition("dispose");
		expect(a.state).toBe("stopped");
		const b = new AgentSessionStateMachine();
		b.transition("startupFailed");
		expect(b.state).toBe("failed");
	});
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm exec vitest run src/adapters/interactive/session-state-machine.test.ts`
Expected: FAIL — cannot resolve `./session-state-machine`.

- [ ] **Step 4: Write minimal implementation**

Create `src/adapters/interactive/session-state-machine.ts`:

```ts
import type { SessionStatus } from "../types";

export type SessionEvent =
	| "readyOutbox"
	| "startupFailed"
	| "send"
	| "turnPaused"
	| "turnDone"
	| "turnFailed"
	| "terminalClosed"
	| "dispose";

const TERMINAL: ReadonlySet<SessionStatus> = new Set<SessionStatus>([
	"done",
	"failed",
	"stopped",
]);

const TABLE: Record<
	SessionStatus,
	Partial<Record<SessionEvent, SessionStatus>>
> = {
	launching: {
		readyOutbox: "ready",
		startupFailed: "failed",
		dispose: "stopped",
		terminalClosed: "failed",
	},
	ready: {
		send: "busy",
		dispose: "stopped",
		terminalClosed: "failed",
	},
	busy: {
		turnPaused: "awaiting-input",
		turnDone: "done",
		turnFailed: "failed",
		dispose: "stopped",
		terminalClosed: "failed",
	},
	"awaiting-input": {
		send: "busy",
		dispose: "stopped",
		terminalClosed: "failed",
	},
	done: {},
	failed: {},
	stopped: {},
};

export class AgentSessionStateMachine {
	private current: SessionStatus = "launching";

	constructor(
		private readonly onChange?: (
			from: SessionStatus,
			to: SessionStatus,
		) => void,
	) {}

	get state(): SessionStatus {
		return this.current;
	}

	get isTerminal(): boolean {
		return TERMINAL.has(this.current);
	}

	transition(event: SessionEvent): void {
		if (this.isTerminal) {
			return;
		}
		const next = TABLE[this.current][event];
		if (next === undefined) {
			throw new Error(`illegal transition: ${this.current} -/${event}`);
		}
		const prev = this.current;
		this.current = next;
		this.onChange?.(prev, next);
	}
}
```

- [ ] **Step 5: Run test to verify it passes and lint**

Run: `pnpm exec vitest run src/adapters/interactive/session-state-machine.test.ts && pnpm run lint`
Expected: PASS (5 tests); lint clean.

- [ ] **Step 6: Commit**

```bash
git add src/adapters/types.ts src/adapters/interactive/session-state-machine.ts src/adapters/interactive/session-state-machine.test.ts
git commit -m "feat: explicit AgentSessionStateMachine transition table"
```

### Task 2: Surface `status` on `InteractiveSession` and drive the machine

**Files:**
- Modify: `src/adapters/types.ts` (add `status` `WorkerEvent` kind)
- Modify: `src/adapters/interactive/types.ts` (add `status` to `InteractiveSession`)
- Modify: `src/adapters/interactive/interactive-session.ts` (replace ad-hoc booleans with the machine)
- Test: `src/adapters/interactive/interactive-session.test.ts` (extend)

**Interfaces:**
- Consumes: `AgentSessionStateMachine`, `SessionStatus` (Task 1).
- Produces:
  - `WorkerEvent` gains `{ kind: "status"; status: SessionStatus }`.
  - `InteractiveSession` gains `readonly status: SessionStatus`.

- [ ] **Step 1: Write the failing test (extend the existing suite)**

Add these two tests inside the `describe("InteractiveSession", …)` block in `src/adapters/interactive/interactive-session.test.ts` (reuse the file's existing `fakeProfile`, `mkTmpRepo`, `writeOutbox`, `fastDeps` helpers):

```ts
	test("status getter and status events track the lifecycle", async () => {
		const cwd = await mkTmpRepo();
		const transport = new FakeTerminalTransport();
		const profile = fakeProfile({
			sessionDir: () => cwd,
			harvest: () => ({ sessionId: "sess-1" }),
		});
		const startPromise = startInteractive(
			profile,
			{ cwd, workerId: "s1", readyTimeoutMs: 2_000, turnTimeoutMs: 2_000 },
			fastDeps(transport),
		);
		writeOutbox(cwd, "s1", 0, { status: "paused", summary: "ready" }, 30);
		const session = await startPromise;
		expect(session.status).toBe("ready");

		writeOutbox(cwd, "s1", 1, { status: "paused", summary: "step 1" }, 30);
		await session.send("turn 1");
		expect(session.status).toBe("awaiting-input");

		writeOutbox(cwd, "s1", 2, { status: "done", summary: "fin" }, 30);
		await session.send("turn 2");
		expect(session.status).toBe("done");

		const statuses: string[] = [];
		for await (const event of session) {
			if (event.kind === "status") {
				statuses.push(event.status);
			}
		}
		expect(statuses).toEqual([
			"ready",
			"busy",
			"awaiting-input",
			"busy",
			"done",
		]);
		await session.dispose();
	});

	test("a crashed turn drives status to failed", async () => {
		const cwd = await mkTmpRepo();
		const transport = new FakeTerminalTransport();
		const startPromise = startInteractive(
			fakeProfile(),
			{ cwd, workerId: "s2", readyTimeoutMs: 2_000, turnTimeoutMs: 2_000 },
			{ ...fastDeps(transport), checkAlive: async () => false, crashPollMs: 50 },
		);
		writeOutbox(cwd, "s2", 0, { status: "paused", summary: "ready" }, 20);
		const session = await startPromise;

		const result = await session.send("will crash");
		expect(result.status).toBe("crashed");
		expect(session.status).toBe("failed");
		await session.dispose();
	});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run src/adapters/interactive/interactive-session.test.ts`
Expected: FAIL — `session.status` is `undefined` / property does not exist.

- [ ] **Step 3: Add the `status` `WorkerEvent` kind**

In `src/adapters/types.ts`, extend the `WorkerEvent` union with a new member (keep the others unchanged):

```ts
export type WorkerEvent =
	| { kind: "started"; sessionId: string; model?: string }
	| { kind: "message"; text: string }
	| { kind: "thinking"; text: string }
	| { kind: "tool_call"; name: string; input: unknown }
	| ({ kind: "usage" } & WorkerUsage)
	| { kind: "status"; status: SessionStatus }
	| { kind: "unknown"; raw: unknown };
```

- [ ] **Step 4: Add `status` to the `InteractiveSession` interface**

In `src/adapters/interactive/types.ts`, import `SessionStatus` from `../types` (add it to the existing `import type` line) and add the getter to the interface:

```ts
import type {
	ErrorClass,
	SessionStatus,
	WorkerEvent,
	WorkerUsage,
} from "../types";
```

```ts
export interface InteractiveSession extends AsyncIterable<WorkerEvent> {
	send(prompt: string): Promise<TurnResult>;
	readonly status: SessionStatus;
	readonly sessionId: Promise<string | undefined>;
	dispose(): Promise<void>;
}
```

- [ ] **Step 5: Drive the machine from `InteractiveSessionImpl`**

In `src/adapters/interactive/interactive-session.ts`:

Add the import (near the other `./` imports):

```ts
import { AgentSessionStateMachine } from "./session-state-machine";
```

Replace the class fields `private closed = false;` and `private closedByTerminal = false;` with the machine. The `private turn = 0;` and `private _sessionId` fields stay. New field block:

```ts
	private turn = 0;
	private _sessionId: string | undefined;
	private readonly emitter = new EventEmitter();
	private readonly buffered: WorkerEvent[] = [];
	private readonly machine = new AgentSessionStateMachine((_, to) => {
		this.pushEvent({ kind: "status", status: to });
		if (to === "done" || to === "failed" || to === "stopped") {
			this.finalizeTerminal();
		}
	});
```

(Check `to` directly rather than `this.machine.isTerminal` — avoids referencing the field from inside its own initializer, SF1.)

Add the public getter (place beside the `sessionId` getter):

```ts
	get status(): SessionStatus {
		return this.machine.state;
	}
```

Merge `SessionStatus` into the **existing** `../types` import (the file already has `import type { WorkerEvent } from "../types";` at line 3 — extend that line rather than adding a second import from the same module, which Biome would flag, M2):

```ts
import type { SessionStatus, WorkerEvent } from "../types";
```

(The `./types` import group — `HarvestResult, InteractiveCliProfile, …, TurnResult` — is unchanged.)

Change the constructor's terminal-close listener from setting the boolean to firing the transition:

```ts
		transport.onDidClose(() => {
			this.machine.transition("terminalClosed");
		});
```

In `sessionId` getter, replace `if (this.closed)` with `if (this.machine.isTerminal)`.

In `ready()`, the success path fires `readyOutbox` after `harvestInto`, and the failure path fires `startupFailed` **before** `dispose()`:

```ts
		if (raw === "timeout" || raw === "crashed") {
			this.machine.transition("startupFailed");
			await this.dispose();
			throw new Error(`interactive session not ready: ${String(raw)}`);
		}
		await this.harvestInto();
		this.machine.transition("readyOutbox");
	}
```

In `send()`, replace the completed guard and add the `send` transition:

```ts
	async send(prompt: string): Promise<TurnResult> {
		if (this.machine.isTerminal) {
			throw new Error("session already completed");
		}
		this.machine.transition("send");
		this.turn += 1;
		const turn = this.turn;
		// … rest unchanged …
```

In `waitForOutbox`, replace `if (this.closedByTerminal)` with a machine check — the terminal-close listener has already fired the transition, so:

```ts
			// Only terminalClosed can set "failed" here: startupFailed fires
			// after ready()'s waitForOutbox returns, turnFailed after send()'s.
			if (this.machine.state === "failed") {
				return "crashed";
			}
```

Rewrite `afterTurn` so the `message` event is emitted **before** the turn transition, and every outcome fires exactly one transition:

```ts
	private async afterTurn(base: TurnResult): Promise<TurnResult> {
		const harvested = await this.harvestInto();
		if (base.status === "paused" || base.status === "done") {
			this.pushEvent({ kind: "message", text: base.summary });
		}
		if (base.status === "paused") {
			this.machine.transition("turnPaused");
		} else if (base.status === "done") {
			this.machine.transition("turnDone");
		} else {
			this.machine.transition("turnFailed");
		}
		return base.status === "done" && harvested.usage
			? { ...base, usage: harvested.usage }
			: base;
	}
```

Remove the `finish()` method and add `finalizeTerminal()` in its place (it runs the sessionId-undefined emit that `finish()` used to do; the `pushEvent` that woke the iterator now comes from the terminal `status` event):

```ts
	private finalizeTerminal(): void {
		if (this._sessionId === undefined) {
			this.emitter.emit("sessionId", undefined);
		}
	}
```

Change `dispose()` to fire the transition instead of calling `finish()`:

```ts
	async dispose(): Promise<void> {
		await this.mailbox.dispose();
		this.transport.dispose();
		this.machine.transition("dispose");
	}
```

In the async iterator, replace `if (this.closed)` with `if (this.machine.isTerminal)`:

```ts
			if (this.machine.isTerminal) {
				return;
			}
```

- [ ] **Step 6: Run the full interactive-session suite to verify all pass**

Run: `pnpm exec vitest run src/adapters/interactive/interactive-session.test.ts`
Expected: PASS — the two new tests plus all pre-existing tests (including "send() rejects once the session has completed", which now exercises the `machine.isTerminal` guard). The one existing test that iterates events asserts with `toContainEqual` (a subset check), so the extra `status` events do not break it (SF3).

- [ ] **Step 7: Run the whole unit suite and lint**

Run: `pnpm run test:unit && pnpm run lint`
Expected: PASS across the repo; lint clean. (Confirms no other consumer broke on the widened `WorkerEvent` union.)

- [ ] **Step 8: Commit**

```bash
git add src/adapters/types.ts src/adapters/interactive/types.ts src/adapters/interactive/interactive-session.ts src/adapters/interactive/interactive-session.test.ts
git commit -m "feat: surface coarse session status via the state machine"
```

---

## US-2: Awaiting-input notification (US1.2.2)

When an agent parks waiting on the user, a VSCode information message pops
with the pause summary and a "Focus terminal" action. Ships as an
injected-dependency edge unit; the command that starts a session and wires
this in lands with F1.1/F1.3.

### Task 3: `notifyOnAwaitingInput` edge notifier

**Files:**
- Create: `src/adapters/interactive/notify-awaiting-input.ts`
- Test: `src/adapters/interactive/notify-awaiting-input.test.ts`

**Interfaces:**
- Consumes: `InteractiveSession` (its `AsyncIterable<WorkerEvent>` stream, Task 2).
- Produces:
  - `interface NotifyWindow { showInformationMessage(message: string, ...items: string[]): Thenable<string | undefined>; }`
  - `function notifyOnAwaitingInput(session: InteractiveSession, label: string, win: NotifyWindow, reveal: () => void): Promise<void>`.

Note (deliberate deviation from spec, SF2): the spec's S1 note says the notifier "imports `vscode`," but this plan defines a minimal structural `NotifyWindow` and imports **no** `vscode` — strictly better for testability and consistent with the spec's own statement that `win`/`reveal` are injected. The real composition root passes `vscode.window`, which is structurally compatible with `NotifyWindow`. The spec has been updated to match.

- [ ] **Step 1: Write the failing test**

Create `src/adapters/interactive/notify-awaiting-input.test.ts`:

```ts
import { describe, expect, test, vi } from "vitest";
import { notifyOnAwaitingInput } from "./notify-awaiting-input";
import type { InteractiveSession } from "./types";
import type { WorkerEvent } from "../types";

function fakeSession(events: WorkerEvent[]): InteractiveSession {
	return {
		status: "ready",
		sessionId: Promise.resolve(undefined),
		send: async () => ({ status: "timeout" }),
		dispose: async () => {},
		async *[Symbol.asyncIterator]() {
			for (const event of events) {
				yield event;
			}
		},
	};
}

describe("notifyOnAwaitingInput", () => {
	test("shows a message with the buffered summary and reveals on the action", async () => {
		const session = fakeSession([
			{ kind: "message", text: "need your call" },
			{ kind: "status", status: "awaiting-input" },
		]);
		const showInformationMessage = vi
			.fn()
			.mockResolvedValue("Focus terminal");
		const reveal = vi.fn();

		await notifyOnAwaitingInput(
			session,
			"worker-1",
			{ showInformationMessage },
			reveal,
		);

		expect(showInformationMessage).toHaveBeenCalledWith(
			"worker-1 is waiting on you: need your call",
			"Focus terminal",
		);
		expect(reveal).toHaveBeenCalledTimes(1);
	});

	test("does not reveal when the user dismisses the message", async () => {
		const session = fakeSession([
			{ kind: "status", status: "awaiting-input" },
		]);
		const showInformationMessage = vi.fn().mockResolvedValue(undefined);
		const reveal = vi.fn();

		await notifyOnAwaitingInput(
			session,
			"w",
			{ showInformationMessage },
			reveal,
		);

		expect(showInformationMessage).toHaveBeenCalledTimes(1);
		expect(reveal).not.toHaveBeenCalled();
	});
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run src/adapters/interactive/notify-awaiting-input.test.ts`
Expected: FAIL — cannot resolve `./notify-awaiting-input`.

- [ ] **Step 3: Write minimal implementation**

Create `src/adapters/interactive/notify-awaiting-input.ts`:

```ts
import type { InteractiveSession } from "./types";

export interface NotifyWindow {
	showInformationMessage(
		message: string,
		...items: string[]
	): Thenable<string | undefined>;
}

const FOCUS_ACTION = "Focus terminal";

export async function notifyOnAwaitingInput(
	session: InteractiveSession,
	label: string,
	win: NotifyWindow,
	reveal: () => void,
): Promise<void> {
	let lastMessage = "";
	for await (const event of session) {
		if (event.kind === "message") {
			lastMessage = event.text;
		} else if (
			event.kind === "status" &&
			event.status === "awaiting-input"
		) {
			const choice = await win.showInformationMessage(
				`${label} is waiting on you: ${lastMessage}`,
				FOCUS_ACTION,
			);
			if (choice === FOCUS_ACTION) {
				reveal();
			}
		}
	}
}
```

- [ ] **Step 4: Run to verify it passes and lint**

Run: `pnpm exec vitest run src/adapters/interactive/notify-awaiting-input.test.ts && pnpm run lint`
Expected: PASS (2 tests); lint clean.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/interactive/notify-awaiting-input.ts src/adapters/interactive/notify-awaiting-input.test.ts
git commit -m "feat: awaiting-input notifier for interactive sessions"
```

---

## Self-Review Notes

- **Spec coverage:** state machine → Task 1; `status` getter + `status` event + machine wiring → Task 2; notifier → Task 3. Testing section of the spec maps to the tests in Tasks 1–3. Startup-failure → `failed` is covered by the machine unit test (Task 1, "dispose from launching / startupFailed") since no session is returned to observe from the session test — noted per spec B1/S4.
- **Deferred (out of scope, per spec):** command-palette wiring that starts a session and subscribes the notifier — lands with F1.1/F1.3.
- **Type consistency:** `SessionStatus` (adapters/types.ts), `SessionEvent` (machine), event names `turnPaused/turnDone/turnFailed` used identically across Task 1 table, Task 2 `afterTurn`, and the tests.
