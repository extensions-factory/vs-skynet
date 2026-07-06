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
		expect(
			buildLaunchCommand("codex", ["-C", "/tmp/proj", "-s", "workspace-write"]),
		).toBe("codex '-C' '/tmp/proj' '-s' 'workspace-write'");
	});
});
