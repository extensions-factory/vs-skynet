# Start Agent + Codex Preflight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-07-07-start-agent-design.md`

**Goal:** Add a `Skynet: Start Agent` command that launches a codex interactive session as the active session, gated by a preflight that confirms codex is installed and signed in.

**Architecture:** Two pure, dependency-injected units — `preflight.ts` (`checkCodex(run, codexHome)`, injected child-process runner) and `start-agent.ts` (`startAgentCommand(deps)`, injected window/config/adapter/accessors) — mirroring the released `task-handoff.ts` / `notify-awaiting-input.ts` pattern. `extension.ts` (the composition root) supplies the real `execFile` runner, VSCode config, `codexAdapter.runInteractive`, and `setActiveSession`. No adapter code changes.

**Tech Stack:** TypeScript (strict), vitest (unit, `vscode` aliased to a mock), Biome, pnpm. VSCode extension API. `node:child_process` `execFile` for the preflight only.

## Expected Outcome

After completing this plan, the developer will have:

### Working behavior

- US-1: A developer runs `Skynet: Start Agent` once and a codex session launches in a terminal and becomes the active session that `Skynet: Send Task` / `Skynet: Stop Agent` operate on — no per-run prompts.
- US-2: When codex is not installed or not signed in (or no folder / no home is configured), the command reports a distinct, actionable message and never opens a terminal.

### Artifacts

- `src/adapters/codex/preflight.ts` — `checkCodex(run, codexHome)` detection unit (+ `preflight.test.ts`).
- `src/commands/start-agent.ts` — `startAgentCommand(deps)` command handler (+ `start-agent.test.ts`).
- `src/extension.ts` — registers `skynet.startAgent`, wires real deps (edited; `extension.test.ts` updated).
- `package.json` — `skynet.startAgent` command and `skynet.codex.*` settings (activation is auto-generated from the command declaration).

### How to see it working

- In the Extension Development Host with codex installed + signed in and `skynet.codex.home` set to an isolated codex home and a folder open: run **Skynet: Start Agent** → a `Skynet · codex …` terminal opens, reaches readiness, and **Skynet: Send Task** then drives a turn. With codex signed out (point `skynet.codex.home` at an empty dir): **Skynet: Start Agent** shows "codex is not signed in. Run: codex login" and no terminal opens.

## Global Constraints

- TypeScript only; Biome only (`pnpm run lint`); kebab-case filenames; camelCase functions, PascalCase types.
- Unit tests are vitest, colocated `*.test.ts`, run via `pnpm run test:unit`; they must run headless — no real codex install, no real terminal, no real `child_process` spawn (inject the runner).
- pty/terminal only for agent orchestration; no provider SDK/API dependency. The preflight is the only new `child_process` use and is confined to install/auth diagnostics (endorsed by `CONSTITUTION.md` §CLI-integration).
- The codex adapter requires an isolated `CODEX_HOME`; the start command resolves it as `skynet.codex.home` setting → `CODEX_HOME` env → error.
- Preflight parses `codex login status` **stdout** (`Not logged in`), not its exit code (exit `0` both ways, probed against `codex-cli 0.142.5`).
- Sandbox default is `workspace-write`; `model` omitted → codex's own default.

---

## Foundation

Blocks both US-1 (start needs the gate types) and US-2 (this is the detection logic).

### Task 1: Codex preflight unit

**Depends on:** none

**Files:**
- Create: `src/adapters/codex/preflight.ts`
- Test: `src/adapters/codex/preflight.test.ts`

**Interfaces:**
- Consumes: nothing (injected `Run`).
- Produces:
  - `interface RunResult { code: number; stdout: string; stderr: string }`
  - `type Run = (cmd: string, args: string[], env?: Record<string, string>) => Promise<RunResult>` — rejects when the binary cannot be spawned (ENOENT).
  - `type PreflightResult = { ok: true; version: string } | { ok: false; reason: "not-installed"; message: string } | { ok: false; reason: "not-signed-in"; message: string }`
  - `function checkCodex(run: Run, codexHome: string): Promise<PreflightResult>`

- [ ] **Step 1: Write the failing tests**

```ts
// src/adapters/codex/preflight.test.ts
import { describe, expect, test, vi } from "vitest";
import { checkCodex, type Run, type RunResult } from "./preflight";

const ok = (stdout: string): RunResult => ({ code: 0, stdout, stderr: "" });

describe("checkCodex", () => {
	test("reports not-installed when codex cannot be spawned", async () => {
		const run: Run = vi.fn(async () => {
			throw Object.assign(new Error("spawn codex ENOENT"), { code: "ENOENT" });
		});
		const result = await checkCodex(run, "/home/codex");
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.reason).toBe("not-installed");
		expect(result.message).toMatch(/codex/i);
	});

	test("reports not-signed-in when login status says Not logged in", async () => {
		const run: Run = vi.fn(async (_cmd, args) =>
			args[0] === "--version" ? ok("codex-cli 0.142.5") : ok("Not logged in"),
		);
		const result = await checkCodex(run, "/home/codex");
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.reason).toBe("not-signed-in");
		expect(result.message).toMatch(/codex login/);
	});

	test("passes login status env with CODEX_HOME", async () => {
		const run = vi.fn(async (_cmd: string, args: string[]) =>
			args[0] === "--version" ? ok("codex-cli 0.142.5") : ok("Logged in using ChatGPT"),
		);
		await checkCodex(run as Run, "/home/codex");
		expect(run).toHaveBeenCalledWith("codex", ["login", "status"], {
			CODEX_HOME: "/home/codex",
		});
	});

	test("reports ok with the parsed version when signed in", async () => {
		const run: Run = vi.fn(async (_cmd, args) =>
			args[0] === "--version" ? ok("codex-cli 0.142.5\n") : ok("Logged in using ChatGPT"),
		);
		const result = await checkCodex(run, "/home/codex");
		expect(result).toEqual({ ok: true, version: "codex-cli 0.142.5" });
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run test:unit src/adapters/codex/preflight.test.ts`
Expected: FAIL — `Failed to resolve import "./preflight"` / `checkCodex is not a function`.

- [ ] **Step 3: Write the minimal implementation**

```ts
// src/adapters/codex/preflight.ts
export interface RunResult {
	code: number;
	stdout: string;
	stderr: string;
}

export type Run = (
	cmd: string,
	args: string[],
	env?: Record<string, string>,
) => Promise<RunResult>;

export type PreflightResult =
	| { ok: true; version: string }
	| { ok: false; reason: "not-installed"; message: string }
	| { ok: false; reason: "not-signed-in"; message: string };

export async function checkCodex(
	run: Run,
	codexHome: string,
): Promise<PreflightResult> {
	let version: string;
	try {
		const v = await run("codex", ["--version"]);
		version = v.stdout.trim();
	} catch {
		return {
			ok: false,
			reason: "not-installed",
			message: "codex CLI not found on your PATH. Install codex and try again.",
		};
	}

	const status = await run("codex", ["login", "status"], {
		CODEX_HOME: codexHome,
	});
	if (status.stdout.includes("Not logged in")) {
		return {
			ok: false,
			reason: "not-signed-in",
			message: "codex is not signed in. Run: codex login",
		};
	}

	return { ok: true, version };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm run test:unit src/adapters/codex/preflight.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/adapters/codex/preflight.ts src/adapters/codex/preflight.test.ts
git commit -m "feat: codex install/sign-in preflight"
```

---

## US-1: Start an agent in one command

Implements spec US-1. Task 2 is the pure handler (launch path + guards); Task 3 wires it into VSCode and ships the command/settings. The preflight *gate* lands in US-2 (Task 4).

### Task 2: Start-agent command handler

**Depends on:** Task 1

**Files:**
- Create: `src/commands/start-agent.ts`
- Test: `src/commands/start-agent.test.ts`

**Interfaces:**
- Consumes: `PreflightResult` from `src/adapters/codex/preflight.ts`; `InteractiveOpts`, `InteractiveSession` from `src/adapters/interactive/types.ts`; `SessionStatus` from `src/adapters/types.ts`.
- Produces:
  - `type Sandbox = "read-only" | "workspace-write" | "danger-full-access"`
  - `interface StartAgentConfig { codexHome?: string; model?: string; sandbox?: Sandbox }` (root resolves `codexHome` as setting → env before calling)
  - `interface StartAgentWindow { showErrorMessage(m: string): Thenable<string | undefined>; showInformationMessage(m: string): Thenable<string | undefined> }`
  - `interface StartAgentDeps { getActiveSession(): InteractiveSession | undefined; setActiveSession(s: InteractiveSession | undefined): void; getWorkspaceCwd(): string | undefined; getConfig(): StartAgentConfig; checkCodex(codexHome: string): Promise<PreflightResult>; runInteractive(opts: InteractiveOpts): Promise<InteractiveSession>; genWorkerId(): string; win: StartAgentWindow }`
  - `function startAgentCommand(deps: StartAgentDeps): Promise<void>`

  Note: `checkCodex` is declared here but not *called* until Task 4 — Task 2 wires the launch path only. Task 4 inserts the gate.

  **Intentional spec deviations (SF-1, SF-2):** the property is named `win` (not the spec's `window`) to avoid shadowing the `vscode.window` import in the composition root, and the config field is `codexHome` (not the spec's `home`) because the config type isn't codex-scoped by name. Both are internally consistent across handler, tests, and wiring.

- [ ] **Step 1: Write the failing tests**

```ts
// src/commands/start-agent.test.ts
import { describe, expect, test, vi } from "vitest";
import type { SessionStatus } from "../adapters/types";
import type { InteractiveSession } from "../adapters/interactive/types";
import type { PreflightResult } from "../adapters/codex/preflight";
import { startAgentCommand, type StartAgentDeps } from "./start-agent";

function fakeSession(status: SessionStatus = "ready"): InteractiveSession {
	return {
		status,
		sessionId: Promise.resolve(undefined),
		send: vi.fn(async () => ({ status: "done", summary: "ok" }) as const),
		dispose: vi.fn(async () => {}),
		async *[Symbol.asyncIterator]() {},
	};
}

function makeDeps(over: Partial<StartAgentDeps> = {}): StartAgentDeps {
	const session = fakeSession();
	return {
		getActiveSession: () => undefined,
		setActiveSession: vi.fn(),
		getWorkspaceCwd: () => "/repo",
		getConfig: () => ({ codexHome: "/home/codex", sandbox: "workspace-write" }),
		checkCodex: vi.fn(async (): Promise<PreflightResult> => ({ ok: true, version: "codex-cli 0.142.5" })),
		runInteractive: vi.fn(async () => session),
		genWorkerId: () => "codex-abcd1234",
		win: {
			showErrorMessage: vi.fn(async () => undefined),
			showInformationMessage: vi.fn(async () => undefined),
		},
		...over,
	};
}

describe("startAgentCommand (launch path)", () => {
	test("launches with opts from config and publishes the session", async () => {
		const session = fakeSession();
		const deps = makeDeps({
			runInteractive: vi.fn(async () => session),
			getConfig: () => ({ codexHome: "/home/codex", model: "gpt-x", sandbox: "read-only" }),
		});
		await startAgentCommand(deps);
		expect(deps.runInteractive).toHaveBeenCalledWith({
			cwd: "/repo",
			workerId: "codex-abcd1234",
			configDir: "/home/codex",
			model: "gpt-x",
			sandbox: "read-only",
		});
		expect(deps.setActiveSession).toHaveBeenCalledWith(session);
		expect(deps.win.showInformationMessage).toHaveBeenCalledWith("Agent started.");
	});

	test("omits model and defaults sandbox to workspace-write", async () => {
		const deps = makeDeps({ getConfig: () => ({ codexHome: "/home/codex" }) });
		await startAgentCommand(deps);
		expect(deps.runInteractive).toHaveBeenCalledWith(
			expect.objectContaining({ sandbox: "workspace-write", model: undefined }),
		);
	});

	test("refuses when a non-terminal session is already active", async () => {
		const deps = makeDeps({ getActiveSession: () => fakeSession("busy") });
		await startAgentCommand(deps);
		expect(deps.runInteractive).not.toHaveBeenCalled();
		expect(deps.win.showErrorMessage).toHaveBeenCalledWith(
			"An agent is already running — stop it first.",
		);
	});

	test("allows starting when the previous session is terminal", async () => {
		const deps = makeDeps({ getActiveSession: () => fakeSession("stopped") });
		await startAgentCommand(deps);
		expect(deps.runInteractive).toHaveBeenCalledTimes(1);
	});

	test("aborts when no workspace folder is open", async () => {
		const deps = makeDeps({ getWorkspaceCwd: () => undefined });
		await startAgentCommand(deps);
		expect(deps.runInteractive).not.toHaveBeenCalled();
		expect(deps.win.showErrorMessage).toHaveBeenCalledWith(
			"Open a folder before starting an agent.",
		);
	});

	test("aborts when no codex home is configured", async () => {
		const deps = makeDeps({ getConfig: () => ({ codexHome: undefined }) });
		await startAgentCommand(deps);
		expect(deps.runInteractive).not.toHaveBeenCalled();
		expect(deps.win.showErrorMessage).toHaveBeenCalledWith(
			"Set skynet.codex.home (or the CODEX_HOME env var) to an isolated codex home.",
		);
	});

	test("catches a thrown runInteractive and shows an error, no rejection", async () => {
		const deps = makeDeps({
			runInteractive: vi.fn(async () => {
				throw new Error("readiness timeout");
			}),
		});
		await expect(startAgentCommand(deps)).resolves.toBeUndefined();
		expect(deps.setActiveSession).not.toHaveBeenCalled();
		expect(deps.win.showErrorMessage).toHaveBeenCalledWith(
			"Failed to start agent: readiness timeout",
		);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run test:unit src/commands/start-agent.test.ts`
Expected: FAIL — `Failed to resolve import "./start-agent"`.

- [ ] **Step 3: Write the minimal implementation**

```ts
// src/commands/start-agent.ts
import type { PreflightResult } from "../adapters/codex/preflight";
import type {
	InteractiveOpts,
	InteractiveSession,
} from "../adapters/interactive/types";
import type { SessionStatus } from "../adapters/types";

export type Sandbox = "read-only" | "workspace-write" | "danger-full-access";

export interface StartAgentConfig {
	codexHome?: string;
	model?: string;
	sandbox?: Sandbox;
}

export interface StartAgentWindow {
	showErrorMessage(message: string): Thenable<string | undefined>;
	showInformationMessage(message: string): Thenable<string | undefined>;
}

export interface StartAgentDeps {
	getActiveSession(): InteractiveSession | undefined;
	setActiveSession(s: InteractiveSession | undefined): void;
	getWorkspaceCwd(): string | undefined;
	getConfig(): StartAgentConfig;
	checkCodex(codexHome: string): Promise<PreflightResult>;
	runInteractive(opts: InteractiveOpts): Promise<InteractiveSession>;
	genWorkerId(): string;
	win: StartAgentWindow;
}

const TERMINAL: ReadonlySet<SessionStatus> = new Set<SessionStatus>([
	"done",
	"failed",
	"stopped",
]);

export async function startAgentCommand(deps: StartAgentDeps): Promise<void> {
	const active = deps.getActiveSession();
	if (active && !TERMINAL.has(active.status)) {
		await deps.win.showErrorMessage(
			"An agent is already running — stop it first.",
		);
		return;
	}

	const cwd = deps.getWorkspaceCwd();
	if (!cwd) {
		await deps.win.showErrorMessage("Open a folder before starting an agent.");
		return;
	}

	const cfg = deps.getConfig();
	const codexHome = cfg.codexHome?.trim() || undefined;
	if (!codexHome) {
		await deps.win.showErrorMessage(
			"Set skynet.codex.home (or the CODEX_HOME env var) to an isolated codex home.",
		);
		return;
	}

	const opts: InteractiveOpts = {
		cwd,
		workerId: deps.genWorkerId(),
		configDir: codexHome,
		model: cfg.model?.trim() || undefined,
		sandbox: cfg.sandbox ?? "workspace-write",
	};

	try {
		const session = await deps.runInteractive(opts);
		deps.setActiveSession(session);
		await deps.win.showInformationMessage("Agent started.");
	} catch (err) {
		const detail = err instanceof Error ? err.message : String(err);
		await deps.win.showErrorMessage(`Failed to start agent: ${detail}`);
	}
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm run test:unit src/commands/start-agent.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/commands/start-agent.ts src/commands/start-agent.test.ts
git commit -m "feat: start-agent command handler launch path"
```

### Task 3: Register the command and wire real dependencies

**Depends on:** Task 2

**Files:**
- Modify: `src/extension.ts`
- Modify: `src/extension.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `startAgentCommand`, `StartAgentDeps`, `StartAgentConfig`, `Sandbox` from `src/commands/start-agent.ts`; `checkCodex`, `Run`, `RunResult` from `src/adapters/codex/preflight.ts`; `codexAdapter` from `src/adapters/codex/codex-adapter.ts`; existing `setActiveSession` / `activeSession` in `extension.ts`.
- Produces: registered `skynet.startAgent` command; `contributes.commands` + `contributes.configuration` in `package.json` (`activationEvents` stays empty — auto-generated).

- [ ] **Step 1: Update the failing extension test**

Keep the existing `registers the send-task command`, `registers the stop-agent command`, and `mocks the terminal API surface` tests unchanged. Only **replace** the `registers exactly the two Skynet commands (no scaffold left)` test with the two tests below (a start-agent registration assertion + an exactly-three assertion):

```ts
// src/extension.test.ts — replace the "exactly the two Skynet commands" test
it("registers the start-agent command", () => {
	const context = { subscriptions: [] } as unknown as Parameters<typeof activate>[0];
	activate(context);
	expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
		"skynet.startAgent",
		expect.any(Function),
	);
});

it("registers exactly the three Skynet commands (no scaffold left)", () => {
	const context = { subscriptions: [] } as unknown as Parameters<typeof activate>[0];
	activate(context);
	expect(vscode.commands.registerCommand).toHaveBeenCalledTimes(3);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm run test:unit src/extension.test.ts`
Expected: FAIL — `registerCommand` called 2 times, `skynet.startAgent` never registered.

- [ ] **Step 3: Wire the command in `extension.ts`**

Add imports and a real `execFile`-backed runner, then register the command. Full new file:

```ts
// src/extension.ts
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as vscode from "vscode";
import { codexAdapter } from "./adapters/codex/codex-adapter";
import { checkCodex, type Run, type RunResult } from "./adapters/codex/preflight";
import {
	sendTaskCommand,
	stopAgentCommand,
} from "./adapters/interactive/task-handoff";
import type { InteractiveSession } from "./adapters/interactive/types";
import {
	type Sandbox,
	type StartAgentConfig,
	startAgentCommand,
} from "./commands/start-agent";

let activeSession: InteractiveSession | undefined;

export function setActiveSession(
	session: InteractiveSession | undefined,
): void {
	activeSession = session;
}

const runCli: Run = (cmd, args, env) =>
	new Promise<RunResult>((resolve, reject) => {
		execFile(
			cmd,
			args,
			{ env: { ...process.env, ...env } },
			(err, stdout, stderr) => {
				// Spawn failure (binary not on PATH) → reject so checkCodex reports not-installed.
				if (err && (err as NodeJS.ErrnoException).code === "ENOENT") {
					reject(err);
					return;
				}
				// ponytail: async execFile puts the numeric exit code on err.code (not err.status,
				// which is spawnSync's field). checkCodex never reads `code` — it parses stdout —
				// so this is best-effort only; the exit code is deliberately not a decision input.
				const code =
					err && typeof (err as { code?: unknown }).code === "number"
						? (err as { code: number }).code
						: 0;
				resolve({ code, stdout: stdout ?? "", stderr: stderr ?? "" });
			},
		);
	});

function readConfig(): StartAgentConfig {
	const c = vscode.workspace.getConfiguration("skynet.codex");
	const codexHome =
		c.get<string>("home")?.trim() || process.env.CODEX_HOME?.trim() || undefined;
	return {
		codexHome,
		model: c.get<string>("model")?.trim() || undefined,
		sandbox: c.get<Sandbox>("sandbox") ?? "workspace-write",
	};
}

export function activate(context: vscode.ExtensionContext) {
	const getActiveSession = () => activeSession;

	context.subscriptions.push(
		vscode.commands.registerCommand("skynet.startAgent", () =>
			startAgentCommand({
				getActiveSession,
				setActiveSession,
				getWorkspaceCwd: () =>
					vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
				getConfig: readConfig,
				checkCodex: (codexHome) => checkCodex(runCli, codexHome),
				runInteractive: (opts) => codexAdapter.runInteractive(opts),
				genWorkerId: () => `codex-${randomUUID().slice(0, 8)}`,
				win: vscode.window,
			}),
		),
		vscode.commands.registerCommand("skynet.sendTask", () =>
			sendTaskCommand(getActiveSession, vscode.window),
		),
		vscode.commands.registerCommand("skynet.stopAgent", () =>
			stopAgentCommand(getActiveSession, vscode.window),
		),
	);
}

export function deactivate() {}
```

- [ ] **Step 4: Add the command and settings to `package.json`**

In `contributes.commands`, add:

```json
{
	"command": "skynet.startAgent",
	"title": "Start Agent",
	"category": "Skynet"
}
```

Add `contributes.configuration` (sibling of `commands`):

```json
"configuration": {
	"title": "Skynet",
	"properties": {
		"skynet.codex.home": {
			"type": "string",
			"default": "",
			"description": "Path to an isolated codex home (CODEX_HOME) for Skynet sessions. Falls back to the CODEX_HOME environment variable when empty."
		},
		"skynet.codex.model": {
			"type": "string",
			"default": "",
			"description": "Model to launch codex with. Empty uses codex's own default."
		},
		"skynet.codex.sandbox": {
			"type": "string",
			"enum": ["read-only", "workspace-write", "danger-full-access"],
			"default": "workspace-write",
			"description": "Codex sandbox permission level for Skynet sessions."
		}
	}
}
```

Leave `activationEvents` as `[]`. VSCode (engine `^1.125`) auto-generates `onCommand:*` activation for every command in `contributes.commands`, which is how the existing `sendTask` / `stopAgent` already activate — no explicit entry is needed.

- [ ] **Step 5: Run the tests and lint to verify they pass**

Run: `pnpm run test:unit src/extension.test.ts && pnpm run lint`
Expected: PASS (extension tests green, including exactly-three-commands); Biome clean. Then `node -e "require('./package.json')"` parses (valid JSON).

- [ ] **Step 6: Commit**

```bash
git add src/extension.ts src/extension.test.ts package.json
git commit -m "feat: register skynet.startAgent command and settings"
```

**US-1 Checkpoint:**

- Run the full unit suite: `pnpm run test:unit` → all green.
- In the Extension Development Host (codex installed + signed in, `skynet.codex.home` set to an isolated home, a folder open): run **Skynet: Start Agent** → a `Skynet · codex …` terminal opens and reaches readiness; **Skynet: Send Task** drives a turn (GIVEN installed+signed-in+folder+home WHEN start THEN session launches and becomes active).
- With a session already running, run **Skynet: Start Agent** again → "An agent is already running — stop it first."; no second terminal (GIVEN active WHEN start THEN refuses).
- Close the folder (no workspace) → **Skynet: Start Agent** → "Open a folder before starting an agent."; clear `skynet.codex.home` and unset `CODEX_HOME` → "Set skynet.codex.home …"; no terminal in either case (GIVEN no folder / no home WHEN start THEN aborts, no terminal).

## US-2: Detect a missing or signed-out CLI

Implements spec US-2. Task 1 (Foundation) is the detection logic; this task inserts the gate into the command so a broken CLI is caught before any terminal opens.

### Task 4: Gate the launch on the preflight

**Depends on:** Task 1, Task 2

**Files:**
- Modify: `src/commands/start-agent.ts`
- Modify: `src/commands/start-agent.test.ts`

**Interfaces:**
- Consumes: `checkCodex` via `deps.checkCodex(codexHome)` (declared in Task 2); `PreflightResult`.
- Produces: no new exports — `startAgentCommand` now calls `checkCodex` after resolving the home and before building `opts`.

- [ ] **Step 1: Write the failing tests**

Append to `src/commands/start-agent.test.ts`:

```ts
describe("startAgentCommand (preflight gate)", () => {
	test("runs checkCodex with the resolved home before launching", async () => {
		const deps = makeDeps();
		await startAgentCommand(deps);
		expect(deps.checkCodex).toHaveBeenCalledWith("/home/codex");
	});

	test("aborts and shows the message when codex is not installed", async () => {
		const deps = makeDeps({
			checkCodex: vi.fn(async () => ({
				ok: false as const,
				reason: "not-installed" as const,
				message: "codex CLI not found on your PATH. Install codex and try again.",
			})),
		});
		await startAgentCommand(deps);
		expect(deps.runInteractive).not.toHaveBeenCalled();
		expect(deps.setActiveSession).not.toHaveBeenCalled();
		expect(deps.win.showErrorMessage).toHaveBeenCalledWith(
			"codex CLI not found on your PATH. Install codex and try again.",
		);
	});

	test("aborts and shows the message when codex is not signed in", async () => {
		const deps = makeDeps({
			checkCodex: vi.fn(async () => ({
				ok: false as const,
				reason: "not-signed-in" as const,
				message: "codex is not signed in. Run: codex login",
			})),
		});
		await startAgentCommand(deps);
		expect(deps.runInteractive).not.toHaveBeenCalled();
		expect(deps.win.showErrorMessage).toHaveBeenCalledWith(
			"codex is not signed in. Run: codex login",
		);
	});

	test("does not run checkCodex when the home is missing", async () => {
		const deps = makeDeps({ getConfig: () => ({ codexHome: undefined }) });
		await startAgentCommand(deps);
		expect(deps.checkCodex).not.toHaveBeenCalled();
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm run test:unit src/commands/start-agent.test.ts`
Expected: FAIL — `checkCodex` never called (no gate yet); not-installed/not-signed-in cases still call `runInteractive`.

- [ ] **Step 3: Insert the gate**

In `startAgentCommand`, add the preflight call between the `codexHome` guard and building `opts`:

```ts
	if (!codexHome) {
		await deps.win.showErrorMessage(
			"Set skynet.codex.home (or the CODEX_HOME env var) to an isolated codex home.",
		);
		return;
	}

	const pre = await deps.checkCodex(codexHome);
	if (!pre.ok) {
		await deps.win.showErrorMessage(pre.message);
		return;
	}

	const opts: InteractiveOpts = {
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm run test:unit src/commands/start-agent.test.ts`
Expected: PASS (11 tests — the 7 launch-path tests still green, 4 gate tests now green).

- [ ] **Step 5: Commit**

```bash
git add src/commands/start-agent.ts src/commands/start-agent.test.ts
git commit -m "feat: gate start-agent on the codex preflight"
```

**US-2 Checkpoint:**

- With `skynet.codex.home` pointing at an empty/signed-out codex home, run **Skynet: Start Agent** → "codex is not signed in. Run: codex login"; no terminal opens (GIVEN installed but signed out WHEN start THEN not-signed-in message, no terminal, `runInteractive` not called).
- With codex removed from `PATH` (or `skynet.codex.home` valid but binary absent), run **Skynet: Start Agent** → "codex CLI not found on your PATH. Install codex and try again."; no terminal (GIVEN not installed WHEN start THEN not-installed message, no terminal).
- With codex installed + signed in, the preflight returns ok and the launch proceeds (GIVEN signed in WHEN preflight runs THEN ok, launch proceeds) — verified by `pnpm run test:unit` (`reports ok with the parsed version`) and the US-1 happy-path checkpoint.
