import type { InteractiveSession } from "./types";

export interface NotifyWindow {
	showInformationMessage(
		message: string,
		...items: string[]
	): Thenable<string | undefined>;
}

const FOCUS_ACTION = "Focus terminal";

export async function notifyOnAwaitingInput(
	session: InteractiveSession,
	label: string,
	win: NotifyWindow,
	reveal: () => void,
): Promise<void> {
	let lastMessage = "";
	for await (const event of session) {
		if (event.kind === "message") {
			lastMessage = event.text;
		} else if (event.kind === "status" && event.status === "awaiting-input") {
			const choice = await win.showInformationMessage(
				`${label} is waiting on you: ${lastMessage}`,
				FOCUS_ACTION,
			);
			if (choice === FOCUS_ACTION) {
				reveal();
			}
		}
	}
}
