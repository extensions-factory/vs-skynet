// Uniformly single-quotes every argv token before joining. A quoted flag
// (e.g. '-C') behaves identically to an unquoted one in a POSIX shell, so this
// skips per-token special-character detection.
export function shellQuote(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}

export function buildLaunchCommand(binary: string, argv: string[]): string {
	return [binary, ...argv.map(shellQuote)].join(" ");
}
