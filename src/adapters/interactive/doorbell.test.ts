import { describe, expect, test } from "vitest";
import { ring } from "./doorbell";
import { FakeTerminalTransport } from "./test-helpers/fake-terminal-transport";

describe("ring (doorbell)", () => {
	test("shows the terminal, sends the ping as plain text, then the submit sequence -- in order", async () => {
		const transport = new FakeTerminalTransport();
		await ring(
			transport,
			"Read .skynet/w1/inbox/turn-1.md and follow it.",
			"\t",
		);
		expect(transport.calls).toEqual([
			{ method: "show", args: [false] },
			{
				method: "sendText",
				args: ["Read .skynet/w1/inbox/turn-1.md and follow it.", false],
			},
			{ method: "sendSequence", args: ["\t"] },
		]);
	});
});
