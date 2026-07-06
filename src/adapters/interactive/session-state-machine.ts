import type { SessionStatus } from "../types";

export type SessionEvent =
	| "readyOutbox"
	| "startupFailed"
	| "send"
	| "turnPaused"
	| "turnDone"
	| "turnFailed"
	| "terminalClosed"
	| "dispose";

const TERMINAL: ReadonlySet<SessionStatus> = new Set<SessionStatus>([
	"done",
	"failed",
	"stopped",
]);

const TABLE: Record<
	SessionStatus,
	Partial<Record<SessionEvent, SessionStatus>>
> = {
	launching: {
		readyOutbox: "ready",
		startupFailed: "failed",
		dispose: "stopped",
		terminalClosed: "failed",
	},
	ready: {
		send: "busy",
		dispose: "stopped",
		terminalClosed: "failed",
	},
	busy: {
		turnPaused: "awaiting-input",
		turnDone: "done",
		turnFailed: "failed",
		dispose: "stopped",
		terminalClosed: "failed",
	},
	"awaiting-input": {
		send: "busy",
		dispose: "stopped",
		terminalClosed: "failed",
	},
	done: {},
	failed: {},
	stopped: {},
};

export class AgentSessionStateMachine {
	private current: SessionStatus = "launching";

	constructor(
		private readonly onChange?: (
			from: SessionStatus,
			to: SessionStatus,
		) => void,
	) {}

	get state(): SessionStatus {
		return this.current;
	}

	get isTerminal(): boolean {
		return TERMINAL.has(this.current);
	}

	transition(event: SessionEvent): void {
		if (this.isTerminal) {
			return;
		}
		const next = TABLE[this.current][event];
		if (next === undefined) {
			throw new Error(`illegal transition: ${this.current} -/${event}`);
		}
		const prev = this.current;
		this.current = next;
		this.onChange?.(prev, next);
	}
}
