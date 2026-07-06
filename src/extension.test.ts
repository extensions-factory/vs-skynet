import { describe, expect, it } from "vitest";
import * as vscode from "vscode";
import { activate } from "./extension";

describe("activate", () => {
	it("registers exactly one command", () => {
		const context = { subscriptions: [] } as unknown as Parameters<
			typeof activate
		>[0];

		activate(context);

		expect(vscode.commands.registerCommand).toHaveBeenCalledTimes(1);
	});

	it("mocks the terminal API surface imported by interactive adapters", () => {
		expect(vscode.window.createTerminal).toBeTypeOf("function");
		expect(vscode.window.onDidCloseTerminal).toBeTypeOf("function");
		expect(vscode.commands.executeCommand).toBeTypeOf("function");
	});
});
