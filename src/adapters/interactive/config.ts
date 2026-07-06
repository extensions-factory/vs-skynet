// Central config for the interactive core. Agent-facing prompt wording and
// every default timeout live here: tune them in one place, not in the state
// machine. `rel` is the forward-slash mailbox dir (e.g. ".skynet/w1").

export const DEFAULT_TURN_TIMEOUT_MS = 300_000;
export const DEFAULT_READY_TIMEOUT_MS = 30_000;
export const DEFAULT_CRASH_POLL_MS = 3_000;
export const DEFAULT_LAUNCH_DELAY_MS = 1_500;
export const DEFAULT_MAILBOX_POLL_MS = 500;

export function protocolText(rel: string): string {
	return [
		`For each ${rel}/inbox/turn-N.md I give you: do the work it asks, then write`,
		`${rel}/outbox/turn-N.json before you stop, matching the same N:`,
		'Readiness (turn 0), after reading this file -> {"status":"paused","summary":"ready"}',
		'Pausing / need the next instruction -> {"status":"paused","summary":"<what you did>"}',
		'Whole task complete -> {"status":"done","summary":"...","filesTouched":["..."]}',
		'Unrecoverable error -> {"status":"error","reason":"..."}',
		"",
		"Never delete inbox files. Write the outbox file in a single operation as the",
		"last action of a turn (write turn-N.json.tmp, then rename to turn-N.json).",
	].join("\n");
}

export function readinessInboxText(rel: string): string {
	return [
		`You are connected through the skynet mailbox at ${rel}.`,
		`Read ${rel}/protocol.md, then confirm you are ready by writing`,
		`${rel}/outbox/turn-0.json = {"status":"paused","summary":"ready"} -- do nothing else this turn.`,
	].join("\n");
}

export function readinessPing(rel: string): string {
	return `Read ${rel}/protocol.md, then ${rel}/inbox/turn-0.md and follow it.`;
}

export function turnPing(rel: string, turn: number): string {
	return `Read ${rel}/inbox/turn-${turn}.md and follow it.`;
}

export function turnInbox(prompt: string, rel: string, turn: number): string {
	return `${prompt}\n\n(write ${rel}/outbox/turn-${turn}.json per protocol)`;
}
