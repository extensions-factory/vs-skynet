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
