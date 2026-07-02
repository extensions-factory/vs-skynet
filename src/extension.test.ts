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
});
