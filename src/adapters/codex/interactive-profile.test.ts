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
		const result = parseCodexRollout(
			[SESSION_META_LINE, TOKEN_COUNT_LINE, LATER_TOKEN_COUNT_LINE].join("\n"),
		);
		expect(result.usage?.inputTokens).toBe(20000);
		expect(result.usage?.outputTokens).toBe(120);
	});

	test("ignores blank lines and non-JSON noise", () => {
		const result = parseCodexRollout(["", "  ", "not json", SESSION_META_LINE].join("\n"));
		expect(result.sessionId).toBe("019f1953-71c9-7c41-b8fb-c841283efe1e");
	});

	test("returns an empty result for text with no recognized lines", () => {
		expect(parseCodexRollout("")).toEqual({
			sessionId: undefined,
			usage: undefined,
			rateLimits: undefined,
		});
	});
});

describe("codexInteractive profile", () => {
	test("launchArgv includes the verified -a never + keymap overrides", () => {
		const argv = codexInteractive.launchArgv({
			cwd: "/tmp/p",
			workerId: "w",
			model: "gpt-x",
		});
		expect(argv).toEqual([
			"-C",
			"/tmp/p",
			"-m",
			"gpt-x",
			"-s",
			"workspace-write",
			"-a",
			"never",
			"-c",
			"disable_paste_burst=true",
			"-c",
			'tui.keymap.composer.submit="tab"',
			"-c",
			'tui.keymap.composer.queue="ctrl-q"',
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
