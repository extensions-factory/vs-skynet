import * as vscode from "vscode";
import { sendTaskCommand } from "./adapters/interactive/task-handoff";
import type { InteractiveSession } from "./adapters/interactive/types";

let activeSession: InteractiveSession | undefined;

export function setActiveSession(
	session: InteractiveSession | undefined,
): void {
	activeSession = session;
}

export function activate(context: vscode.ExtensionContext) {
	const getActiveSession = () => activeSession;

	context.subscriptions.push(
		vscode.commands.registerCommand("skynet.sendTask", () =>
			sendTaskCommand(getActiveSession, vscode.window),
		),
	);
}

export function deactivate() {}
