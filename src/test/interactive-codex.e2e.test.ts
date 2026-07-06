import * as assert from "node:assert";
import * as os from "node:os";
import { codexAdapter } from "../adapters/codex/codex-adapter";

const RUN = process.env.CODEX_INTERACTIVE_E2E === "1";

suite("codex interactive e2e (real CLI)", () => {
	(RUN ? test : test.skip)(
		"drives readiness + two real turns against a real codex",
		async function () {
			this.timeout(300_000);
			const session = await codexAdapter.runInteractive({
				cwd: os.tmpdir(),
				workerId: "e2e",
				configDir: process.env.CODEX_HOME,
			});
			try {
				const first = await session.send(
					"Create a file called hello.txt containing the word hi, then pause.",
				);
				assert.ok(
					first.status === "paused" || first.status === "done",
					`unexpected: ${first.status}`,
				);

				const second = await session.send(
					"Now stop -- the whole task is complete.",
				);
				assert.strictEqual(second.status, "done");

				const sessionId = await session.sessionId;
				assert.strictEqual(typeof sessionId, "string");
			} finally {
				await session.dispose();
			}
		},
	);
});
