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
		expect(
			await hasLiveDescendant(process.pid, "definitely-not-a-real-process-name"),
		).toBe(false);
	});
});
