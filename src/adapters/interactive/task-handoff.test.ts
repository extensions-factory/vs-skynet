import { describe, expect, test, vi } from "vitest";
import type { SessionStatus } from "../types";
import { sendTaskCommand, stopAgentCommand } from "./task-handoff";
import type { InteractiveSession, TurnResult } from "./types";

function fakeSession(
	status: SessionStatus,
	sendResult: TurnResult = { status: "done", summary: "ok" },
	send = vi.fn(async () => sendResult),
): { session: InteractiveSession; send: typeof send } {
	const session: InteractiveSession = {
		status,
		sessionId: Promise.resolve(undefined),
		send,
		dispose: vi.fn(async () => {}),
		async *[Symbol.asyncIterator]() {},
	};
	return { session, send };
}

function fakeWindow(...args: [(string | undefined)?]) {
	const inputValue = args.length === 0 ? "do the thing" : args[0];

	return {
		showInputBox: vi.fn(async () => inputValue),
		showInformationMessage: vi.fn(async () => undefined),
		showErrorMessage: vi.fn(async () => undefined),
	};
}

describe("sendTaskCommand", () => {
	test("sends the entered prompt and shows the done summary", async () => {
		const { session, send } = fakeSession("ready", {
			status: "done",
			summary: "shipped it",
		});
		const win = fakeWindow("build the widget");

		await sendTaskCommand(() => session, win);

		expect(send).toHaveBeenCalledWith("build the widget");
		expect(win.showInformationMessage).toHaveBeenCalledWith(
			"Agent finished: shipped it",
		);
	});

	test("sends when awaiting-input", async () => {
		const { session, send } = fakeSession("awaiting-input");
		await sendTaskCommand(() => session, fakeWindow("next"));
		expect(send).toHaveBeenCalledWith("next");
	});

	test("refuses when busy, without sending", async () => {
		const { session, send } = fakeSession("busy");
		const win = fakeWindow();
		await sendTaskCommand(() => session, win);
		expect(send).not.toHaveBeenCalled();
		expect(win.showInputBox).not.toHaveBeenCalled();
		expect(win.showInformationMessage).toHaveBeenCalledWith(
			"Agent isn't available right now — try again in a moment.",
		);
	});

	test("refuses when launching, without sending", async () => {
		const { session, send } = fakeSession("launching");
		const win = fakeWindow();
		await sendTaskCommand(() => session, win);
		expect(send).not.toHaveBeenCalled();
		expect(win.showInputBox).not.toHaveBeenCalled();
		expect(win.showInformationMessage).toHaveBeenCalledWith(
			"Agent isn't available right now — try again in a moment.",
		);
	});

	test("reports no running agent when there is no session", async () => {
		const win = fakeWindow();
		await sendTaskCommand(() => undefined, win);
		expect(win.showInputBox).not.toHaveBeenCalled();
		expect(win.showInformationMessage).toHaveBeenCalledWith(
			"No running agent. Start one first.",
		);
	});

	test.each([
		"stopped",
		"failed",
		"done",
	] as const)("reports no running agent when the session is %s", async (status) => {
		const { session, send } = fakeSession(status);
		const win = fakeWindow();
		await sendTaskCommand(() => session, win);
		expect(send).not.toHaveBeenCalled();
		expect(win.showInformationMessage).toHaveBeenCalledWith(
			"No running agent. Start one first.",
		);
	});

	test("does not send when the input box is dismissed", async () => {
		const { session, send } = fakeSession("ready");
		const win = fakeWindow(undefined);
		await sendTaskCommand(() => session, win);
		expect(send).not.toHaveBeenCalled();
	});

	test("does not send when the input is empty", async () => {
		const { session, send } = fakeSession("ready");
		const win = fakeWindow("");
		await sendTaskCommand(() => session, win);
		expect(send).not.toHaveBeenCalled();
	});

	test("surfaces an error TurnResult via showErrorMessage", async () => {
		const { session } = fakeSession("ready", {
			status: "error",
			reason: "boom",
		});
		const win = fakeWindow("go");
		await sendTaskCommand(() => session, win);
		expect(win.showErrorMessage).toHaveBeenCalledWith("Agent error: boom");
	});

	test("catches a thrown send and shows an error, no rejection", async () => {
		const send = vi.fn(async () => {
			throw new Error("illegal transition: busy -/send");
		});
		const { session } = fakeSession("ready", undefined, send);
		const win = fakeWindow("go");
		await expect(sendTaskCommand(() => session, win)).resolves.toBeUndefined();
		expect(win.showErrorMessage).toHaveBeenCalledWith(
			"Failed to send task: illegal transition: busy -/send",
		);
	});
});

describe("stopAgentCommand", () => {
	test("disposes a non-terminal session and confirms", async () => {
		const { session } = fakeSession("busy");
		const win = fakeWindow();
		await stopAgentCommand(() => session, win);
		expect(session.dispose).toHaveBeenCalledTimes(1);
		expect(win.showInformationMessage).toHaveBeenCalledWith("Agent stopped.");
	});

	test.each([
		"ready",
		"awaiting-input",
		"launching",
	] as const)("disposes a %s session", async (status) => {
		const { session } = fakeSession(status);
		await stopAgentCommand(() => session, fakeWindow());
		expect(session.dispose).toHaveBeenCalledTimes(1);
	});

	test("reports nothing to stop when there is no session", async () => {
		const win = fakeWindow();
		await stopAgentCommand(() => undefined, win);
		expect(win.showInformationMessage).toHaveBeenCalledWith(
			"No running agent to stop.",
		);
	});

	test("does not dispose an already-terminal session", async () => {
		const { session } = fakeSession("stopped");
		const win = fakeWindow();
		await stopAgentCommand(() => session, win);
		expect(session.dispose).not.toHaveBeenCalled();
		expect(win.showInformationMessage).toHaveBeenCalledWith(
			"No running agent to stop.",
		);
	});

	test("catches a thrown dispose and shows an error, no rejection", async () => {
		const { session } = fakeSession("busy");
		session.dispose = vi.fn(async () => {
			throw new Error("rm failed");
		});
		const win = fakeWindow();

		await expect(stopAgentCommand(() => session, win)).resolves.toBeUndefined();

		expect(win.showErrorMessage).toHaveBeenCalledWith(
			"Failed to stop agent: rm failed",
		);
	});
});
