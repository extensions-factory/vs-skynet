import type { Dirent } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { HarvestResult, InteractiveCliProfile } from "./types";

export async function harvestSession(
	profile: InteractiveCliProfile,
	configDir: string | undefined,
	startedAtMs?: number,
): Promise<HarvestResult> {
	const newest = await newestFileRecursive(
		profile.sessionDir(configDir),
		startedAtMs,
	);
	if (!newest) {
		return {};
	}
	return profile.harvest(await fs.readFile(newest, "utf8"));
}

async function newestFileRecursive(
	dir: string,
	startedAtMs: number | undefined,
): Promise<string | undefined> {
	let entries: Dirent[];
	try {
		entries = await fs.readdir(dir, { withFileTypes: true });
	} catch {
		return undefined;
	}

	let newest: { file: string; mtimeMs: number } | undefined;
	const consider = async (file: string) => {
		const stat = await fs.stat(file);
		if (startedAtMs !== undefined && stat.mtimeMs <= startedAtMs) {
			return;
		}
		if (!newest || stat.mtimeMs > newest.mtimeMs) {
			newest = { file, mtimeMs: stat.mtimeMs };
		}
	};

	for (const entry of entries) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			const candidate = await newestFileRecursive(full, startedAtMs);
			if (candidate) {
				await consider(candidate);
			}
		} else if (entry.isFile()) {
			await consider(full);
		}
	}
	return newest?.file;
}
