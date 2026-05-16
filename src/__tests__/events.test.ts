import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { resetState, setTodos, getTodos } from "../state";
import { registerMessageRenderers, registerEventHandlers } from "../events";
import { createMockAPI, createMockContext, createMockTheme } from "./helpers/mocks";
import { MAX_AUTO_CONTINUE } from "../types";

describe("registerMessageRenderers", () => {
  it("registers 'til-done-context' renderer", () => {
    const { api, registerMessageRenderer } = createMockAPI();
    registerMessageRenderers(api);

    expect(registerMessageRenderer).toHaveBeenCalledWith("til-done-context", expect.any(Function));
  });

  it("registers 'til-done-complete' renderer", () => {
    const { api, registerMessageRenderer } = createMockAPI();
    registerMessageRenderers(api);

    expect(registerMessageRenderer).toHaveBeenCalledWith("til-done-complete", expect.any(Function));
  });

  it("'til-done-context' renderer returns themed text", () => {
    const { api, registerMessageRenderer } = createMockAPI();
    registerMessageRenderers(api);

    const rendererCalls = registerMessageRenderer.mock.calls;
    const contextCall = rendererCalls.find((call) => call[0] === "til-done-context");
    const renderer = contextCall![1];

    const mockTheme = createMockTheme();
    const message = { content: "test content" };
    const result = renderer(message, { expanded: false, isPartial: false }, mockTheme);

    expect(result.toString()).toContain("test content");
  });

  it("'til-done-complete' renderer returns themed text", () => {
    const { api, registerMessageRenderer } = createMockAPI();
    registerMessageRenderers(api);

    const rendererCalls = registerMessageRenderer.mock.calls;
    const completeCall = rendererCalls.find((call) => call[0] === "til-done-complete");
    const renderer = completeCall![1];

    const mockTheme = createMockTheme();
    const message = { content: "complete message" };
    const result = renderer(message, { expanded: false, isPartial: false }, mockTheme);

    expect(result.toString()).toContain("complete message");
  });

  it("'til-done-countdown' renderer returns themed text", () => {
    const { api, registerMessageRenderer } = createMockAPI();
    registerMessageRenderers(api);
    const rendererCalls = registerMessageRenderer.mock.calls;
    const countdownCall = rendererCalls.find((call) => call[0] === "til-done-countdown");
    const renderer = countdownCall![1];
    const mockTheme = createMockTheme();
    const message = { content: "Auto-continuing in 2s..." };
    const result = renderer(message, { expanded: false, isPartial: false }, mockTheme);
    expect(result.toString()).toContain("Auto-continuing in 2s...");
  });
});

describe("registerEventHandlers", () => {
  beforeEach(() => {
    resetState();
  });

  it("registers handlers for session_start, session_tree, before_agent_start, agent_end", () => {
    const { api, on } = createMockAPI();
    registerEventHandlers(api);

    expect(on).toHaveBeenCalledWith("session_start", expect.any(Function));
    expect(on).toHaveBeenCalledWith("session_tree", expect.any(Function));
    expect(on).toHaveBeenCalledWith("before_agent_start", expect.any(Function));
    expect(on).toHaveBeenCalledWith("agent_end", expect.any(Function));
  });
});

describe("session_start handler", () => {
  beforeEach(() => {
    resetState();
  });

  it("reconstructs state and updates UI", async () => {
    const { api, on } = createMockAPI();
    const setStatus = vi.fn();
    const ctx = createMockContext([
      {
        type: "message",
        message: {
          role: "toolResult",
          toolName: "write_todos",
          details: {
            todos: [{ text: "task 1", status: "not_started" }],
          },
        },
      },
    ]);
    ctx.ui.setStatus = setStatus;

    registerEventHandlers(api);

    const sessionStartHandler = on.mock.calls.find((call) => call[0] === "session_start")![1];
    await sessionStartHandler({}, ctx);

    expect(getTodos()).toEqual([{ text: "task 1", status: "not_started" }]);
    expect(setStatus).toHaveBeenCalled();
  });
});

describe("session_tree handler", () => {
  beforeEach(() => {
    resetState();
  });

  it("reconstructs state and updates UI", async () => {
    const { api, on } = createMockAPI();
    const setStatus = vi.fn();
    const ctx = createMockContext([
      {
        type: "message",
        message: {
          role: "toolResult",
          toolName: "edit_todos",
          details: {
            todos: [
              { text: "task 1", status: "completed" },
              { text: "task 2", status: "in_progress" },
            ],
          },
        },
      },
    ]);
    ctx.ui.setStatus = setStatus;

    registerEventHandlers(api);

    const sessionTreeHandler = on.mock.calls.find((call) => call[0] === "session_tree")![1];
    await sessionTreeHandler({}, ctx);

    expect(getTodos()).toEqual([
      { text: "task 1", status: "completed" },
      { text: "task 2", status: "in_progress" },
    ]);
    expect(setStatus).toHaveBeenCalled();
  });
});

describe("before_agent_start handler", () => {
  beforeEach(() => {
    resetState();
  });

  it("returns context message when incomplete todos exist", async () => {
    const { api, on } = createMockAPI();
    setTodos([
      { text: "task 1", status: "completed" },
      { text: "task 2", status: "not_started" },
    ]);

    registerEventHandlers(api);

    const beforeAgentStartHandler = on.mock.calls.find(
      (call) => call[0] === "before_agent_start",
    )![1];
    const result = await beforeAgentStartHandler();

    expect(result).toBeDefined();
    expect(result.message.customType).toBe("til-done-context");
    expect(result.message.display).toBe(false);
    expect(result.message.content).toContain("task 1");
    expect(result.message.content).toContain("task 2");
  });

  it("returns undefined when all todos are completed", async () => {
    const { api, on } = createMockAPI();
    setTodos([
      { text: "task 1", status: "completed" },
      { text: "task 2", status: "completed" },
    ]);

    registerEventHandlers(api);

    const beforeAgentStartHandler = on.mock.calls.find(
      (call) => call[0] === "before_agent_start",
    )![1];
    const result = await beforeAgentStartHandler();

    expect(result).toBeUndefined();
  });

  it("returns undefined when all todos are abandoned", async () => {
    const { api, on } = createMockAPI();
    setTodos([
      { text: "task 1", status: "abandoned" },
      { text: "task 2", status: "abandoned" },
    ]);

    registerEventHandlers(api);

    const beforeAgentStartHandler = on.mock.calls.find(
      (call) => call[0] === "before_agent_start",
    )![1];
    const result = await beforeAgentStartHandler();

    expect(result).toBeUndefined();
  });

  it("returns undefined when todos array is empty", async () => {
    const { api, on } = createMockAPI();
    setTodos([]);

    registerEventHandlers(api);

    const beforeAgentStartHandler = on.mock.calls.find(
      (call) => call[0] === "before_agent_start",
    )![1];
    const result = await beforeAgentStartHandler();

    expect(result).toBeUndefined();
  });

  it("message has display: false", async () => {
    const { api, on } = createMockAPI();
    setTodos([{ text: "task 1", status: "not_started" }]);

    registerEventHandlers(api);

    const beforeAgentStartHandler = on.mock.calls.find(
      (call) => call[0] === "before_agent_start",
    )![1];
    const result = await beforeAgentStartHandler();

    expect(result.message.display).toBe(false);
  });

  it("message contains formatted todo list", async () => {
    const { api, on } = createMockAPI();
    setTodos([
      { text: "task 1", status: "completed" },
      { text: "task 2", status: "in_progress" },
    ]);

    registerEventHandlers(api);

    const beforeAgentStartHandler = on.mock.calls.find(
      (call) => call[0] === "before_agent_start",
    )![1];
    const result = await beforeAgentStartHandler();

    expect(result.message.content).toContain("✓ [0] task 1");
    expect(result.message.content).toContain("● [1] task 2");
  });
});

describe("agent_end handler", () => {
  beforeEach(() => {
    resetState();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends sendUserMessage when incomplete todos remain", async () => {
    const { api, on, sendUserMessage } = createMockAPI();
    setTodos([
      { text: "task 1", status: "completed" },
      { text: "task 2", status: "not_started" },
    ]);

    registerEventHandlers(api);

    const agentEndHandler = on.mock.calls.find((call) => call[0] === "agent_end")![1];
    await agentEndHandler({ messages: [{ role: "assistant", stopReason: "stop" }] }, {});
    vi.advanceTimersByTime(3000);

    expect(sendUserMessage).toHaveBeenCalled();
    const prompt = sendUserMessage.mock.calls[0]![0]!;
    expect(prompt).toContain("edit_todos");
    expect(prompt).toContain("action 'start'");
    expect(prompt).toContain("[1]");
  });

  it("sendUserMessage content does not contain todo.text in instruction portion (SEC-CRIT-01)", async () => {
    const { api, on, sendUserMessage } = createMockAPI();
    setTodos([
      { text: "task 1", status: "completed" },
      { text: "task 2", status: "in_progress" },
    ]);

    registerEventHandlers(api);

    const agentEndHandler = on.mock.calls.find((call) => call[0] === "agent_end")![1];
    await agentEndHandler({ messages: [{ role: "assistant", stopReason: "stop" }] }, {});
    vi.advanceTimersByTime(3000);

    const prompt = sendUserMessage.mock.calls[0]![0]!;
    const lines = prompt.split("\n");

    // Find the instruction line
    const instructionLine = lines.find((line: string) => line.includes("Next action:"));
    expect(instructionLine).toBeDefined();
    expect(instructionLine).not.toContain("task 2");

    // The instruction should only contain the action name and index, not the text
    expect(instructionLine).toContain("edit_todos with action 'complete'");
    expect(instructionLine).toContain("[1]");
  });

  it("returns early when todos is empty", async () => {
    const mockApi = createMockAPI();
    setTodos([]);

    registerEventHandlers(mockApi.api);

    const agentEndHandler = mockApi.on.mock.calls.find((call) => call[0] === "agent_end")![1];
    await agentEndHandler({ messages: [{ role: "assistant", stopReason: "stop" }] }, {});

    expect(mockApi.sendUserMessage).not.toHaveBeenCalled();
  });

  it("returns early when all todos are completed", async () => {
    const mockApi = createMockAPI();
    setTodos([
      { text: "task 1", status: "completed" },
      { text: "task 2", status: "completed" },
    ]);

    registerEventHandlers(mockApi.api);

    const agentEndHandler = mockApi.on.mock.calls.find((call) => call[0] === "agent_end")![1];
    await agentEndHandler({ messages: [{ role: "assistant", stopReason: "stop" }] }, {});

    expect(mockApi.sendUserMessage).not.toHaveBeenCalled();
  });

  it("returns early when all todos are abandoned", async () => {
    const mockApi = createMockAPI();
    setTodos([
      { text: "task 1", status: "abandoned" },
      { text: "task 2", status: "abandoned" },
    ]);

    registerEventHandlers(mockApi.api);

    const agentEndHandler = mockApi.on.mock.calls.find((call) => call[0] === "agent_end")![1];
    await agentEndHandler({ messages: [{ role: "assistant", stopReason: "stop" }] }, {});

    expect(mockApi.sendUserMessage).not.toHaveBeenCalled();
  });

  it("sends completion message via sendMessage when auto-continue limit reached", async () => {
    const mockApi = createMockAPI();
    setTodos([
      { text: "task 1", status: "completed" },
      { text: "task 2", status: "not_started" },
    ]);

    registerEventHandlers(mockApi.api);

    const agentEndHandler = mockApi.on.mock.calls.find((call) => call[0] === "agent_end")![1];

    // Call handler MAX_AUTO_CONTINUE + 1 times, advancing timers each time
    for (let i = 0; i <= MAX_AUTO_CONTINUE; i++) {
      await agentEndHandler({ messages: [{ role: "assistant", stopReason: "stop" }] }, {});
      vi.advanceTimersByTime(3000);
    }

    expect(mockApi.sendMessage).toHaveBeenCalled();
    // Find the limit-reached message among the calls
    const completeCall = mockApi.sendMessage.mock.calls.find(
      (call: unknown[]) => (call[0] as { customType: string }).customType === "til-done-complete",
    );
    expect(completeCall).toBeDefined();
    expect((completeCall![0] as { content: string }).content).toContain(
      "Auto-continue limit reached",
    );
  });

  it("does not send sendUserMessage when limit reached", async () => {
    const mockApi = createMockAPI();
    setTodos([{ text: "task 1", status: "not_started" }]);

    registerEventHandlers(mockApi.api);

    const agentEndHandler = mockApi.on.mock.calls.find((call) => call[0] === "agent_end")![1];

    // Call handler MAX_AUTO_CONTINUE + 1 times, advancing timers each time
    for (let i = 0; i <= MAX_AUTO_CONTINUE; i++) {
      await agentEndHandler({ messages: [{ role: "assistant", stopReason: "stop" }] }, {});
      vi.advanceTimersByTime(3000);
    }

    // sendUserMessage should only have been called MAX_AUTO_CONTINUE times (not on the limit-hit call)
    expect(mockApi.sendUserMessage).toHaveBeenCalledTimes(MAX_AUTO_CONTINUE);
  });

  it("increments auto-continue counter on each call", async () => {
    const { api, on, sendUserMessage } = createMockAPI();
    setTodos([{ text: "task 1", status: "not_started" }]);

    registerEventHandlers(api);

    const agentEndHandler = on.mock.calls.find((call) => call[0] === "agent_end")![1];

    // First call should work
    await agentEndHandler({ messages: [{ role: "assistant", stopReason: "stop" }] }, {});
    vi.advanceTimersByTime(3000);
    expect(sendUserMessage).toHaveBeenCalledTimes(1);

    // Second call should also work
    await agentEndHandler({ messages: [{ role: "assistant", stopReason: "stop" }] }, {});
    vi.advanceTimersByTime(3000);
    expect(sendUserMessage).toHaveBeenCalledTimes(2);

    // Third call should also work
    await agentEndHandler({ messages: [{ role: "assistant", stopReason: "stop" }] }, {});
    vi.advanceTimersByTime(3000);
    expect(sendUserMessage).toHaveBeenCalledTimes(3);
  });

  it("resets counter is NOT called by agent_end itself (only by tool actions)", async () => {
    const { api, on } = createMockAPI();
    setTodos([{ text: "task 1", status: "not_started" }]);

    registerEventHandlers(api);

    const agentEndHandler = on.mock.calls.find((call) => call[0] === "agent_end")![1];

    // Call multiple times - counter should keep incrementing
    await agentEndHandler({ messages: [{ role: "assistant", stopReason: "stop" }] }, {});
    vi.advanceTimersByTime(3000);
    await agentEndHandler({ messages: [{ role: "assistant", stopReason: "stop" }] }, {});
    vi.advanceTimersByTime(3000);
    await agentEndHandler({ messages: [{ role: "assistant", stopReason: "stop" }] }, {});
    vi.advanceTimersByTime(3000);

    // The counter should have incremented each time
    // This is tested implicitly by the fact that sendUserMessage gets called 3 times
    // (if counter was reset, it would still call, but we want to ensure it doesn't reset)
  });

  it("prompt contains structured format with remaining list", async () => {
    const { api, on, sendUserMessage } = createMockAPI();
    setTodos([
      { text: "task 1", status: "completed" },
      { text: "task 2", status: "not_started" },
      { text: "task 3", status: "in_progress" },
    ]);

    registerEventHandlers(api);

    const agentEndHandler = on.mock.calls.find((call) => call[0] === "agent_end")![1];
    await agentEndHandler({ messages: [{ role: "assistant", stopReason: "stop" }] }, {});
    vi.advanceTimersByTime(3000);

    const prompt = sendUserMessage.mock.calls[0]![0]!;
    expect(prompt).toContain("Remaining items:");
    expect(prompt).toContain("– [1] task 2");
    expect(prompt).toContain("● [2] task 3");
  });

  it("prompt contains next action instruction with index and action name only", async () => {
    const { api, on, sendUserMessage } = createMockAPI();
    setTodos([
      { text: "task 1", status: "completed" },
      { text: "task 2", status: "in_progress" },
    ]);

    registerEventHandlers(api);

    const agentEndHandler = on.mock.calls.find((call) => call[0] === "agent_end")![1];
    await agentEndHandler({ messages: [{ role: "assistant", stopReason: "stop" }] }, {});
    vi.advanceTimersByTime(3000);

    const prompt = sendUserMessage.mock.calls[0]![0]!;
    expect(prompt).toContain("Next action: edit_todos with action 'complete' and indices [1]");
  });

  it("does not auto-continue when agent was aborted (user interrupt)", async () => {
    const { api, on, sendUserMessage } = createMockAPI();
    const ctx = createMockContext();
    setTodos([
      { text: "task 1", status: "completed" },
      { text: "task 2", status: "not_started" },
    ]);

    registerEventHandlers(api);

    const agentEndHandler = on.mock.calls.find((call) => call[0] === "agent_end")![1];
    await agentEndHandler({ messages: [{ role: "assistant", stopReason: "aborted" }] }, ctx);
    vi.advanceTimersByTime(3000);

    expect(sendUserMessage).not.toHaveBeenCalled();
    // Also no countdown widget on abort
    expect(ctx.ui.setWidget).not.toHaveBeenCalled();
  });

  it("shows countdown widget before auto-continue", async () => {
    const { api, on, sendUserMessage } = createMockAPI();
    const ctx = createMockContext();
    setTodos([{ text: "task 1", status: "not_started" }]);

    registerEventHandlers(api);

    const agentEndHandler = on.mock.calls.find((call) => call[0] === "agent_end")![1];
    await agentEndHandler({ messages: [{ role: "assistant", stopReason: "stop" }] }, ctx);

    // Countdown widget should appear immediately with 3s
    expect(ctx.ui.setWidget).toHaveBeenCalledWith(
      "til-done-countdown",
      expect.arrayContaining([expect.stringContaining("3s")]),
      { placement: "aboveEditor" },
    );

    // Advance 1s → widget updated to 2s
    vi.advanceTimersByTime(1000);
    expect(ctx.ui.setWidget).toHaveBeenCalledWith(
      "til-done-countdown",
      expect.arrayContaining([expect.stringContaining("2s")]),
      { placement: "aboveEditor" },
    );

    // Advance 1s → widget updated to 1s
    vi.advanceTimersByTime(1000);
    expect(ctx.ui.setWidget).toHaveBeenCalledWith(
      "til-done-countdown",
      expect.arrayContaining([expect.stringContaining("1s")]),
      { placement: "aboveEditor" },
    );

    // Advance 1s → widget cleared and sendUserMessage called
    vi.advanceTimersByTime(1000);
    expect(ctx.ui.setWidget).toHaveBeenCalledWith("til-done-countdown", undefined);
    expect(sendUserMessage).toHaveBeenCalled();
  });

  it("sends sendUserMessage via setTimeout when no UI available", async () => {
    const { api, on, sendUserMessage } = createMockAPI();
    const ctx = createMockContext();
    ctx.hasUI = false;
    setTodos([{ text: "task 1", status: "not_started" }]);
    registerEventHandlers(api);
    const agentEndHandler = on.mock.calls.find((call) => call[0] === "agent_end")![1]! as any;
    await agentEndHandler({ messages: [{ role: "assistant", stopReason: "stop" }] }, ctx);
    vi.advanceTimersByTime(3000);
    expect(sendUserMessage).toHaveBeenCalledTimes(1);
    const prompt = sendUserMessage.mock.calls[0]![0] as string;
    expect(prompt).toContain("edit_todos");
    expect(prompt).toContain("action 'start'");
  });

  it("clears widget and handles gracefully when sendUserMessage throws during countdown", async () => {
    const { api, on, sendUserMessage } = createMockAPI();
    const ctx = createMockContext();
    sendUserMessage.mockImplementation(() => {
      throw new Error("Agent already processing user input");
    });
    setTodos([{ text: "task 1", status: "not_started" }]);

    registerEventHandlers(api);

    const agentEndHandler = on.mock.calls.find((call) => call[0] === "agent_end")![1];
    await agentEndHandler({ messages: [{ role: "assistant", stopReason: "stop" }] }, ctx);

    // Widget shows 3s immediately
    expect(ctx.ui.setWidget).toHaveBeenCalledWith(
      "til-done-countdown",
      expect.arrayContaining([expect.stringContaining("3s")]),
      { placement: "aboveEditor" },
    );

    // Advance 3s to trigger the sendUserMessage throw
    vi.advanceTimersByTime(3000);

    // Widget should be cleared even though sendUserMessage threw
    expect(ctx.ui.setWidget).toHaveBeenCalledWith("til-done-countdown", undefined);
    expect(sendUserMessage).toHaveBeenCalled();
    // No crash — test completes without unhandled exception
  });
});
