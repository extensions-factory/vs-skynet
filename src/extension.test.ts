import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { activate } from "./extension";

describe("activate", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("registers the send-task command", () => {
		const context = { subscriptions: [] } as unknown as Parameters<
			typeof activate
		>[0];

		activate(context);

		expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
			"skynet.sendTask",
			expect.any(Function),
		);
	});

	it("registers the stop-agent command", () => {
		const context = { subscriptions: [] } as unknown as Parameters<
			typeof activate
		>[0];

		activate(context);

		expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
			"skynet.stopAgent",
			expect.any(Function),
		);
	});

	it("registers exactly the two Skynet commands (no scaffold left)", () => {
		const context = { subscriptions: [] } as unknown as Parameters<
			typeof activate
		>[0];

		activate(context);

		expect(vscode.commands.registerCommand).toHaveBeenCalledTimes(2);
	});

	it("mocks the terminal API surface imported by interactive adapters", () => {
		expect(vscode.window.createTerminal).toBeTypeOf("function");
		expect(vscode.window.onDidCloseTerminal).toBeTypeOf("function");
		expect(vscode.commands.executeCommand).toBeTypeOf("function");
	});
});
