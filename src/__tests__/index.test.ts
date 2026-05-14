import { describe, it, expect, vi } from "vitest";
import extensionFactory from "../index";

describe("default export (extension factory)", () => {
  it("registers 3 tools (write_todos, list_todos, edit_todos)", () => {
    const registerTool = vi.fn();
    const api = {
      registerTool,
      on: vi.fn(),
      registerMessageRenderer: vi.fn(),
    } as unknown as Parameters<typeof extensionFactory>[0];

    extensionFactory(api);

    expect(registerTool).toHaveBeenCalledTimes(3);
    const toolNames = registerTool.mock.calls.map((call) => call[0].name);
    expect(toolNames).toContain("write_todos");
    expect(toolNames).toContain("list_todos");
    expect(toolNames).toContain("edit_todos");
  });

  it("registers 2 message renderers", () => {
    const registerMessageRenderer = vi.fn();
    const api = {
      registerTool: vi.fn(),
      on: vi.fn(),
      registerMessageRenderer,
    } as unknown as Parameters<typeof extensionFactory>[0];

    extensionFactory(api);

    expect(registerMessageRenderer).toHaveBeenCalledTimes(3);
    const rendererTypes = registerMessageRenderer.mock.calls.map((call) => call[0]);
    expect(rendererTypes).toContain("til-done-context");
    expect(rendererTypes).toContain("til-done-complete");
    expect(rendererTypes).toContain("til-done-countdown");
  });

  it("registers 4+ event handlers (session_start, session_tree, before_agent_start, agent_end)", () => {
    const on = vi.fn();
    const api = {
      registerTool: vi.fn(),
      on,
      registerMessageRenderer: vi.fn(),
    } as unknown as Parameters<typeof extensionFactory>[0];

    extensionFactory(api);

    expect(on).toHaveBeenCalled();
    const eventNames = on.mock.calls.map((call) => call[0]);
    expect(eventNames).toContain("session_start");
    expect(eventNames).toContain("session_tree");
    expect(eventNames).toContain("before_agent_start");
    expect(eventNames).toContain("agent_end");
  });

  it("does not throw", () => {
    const api = {
      registerTool: vi.fn(),
      on: vi.fn(),
      registerMessageRenderer: vi.fn(),
    } as unknown as Parameters<typeof extensionFactory>[0];

    expect(() => extensionFactory(api)).not.toThrow();
  });
});
