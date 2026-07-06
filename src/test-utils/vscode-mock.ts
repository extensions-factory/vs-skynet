import { vi } from "vitest";

export const commands = {
	executeCommand: vi.fn(),
	registerCommand: vi.fn(),
};

export const window = {
	createTerminal: vi.fn(() => ({
		dispose: vi.fn(),
		processId: Promise.resolve(1234),
		sendText: vi.fn(),
		show: vi.fn(),
	})),
	onDidCloseTerminal: vi.fn(() => ({ dispose: vi.fn() })),
	showInformationMessage: vi.fn(),
};
