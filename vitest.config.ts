import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["src/**/*.test.ts"],
		exclude: ["src/test/**"],
	},
	resolve: {
		alias: {
			vscode: resolve(__dirname, "src/test-utils/vscode-mock.ts"),
		},
	},
});
