import { describe, expect, test, vi } from "vitest";
import type { WorkerEvent } from "../types";
import { notifyOnAwaitingInput } from "./notify-awaiting-input";
import type { InteractiveSession } from "./types";

function fakeSession(events: WorkerEvent[]): InteractiveSession {
	return {
		status: "ready",
		sessionId: Promise.resolve(undefined),
		send: async () => ({ status: "timeout" }),
		dispose: async () => {},
		async *[Symbol.asyncIterator]() {
			for (const event of events) {
				yield event;
			}
		},
	};
}

describe("notifyOnAwaitingInput", () => {
	test("shows a message with the buffered summary and reveals on the action", async () => {
		const session = fakeSession([
			{ kind: "message", text: "need your call" },
			{ kind: "status", status: "awaiting-input" },
		]);
		const showInformationMessage = vi.fn().mockResolvedValue("Focus terminal");
		const reveal = vi.fn();

		await notifyOnAwaitingInput(
			session,
			"worker-1",
			{ showInformationMessage },
			reveal,
		);

		expect(showInformationMessage).toHaveBeenCalledWith(
			"worker-1 is waiting on you: need your call",
			"Focus terminal",
		);
		expect(reveal).toHaveBeenCalledTimes(1);
	});

	test("does not reveal when the user dismisses the message", async () => {
		const session = fakeSession([{ kind: "status", status: "awaiting-input" }]);
		const showInformationMessage = vi.fn().mockResolvedValue(undefined);
		const reveal = vi.fn();

		await notifyOnAwaitingInput(
			session,
			"w",
			{ showInformationMessage },
			reveal,
		);

		expect(showInformationMessage).toHaveBeenCalledTimes(1);
		expect(reveal).not.toHaveBeenCalled();
	});
});
