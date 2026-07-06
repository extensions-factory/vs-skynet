import { EventEmitter, once } from "node:events";
import { classifyError } from "../classify";
import type { WorkerEvent } from "../types";
import {
	DEFAULT_CRASH_POLL_MS,
	DEFAULT_LAUNCH_DELAY_MS,
	DEFAULT_MAILBOX_POLL_MS,
	DEFAULT_READY_TIMEOUT_MS,
	DEFAULT_TURN_TIMEOUT_MS,
	protocolText,
	readinessInboxText,
	readinessPing,
	turnInbox,
	turnPing,
} from "./config";
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

export interface StartInteractiveDeps {
	terminalFactory: TerminalFactory;
	checkAlive: (pid: number, matchName: string) => Promise<boolean>;
	crashPollMs: number;
	launchDelayMs: number;
	mailboxPollMs: number;
}

export async function startInteractive(
	profile: InteractiveCliProfile,
	opts: InteractiveOpts,
	deps: Partial<StartInteractiveDeps> = {},
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
	const startedAtMs = Date.now();

	const transport = resolved.terminalFactory.create({
		name: `${profile.id}-interactive-${opts.workerId}`,
		cwd: opts.cwd,
		env: profile.configEnv(opts.configDir),
	});
	transport.sendText(
		buildLaunchCommand(profile.id, profile.launchArgv(opts)),
		true,
	);
	await delay(resolved.launchDelayMs);

	const session = new InteractiveSessionImpl(
		profile,
		opts,
		mailbox,
		transport,
		resolved,
		startedAtMs,
	);
	await session.ready();
	return session;
}

class InteractiveSessionImpl implements InteractiveSession {
	private turn = 0;
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
		private readonly deps: StartInteractiveDeps,
		private readonly startedAtMs: number,
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
		return once(this.emitter, "sessionId").then(
			([id]) => id as string | undefined,
		);
	}

	async ready(): Promise<void> {
		const readyTimeoutMs = this.opts.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
		await this.mailbox.writeInbox(
			0,
			readinessInboxText(this.mailbox.relativeDir),
		);
		const ping = readinessPing(this.mailbox.relativeDir);

		await ring(this.transport, ping, this.profile.submitSequence);
		let raw = await this.waitForOutbox(0, readyTimeoutMs, false);
		if (raw === "timeout") {
			await ring(this.transport, ping, this.profile.submitSequence);
			raw = await this.waitForOutbox(0, readyTimeoutMs, false);
		}
		if (raw === "timeout" || raw === "crashed") {
			await this.dispose();
			throw new Error(`interactive session not ready: ${String(raw)}`);
		}
		await this.harvestInto();
	}

	async send(prompt: string): Promise<TurnResult> {
		if (this.closed) {
			throw new Error("session already completed");
		}
		this.turn += 1;
		const turn = this.turn;

		await this.mailbox.writeInbox(
			turn,
			turnInbox(prompt, this.mailbox.relativeDir, turn),
		);
		await ring(
			this.transport,
			turnPing(this.mailbox.relativeDir, turn),
			this.profile.submitSequence,
		);

		const turnTimeoutMs = this.opts.turnTimeoutMs ?? DEFAULT_TURN_TIMEOUT_MS;
		const raw = await this.waitForOutbox(turn, turnTimeoutMs);
		return this.afterTurn(this.toTurnResult(raw));
	}

	private async waitForOutbox(
		turn: number,
		timeoutMs: number,
		checkCrash = true,
	): Promise<unknown> {
		const deadline = Date.now() + timeoutMs;
		let nextCrashCheck = Date.now() + this.deps.crashPollMs;

		while (Date.now() < deadline) {
			if (this.closedByTerminal) {
				return "crashed";
			}
			if (checkCrash && Date.now() >= nextCrashCheck) {
				const pid = await this.transport.processId();
				if (
					pid !== undefined &&
					!(await this.deps.checkAlive(pid, this.profile.id))
				) {
					return "crashed";
				}
				nextCrashCheck = Date.now() + this.deps.crashPollMs;
			}
			const raw = await this.mailbox.tryReadOutbox(turn);
			if (raw !== undefined) {
				return raw;
			}
			await delay(
				Math.min(this.deps.mailboxPollMs, Math.max(0, deadline - Date.now())),
			);
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
		const data = raw as {
			status?: unknown;
			summary?: unknown;
			reason?: unknown;
			filesTouched?: unknown;
		};
		if (data.status === "paused") {
			return { status: "paused", summary: String(data.summary ?? "") };
		}
		if (data.status === "done") {
			return {
				status: "done",
				summary: String(data.summary ?? ""),
				filesTouched: Array.isArray(data.filesTouched)
					? data.filesTouched.map(String)
					: undefined,
			};
		}
		if (data.status === "error") {
			const reason = String(data.reason ?? "");
			return { status: "error", reason, errorClass: classifyError(reason) };
		}
		return {
			status: "error",
			reason: `outbox had unknown status: ${JSON.stringify(raw)}`,
		};
	}

	private async harvestInto(): Promise<HarvestResult> {
		const harvested: HarvestResult = await harvestSession(
			this.profile,
			this.opts.configDir,
			this.startedAtMs,
		).catch(() => ({}));
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
			base.status === "done" && harvested.usage
				? { ...base, usage: harvested.usage }
				: base;
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
