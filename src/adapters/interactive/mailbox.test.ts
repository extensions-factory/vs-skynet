import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, test } from "vitest";
import { Mailbox } from "./mailbox";

async function mkTmpRepo(): Promise<string> {
	return fs.mkdtemp(path.join(os.tmpdir(), "mailbox-test-"));
}

describe("Mailbox", () => {
	test("writeInbox writes the exact turn file under inbox/", async () => {
		const cwd = await mkTmpRepo();
		const mailbox = new Mailbox(cwd, "w1");
		await mailbox.ensureDirs();
		await mailbox.writeInbox(1, "do the thing");
		const written = await fs.readFile(
			path.join(cwd, ".skynet", "w1", "inbox", "turn-1.md"),
			"utf8",
		);
		expect(written).toBe("do the thing");
	});

	test("writeProtocol writes protocol.md at the mailbox root", async () => {
		const cwd = await mkTmpRepo();
		const mailbox = new Mailbox(cwd, "w1b");
		await mailbox.ensureDirs();
		await mailbox.writeProtocol("PROTOCOL BODY");
		const written = await fs.readFile(
			path.join(cwd, ".skynet", "w1b", "protocol.md"),
			"utf8",
		);
		expect(written).toBe("PROTOCOL BODY");
	});

	test("tryReadOutbox returns undefined when the file does not exist yet", async () => {
		const cwd = await mkTmpRepo();
		const mailbox = new Mailbox(cwd, "w2");
		await mailbox.ensureDirs();
		expect(await mailbox.tryReadOutbox(1)).toBeUndefined();
	});

	test("tryReadOutbox returns undefined on a half-written file, then the parsed value once valid", async () => {
		const cwd = await mkTmpRepo();
		const mailbox = new Mailbox(cwd, "w3");
		await mailbox.ensureDirs();
		const outboxFile = path.join(
			cwd,
			".skynet",
			"w3",
			"outbox",
			"turn-1.json",
		);

		await fs.writeFile(outboxFile, '{"status":"paus');
		expect(await mailbox.tryReadOutbox(1)).toBeUndefined();

		await fs.writeFile(outboxFile, '{"status":"paused","summary":"ok"}');
		expect(await mailbox.tryReadOutbox(1)).toEqual({
			status: "paused",
			summary: "ok",
		});
	});

	test("ensureGitignored creates, appends, then no-ops for .skynet/", async () => {
		const cwd = await mkTmpRepo();
		const mailbox = new Mailbox(cwd, "w4");

		await mailbox.ensureGitignored(cwd);
		expect(await fs.readFile(path.join(cwd, ".gitignore"), "utf8")).toBe(
			".skynet/\n",
		);

		await fs.writeFile(path.join(cwd, ".gitignore"), "node_modules/\n");
		await mailbox.ensureGitignored(cwd);
		expect(await fs.readFile(path.join(cwd, ".gitignore"), "utf8")).toBe(
			"node_modules/\n.skynet/\n",
		);

		await mailbox.ensureGitignored(cwd);
		expect(await fs.readFile(path.join(cwd, ".gitignore"), "utf8")).toBe(
			"node_modules/\n.skynet/\n",
		);
	});

	test("dispose removes the worker's mailbox dir", async () => {
		const cwd = await mkTmpRepo();
		const mailbox = new Mailbox(cwd, "w5");
		await mailbox.ensureDirs();
		await mailbox.dispose();
		await expect(fs.access(mailbox.dir)).rejects.toThrow();
	});
});
