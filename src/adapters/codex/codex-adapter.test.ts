import { describe, expect, test, vi } from "vitest";

const { startInteractive } = vi.hoisted(() => ({
	startInteractive: vi.fn(async () => ({ id: "fake-session" })),
}));

vi.mock("../interactive/interactive-session", () => ({ startInteractive }));

import { codexAdapter } from "./codex-adapter";
import { codexInteractive } from "./interactive-profile";

describe("codexAdapter", () => {
	test("has id 'codex'", () => {
		expect(codexAdapter.id).toBe("codex");
	});

	test("runInteractive delegates to startInteractive with the codex profile and resolved opts", async () => {
		const opts = { cwd: "/tmp/p", workerId: "w1", configDir: "/home/acct" };
		await codexAdapter.runInteractive(opts);
		expect(startInteractive).toHaveBeenCalledWith(codexInteractive, opts);
	});

	test("resolves configDir from CODEX_HOME when opts.configDir is absent", async () => {
		const prev = process.env.CODEX_HOME;
		process.env.CODEX_HOME = "/home/env-acct";
		try {
			await codexAdapter.runInteractive({ cwd: "/tmp/p", workerId: "w2" });
			expect(startInteractive).toHaveBeenCalledWith(codexInteractive, {
				cwd: "/tmp/p",
				workerId: "w2",
				configDir: "/home/env-acct",
			});
		} finally {
			if (prev === undefined) {
				delete process.env.CODEX_HOME;
			} else {
				process.env.CODEX_HOME = prev;
			}
		}
	});

	test("throws when neither opts.configDir nor CODEX_HOME is set (mandatory account isolation)", async () => {
		const prev = process.env.CODEX_HOME;
		delete process.env.CODEX_HOME;
		try {
			await expect(
				codexAdapter.runInteractive({ cwd: "/tmp/p", workerId: "w3" }),
			).rejects.toThrow(/CODEX_HOME/);
		} finally {
			if (prev !== undefined) {
				process.env.CODEX_HOME = prev;
			}
		}
	});
});
