import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, test } from "vitest";
import { harvestSession } from "./session-harvester";
import type { InteractiveCliProfile } from "./types";

async function mkTmpDir(): Promise<string> {
	return fs.mkdtemp(path.join(os.tmpdir(), "session-harvester-test-"));
}

function fakeProfile(
	sessionDir: string,
	harvest: (text: string) => { sessionId?: string },
): InteractiveCliProfile {
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
		const result = await harvestSession(
			fakeProfile("/nonexistent/does/not/exist", () => ({})),
			undefined,
		);
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
			undefined,
		);

		expect(seenText).toEqual(["new-content"]);
		expect(result).toEqual({ sessionId: "found-it" });
	});

	test("ignores rollout files older than the session start time", async () => {
		const root = await mkTmpDir();
		const stale = path.join(root, "rollout-stale.jsonl");
		await fs.writeFile(stale, "stale-content");
		const staleTime = new Date(Date.now() - 60_000);
		await fs.utimes(stale, staleTime, staleTime);

		const seenText: string[] = [];
		const result = await harvestSession(
			fakeProfile(root, (text) => {
				seenText.push(text);
				return { sessionId: "stale-session" };
			}),
			undefined,
			Date.now() - 1_000,
		);

		expect(seenText).toEqual([]);
		expect(result).toEqual({});
	});
});
