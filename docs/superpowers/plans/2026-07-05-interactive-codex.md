# Interactive Codex Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an interactive run mode that drives `codex` as a live TUI inside a VSCode terminal — multi-turn steering with pause/resume in one session, proven against a real `codex` install through a file mailbox.

**Architecture:** A CLI-agnostic core under `src/adapters/interactive/` (mailbox with a `protocol.md` file, doorbell, crash detection, session harvesting, and the `InteractiveSession` state machine) driven entirely through files and a `TerminalTransport` interface, so the core is testable without a real CLI. `src/adapters/codex/interactive-profile.ts` supplies the one CLI-specific seam (`codexInteractive: InteractiveCliProfile`) — launch argv, env, submit key, and a rollout-JSONL parser. `codexAdapter.runInteractive()` wires them together.

**Tech Stack:** TypeScript (`module: Node16`, strict, CommonJS emit), VSCode extension API (`vscode.window.createTerminal`), Node `child_process`/`fs/promises`/`events`, vitest (unit) + `@vscode/test-cli` (integration), Biome.

## Global Constraints

- **pty/terminal only** (`CONSTITUTION.md`): no `codex exec --json`, no provider SDK. Interactive mailbox is the only run mode; a single-turn session is the fast path.
- Verified launch argv (`codex-cli 0.142.4`): `codex -C <cwd> [-m <model>] -s <sandbox> -a never -c disable_paste_burst=true -c 'tui.keymap.composer.submit="tab"' -c 'tui.keymap.composer.queue="ctrl-q"'`; submit key `"\t"`.
- Default timeouts: `turnTimeoutMs` 300000 (5 min); `readyTimeoutMs` 30000 (30s, **turn-0 only**, re-pings once on expiry). Real-work turns (N ≥ 1) are **never** re-pinged.
- Protocol is delivered via `.skynet/<workerId>/protocol.md` (disposable, gitignored). The project's own instruction file (`AGENTS.md`) is **never** read or written.
- Crash detection (`ps -Ao pid,ppid,comm` descendant walk) is **macOS/Linux only** in v1.
- The mailbox reader is a **poll loop** (~500ms), not `vscode.FileSystemWatcher`.
- **Unit tests (vitest):** colocated `src/adapters/**/<module>.test.ts`; `import { describe, expect, test } from "vitest"`. Run: `pnpm run test:unit`.
- **Integration tests (mocha, `@vscode/test-cli`):** under `src/test/**`; `suite`/`test` globals + `import * as assert from "node:assert"`; real `vscode`. Run: `pnpm run test:integration`.
- Relative imports omit the `.js` extension (matches `src/extension.test.ts`).
- The real-CLI e2e test is gated behind `process.env.CODEX_INTERACTIVE_E2E` so `pnpm test` does not burn quota by default.
- Commits: Conventional Commits, enforced by the commit-msg hook.
- Spec: [`docs/superpowers/specs/2026-07-04-interactive-codex-design.md`](../specs/2026-07-04-interactive-codex-design.md) — read first.

---

## US-0: Shared adapter foundation (prerequisite)

The interactive core imports shared types and a pure error classifier from `src/adapters/`. `active/` has neither yet. This US creates the minimal set the interactive code consumes — nothing more (no one-shot `run()`/`RunOpts`/`WorkerRun`; those belong to a headless path the constitution forbids).

### Task 0.1: Shared types + error classifier

**Files:**
- Create: `src/adapters/types.ts`
- Create: `src/adapters/classify.ts`
- Test: `src/adapters/classify.test.ts`

**Interfaces:**
- Produces:
  - `type ErrorClass = "limit" | "transport" | "terminal"`
  - `type WorkerEvent` (union incl. `started`/`message`/`usage`)
  - `interface WorkerUsage { inputTokens: number; outputTokens: number; cachedInputTokens?: number; cacheWriteTokens?: number; reasoningTokens?: number; costUsd?: number }`
  - `interface WorkerResult { status: "success"|"failed"|"cancelled"; reason?: string; errorClass?: ErrorClass; usage?: WorkerUsage; lastMessage?: string }`
  - `function classifyError(text: string): ErrorClass`

- [ ] **Step 1: Create the types file (no test — pure declarations)**

Create `src/adapters/types.ts`:

```ts
export type ErrorClass = "limit" | "transport" | "terminal";

export type WorkerEvent =
  | { kind: "started"; sessionId: string; model?: string }
  | { kind: "message"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "tool_call"; name: string; input: unknown }
  | ({ kind: "usage" } & WorkerUsage)
  | { kind: "unknown"; raw: unknown };

export interface WorkerUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  costUsd?: number;
}

export interface WorkerResult {
  status: "success" | "failed" | "cancelled";
  reason?: string;
  errorClass?: ErrorClass;
  usage?: WorkerUsage;
  lastMessage?: string;
}
```

- [ ] **Step 2: Write the failing test**

Create `src/adapters/classify.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { classifyError } from "./classify";

describe("classifyError", () => {
  test("matches rate-limit language as limit", () => {
    expect(classifyError("Error 429: too many requests")).toBe("limit");
    expect(classifyError("you have hit your quota")).toBe("limit");
  });

  test("matches network language as transport", () => {
    expect(classifyError("ECONNRESET while reading socket")).toBe("transport");
    expect(classifyError("dns ENOTFOUND")).toBe("transport");
  });

  test("falls back to terminal for anything else", () => {
    expect(classifyError("segfault in child process")).toBe("terminal");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm run test:unit src/adapters/classify.test.ts`
Expected: FAIL — `Cannot find module './classify'`.

- [ ] **Step 4: Write minimal implementation**

Create `src/adapters/classify.ts`:

```ts
import type { ErrorClass } from "./types";

const LIMIT = /rate.?limit|429|quota|too many requests/i;
const TRANSPORT = /network|econn|etimedout|timeout|socket|dns|enotfound/i;

// ponytail: heuristic patterns, unverified against real limit/transport output.
// Refine the regexes on the first real capture.
export function classifyError(text: string): ErrorClass {
  if (LIMIT.test(text)) {
    return "limit";
  }
  if (TRANSPORT.test(text)) {
    return "transport";
  }
  return "terminal";
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm run test:unit src/adapters/classify.test.ts`
Expected: PASS — all three cases green.

- [ ] **Step 6: Commit**

```bash
git add src/adapters/types.ts src/adapters/classify.ts src/adapters/classify.test.ts
git commit -m "feat: shared adapter types + error classifier"
```

---

## US-1: Interactive Codex Mode

A developer calls `codexAdapter.runInteractive({cwd, workerId})`, gets an `InteractiveSession` that has already completed a turn-0 readiness handshake, `send()`s real turns that pause or complete, watches a sparse `WorkerEvent` stream, reads a harvested `sessionId`/usage from codex's own rollout JSONL, and `dispose()`s cleanly — proven by deterministic vitest unit tests (fake terminal transport) plus an opt-in real-CLI integration test.

### Task 1: Interactive types + shell quoting

**Files:**
- Create: `src/adapters/interactive/types.ts`
- Create: `src/adapters/interactive/shell.ts`
- Test: `src/adapters/interactive/shell.test.ts`

**Interfaces:**
- Consumes: `ErrorClass`, `WorkerEvent`, `WorkerUsage` from `../types` (Task 0.1).
- Produces:
  - `interface InteractiveOpts { cwd: string; workerId: string; model?: string; configDir?: string; sandbox?: "read-only"|"workspace-write"|"danger-full-access"; turnTimeoutMs?: number; readyTimeoutMs?: number }`
  - `type TurnResult = { status: "paused"; summary: string } | { status: "done"; summary: string; usage?: WorkerUsage; filesTouched?: string[] } | { status: "error"; reason: string; errorClass?: ErrorClass } | { status: "timeout" } | { status: "crashed" }`
  - `interface InteractiveSession extends AsyncIterable<WorkerEvent> { send(prompt: string): Promise<TurnResult>; readonly sessionId: Promise<string | undefined>; dispose(): Promise<void> }`
  - `interface HarvestResult { sessionId?: string; usage?: WorkerUsage; rateLimits?: unknown }`
  - `interface InteractiveCliProfile { id: "codex"|"claude"|"agy"; launchArgv(opts: InteractiveOpts): string[]; configEnv(configDir?: string): Record<string,string>; submitSequence: string; sessionDir(configDir?: string): string; harvest(sessionFileText: string): HarvestResult; sessionInfoPrompt?(outboxPath: string): string }`
  - `interface TerminalTransport { show(preserveFocus: boolean): void; sendText(text: string, addNewLine: boolean): void; sendSequence(sequence: string): Promise<void>; processId(): Promise<number | undefined>; onDidClose(listener: (exitCode: number|undefined) => void): {dispose():void}; dispose(): void }`
  - `interface TerminalFactory { create(opts: {name: string; cwd: string; env: Record<string, string>}): TerminalTransport }`
  - `function shellQuote(value: string): string`
  - `function buildLaunchCommand(binary: string, argv: string[]): string`

- [ ] **Step 1: Create the types file (no test — pure declarations)**

Create `src/adapters/interactive/types.ts`:

```ts
import type { ErrorClass, WorkerEvent, WorkerUsage } from "../types";

export interface InteractiveOpts {
  cwd: string;
  workerId: string;
  model?: string;
  configDir?: string;
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  turnTimeoutMs?: number;
  readyTimeoutMs?: number;
}

export type TurnResult =
  | { status: "paused"; summary: string }
  | { status: "done"; summary: string; usage?: WorkerUsage; filesTouched?: string[] }
  | { status: "error"; reason: string; errorClass?: ErrorClass }
  | { status: "timeout" }
  | { status: "crashed" };

export interface InteractiveSession extends AsyncIterable<WorkerEvent> {
  send(prompt: string): Promise<TurnResult>;
  readonly sessionId: Promise<string | undefined>;
  dispose(): Promise<void>;
}

export interface HarvestResult {
  sessionId?: string;
  usage?: WorkerUsage;
  rateLimits?: unknown;
}

export interface InteractiveCliProfile {
  id: "codex" | "claude" | "agy";
  launchArgv(opts: InteractiveOpts): string[];
  configEnv(configDir?: string): Record<string, string>;
  submitSequence: string;
  sessionDir(configDir?: string): string;
  harvest(sessionFileText: string): HarvestResult;
  sessionInfoPrompt?(outboxPath: string): string;
}

export interface TerminalTransport {
  show(preserveFocus: boolean): void;
  sendText(text: string, addNewLine: boolean): void;
  sendSequence(sequence: string): Promise<void>;
  processId(): Promise<number | undefined>;
  onDidClose(listener: (exitCode: number | undefined) => void): { dispose(): void };
  dispose(): void;
}

export interface TerminalFactory {
  create(opts: { name: string; cwd: string; env: Record<string, string> }): TerminalTransport;
}
```

- [ ] **Step 2: Write the failing test**

Create `src/adapters/interactive/shell.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { buildLaunchCommand, shellQuote } from "./shell";

describe("shellQuote", () => {
  test("wraps a plain value in single quotes", () => {
    expect(shellQuote("workspace-write")).toBe("'workspace-write'");
  });

  test("escapes embedded single quotes", () => {
    expect(shellQuote("it's")).toBe("'it'\\''s'");
  });

  test("wraps a path with spaces", () => {
    expect(shellQuote("/tmp/with space")).toBe("'/tmp/with space'");
  });
});

describe("buildLaunchCommand", () => {
  test("joins the binary name with each quoted argv token", () => {
    expect(buildLaunchCommand("codex", ["-C", "/tmp/proj", "-s", "workspace-write"])).toBe(
      "codex '-C' '/tmp/proj' '-s' 'workspace-write'"
    );
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm run test:unit src/adapters/interactive/shell.test.ts`
Expected: FAIL — `Cannot find module './shell'`.

- [ ] **Step 4: Write minimal implementation**

Create `src/adapters/interactive/shell.ts`:

```ts
// Uniformly single-quotes every argv token before joining. A quoted flag
// (e.g. '-C') behaves identically to an unquoted one in a POSIX shell, so this
// skips per-token special-character detection.
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function buildLaunchCommand(binary: string, argv: string[]): string {
  return [binary, ...argv.map(shellQuote)].join(" ");
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm run test:unit src/adapters/interactive/shell.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/adapters/interactive/types.ts src/adapters/interactive/shell.ts src/adapters/interactive/shell.test.ts
git commit -m "feat: interactive types + shell quoting"
```

---

### Task 2: Mailbox (inbox/outbox + protocol.md + gitignore)

**Files:**
- Create: `src/adapters/interactive/fs-helpers.ts`
- Create: `src/adapters/interactive/mailbox.ts`
- Test: `src/adapters/interactive/mailbox.test.ts`

**Interfaces:**
- Produces:
  - `function readFileIfExists(filePath: string): Promise<string>` (returns `""` on `ENOENT`, rethrows otherwise).
  - `class Mailbox { readonly relativeDir: string; readonly dir: string; constructor(cwd: string, workerId: string); ensureDirs(): Promise<void>; ensureGitignored(cwd: string): Promise<void>; writeProtocol(text: string): Promise<void>; writeInbox(turn: number, text: string): Promise<void>; tryReadOutbox(turn: number): Promise<unknown>; dispose(): Promise<void> }`
  - `relativeDir` is `.skynet/<workerId>` (forward-slash, used inside ping text; independent of host path separator).
  - `tryReadOutbox` is a **single non-blocking attempt**: returns `undefined` if the file doesn't exist yet or isn't valid JSON yet (mid-write); throws on any other error. The poll loop lives in `InteractiveSession` (Task 8).

- [ ] **Step 1: Write the failing test**

Create `src/adapters/interactive/mailbox.test.ts`:

```ts
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, test } from "vitest";
import { Mailbox } from "./mailbox";

async function mkTmpRepo(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "mailbox-test-"));
}

describe("Mailbox", () => {
  test("writeInbox writes the exact turn file under inbox/", async () => {
    const cwd = await mkTmpRepo();
    const mailbox = new Mailbox(cwd, "w1");
    await mailbox.ensureDirs();
    await mailbox.writeInbox(1, "do the thing");
    const written = await fs.readFile(path.join(cwd, ".skynet", "w1", "inbox", "turn-1.md"), "utf8");
    expect(written).toBe("do the thing");
  });

  test("writeProtocol writes protocol.md at the mailbox root", async () => {
    const cwd = await mkTmpRepo();
    const mailbox = new Mailbox(cwd, "w1b");
    await mailbox.ensureDirs();
    await mailbox.writeProtocol("PROTOCOL BODY");
    const written = await fs.readFile(path.join(cwd, ".skynet", "w1b", "protocol.md"), "utf8");
    expect(written).toBe("PROTOCOL BODY");
  });

  test("tryReadOutbox returns undefined when the file does not exist yet", async () => {
    const cwd = await mkTmpRepo();
    const mailbox = new Mailbox(cwd, "w2");
    await mailbox.ensureDirs();
    expect(await mailbox.tryReadOutbox(1)).toBeUndefined();
  });

  test("tryReadOutbox returns undefined on a half-written file, then the parsed value once valid", async () => {
    const cwd = await mkTmpRepo();
    const mailbox = new Mailbox(cwd, "w3");
    await mailbox.ensureDirs();
    const outboxFile = path.join(cwd, ".skynet", "w3", "outbox", "turn-1.json");

    await fs.writeFile(outboxFile, '{"status":"paus'); // mid-write
    expect(await mailbox.tryReadOutbox(1)).toBeUndefined();

    await fs.writeFile(outboxFile, '{"status":"paused","summary":"ok"}');
    expect(await mailbox.tryReadOutbox(1)).toEqual({ status: "paused", summary: "ok" });
  });

  test("ensureGitignored creates, appends, then no-ops for .skynet/", async () => {
    const cwd = await mkTmpRepo();
    const mailbox = new Mailbox(cwd, "w4");

    await mailbox.ensureGitignored(cwd);
    expect(await fs.readFile(path.join(cwd, ".gitignore"), "utf8")).toBe(".skynet/\n");

    await fs.writeFile(path.join(cwd, ".gitignore"), "node_modules/\n");
    await mailbox.ensureGitignored(cwd);
    expect(await fs.readFile(path.join(cwd, ".gitignore"), "utf8")).toBe("node_modules/\n.skynet/\n");

    await mailbox.ensureGitignored(cwd);
    expect(await fs.readFile(path.join(cwd, ".gitignore"), "utf8")).toBe("node_modules/\n.skynet/\n");
  });

  test("dispose removes the worker's mailbox dir", async () => {
    const cwd = await mkTmpRepo();
    const mailbox = new Mailbox(cwd, "w5");
    await mailbox.ensureDirs();
    await mailbox.dispose();
    await expect(fs.access(mailbox.dir)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test:unit src/adapters/interactive/mailbox.test.ts`
Expected: FAIL — `Cannot find module './mailbox'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/adapters/interactive/fs-helpers.ts`:

```ts
import * as fs from "node:fs/promises";

export async function readFileIfExists(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return "";
    }
    throw err;
  }
}
```

Create `src/adapters/interactive/mailbox.ts`:

```ts
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { readFileIfExists } from "./fs-helpers";

export class Mailbox {
  readonly relativeDir: string;
  readonly dir: string;

  constructor(cwd: string, workerId: string) {
    this.relativeDir = `.skynet/${workerId}`;
    this.dir = path.join(cwd, ".skynet", workerId);
  }

  async ensureDirs(): Promise<void> {
    await fs.mkdir(path.join(this.dir, "inbox"), { recursive: true });
    await fs.mkdir(path.join(this.dir, "outbox"), { recursive: true });
  }

  async ensureGitignored(cwd: string): Promise<void> {
    const gitignorePath = path.join(cwd, ".gitignore");
    const existing = await readFileIfExists(gitignorePath);
    if (existing.split("\n").some((line) => line.trim() === ".skynet/")) {
      return;
    }
    const withNewline = existing.length && !existing.endsWith("\n") ? `${existing}\n` : existing;
    await fs.writeFile(gitignorePath, `${withNewline}.skynet/\n`);
  }

  async writeProtocol(text: string): Promise<void> {
    await fs.writeFile(path.join(this.dir, "protocol.md"), text);
  }

  async writeInbox(turn: number, text: string): Promise<void> {
    await fs.writeFile(path.join(this.dir, "inbox", `turn-${turn}.md`), text);
  }

  async tryReadOutbox(turn: number): Promise<unknown> {
    const file = path.join(this.dir, "outbox", `turn-${turn}.json`);
    try {
      return JSON.parse(await fs.readFile(file, "utf8"));
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && !(err instanceof SyntaxError)) {
        throw err;
      }
      return undefined;
    }
  }

  async dispose(): Promise<void> {
    await fs.rm(this.dir, { recursive: true, force: true });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run test:unit src/adapters/interactive/mailbox.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/interactive/fs-helpers.ts src/adapters/interactive/mailbox.ts src/adapters/interactive/mailbox.test.ts
git commit -m "feat: interactive mailbox (inbox/outbox, protocol.md, gitignore)"
```

---

### Task 3: Fake transport test double + Doorbell

**Files:**
- Create: `src/adapters/interactive/test-helpers/fake-terminal-transport.ts`
- Create: `src/adapters/interactive/doorbell.ts`
- Test: `src/adapters/interactive/doorbell.test.ts`

**Interfaces:**
- Consumes: `TerminalTransport` from `./types` (Task 1).
- Produces:
  - `class FakeTerminalTransport implements TerminalTransport` with a public `calls: {method: "show"|"sendText"|"sendSequence"|"dispose"; args: unknown[]}[]` log, a mutable `pid`, and `simulateClose(exitCode?: number): void`.
  - `function ring(transport: TerminalTransport, pingLine: string, submitSequence: string): Promise<void>`

Note: the helper lives under `test-helpers/` (not `.test.ts`) so vitest does not run it as a suite; it is imported by other tests.

- [ ] **Step 1: Write the failing test**

Create `src/adapters/interactive/test-helpers/fake-terminal-transport.ts`:

```ts
import type { TerminalTransport } from "../types";

export interface RecordedCall {
  method: "show" | "sendText" | "sendSequence" | "dispose";
  args: unknown[];
}

export class FakeTerminalTransport implements TerminalTransport {
  readonly calls: RecordedCall[] = [];
  pid: number | undefined = 4242;
  private readonly closeListeners: Array<(exitCode: number | undefined) => void> = [];

  show(preserveFocus: boolean): void {
    this.calls.push({ method: "show", args: [preserveFocus] });
  }

  sendText(text: string, addNewLine: boolean): void {
    this.calls.push({ method: "sendText", args: [text, addNewLine] });
  }

  async sendSequence(sequence: string): Promise<void> {
    this.calls.push({ method: "sendSequence", args: [sequence] });
  }

  async processId(): Promise<number | undefined> {
    return this.pid;
  }

  onDidClose(listener: (exitCode: number | undefined) => void): { dispose(): void } {
    this.closeListeners.push(listener);
    return {
      dispose: () => {
        const index = this.closeListeners.indexOf(listener);
        if (index !== -1) {
          this.closeListeners.splice(index, 1);
        }
      },
    };
  }

  dispose(): void {
    this.calls.push({ method: "dispose", args: [] });
  }

  simulateClose(exitCode?: number): void {
    this.closeListeners.forEach((listener) => listener(exitCode));
  }
}
```

Create `src/adapters/interactive/doorbell.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { ring } from "./doorbell";
import { FakeTerminalTransport } from "./test-helpers/fake-terminal-transport";

describe("ring (doorbell)", () => {
  test("shows the terminal, sends the ping as plain text, then the submit sequence — in order", async () => {
    const transport = new FakeTerminalTransport();
    await ring(transport, "Read .skynet/w1/inbox/turn-1.md and follow it.", "\t");
    expect(transport.calls).toEqual([
      { method: "show", args: [false] },
      { method: "sendText", args: ["Read .skynet/w1/inbox/turn-1.md and follow it.", false] },
      { method: "sendSequence", args: ["\t"] },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test:unit src/adapters/interactive/doorbell.test.ts`
Expected: FAIL — `Cannot find module './doorbell'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/adapters/interactive/doorbell.ts`:

```ts
import type { TerminalTransport } from "./types";

export async function ring(
  transport: TerminalTransport,
  pingLine: string,
  submitSequence: string
): Promise<void> {
  transport.show(false);
  transport.sendText(pingLine, false);
  await transport.sendSequence(submitSequence);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run test:unit src/adapters/interactive/doorbell.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/interactive/test-helpers/fake-terminal-transport.ts src/adapters/interactive/doorbell.ts src/adapters/interactive/doorbell.test.ts
git commit -m "feat: interactive doorbell + fake terminal transport"
```

---

### Task 4: Crash detection (process-descendant walk)

**Files:**
- Create: `src/adapters/interactive/process-watch.ts`
- Test: `src/adapters/interactive/process-watch.test.ts`

**Interfaces:**
- Produces: `function hasLiveDescendant(pid: number, matchName: string): Promise<boolean>`

macOS/Linux only (`ps -Ao`) — matches the spec's v1 scope.

- [ ] **Step 1: Write the failing test**

Create `src/adapters/interactive/process-watch.test.ts`:

```ts
import { type ChildProcess, spawn } from "node:child_process";
import { describe, expect, test } from "vitest";
import { hasLiveDescendant } from "./process-watch";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("hasLiveDescendant", () => {
  test("finds a live descendant by command name, then stops once it exits", async () => {
    const child: ChildProcess = spawn("sleep", ["5"]);
    await wait(300);
    expect(await hasLiveDescendant(process.pid, "sleep")).toBe(true);

    child.kill();
    await wait(500);
    expect(await hasLiveDescendant(process.pid, "sleep")).toBe(false);
  }, 10_000);

  test("returns false for a pid with no matching descendants", async () => {
    expect(await hasLiveDescendant(process.pid, "definitely-not-a-real-process-name")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test:unit src/adapters/interactive/process-watch.test.ts`
Expected: FAIL — `Cannot find module './process-watch'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/adapters/interactive/process-watch.ts`:

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

interface ProcessRow {
  pid: number;
  ppid: number;
  comm: string;
}

// ponytail: macOS/Linux only (`ps -Ao`). Windows child-PID polling is out of
// scope for v1 — matches the interactive-codex spec.
export async function hasLiveDescendant(pid: number, matchName: string): Promise<boolean> {
  const { stdout } = await execFileAsync("ps", ["-Ao", "pid,ppid,comm"]);
  const rows = stdout.trim().split("\n").slice(1).map(parseRow).filter(isRow);

  const queue = [pid];
  const seen = new Set<number>();
  while (queue.length) {
    const current = queue.shift()!;
    if (seen.has(current)) {
      continue;
    }
    seen.add(current);
    for (const row of rows) {
      if (row.ppid !== current) {
        continue;
      }
      if (row.comm.includes(matchName)) {
        return true;
      }
      queue.push(row.pid);
    }
  }
  return false;
}

function parseRow(line: string): ProcessRow | undefined {
  const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
  if (!match) {
    return undefined;
  }
  return { pid: Number(match[1]), ppid: Number(match[2]), comm: match[3] };
}

function isRow(row: ProcessRow | undefined): row is ProcessRow {
  return row !== undefined;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run test:unit src/adapters/interactive/process-watch.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/interactive/process-watch.ts src/adapters/interactive/process-watch.test.ts
git commit -m "feat: interactive crash detection via process-descendant walk"
```

---

### Task 5: Codex rollout parser + profile

**Files:**
- Create: `src/adapters/codex/interactive-profile.ts`
- Test: `src/adapters/codex/interactive-profile.test.ts`

**Interfaces:**
- Consumes: `HarvestResult`, `InteractiveCliProfile`, `InteractiveOpts` from `../interactive/types` (Task 1); `WorkerUsage` from `../types`.
- Produces:
  - `function parseCodexRollout(text: string): HarvestResult`
  - `const codexInteractive: InteractiveCliProfile`

Fixture data below is **real**, captured from a `codex-cli 0.142.4` rollout file, trimmed of the long `base_instructions.text` field the parser never reads.

- [ ] **Step 1: Write the failing test**

Create `src/adapters/codex/interactive-profile.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { codexInteractive, parseCodexRollout } from "./interactive-profile";

const SESSION_META_LINE = JSON.stringify({
  timestamp: "2026-06-30T16:19:33.980Z",
  type: "session_meta",
  payload: {
    id: "019f1953-71c9-7c41-b8fb-c841283efe1e",
    timestamp: "2026-06-30T16:18:46.914Z",
    cwd: "/Users/binn/Projects/x",
    cli_version: "0.142.4",
  },
});

const TOKEN_COUNT_LINE = JSON.stringify({
  timestamp: "2026-06-30T16:19:37.748Z",
  type: "event_msg",
  payload: {
    type: "token_count",
    info: {
      total_token_usage: {
        input_tokens: 16660,
        cached_input_tokens: 9088,
        output_tokens: 69,
        reasoning_output_tokens: 53,
        total_tokens: 16729,
      },
      last_token_usage: { input_tokens: 16660, output_tokens: 69, total_tokens: 16729 },
      model_context_window: 258400,
    },
    rate_limits: {
      primary: { used_percent: 28.0, window_minutes: 300, resets_at: 1782842455 },
      secondary: { used_percent: 30.0, window_minutes: 10080, resets_at: 1783393060 },
      plan_type: "plus",
    },
  },
});

const LATER_TOKEN_COUNT_LINE = JSON.stringify({
  timestamp: "2026-06-30T16:25:00.000Z",
  type: "event_msg",
  payload: {
    type: "token_count",
    info: {
      total_token_usage: {
        input_tokens: 20000,
        cached_input_tokens: 9088,
        output_tokens: 120,
        reasoning_output_tokens: 60,
        total_tokens: 20180,
      },
      model_context_window: 258400,
    },
  },
});

describe("parseCodexRollout", () => {
  test("extracts sessionId, cumulative usage, and rate limits", () => {
    const result = parseCodexRollout([SESSION_META_LINE, TOKEN_COUNT_LINE].join("\n"));
    expect(result.sessionId).toBe("019f1953-71c9-7c41-b8fb-c841283efe1e");
    expect(result.usage).toEqual({
      inputTokens: 16660,
      outputTokens: 69,
      cachedInputTokens: 9088,
      reasoningTokens: 53,
    });
    expect(result.rateLimits).toBeTruthy();
  });

  test("keeps the latest cumulative usage across multiple token_count lines", () => {
    const result = parseCodexRollout([SESSION_META_LINE, TOKEN_COUNT_LINE, LATER_TOKEN_COUNT_LINE].join("\n"));
    expect(result.usage?.inputTokens).toBe(20000);
    expect(result.usage?.outputTokens).toBe(120);
  });

  test("ignores blank lines and non-JSON noise", () => {
    const result = parseCodexRollout(["", "  ", "not json", SESSION_META_LINE].join("\n"));
    expect(result.sessionId).toBe("019f1953-71c9-7c41-b8fb-c841283efe1e");
  });

  test("returns an empty result for text with no recognized lines", () => {
    expect(parseCodexRollout("")).toEqual({ sessionId: undefined, usage: undefined, rateLimits: undefined });
  });
});

describe("codexInteractive profile", () => {
  test("launchArgv includes the verified -a never + keymap overrides", () => {
    const argv = codexInteractive.launchArgv({ cwd: "/tmp/p", workerId: "w", model: "gpt-x" });
    expect(argv).toEqual([
      "-C", "/tmp/p", "-m", "gpt-x", "-s", "workspace-write", "-a", "never",
      "-c", "disable_paste_burst=true",
      "-c", 'tui.keymap.composer.submit="tab"',
      "-c", 'tui.keymap.composer.queue="ctrl-q"',
    ]);
  });

  test("configEnv sets CODEX_HOME only when a configDir is given", () => {
    expect(codexInteractive.configEnv("/home/x")).toEqual({ CODEX_HOME: "/home/x" });
    expect(codexInteractive.configEnv()).toEqual({});
  });

  test("sessionDir points at <configDir>/sessions, or ~/.codex/sessions by default", () => {
    expect(codexInteractive.sessionDir("/home/x")).toBe("/home/x/sessions");
    expect(codexInteractive.sessionDir()).toMatch(/\.codex\/sessions$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test:unit src/adapters/codex/interactive-profile.test.ts`
Expected: FAIL — `Cannot find module './interactive-profile'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/adapters/codex/interactive-profile.ts`:

```ts
import * as os from "node:os";
import * as path from "node:path";
import type { HarvestResult, InteractiveCliProfile, InteractiveOpts } from "../interactive/types";
import type { WorkerUsage } from "../types";

interface RolloutLine {
  type?: string;
  payload?: {
    id?: unknown;
    type?: string;
    info?: { total_token_usage?: Record<string, unknown> };
    rate_limits?: unknown;
  };
}

export function parseCodexRollout(text: string): HarvestResult {
  let sessionId: string | undefined;
  let usage: WorkerUsage | undefined;
  let rateLimits: unknown;

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    let entry: RolloutLine;
    try {
      entry = JSON.parse(trimmed);
    } catch {
      continue;
    }

    if (entry.type === "session_meta" && entry.payload?.id) {
      sessionId = String(entry.payload.id);
    } else if (entry.type === "event_msg" && entry.payload?.type === "token_count") {
      const total = entry.payload.info?.total_token_usage;
      if (total) {
        usage = {
          inputTokens: Number(total.input_tokens ?? 0),
          outputTokens: Number(total.output_tokens ?? 0),
          cachedInputTokens: total.cached_input_tokens !== undefined ? Number(total.cached_input_tokens) : undefined,
          reasoningTokens:
            total.reasoning_output_tokens !== undefined ? Number(total.reasoning_output_tokens) : undefined,
        };
      }
      if (entry.payload.rate_limits) {
        rateLimits = entry.payload.rate_limits;
      }
    }
  }

  return { sessionId, usage, rateLimits };
}

export const codexInteractive: InteractiveCliProfile = {
  id: "codex",
  launchArgv: (o: InteractiveOpts) => [
    "-C", o.cwd,
    ...(o.model ? ["-m", o.model] : []),
    "-s", o.sandbox ?? "workspace-write",
    "-a", "never",
    "-c", "disable_paste_burst=true",
    "-c", 'tui.keymap.composer.submit="tab"',
    "-c", 'tui.keymap.composer.queue="ctrl-q"',
  ],
  configEnv: (dir) => (dir ? { CODEX_HOME: dir } : {}),
  submitSequence: "\t",
  sessionDir: (dir) => (dir ? path.join(dir, "sessions") : path.join(os.homedir(), ".codex", "sessions")),
  harvest: (text) => parseCodexRollout(text),
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run test:unit src/adapters/codex/interactive-profile.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/codex/interactive-profile.ts src/adapters/codex/interactive-profile.test.ts
git commit -m "feat: codex rollout parser + interactive profile"
```

---

### Task 6: Session harvester (newest-rollout lookup)

**Files:**
- Create: `src/adapters/interactive/session-harvester.ts`
- Test: `src/adapters/interactive/session-harvester.test.ts`

**Interfaces:**
- Consumes: `InteractiveCliProfile`, `HarvestResult` from `./types` (Task 1).
- Produces: `function harvestSession(profile: InteractiveCliProfile, configDir: string | undefined): Promise<HarvestResult>`

Generic recursive newest-file finder (handles codex's `sessions/YYYY/MM/DD/rollout-*.jsonl` nesting without hardcoding depth), then delegates parsing to `profile.harvest(text)`.

- [ ] **Step 1: Write the failing test**

Create `src/adapters/interactive/session-harvester.test.ts`:

```ts
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, test } from "vitest";
import { harvestSession } from "./session-harvester";
import type { InteractiveCliProfile } from "./types";

async function mkTmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "session-harvester-test-"));
}

function fakeProfile(sessionDir: string, harvest: (text: string) => { sessionId?: string }): InteractiveCliProfile {
  return {
    id: "codex",
    launchArgv: () => [],
    configEnv: () => ({}),
    submitSequence: "\t",
    sessionDir: () => sessionDir,
    harvest,
  };
}

describe("harvestSession", () => {
  test("returns {} when the session dir does not exist", async () => {
    const result = await harvestSession(fakeProfile("/nonexistent/does/not/exist", () => ({})), undefined);
    expect(result).toEqual({});
  });

  test("finds the newest file across nested subdirs and hands its content to profile.harvest", async () => {
    const root = await mkTmpDir();
    const nestedDir = path.join(root, "2026", "06", "30");
    await fs.mkdir(nestedDir, { recursive: true });

    const older = path.join(nestedDir, "rollout-old.jsonl");
    const newer = path.join(nestedDir, "rollout-new.jsonl");
    await fs.writeFile(older, "old-content");
    await fs.writeFile(newer, "new-content");

    const oldTime = new Date(Date.now() - 60_000);
    const newTime = new Date();
    await fs.utimes(older, oldTime, oldTime);
    await fs.utimes(newer, newTime, newTime);

    const seenText: string[] = [];
    const result = await harvestSession(
      fakeProfile(root, (text) => {
        seenText.push(text);
        return { sessionId: "found-it" };
      }),
      undefined
    );

    expect(seenText).toEqual(["new-content"]);
    expect(result).toEqual({ sessionId: "found-it" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test:unit src/adapters/interactive/session-harvester.test.ts`
Expected: FAIL — `Cannot find module './session-harvester'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/adapters/interactive/session-harvester.ts`:

```ts
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { HarvestResult, InteractiveCliProfile } from "./types";

export async function harvestSession(
  profile: InteractiveCliProfile,
  configDir: string | undefined
): Promise<HarvestResult> {
  const newest = await newestFileRecursive(profile.sessionDir(configDir));
  if (!newest) {
    return {};
  }
  return profile.harvest(await fs.readFile(newest, "utf8"));
}

async function newestFileRecursive(dir: string): Promise<string | undefined> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return undefined;
  }

  let newest: { file: string; mtimeMs: number } | undefined;
  const consider = async (file: string) => {
    const stat = await fs.stat(file);
    if (!newest || stat.mtimeMs > newest.mtimeMs) {
      newest = { file, mtimeMs: stat.mtimeMs };
    }
  };

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const candidate = await newestFileRecursive(full);
      if (candidate) {
        await consider(candidate);
      }
    } else if (entry.isFile()) {
      await consider(full);
    }
  }
  return newest?.file;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run test:unit src/adapters/interactive/session-harvester.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/interactive/session-harvester.ts src/adapters/interactive/session-harvester.test.ts
git commit -m "feat: recursive newest-session-file harvester"
```

---

### Task 7: VscodeTerminalTransport (real terminal wrapper)

**Files:**
- Create: `src/adapters/interactive/vscode-terminal-transport.ts`
- Test: `src/test/interactive-vscode-terminal-transport.test.ts` (integration — real vscode)

**Interfaces:**
- Consumes: `TerminalTransport`, `TerminalFactory` from `../adapters/interactive/types` (Task 1).
- Produces: `class VscodeTerminalTransport implements TerminalTransport`, `class VscodeTerminalFactory implements TerminalFactory`

Thin wrapper over the real `vscode` API — the only interactive-core file that touches `vscode` directly. The test lives under `src/test/` so `@vscode/test-cli` runs it in a real extension host (vitest excludes `src/test/`).

- [ ] **Step 1: Write the failing test**

Create `src/test/interactive-vscode-terminal-transport.test.ts`:

```ts
import * as assert from "node:assert";
import { VscodeTerminalFactory } from "../adapters/interactive/vscode-terminal-transport";

suite("VscodeTerminalTransport", () => {
  test("creates a real terminal, resolves a process id, and disposes cleanly", async function () {
    this.timeout(10_000);
    const factory = new VscodeTerminalFactory();
    const transport = factory.create({ name: "interactive-transport-test", cwd: process.cwd(), env: {} });
    try {
      const pid = await transport.processId();
      assert.strictEqual(typeof pid, "number");
    } finally {
      transport.dispose();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test:integration`
Expected: FAIL — `Cannot find module '../adapters/interactive/vscode-terminal-transport'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/adapters/interactive/vscode-terminal-transport.ts`:

```ts
import * as vscode from "vscode";
import type { TerminalFactory, TerminalTransport } from "./types";

export class VscodeTerminalTransport implements TerminalTransport {
  private readonly closeListeners: Array<(exitCode: number | undefined) => void> = [];
  private readonly closeSub: vscode.Disposable;

  constructor(private readonly terminal: vscode.Terminal) {
    this.closeSub = vscode.window.onDidCloseTerminal((closed) => {
      if (closed === this.terminal) {
        this.closeListeners.forEach((listener) => listener(closed.exitStatus?.code));
      }
    });
  }

  show(preserveFocus: boolean): void {
    this.terminal.show(preserveFocus);
  }

  sendText(text: string, addNewLine: boolean): void {
    this.terminal.sendText(text, addNewLine);
  }

  async sendSequence(sequence: string): Promise<void> {
    await vscode.commands.executeCommand("workbench.action.terminal.sendSequence", { text: sequence });
  }

  async processId(): Promise<number | undefined> {
    return this.terminal.processId;
  }

  onDidClose(listener: (exitCode: number | undefined) => void): { dispose(): void } {
    this.closeListeners.push(listener);
    return {
      dispose: () => {
        const index = this.closeListeners.indexOf(listener);
        if (index !== -1) {
          this.closeListeners.splice(index, 1);
        }
      },
    };
  }

  dispose(): void {
    this.closeSub.dispose();
    this.terminal.dispose();
  }
}

export class VscodeTerminalFactory implements TerminalFactory {
  create(opts: { name: string; cwd: string; env: Record<string, string> }): TerminalTransport {
    const terminal = vscode.window.createTerminal({ name: opts.name, cwd: opts.cwd, env: opts.env });
    return new VscodeTerminalTransport(terminal);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run test:integration`
Expected: PASS — `VscodeTerminalTransport` suite green.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/interactive/vscode-terminal-transport.ts src/test/interactive-vscode-terminal-transport.test.ts
git commit -m "feat: real vscode.Terminal wrapper implementing TerminalTransport"
```

---

### Task 8: InteractiveSession state machine + startInteractive (readiness turn-0)

**Files:**
- Create: `src/adapters/interactive/interactive-session.ts`
- Test: `src/adapters/interactive/interactive-session.test.ts`

**Interfaces:**
- Consumes: `Mailbox` (Task 2), `ring` (Task 3), `harvestSession` (Task 6), `buildLaunchCommand` (Task 1), `classifyError` from `../classify` (Task 0.1), `VscodeTerminalFactory` (Task 7), `hasLiveDescendant` (Task 4), all types from `./types` (Task 1).
- Produces:
  - `interface StartInteractiveDeps { terminalFactory: TerminalFactory; checkAlive: (pid: number, matchName: string) => Promise<boolean>; crashPollMs: number; launchDelayMs: number; mailboxPollMs: number }`
  - `function startInteractive(profile: InteractiveCliProfile, opts: InteractiveOpts, deps?: Partial<StartInteractiveDeps>): Promise<InteractiveSession>`

The core orchestrator: writes `protocol.md`, launches the terminal, runs a **synthetic turn-0 readiness handshake** (re-ping once on `readyTimeoutMs`), then serves real turns (N ≥ 1) with **no readiness re-ping** — guarded only by `turnTimeoutMs`. Session-id/usage come from the harvest; the sparse `WorkerEvent` iterator is passive.

Notes:
- `readyTimeoutMs` re-ping is **turn-0 only** (idempotent: re-reading `protocol.md` + re-writing `ready` does no real work). This is the fix for the duplicate-execution hazard of reusing a real turn as the readiness probe.
- The codex profile has no `sessionInfoPrompt`, so no session-info fallback is built here (deferred to CLIs that need it).

- [ ] **Step 1: Write the failing test**

Create `src/adapters/interactive/interactive-session.test.ts`:

```ts
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, test } from "vitest";
import { startInteractive } from "./interactive-session";
import { FakeTerminalTransport } from "./test-helpers/fake-terminal-transport";
import type { InteractiveCliProfile } from "./types";

function fakeProfile(overrides: Partial<InteractiveCliProfile> = {}): InteractiveCliProfile {
  return {
    id: "codex",
    launchArgv: () => ["--fake"],
    configEnv: () => ({}),
    submitSequence: "\t",
    sessionDir: (dir) => dir ?? "/nonexistent",
    harvest: () => ({}),
    ...overrides,
  };
}

async function mkTmpRepo(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "interactive-session-test-"));
}

function writeOutbox(cwd: string, workerId: string, turn: number, data: unknown, delayMs: number): void {
  setTimeout(() => {
    void fs.writeFile(path.join(cwd, ".skynet", workerId, "outbox", `turn-${turn}.json`), JSON.stringify(data));
  }, delayMs);
}

const fastDeps = (transport: FakeTerminalTransport) => ({
  terminalFactory: { create: () => transport },
  launchDelayMs: 0,
  mailboxPollMs: 10,
});

describe("InteractiveSession", () => {
  test("readiness turn-0 completes, then paused + done turns surface usage/sessionId on the iterator", async () => {
    const cwd = await mkTmpRepo();
    const transport = new FakeTerminalTransport();
    const profile = fakeProfile({
      sessionDir: () => cwd, // pretend the CLI transcript lives in cwd for this fake
      harvest: () => ({ sessionId: "sess-1", usage: { inputTokens: 10, outputTokens: 5 } }),
    });

    const startPromise = startInteractive(
      profile,
      { cwd, workerId: "w1", readyTimeoutMs: 2_000, turnTimeoutMs: 2_000 },
      fastDeps(transport)
    );
    writeOutbox(cwd, "w1", 0, { status: "paused", summary: "ready" }, 30); // readiness
    const session = await startPromise;

    writeOutbox(cwd, "w1", 1, { status: "paused", summary: "step 1 complete" }, 30);
    const first = await session.send("turn 1");
    expect(first).toEqual({ status: "paused", summary: "step 1 complete" });

    writeOutbox(cwd, "w1", 2, { status: "done", summary: "all done", filesTouched: ["a.txt"] }, 30);
    const second = await session.send("turn 2");
    expect(second.status).toBe("done");
    expect((second as { filesTouched?: string[] }).filesTouched).toEqual(["a.txt"]);
    expect((second as { usage?: unknown }).usage).toEqual({ inputTokens: 10, outputTokens: 5 });

    expect(await session.sessionId).toBe("sess-1");

    const events: unknown[] = [];
    for await (const event of session) {
      events.push(event);
    }
    expect(events).toContainEqual({ kind: "started", sessionId: "sess-1" });
    expect(events).toContainEqual({ kind: "message", text: "step 1 complete" });
    expect(events).toContainEqual({ kind: "message", text: "all done" });

    await session.dispose();
  });

  test("send() rejects once the session has completed", async () => {
    const cwd = await mkTmpRepo();
    const transport = new FakeTerminalTransport();
    const startPromise = startInteractive(
      fakeProfile(),
      { cwd, workerId: "w2", readyTimeoutMs: 2_000, turnTimeoutMs: 2_000 },
      fastDeps(transport)
    );
    writeOutbox(cwd, "w2", 0, { status: "paused", summary: "ready" }, 30);
    const session = await startPromise;

    writeOutbox(cwd, "w2", 1, { status: "done", summary: "done" }, 30);
    await session.send("turn 1");
    await expect(session.send("turn 2")).rejects.toThrow(/already completed/);
  });

  test("a real turn slower than readyTimeoutMs is NOT re-pinged (no duplicate execution)", async () => {
    const cwd = await mkTmpRepo();
    const transport = new FakeTerminalTransport();
    const startPromise = startInteractive(
      fakeProfile(),
      { cwd, workerId: "w3", readyTimeoutMs: 100, turnTimeoutMs: 2_000 },
      fastDeps(transport)
    );
    writeOutbox(cwd, "w3", 0, { status: "paused", summary: "ready" }, 20);
    const session = await startPromise;

    const pingsBefore = transport.calls.filter((c) => c.method === "sendText").length;
    // outbox for turn 1 arrives at 300ms — well past readyTimeoutMs (100ms)
    writeOutbox(cwd, "w3", 1, { status: "done", summary: "slow but single" }, 300);
    const result = await session.send("slow turn");
    const pingsAfter = transport.calls.filter((c) => c.method === "sendText").length;

    expect(result.status).toBe("done");
    expect(pingsAfter - pingsBefore).toBe(1); // exactly one ping for the real turn
    await session.dispose();
  });

  test("readiness fails and disposes when turn-0 never arrives", async () => {
    const cwd = await mkTmpRepo();
    const transport = new FakeTerminalTransport();
    await expect(
      startInteractive(
        fakeProfile(),
        { cwd, workerId: "w4", readyTimeoutMs: 60, turnTimeoutMs: 500 },
        fastDeps(transport)
      )
    ).rejects.toThrow(/not ready/);
    // terminal was disposed on the failed readiness
    expect(transport.calls.some((c) => c.method === "dispose")).toBe(true);
  }, 10_000);

  test("timeout when a real turn never writes its outbox", async () => {
    const cwd = await mkTmpRepo();
    const transport = new FakeTerminalTransport();
    const startPromise = startInteractive(
      fakeProfile(),
      { cwd, workerId: "w5", readyTimeoutMs: 2_000, turnTimeoutMs: 120 },
      fastDeps(transport)
    );
    writeOutbox(cwd, "w5", 0, { status: "paused", summary: "ready" }, 20);
    const session = await startPromise;

    const result = await session.send("never answered");
    expect(result.status).toBe("timeout");
    await session.dispose();
  }, 10_000);

  test("crashed when the terminal reports no live codex descendant", async () => {
    const cwd = await mkTmpRepo();
    const transport = new FakeTerminalTransport();
    const startPromise = startInteractive(
      fakeProfile(),
      { cwd, workerId: "w6", readyTimeoutMs: 2_000, turnTimeoutMs: 2_000 },
      // crashPollMs 50 > the 20ms readiness outbox, so readiness resolves before
      // the first crash check; the real turn (no outbox) then trips checkAlive.
      { ...fastDeps(transport), checkAlive: async () => false, crashPollMs: 50 }
    );
    writeOutbox(cwd, "w6", 0, { status: "paused", summary: "ready" }, 20);
    const session = await startPromise;

    const result = await session.send("will crash"); // no outbox; checkAlive false → crashed
    expect(result.status).toBe("crashed");
    await session.dispose();
  }, 10_000);

  test("writes protocol.md and never touches the project's AGENTS.md", async () => {
    const cwd = await mkTmpRepo();
    const transport = new FakeTerminalTransport();
    const startPromise = startInteractive(
      fakeProfile(),
      { cwd, workerId: "w7", readyTimeoutMs: 2_000, turnTimeoutMs: 2_000 },
      fastDeps(transport)
    );
    writeOutbox(cwd, "w7", 0, { status: "paused", summary: "ready" }, 30);
    const session = await startPromise;

    // protocol lives in the mailbox dir; the project instruction file is untouched.
    const protocol = await fs.readFile(path.join(cwd, ".skynet", "w7", "protocol.md"), "utf8");
    expect(protocol).toContain("outbox/turn-N.json");
    await expect(fs.access(path.join(cwd, "AGENTS.md"))).rejects.toThrow();

    await session.dispose();
    // dispose removes the whole mailbox dir, protocol.md included.
    await expect(fs.access(path.join(cwd, ".skynet", "w7", "protocol.md"))).rejects.toThrow();
    await expect(fs.access(path.join(cwd, "AGENTS.md"))).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test:unit src/adapters/interactive/interactive-session.test.ts`
Expected: FAIL — `Cannot find module './interactive-session'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/adapters/interactive/interactive-session.ts`:

```ts
import { EventEmitter, once } from "node:events";
import { classifyError } from "../classify";
import type { WorkerEvent } from "../types";
import { ring } from "./doorbell";
import { Mailbox } from "./mailbox";
import { hasLiveDescendant } from "./process-watch";
import { harvestSession } from "./session-harvester";
import { buildLaunchCommand } from "./shell";
import type {
  HarvestResult,
  InteractiveCliProfile,
  InteractiveOpts,
  InteractiveSession,
  TerminalFactory,
  TerminalTransport,
  TurnResult,
} from "./types";
import { VscodeTerminalFactory } from "./vscode-terminal-transport";

const DEFAULT_TURN_TIMEOUT_MS = 300_000;
const DEFAULT_READY_TIMEOUT_MS = 30_000;
const DEFAULT_CRASH_POLL_MS = 3_000;
const DEFAULT_LAUNCH_DELAY_MS = 1_500;
const DEFAULT_MAILBOX_POLL_MS = 500;

export interface StartInteractiveDeps {
  terminalFactory: TerminalFactory;
  checkAlive: (pid: number, matchName: string) => Promise<boolean>;
  crashPollMs: number;
  launchDelayMs: number;
  mailboxPollMs: number;
}

function protocolText(rel: string): string {
  return [
    `For each ${rel}/inbox/turn-N.md I give you: do the work it asks, then write`,
    `${rel}/outbox/turn-N.json before you stop, matching the same N:`,
    `- Readiness (turn 0), after reading this file -> {"status":"paused","summary":"ready"}`,
    `- Pausing / need the next instruction -> {"status":"paused","summary":"<what you did>"}`,
    `- Whole task complete -> {"status":"done","summary":"...","filesTouched":["..."]}`,
    `- Unrecoverable error -> {"status":"error","reason":"..."}`,
    "",
    "Never delete inbox files. Write the outbox file in a single operation as the",
    "last action of a turn (write turn-N.json.tmp, then rename to turn-N.json).",
  ].join("\n");
}

function readinessInboxText(rel: string): string {
  return [
    `You are connected through the skynet mailbox at ${rel}.`,
    `Read ${rel}/protocol.md, then confirm you are ready by writing`,
    `${rel}/outbox/turn-0.json = {"status":"paused","summary":"ready"} — do nothing else this turn.`,
  ].join("\n");
}

export async function startInteractive(
  profile: InteractiveCliProfile,
  opts: InteractiveOpts,
  deps: Partial<StartInteractiveDeps> = {}
): Promise<InteractiveSession> {
  const resolved: StartInteractiveDeps = {
    terminalFactory: deps.terminalFactory ?? new VscodeTerminalFactory(),
    checkAlive: deps.checkAlive ?? hasLiveDescendant,
    crashPollMs: deps.crashPollMs ?? DEFAULT_CRASH_POLL_MS,
    launchDelayMs: deps.launchDelayMs ?? DEFAULT_LAUNCH_DELAY_MS,
    mailboxPollMs: deps.mailboxPollMs ?? DEFAULT_MAILBOX_POLL_MS,
  };

  const mailbox = new Mailbox(opts.cwd, opts.workerId);
  await mailbox.ensureDirs();
  await mailbox.ensureGitignored(opts.cwd);
  await mailbox.writeProtocol(protocolText(mailbox.relativeDir));

  const transport = resolved.terminalFactory.create({
    name: `${profile.id}-interactive-${opts.workerId}`,
    cwd: opts.cwd,
    env: profile.configEnv(opts.configDir),
  });
  transport.sendText(buildLaunchCommand(profile.id, profile.launchArgv(opts)), true);
  await delay(resolved.launchDelayMs);

  const session = new InteractiveSessionImpl(profile, opts, mailbox, transport, resolved);
  await session.ready();
  return session;
}

class InteractiveSessionImpl implements InteractiveSession {
  private turn = 0; // 0 is consumed by the readiness handshake; first send() → 1
  private closed = false;
  private closedByTerminal = false;
  private _sessionId: string | undefined;
  private readonly emitter = new EventEmitter();
  private readonly buffered: WorkerEvent[] = [];

  constructor(
    private readonly profile: InteractiveCliProfile,
    private readonly opts: InteractiveOpts,
    private readonly mailbox: Mailbox,
    private readonly transport: TerminalTransport,
    private readonly deps: StartInteractiveDeps
  ) {
    transport.onDidClose(() => {
      this.closedByTerminal = true;
    });
  }

  get sessionId(): Promise<string | undefined> {
    if (this._sessionId !== undefined) {
      return Promise.resolve(this._sessionId);
    }
    if (this.closed) {
      return Promise.resolve(undefined);
    }
    return once(this.emitter, "sessionId").then(([id]) => id as string | undefined);
  }

  // Synthetic turn-0 readiness. Idempotent, so a lost first ping is safely re-sent
  // once. Real-work turns are never re-sent (see send()).
  async ready(): Promise<void> {
    const readyTimeoutMs = this.opts.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
    await this.mailbox.writeInbox(0, readinessInboxText(this.mailbox.relativeDir));
    const ping = `Read ${this.mailbox.relativeDir}/protocol.md, then ${this.mailbox.relativeDir}/inbox/turn-0.md and follow it.`;

    await ring(this.transport, ping, this.profile.submitSequence);
    let raw = await this.waitForOutbox(0, readyTimeoutMs);
    if (raw === "timeout") {
      await ring(this.transport, ping, this.profile.submitSequence);
      raw = await this.waitForOutbox(0, readyTimeoutMs);
    }
    if (raw === "timeout" || raw === "crashed") {
      await this.dispose();
      throw new Error(`interactive session not ready: ${String(raw)}`);
    }
    await this.harvestInto(); // emit started/usage if available; do not finish
  }

  async send(prompt: string): Promise<TurnResult> {
    if (this.closed) {
      throw new Error("session already completed");
    }
    this.turn += 1;
    const turn = this.turn;

    const inbox = `${prompt}\n\n(write ${this.mailbox.relativeDir}/outbox/turn-${turn}.json per protocol)`;
    await this.mailbox.writeInbox(turn, inbox);
    const ping = `Read ${this.mailbox.relativeDir}/inbox/turn-${turn}.md and follow it.`;
    await ring(this.transport, ping, this.profile.submitSequence);

    const turnTimeoutMs = this.opts.turnTimeoutMs ?? DEFAULT_TURN_TIMEOUT_MS;
    const raw = await this.waitForOutbox(turn, turnTimeoutMs); // NO re-ping for real turns
    return this.afterTurn(this.toTurnResult(raw));
  }

  private async waitForOutbox(turn: number, timeoutMs: number): Promise<unknown> {
    const deadline = Date.now() + timeoutMs;
    let nextCrashCheck = Date.now() + this.deps.crashPollMs;

    while (Date.now() < deadline) {
      if (this.closedByTerminal) {
        return "crashed";
      }
      if (Date.now() >= nextCrashCheck) {
        const pid = await this.transport.processId();
        if (pid !== undefined && !(await this.deps.checkAlive(pid, this.profile.id))) {
          return "crashed";
        }
        nextCrashCheck = Date.now() + this.deps.crashPollMs;
      }
      const raw = await this.mailbox.tryReadOutbox(turn);
      if (raw !== undefined) {
        return raw;
      }
      await delay(Math.min(this.deps.mailboxPollMs, Math.max(0, deadline - Date.now())));
    }
    return "timeout";
  }

  private toTurnResult(raw: unknown): TurnResult {
    if (raw === "timeout") {
      return { status: "timeout" };
    }
    if (raw === "crashed") {
      return { status: "crashed" };
    }
    const data = raw as { status?: unknown; summary?: unknown; reason?: unknown; filesTouched?: unknown };
    if (data.status === "paused") {
      return { status: "paused", summary: String(data.summary ?? "") };
    }
    if (data.status === "done") {
      return {
        status: "done",
        summary: String(data.summary ?? ""),
        filesTouched: Array.isArray(data.filesTouched) ? data.filesTouched.map(String) : undefined,
      };
    }
    if (data.status === "error") {
      const reason = String(data.reason ?? "");
      return { status: "error", reason, errorClass: classifyError(reason) };
    }
    return { status: "error", reason: `outbox had unknown status: ${JSON.stringify(raw)}` };
  }

  private async harvestInto(): Promise<HarvestResult> {
    const harvested: HarvestResult = await harvestSession(this.profile, this.opts.configDir).catch(() => ({}));
    if (this._sessionId === undefined && harvested.sessionId) {
      this._sessionId = harvested.sessionId;
      this.emitter.emit("sessionId", harvested.sessionId);
      this.pushEvent({
        kind: "started",
        sessionId: harvested.sessionId,
        ...(this.opts.model ? { model: this.opts.model } : {}),
      });
    }
    if (harvested.usage) {
      this.pushEvent({ kind: "usage", ...harvested.usage });
    }
    return harvested;
  }

  private async afterTurn(base: TurnResult): Promise<TurnResult> {
    const harvested = await this.harvestInto();
    if (base.status === "paused" || base.status === "done") {
      this.pushEvent({ kind: "message", text: base.summary });
    }
    const result: TurnResult =
      base.status === "done" && harvested.usage ? { ...base, usage: harvested.usage } : base;
    if (result.status !== "paused") {
      this.finish();
    }
    return result;
  }

  private pushEvent(event: WorkerEvent): void {
    this.buffered.push(event);
    this.emitter.emit("event");
  }

  private finish(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.emitter.emit("event");
    if (this._sessionId === undefined) {
      this.emitter.emit("sessionId", undefined);
    }
  }

  async dispose(): Promise<void> {
    await this.mailbox.dispose();
    this.transport.dispose();
    this.finish();
  }

  async *[Symbol.asyncIterator](): AsyncIterator<WorkerEvent> {
    let index = 0;
    while (true) {
      while (index < this.buffered.length) {
        yield this.buffered[index];
        index += 1;
      }
      if (this.closed) {
        return;
      }
      await once(this.emitter, "event");
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run test:unit src/adapters/interactive/interactive-session.test.ts`
Expected: PASS — all six cases green.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/interactive/interactive-session.ts src/adapters/interactive/interactive-session.test.ts
git commit -m "feat: InteractiveSession state machine with turn-0 readiness"
```

---

### Task 9: Codex adapter wiring + real-CLI e2e

**Files:**
- Create: `src/adapters/codex/codex-adapter.ts`
- Modify: `src/adapters/types.ts` (add `AgentAdapter`)
- Test: `src/adapters/codex/codex-adapter.test.ts` (unit — wiring)
- Test: `src/test/interactive-codex.e2e.test.ts` (integration — real codex, env-gated)

**Interfaces:**
- Consumes: `startInteractive` (Task 8), `codexInteractive` (Task 5), `InteractiveOpts`/`InteractiveSession` (Task 1).
- Produces:
  - `interface AgentAdapter { readonly id: "codex"|"claude"|"agy"; runInteractive(opts: InteractiveOpts): Promise<InteractiveSession> }` (added to `src/adapters/types.ts`)
  - `const codexAdapter: AgentAdapter`

- [ ] **Step 1: Add `AgentAdapter` to shared types**

Edit `src/adapters/types.ts`: add the import **at the top of the file** (imports may not be appended):

```ts
import type { InteractiveOpts, InteractiveSession } from "./interactive/types";
```

Then add the interface **at the end of the file**:

```ts
export interface AgentAdapter {
  readonly id: "codex" | "claude" | "agy";
  runInteractive(opts: InteractiveOpts): Promise<InteractiveSession>;
}
```

This is a type-only circular import (`types.ts` ↔ `interactive/types.ts`); TypeScript erases it, so there is no runtime cycle.

- [ ] **Step 2: Write the failing unit test (wiring)**

Create `src/adapters/codex/codex-adapter.test.ts`:

```ts
import { describe, expect, test, vi } from "vitest";

const startInteractive = vi.fn(async () => ({ id: "fake-session" }));
vi.mock("../interactive/interactive-session", () => ({ startInteractive }));

import { codexInteractive } from "./interactive-profile";
import { codexAdapter } from "./codex-adapter";

describe("codexAdapter", () => {
  test("has id 'codex'", () => {
    expect(codexAdapter.id).toBe("codex");
  });

  test("runInteractive delegates to startInteractive with the codex profile and opts", async () => {
    const opts = { cwd: "/tmp/p", workerId: "w1" };
    await codexAdapter.runInteractive(opts);
    expect(startInteractive).toHaveBeenCalledWith(codexInteractive, opts);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm run test:unit src/adapters/codex/codex-adapter.test.ts`
Expected: FAIL — `Cannot find module './codex-adapter'`.

- [ ] **Step 4: Write minimal implementation**

Create `src/adapters/codex/codex-adapter.ts`:

```ts
import { startInteractive } from "../interactive/interactive-session";
import type { InteractiveOpts, InteractiveSession } from "../interactive/types";
import type { AgentAdapter } from "../types";
import { codexInteractive } from "./interactive-profile";

export const codexAdapter: AgentAdapter = {
  id: "codex",
  runInteractive(opts: InteractiveOpts): Promise<InteractiveSession> {
    return startInteractive(codexInteractive, opts);
  },
};
```

- [ ] **Step 5: Run unit test to verify it passes**

Run: `pnpm run test:unit src/adapters/codex/codex-adapter.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the opt-in real-CLI e2e (integration)**

Create `src/test/interactive-codex.e2e.test.ts`:

```ts
import * as assert from "node:assert";
import * as os from "node:os";
import { codexAdapter } from "../adapters/codex/codex-adapter";

const RUN = process.env.CODEX_INTERACTIVE_E2E === "1";

suite("codex interactive e2e (real CLI)", () => {
  (RUN ? test : test.skip)("drives readiness + two real turns against a real codex", async function () {
    this.timeout(300_000);
    const session = await codexAdapter.runInteractive({ cwd: os.tmpdir(), workerId: "e2e" });
    try {
      const first = await session.send(
        "Create a file called hello.txt containing the word hi, then pause."
      );
      assert.ok(first.status === "paused" || first.status === "done", `unexpected: ${first.status}`);

      const second = await session.send("Now stop — the whole task is complete.");
      assert.strictEqual(second.status, "done");

      const sessionId = await session.sessionId;
      assert.strictEqual(typeof sessionId, "string");
    } finally {
      await session.dispose();
    }
  });
});
```

- [ ] **Step 7: Run tests**

Run (default, e2e skipped): `pnpm test`
Expected: PASS — unit + integration green; the e2e case reports skipped.

Run (opt-in, needs codex installed + signed in): `CODEX_INTERACTIVE_E2E=1 pnpm run test:integration`
Expected: PASS — the real-CLI case drives two turns and harvests a session id.

- [ ] **Step 8: Commit**

```bash
git add src/adapters/types.ts src/adapters/codex/codex-adapter.ts src/adapters/codex/codex-adapter.test.ts src/test/interactive-codex.e2e.test.ts
git commit -m "feat: codex adapter runInteractive + opt-in real-CLI e2e"
```

---

## Final verification

- [ ] Run the full suite: `pnpm test` — all unit + integration green, e2e skipped.
- [ ] Run the linter: `pnpm run lint` — clean.
- [ ] Confirm `.skynet/` was appended to `.gitignore` during any local run and that no `.skynet/` artifacts are staged.
