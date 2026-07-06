import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, test } from "vitest";
import { startInteractive } from "./interactive-session";
import { FakeTerminalTransport } from "./test-helpers/fake-terminal-transport";
import type { InteractiveCliProfile } from "./types";

function fakeProfile(
	overrides: Partial<InteractiveCliProfile> = {},
): InteractiveCliProfile {
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

function writeOutbox(
	cwd: string,
	workerId: string,
	turn: number,
	data: unknown,
	delayMs: number,
): void {
	setTimeout(() => {
		void fs.writeFile(
			path.join(cwd, ".skynet", workerId, "outbox", `turn-${turn}.json`),
			JSON.stringify(data),
		);
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
			sessionDir: () => cwd,
			harvest: () => ({
				sessionId: "sess-1",
				usage: { inputTokens: 10, outputTokens: 5 },
			}),
		});

		const startPromise = startInteractive(
			profile,
			{ cwd, workerId: "w1", readyTimeoutMs: 2_000, turnTimeoutMs: 2_000 },
			fastDeps(transport),
		);
		writeOutbox(cwd, "w1", 0, { status: "paused", summary: "ready" }, 30);
		const session = await startPromise;

		writeOutbox(
			cwd,
			"w1",
			1,
			{ status: "paused", summary: "step 1 complete" },
			30,
		);
		const first = await session.send("turn 1");
		expect(first).toEqual({ status: "paused", summary: "step 1 complete" });

		writeOutbox(
			cwd,
			"w1",
			2,
			{ status: "done", summary: "all done", filesTouched: ["a.txt"] },
			30,
		);
		const second = await session.send("turn 2");
		expect(second.status).toBe("done");
		expect((second as { filesTouched?: string[] }).filesTouched).toEqual([
			"a.txt",
		]);
		expect((second as { usage?: unknown }).usage).toEqual({
			inputTokens: 10,
			outputTokens: 5,
		});

		expect(await session.sessionId).toBe("sess-1");

		const events: unknown[] = [];
		for await (const event of session) {
			events.push(event);
		}
		expect(events).toContainEqual({ kind: "started", sessionId: "sess-1" });
		expect(events).toContainEqual({
			kind: "message",
			text: "step 1 complete",
		});
		expect(events).toContainEqual({ kind: "message", text: "all done" });

		await session.dispose();
	});

	test("send() rejects once the session has completed", async () => {
		const cwd = await mkTmpRepo();
		const transport = new FakeTerminalTransport();
		const startPromise = startInteractive(
			fakeProfile(),
			{ cwd, workerId: "w2", readyTimeoutMs: 2_000, turnTimeoutMs: 2_000 },
			fastDeps(transport),
		);
		writeOutbox(cwd, "w2", 0, { status: "paused", summary: "ready" }, 30);
		const session = await startPromise;

		writeOutbox(cwd, "w2", 1, { status: "done", summary: "done" }, 30);
		await session.send("turn 1");
		await expect(session.send("turn 2")).rejects.toThrow(/already completed/);
	});

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
			{
				...fastDeps(transport),
				checkAlive: async () => false,
				crashPollMs: 50,
			},
		);
		writeOutbox(cwd, "s2", 0, { status: "paused", summary: "ready" }, 20);
		const session = await startPromise;

		const result = await session.send("will crash");
		expect(result.status).toBe("crashed");
		expect(session.status).toBe("failed");
		await session.dispose();
	});

	test("a real turn slower than readyTimeoutMs is NOT re-pinged (no duplicate execution)", async () => {
		const cwd = await mkTmpRepo();
		const transport = new FakeTerminalTransport();
		const startPromise = startInteractive(
			fakeProfile(),
			{ cwd, workerId: "w3", readyTimeoutMs: 100, turnTimeoutMs: 2_000 },
			fastDeps(transport),
		);
		writeOutbox(cwd, "w3", 0, { status: "paused", summary: "ready" }, 20);
		const session = await startPromise;

		const pingsBefore = transport.calls.filter(
			(c) => c.method === "sendText",
		).length;
		writeOutbox(
			cwd,
			"w3",
			1,
			{ status: "done", summary: "slow but single" },
			300,
		);
		const result = await session.send("slow turn");
		const pingsAfter = transport.calls.filter(
			(c) => c.method === "sendText",
		).length;

		expect(result.status).toBe("done");
		expect(pingsAfter - pingsBefore).toBe(1);
		await session.dispose();
	});

	test("readiness fails and disposes when turn-0 never arrives", async () => {
		const cwd = await mkTmpRepo();
		const transport = new FakeTerminalTransport();
		await expect(
			startInteractive(
				fakeProfile(),
				{ cwd, workerId: "w4", readyTimeoutMs: 60, turnTimeoutMs: 500 },
				fastDeps(transport),
			),
		).rejects.toThrow(/not ready/);
		expect(transport.calls.some((c) => c.method === "dispose")).toBe(true);
	}, 10_000);

	test("readiness does not run crash detection before turn-0 resolves", async () => {
		const cwd = await mkTmpRepo();
		const transport = new FakeTerminalTransport();
		let checks = 0;
		const startPromise = startInteractive(
			fakeProfile(),
			{ cwd, workerId: "w4b", readyTimeoutMs: 500, turnTimeoutMs: 500 },
			{
				...fastDeps(transport),
				checkAlive: async () => {
					checks += 1;
					return false;
				},
				crashPollMs: 10,
			},
		);
		writeOutbox(cwd, "w4b", 0, { status: "paused", summary: "ready" }, 80);
		const session = await startPromise;

		expect(checks).toBe(0);
		await session.dispose();
	}, 10_000);

	test("timeout when a real turn never writes its outbox", async () => {
		const cwd = await mkTmpRepo();
		const transport = new FakeTerminalTransport();
		const startPromise = startInteractive(
			fakeProfile(),
			{ cwd, workerId: "w5", readyTimeoutMs: 2_000, turnTimeoutMs: 120 },
			fastDeps(transport),
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
			{
				...fastDeps(transport),
				checkAlive: async () => false,
				crashPollMs: 50,
			},
		);
		writeOutbox(cwd, "w6", 0, { status: "paused", summary: "ready" }, 20);
		const session = await startPromise;

		const result = await session.send("will crash");
		expect(result.status).toBe("crashed");
		await session.dispose();
	}, 10_000);

	test("writes protocol.md and never touches the project's AGENTS.md", async () => {
		const cwd = await mkTmpRepo();
		const transport = new FakeTerminalTransport();
		const startPromise = startInteractive(
			fakeProfile(),
			{ cwd, workerId: "w7", readyTimeoutMs: 2_000, turnTimeoutMs: 2_000 },
			fastDeps(transport),
		);
		writeOutbox(cwd, "w7", 0, { status: "paused", summary: "ready" }, 30);
		const session = await startPromise;

		const protocol = await fs.readFile(
			path.join(cwd, ".skynet", "w7", "protocol.md"),
			"utf8",
		);
		expect(protocol).toContain("outbox/turn-N.json");
		await expect(fs.access(path.join(cwd, "AGENTS.md"))).rejects.toThrow();

		await session.dispose();
		await expect(
			fs.access(path.join(cwd, ".skynet", "w7", "protocol.md")),
		).rejects.toThrow();
		await expect(fs.access(path.join(cwd, "AGENTS.md"))).rejects.toThrow();
	});
});
