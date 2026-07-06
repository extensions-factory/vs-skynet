import { describe, expect, test, vi } from "vitest";
import { AgentSessionStateMachine } from "./session-state-machine";

describe("AgentSessionStateMachine", () => {
	test("starts at launching, not terminal", () => {
		const m = new AgentSessionStateMachine();
		expect(m.state).toBe("launching");
		expect(m.isTerminal).toBe(false);
	});

	test("walks a full turn lifecycle and fires onChange with from/to", () => {
		const changes: Array<[string, string]> = [];
		const m = new AgentSessionStateMachine((from, to) => {
			changes.push([from, to]);
		});
		m.transition("readyOutbox");
		expect(m.state).toBe("ready");
		m.transition("send");
		expect(m.state).toBe("busy");
		m.transition("turnPaused");
		expect(m.state).toBe("awaiting-input");
		m.transition("send");
		m.transition("turnDone");
		expect(m.state).toBe("done");
		expect(m.isTerminal).toBe(true);
		expect(changes).toEqual([
			["launching", "ready"],
			["ready", "busy"],
			["busy", "awaiting-input"],
			["awaiting-input", "busy"],
			["busy", "done"],
		]);
	});

	test("throws on an illegal transition from a non-terminal state", () => {
		const m = new AgentSessionStateMachine();
		expect(() => m.transition("turnDone")).toThrow(
			/illegal transition: launching -\/turnDone/,
		);
	});

	test("terminal states absorb further events without throwing or firing onChange", () => {
		const onChange = vi.fn();
		const m = new AgentSessionStateMachine(onChange);
		m.transition("readyOutbox");
		m.transition("send");
		m.transition("turnFailed");
		expect(m.state).toBe("failed");
		onChange.mockClear();
		m.transition("dispose");
		m.transition("terminalClosed");
		expect(m.state).toBe("failed");
		expect(onChange).not.toHaveBeenCalled();
	});

	test("dispose from launching goes to stopped; terminalClosed goes to failed", () => {
		const a = new AgentSessionStateMachine();
		a.transition("dispose");
		expect(a.state).toBe("stopped");
		const b = new AgentSessionStateMachine();
		b.transition("startupFailed");
		expect(b.state).toBe("failed");
	});
});
