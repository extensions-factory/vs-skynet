import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@vscode/test-cli";

export default defineConfig({
	files: "out/test/**/*.test.js",
	launchArgs: [
		`--user-data-dir=${join(tmpdir(), "skynet-vscode-user-data")}`,
		`--extensions-dir=${join(tmpdir(), "skynet-vscode-extensions")}`,
	],
});
