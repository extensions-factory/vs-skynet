# Task Hand-off Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-07-06-task-handoff-design.md`

**Goal:** Add two VSCode commands — send a follow-up task to the running agent, and stop it — as a thin edge layer over the existing `InteractiveSession.send()` / `dispose()` seam.

**Architecture:** Two pure handler functions in `src/adapters/interactive/task-handoff.ts` take an injected `getSession` accessor and a structurally-`vscode.window`-compatible `HandoffWindow`, so they import no `vscode` and are fully unit-testable (mirrors the F1.2 `notify-awaiting-input.ts` pattern). The composition root (`extension.ts`) holds the single active session, wires `vscode.window` in, and registers both commands. The hand-off seam is `InteractiveSession.send(prompt)` itself — no new core class.

**Tech Stack:** TypeScript, VSCode extension API (edge only), vitest, Biome, pnpm.

## Expected Outcome

After completing this plan, the developer will have:

### Working behavior

- **US-1:** From the command palette (`Skynet: Send Task`), a developer types a prompt and it is delegated to the running agent via `session.send()`; the turn's outcome is surfaced as a notification. Busy / no-agent states are refused with a clear message instead of a crash.
- **US-2:** From the command palette (`Skynet: Stop Agent`), a developer stops the running agent (`session.dispose()` → status `stopped`); no-agent / already-stopped states show a message instead of erroring.

### Artifacts

- `src/adapters/interactive/task-handoff.ts` — `sendTaskCommand()`, `stopAgentCommand()`, the `HandoffWindow` interface, and the status guards. The hand-off seam consumed here is `InteractiveSession.send()` — no new core class.
- `src/adapters/interactive/task-handoff.test.ts` — unit tests for both handlers against a fake session.
- `src/extension.ts` — holds the single active session (`activeSession` + exported `setActiveSession` for F1.1 to plug into) and registers `skynet.sendTask` / `skynet.stopAgent`.
- `package.json` — `contributes.commands` entries for the two commands.
- `src/test-utils/vscode-mock.ts` — extended with `showInputBox` / `showErrorMessage`.

### How to see it working

- Run `pnpm run test:unit` — the full suite passes, including `task-handoff.test.ts` (all US-1 + US-2 acceptance criteria) and the updated `extension.test.ts` (two Skynet commands registered).
- In the Extension Development Host, open the command palette and run `Skynet: Send Task` / `Skynet: Stop Agent`. With no session started (F1.1 not yet wired), both correctly report "No running agent." — the happy path activates once F1.1 calls `setActiveSession()`.

## Global Constraints

- Language: TypeScript only. Indentation: tabs (match existing files).
- The handler module MUST NOT import `vscode` — all VSCode surface is injected via `HandoffWindow` (mirrors `notify-awaiting-input.ts`); only `extension.ts` (composition root) may import `vscode`.
- No new core class for the hand-off seam — commands call `InteractiveSession.send()` / `dispose()` directly (spec SC-4).
- Test runner: vitest; test files `*.test.ts` colocated with source.
- Formatter/linter: Biome only — `pnpm run lint` must pass.
- Commits: Conventional Commits (`feat:`/`test:`/…), enforced by the commit-msg hook.

---

## US-1: Send a task to the running agent

### Task 1: `sendTaskCommand` handler

**Depends on:** none

**Files:**
- Create: `src/adapters/interactive/task-handoff.ts`
- Test: `src/adapters/interactive/task-handoff.test.ts`

**Interfaces:**
- Consumes: `InteractiveSession` (`send(prompt) → TurnResult`, `status`), `TurnResult`, `SessionStatus` — all from existing `./types` / `../types`.
- Produces:
  - `interface HandoffWindow { showInputBox(options?: { prompt?: string; placeHolder?: string }): Thenable<string | undefined>; showInformationMessage(message: string): Thenable<string | undefined>; showErrorMessage(message: string): Thenable<string | undefined>; }`
  - `sendTaskCommand(getSession: () => InteractiveSession | undefined, win: HandoffWindow): Promise<void>`

- [ ] **Step 1: Write the failing tests**

Create `src/adapters/interactive/task-handoff.test.ts`:

```ts
import { describe, expect, test, vi } from "vitest";
import type { SessionStatus } from "../types";
import { sendTaskCommand } from "./task-handoff";
import type { InteractiveSession, TurnResult } from "./types";

function fakeSession(
	status: SessionStatus,
	sendResult: TurnResult = { status: "done", summary: "ok" },
	send = vi.fn(async () => sendResult),
): { session: InteractiveSession; send: typeof send } {
	const session: InteractiveSession = {
		status,
		sessionId: Promise.resolve(undefined),
		send,
		dispose: vi.fn(async () => {}),
		async *[Symbol.asyncIterator]() {},
	};
	return { session, send };
}

function fakeWindow(inputValue: string | undefined = "do the thing") {
	return {
		showInputBox: vi.fn(async () => inputValue),
		showInformationMessage: vi.fn(async () => undefined),
		showErrorMessage: vi.fn(async () => undefined),
	};
}

describe("sendTaskCommand", () => {
	test("sends the entered prompt and shows the done summary", async () => {
		const { session, send } = fakeSession("ready", {
			status: "done",
			summary: "shipped it",
		});
		const win = fakeWindow("build the widget");

		await sendTaskCommand(() => session, win);

		expect(send).toHaveBeenCalledWith("build the widget");
		expect(win.showInformationMessage).toHaveBeenCalledWith(
			"Agent finished: shipped it",
		);
	});

	test("sends when awaiting-input", async () => {
		const { session, send } = fakeSession("awaiting-input");
		await sendTaskCommand(() => session, fakeWindow("next"));
		expect(send).toHaveBeenCalledWith("next");
	});

	test("refuses when busy, without sending", async () => {
		const { session, send } = fakeSession("busy");
		const win = fakeWindow();
		await sendTaskCommand(() => session, win);
		expect(send).not.toHaveBeenCalled();
		expect(win.showInputBox).not.toHaveBeenCalled();
		expect(win.showInformationMessage).toHaveBeenCalledWith(
			"Agent isn't available right now — try again in a moment.",
		);
	});

	test("refuses when launching, without sending", async () => {
		const { session, send } = fakeSession("launching");
		const win = fakeWindow();
		await sendTaskCommand(() => session, win);
		expect(send).not.toHaveBeenCalled();
		expect(win.showInputBox).not.toHaveBeenCalled();
		expect(win.showInformationMessage).toHaveBeenCalledWith(
			"Agent isn't available right now — try again in a moment.",
		);
	});

	test("reports no running agent when there is no session", async () => {
		const win = fakeWindow();
		await sendTaskCommand(() => undefined, win);
		expect(win.showInputBox).not.toHaveBeenCalled();
		expect(win.showInformationMessage).toHaveBeenCalledWith(
			"No running agent. Start one first.",
		);
	});

	test.each(["stopped", "failed", "done"] as const)(
		"reports no running agent when the session is %s",
		async (status) => {
			const { session, send } = fakeSession(status);
			const win = fakeWindow();
			await sendTaskCommand(() => session, win);
			expect(send).not.toHaveBeenCalled();
			expect(win.showInformationMessage).toHaveBeenCalledWith(
				"No running agent. Start one first.",
			);
		},
	);

	test("does not send when the input box is dismissed", async () => {
		const { session, send } = fakeSession("ready");
		const win = fakeWindow(undefined);
		await sendTaskCommand(() => session, win);
		expect(send).not.toHaveBeenCalled();
	});

	test("does not send when the input is empty", async () => {
		const { session, send } = fakeSession("ready");
		const win = fakeWindow("");
		await sendTaskCommand(() => session, win);
		expect(send).not.toHaveBeenCalled();
	});

	test("surfaces an error TurnResult via showErrorMessage", async () => {
		const { session } = fakeSession("ready", {
			status: "error",
			reason: "boom",
		});
		const win = fakeWindow("go");
		await sendTaskCommand(() => session, win);
		expect(win.showErrorMessage).toHaveBeenCalledWith("Agent error: boom");
	});

	test("catches a thrown send and shows an error, no rejection", async () => {
		const send = vi.fn(async () => {
			throw new Error("illegal transition: busy -/send");
		});
		const { session } = fakeSession("ready", undefined, send);
		const win = fakeWindow("go");
		await expect(
			sendTaskCommand(() => session, win),
		).resolves.toBeUndefined();
		expect(win.showErrorMessage).toHaveBeenCalledWith(
			"Failed to send task: illegal transition: busy -/send",
		);
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run src/adapters/interactive/task-handoff.test.ts`
Expected: FAIL — `Failed to resolve import "./task-handoff"` / `sendTaskCommand is not a function`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/adapters/interactive/task-handoff.ts`:

```ts
import type { SessionStatus } from "../types";
import type { InteractiveSession } from "./types";

export interface HandoffWindow {
	showInputBox(options?: {
		prompt?: string;
		placeHolder?: string;
	}): Thenable<string | undefined>;
	showInformationMessage(message: string): Thenable<string | undefined>;
	showErrorMessage(message: string): Thenable<string | undefined>;
}

const SENDABLE: ReadonlySet<SessionStatus> = new Set<SessionStatus>([
	"ready",
	"awaiting-input",
]);
const TERMINAL: ReadonlySet<SessionStatus> = new Set<SessionStatus>([
	"done",
	"failed",
	"stopped",
]);

export async function sendTaskCommand(
	getSession: () => InteractiveSession | undefined,
	win: HandoffWindow,
): Promise<void> {
	const session = getSession();
	if (!session || TERMINAL.has(session.status)) {
		await win.showInformationMessage("No running agent. Start one first.");
		return;
	}
	if (!SENDABLE.has(session.status)) {
		// Covers busy (a turn is running) and launching (not ready yet) with
		// one accurate message — neither has a prompt the user can add to.
		await win.showInformationMessage(
			"Agent isn't available right now — try again in a moment.",
		);
		return;
	}

	const prompt = await win.showInputBox({ prompt: "Task for the agent" });
	if (!prompt) {
		return;
	}

	try {
		const result = await session.send(prompt);
		switch (result.status) {
			case "done":
				await win.showInformationMessage(`Agent finished: ${result.summary}`);
				break;
			case "paused":
				await win.showInformationMessage(`Agent paused: ${result.summary}`);
				break;
			case "error":
				await win.showErrorMessage(`Agent error: ${result.reason}`);
				break;
			case "timeout":
				await win.showErrorMessage("Agent turn timed out.");
				break;
			case "crashed":
				await win.showErrorMessage("Agent crashed.");
				break;
		}
	} catch (err) {
		const detail = err instanceof Error ? err.message : String(err);
		await win.showErrorMessage(`Failed to send task: ${detail}`);
	}
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run src/adapters/interactive/task-handoff.test.ts`
Expected: PASS — all `sendTaskCommand` tests green (send happy paths, launching/busy refusal, three terminal states, dismissed/empty input, error result, thrown-send caught).

- [ ] **Step 5: Lint**

Run: `pnpm run lint`
Expected: no errors on the new files.

- [ ] **Step 6: Commit**

```bash
git add src/adapters/interactive/task-handoff.ts src/adapters/interactive/task-handoff.test.ts
git commit -m "feat: sendTaskCommand hand-off handler"
```

### Task 2: Wire `skynet.sendTask` into the extension

**Depends on:** Task 1

**Files:**
- Modify: `src/extension.ts`
- Modify: `src/extension.test.ts`
- Modify: `src/test-utils/vscode-mock.ts`
- Modify: `package.json` (`contributes.commands`)

**Interfaces:**
- Consumes: `sendTaskCommand(getSession, win)` and `HandoffWindow` from Task 1; `InteractiveSession` from `./adapters/interactive/types`.
- Produces: `setActiveSession(session: InteractiveSession | undefined): void` exported from `extension.ts` — the single-session holder F1.1 will call. `getActiveSession()` is internal (`() => activeSession`).

- [ ] **Step 1: Extend the vscode mock**

In `src/test-utils/vscode-mock.ts`, add `showInputBox` and `showErrorMessage` to the existing `window` object, right after the existing `showInformationMessage: vi.fn()` line. Do NOT re-add `showInformationMessage` — it is already there (duplicate keys would shadow and trip Biome). Add only these two lines:

```ts
	showInputBox: vi.fn(),
	showErrorMessage: vi.fn(),
```

- [ ] **Step 2: Reset mocks and expect the real command in the extension test**

In `src/extension.test.ts`, first widen the vitest import to include `beforeEach` and `vi`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
```

Add a mock reset as the first statement inside `describe("activate", …)`, so `registerCommand` call history doesn't accumulate across tests (`clearAllMocks` clears call history but keeps the mock implementations, so `createTerminal` still returns its fake):

```ts
	beforeEach(() => {
		vi.clearAllMocks();
	});
```

Then replace the `"registers exactly one command"` test with:

```ts
	it("registers the send-task command", () => {
		const context = { subscriptions: [] } as unknown as Parameters<
			typeof activate
		>[0];

		activate(context);

		expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
			"skynet.sendTask",
			expect.any(Function),
		);
	});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm exec vitest run src/extension.test.ts`
Expected: FAIL — `registerCommand` was called with `skynet.helloWorld`, not `skynet.sendTask`.

- [ ] **Step 4: Rewrite `extension.ts` to hold the session and register the command**

Replace the body of `src/extension.ts` with:

```ts
import * as vscode from "vscode";
import type { InteractiveSession } from "./adapters/interactive/types";
import { sendTaskCommand } from "./adapters/interactive/task-handoff";

// Single active session (MVP; parallel sessions are E2). F1.1's start
// command calls setActiveSession() to plug the running session in here.
let activeSession: InteractiveSession | undefined;

export function setActiveSession(session: InteractiveSession | undefined): void {
	activeSession = session;
}

export function activate(context: vscode.ExtensionContext) {
	const getActiveSession = () => activeSession;

	context.subscriptions.push(
		vscode.commands.registerCommand("skynet.sendTask", () =>
			sendTaskCommand(getActiveSession, vscode.window),
		),
	);
}

export function deactivate() {}
```

- [ ] **Step 5: Replace the palette command in `package.json`**

In `contributes.commands`, replace the `skynet.helloWorld` entry with:

```json
			{
				"command": "skynet.sendTask",
				"title": "Send Task",
				"category": "Skynet"
			}
```

- [ ] **Step 6: Run the extension tests to verify they pass**

Run: `pnpm exec vitest run src/extension.test.ts`
Expected: PASS — `skynet.sendTask` registered; the terminal-API-surface test still green.

- [ ] **Step 7: Lint**

Run: `pnpm run lint`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/extension.ts src/extension.test.ts src/test-utils/vscode-mock.ts package.json
git commit -m "feat: register skynet.sendTask and establish the active-session holder"
```

**US-1 Checkpoint:**

Run: `pnpm exec vitest run src/adapters/interactive/task-handoff.test.ts src/extension.test.ts`
Expected:
- GIVEN `ready`/`awaiting-input` + entered prompt → `send(prompt)` called, `TurnResult` summary shown (`"sends the entered prompt…"`, `"sends when awaiting-input"`, `"surfaces an error TurnResult…"`).
- GIVEN `busy` or `launching` → `send` not called, "isn't available right now" shown (`"refuses when busy…"`, `"refuses when launching…"`).
- GIVEN no session, or any terminal state (`stopped`/`failed`/`done`) → `send` not called, "No running agent" shown (`"reports no running agent when there is no session"`, `"reports no running agent when the session is %s"` ×3).
- GIVEN dismissed/empty input → nothing sent (`"does not send when the input box is dismissed"`, `"…empty"`).
- `skynet.sendTask` registered in the extension (`"registers the send-task command"`).

## US-2: Stop the running agent

### Task 3: `stopAgentCommand` handler

**Depends on:** Task 1

**Files:**
- Modify: `src/adapters/interactive/task-handoff.ts`
- Modify: `src/adapters/interactive/task-handoff.test.ts`

**Interfaces:**
- Consumes: `InteractiveSession` (`dispose()`, `status`), `HandoffWindow`, the `TERMINAL` set — all already in `task-handoff.ts`.
- Produces: `stopAgentCommand(getSession: () => InteractiveSession | undefined, win: HandoffWindow): Promise<void>`

- [ ] **Step 1: Write the failing tests**

Append to `src/adapters/interactive/task-handoff.test.ts` (and add `stopAgentCommand` to the existing import from `./task-handoff`):

```ts
describe("stopAgentCommand", () => {
	test("disposes a non-terminal session and confirms", async () => {
		const { session } = fakeSession("busy");
		const win = fakeWindow();
		await stopAgentCommand(() => session, win);
		expect(session.dispose).toHaveBeenCalledTimes(1);
		expect(win.showInformationMessage).toHaveBeenCalledWith("Agent stopped.");
	});

	test.each(["ready", "awaiting-input", "launching"] as const)(
		"disposes a %s session",
		async (status) => {
			const { session } = fakeSession(status);
			await stopAgentCommand(() => session, fakeWindow());
			expect(session.dispose).toHaveBeenCalledTimes(1);
		},
	);

	test("reports nothing to stop when there is no session", async () => {
		const win = fakeWindow();
		await stopAgentCommand(() => undefined, win);
		expect(win.showInformationMessage).toHaveBeenCalledWith(
			"No running agent to stop.",
		);
	});

	test("does not dispose an already-terminal session", async () => {
		const { session } = fakeSession("stopped");
		const win = fakeWindow();
		await stopAgentCommand(() => session, win);
		expect(session.dispose).not.toHaveBeenCalled();
		expect(win.showInformationMessage).toHaveBeenCalledWith(
			"No running agent to stop.",
		);
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run src/adapters/interactive/task-handoff.test.ts`
Expected: FAIL — `stopAgentCommand is not a function`.

- [ ] **Step 3: Add the implementation**

Append to `src/adapters/interactive/task-handoff.ts`:

```ts
export async function stopAgentCommand(
	getSession: () => InteractiveSession | undefined,
	win: HandoffWindow,
): Promise<void> {
	const session = getSession();
	if (!session || TERMINAL.has(session.status)) {
		await win.showInformationMessage("No running agent to stop.");
		return;
	}
	await session.dispose();
	await win.showInformationMessage("Agent stopped.");
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run src/adapters/interactive/task-handoff.test.ts`
Expected: PASS — all `sendTaskCommand` and `stopAgentCommand` tests green.

- [ ] **Step 5: Lint**

Run: `pnpm run lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/adapters/interactive/task-handoff.ts src/adapters/interactive/task-handoff.test.ts
git commit -m "feat: stopAgentCommand hand-off handler"
```

### Task 4: Wire `skynet.stopAgent` into the extension

**Depends on:** Task 2, Task 3

**Files:**
- Modify: `src/extension.ts`
- Modify: `src/extension.test.ts`
- Modify: `package.json` (`contributes.commands`)

**Interfaces:**
- Consumes: `stopAgentCommand(getSession, win)` from Task 3; the `getActiveSession` accessor already in `activate()` from Task 2.
- Produces: nothing new — completes the command surface.

- [ ] **Step 1: Add the failing registration test**

Append to the `describe("activate", …)` block in `src/extension.test.ts`. The
count assertion locks the command surface at exactly two — it fails if the
scaffold `skynet.helloWorld` survives or a stray command is added (reliable now
that `beforeEach` clears call history):

```ts
	it("registers the stop-agent command", () => {
		const context = { subscriptions: [] } as unknown as Parameters<
			typeof activate
		>[0];

		activate(context);

		expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
			"skynet.stopAgent",
			expect.any(Function),
		);
	});

	it("registers exactly the two Skynet commands (no scaffold left)", () => {
		const context = { subscriptions: [] } as unknown as Parameters<
			typeof activate
		>[0];

		activate(context);

		expect(vscode.commands.registerCommand).toHaveBeenCalledTimes(2);
	});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/extension.test.ts`
Expected: FAIL — `skynet.stopAgent` was never registered.

- [ ] **Step 3: Register the command in `extension.ts`**

In `src/extension.ts`, update the import and add a second registration inside `activate()`:

```ts
import { sendTaskCommand, stopAgentCommand } from "./adapters/interactive/task-handoff";
```

```ts
	context.subscriptions.push(
		vscode.commands.registerCommand("skynet.sendTask", () =>
			sendTaskCommand(getActiveSession, vscode.window),
		),
		vscode.commands.registerCommand("skynet.stopAgent", () =>
			stopAgentCommand(getActiveSession, vscode.window),
		),
	);
```

- [ ] **Step 4: Add the palette entry in `package.json`**

Add to `contributes.commands` (after the `skynet.sendTask` entry):

```json
			{
				"command": "skynet.stopAgent",
				"title": "Stop Agent",
				"category": "Skynet"
			}
```

- [ ] **Step 5: Run the extension tests to verify they pass**

Run: `pnpm exec vitest run src/extension.test.ts`
Expected: PASS — both `skynet.sendTask` and `skynet.stopAgent` registration tests green.

- [ ] **Step 6: Run the full suite + lint**

Run: `pnpm run test:unit && pnpm run lint`
Expected: whole unit suite passes; Biome clean.

- [ ] **Step 7: Commit**

```bash
git add src/extension.ts src/extension.test.ts package.json
git commit -m "feat: register skynet.stopAgent command"
```

**US-2 Checkpoint:**

Run: `pnpm exec vitest run src/adapters/interactive/task-handoff.test.ts src/extension.test.ts`
Expected:
- GIVEN any non-terminal state (`busy`/`ready`/`awaiting-input`/`launching`) → `dispose()` called once, "Agent stopped." shown (`"disposes a non-terminal session…"`, `"disposes a %s session"` ×3).
- GIVEN no/terminal session → `dispose()` not called, "No running agent to stop." shown (`"reports nothing to stop…"`, `"does not dispose an already-terminal session"`).
- `skynet.stopAgent` registered, and exactly two commands total with no scaffold left (`"registers the stop-agent command"`, `"registers exactly the two Skynet commands…"`).
