import type { SessionStatus } from "../types";
import type { InteractiveSession } from "./types";

export interface HandoffWindow {
	showInputBox(options?: {
		prompt?: string;
		placeHolder?: string;
	}): Thenable<string | undefined>;
	showInformationMessage(message: string): Thenable<string | undefined>;
	showErrorMessage(message: string): Thenable<string | undefined>;
}

const SENDABLE: ReadonlySet<SessionStatus> = new Set<SessionStatus>([
	"ready",
	"awaiting-input",
]);
const TERMINAL: ReadonlySet<SessionStatus> = new Set<SessionStatus>([
	"done",
	"failed",
	"stopped",
]);

export async function sendTaskCommand(
	getSession: () => InteractiveSession | undefined,
	win: HandoffWindow,
): Promise<void> {
	const session = getSession();
	if (!session || TERMINAL.has(session.status)) {
		await win.showInformationMessage("No running agent. Start one first.");
		return;
	}
	if (!SENDABLE.has(session.status)) {
		await win.showInformationMessage(
			"Agent isn't available right now — try again in a moment.",
		);
		return;
	}

	const prompt = await win.showInputBox({ prompt: "Task for the agent" });
	if (!prompt) {
		return;
	}

	try {
		const result = await session.send(prompt);
		switch (result.status) {
			case "done":
				await win.showInformationMessage(`Agent finished: ${result.summary}`);
				break;
			case "paused":
				await win.showInformationMessage(`Agent paused: ${result.summary}`);
				break;
			case "error":
				await win.showErrorMessage(`Agent error: ${result.reason}`);
				break;
			case "timeout":
				await win.showErrorMessage("Agent turn timed out.");
				break;
			case "crashed":
				await win.showErrorMessage("Agent crashed.");
				break;
		}
	} catch (err) {
		const detail = err instanceof Error ? err.message : String(err);
		await win.showErrorMessage(`Failed to send task: ${detail}`);
	}
}

export async function stopAgentCommand(
	getSession: () => InteractiveSession | undefined,
	win: HandoffWindow,
): Promise<void> {
	const session = getSession();
	if (!session || TERMINAL.has(session.status)) {
		await win.showInformationMessage("No running agent to stop.");
		return;
	}
	await session.dispose();
	await win.showInformationMessage("Agent stopped.");
}
