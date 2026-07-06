import { startInteractive } from "../interactive/interactive-session";
import type { InteractiveOpts, InteractiveSession } from "../interactive/types";
import type { AgentAdapter } from "../types";
import { codexInteractive } from "./interactive-profile";

export const codexAdapter: AgentAdapter = {
	id: "codex",
	async runInteractive(opts: InteractiveOpts): Promise<InteractiveSession> {
		const configDir = opts.configDir ?? process.env.CODEX_HOME;
		if (!configDir) {
			throw new Error(
				"codex requires an isolated CODEX_HOME: set the CODEX_HOME env var or pass opts.configDir",
			);
		}
		return startInteractive(codexInteractive, { ...opts, configDir });
	},
};
