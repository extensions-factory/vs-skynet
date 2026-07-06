import type { InteractiveOpts, InteractiveSession } from "./interactive/types";

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

export interface AgentAdapter {
	readonly id: "codex" | "claude" | "agy";
	runInteractive(opts: InteractiveOpts): Promise<InteractiveSession>;
}
