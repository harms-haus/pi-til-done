import { describe, it, expect, beforeEach } from "vitest";
import type { TodoItem } from "../types";
import {
  getPlainIcon,
  formatTodoListText,
  formatRemainingList,
  getStatusIcon,
  getTodoLabel,
  renderTodoList,
  renderToolResult,
} from "../formatting";
import { createMockTheme } from "./helpers/mocks";

describe("getPlainIcon", () => {
  it("returns '–' for not_started", () => {
    expect(getPlainIcon("not_started")).toBe("–");
  });

  it("returns '●' for in_progress", () => {
    expect(getPlainIcon("in_progress")).toBe("●");
  });

  it("returns '✓' for completed", () => {
    expect(getPlainIcon("completed")).toBe("✓");
  });

  it("returns '✗' for abandoned", () => {
    expect(getPlainIcon("abandoned")).toBe("✗");
  });
});

describe("formatTodoListText", () => {
  it("returns 'No todos' for empty array", () => {
    const result = formatTodoListText([]);
    expect(result).toBe("No todos");
  });

  it("formats single item correctly: '– [0] my task'", () => {
    const todos: TodoItem[] = [{ text: "my task", status: "not_started" }];
    const result = formatTodoListText(todos);
    expect(result).toBe("– [0] my task");
  });

  it("formats multiple items with correct icons and indices", () => {
    const todos: TodoItem[] = [
      { text: "first task", status: "not_started" },
      { text: "second task", status: "in_progress" },
      { text: "third task", status: "completed" },
      { text: "fourth task", status: "abandoned" },
    ];
    const result = formatTodoListText(todos);
    expect(result).toBe("– [0] first task\n● [1] second task\n✓ [2] third task\n✗ [3] fourth task");
  });

  it("uses correct icon for each status", () => {
    const todos: TodoItem[] = [
      { text: "not started", status: "not_started" },
      { text: "in progress", status: "in_progress" },
      { text: "completed", status: "completed" },
      { text: "abandoned", status: "abandoned" },
    ];
    const result = formatTodoListText(todos);
    expect(result).toContain("– [0] not started");
    expect(result).toContain("● [1] in progress");
    expect(result).toContain("✓ [2] completed");
    expect(result).toContain("✗ [3] abandoned");
  });
});

describe("formatRemainingList", () => {
  it("formats only the specified indices", () => {
    const todos: TodoItem[] = [
      { text: "task 0", status: "not_started" },
      { text: "task 1", status: "in_progress" },
      { text: "task 2", status: "completed" },
      { text: "task 3", status: "not_started" },
    ];
    const indices = [0, 2, 3];
    const result = formatRemainingList(todos, indices);
    expect(result).toBe("– [0] task 0\n✓ [2] task 2\n– [3] task 3");
  });

  it("preserves order from the indices array", () => {
    const todos: TodoItem[] = [
      { text: "task 0", status: "not_started" },
      { text: "task 1", status: "in_progress" },
      { text: "task 2", status: "completed" },
    ];
    const indices = [2, 0, 1];
    const result = formatRemainingList(todos, indices);
    expect(result).toBe("✓ [2] task 2\n– [0] task 0\n● [1] task 1");
  });

  it("formats with correct icons", () => {
    const todos: TodoItem[] = [
      { text: "task 0", status: "not_started" },
      { text: "task 1", status: "in_progress" },
      { text: "task 2", status: "completed" },
      { text: "task 3", status: "abandoned" },
    ];
    const indices = [0, 1, 2, 3];
    const result = formatRemainingList(todos, indices);
    expect(result).toContain("– [0] task 0");
    expect(result).toContain("● [1] task 1");
    expect(result).toContain("✓ [2] task 2");
    expect(result).toContain("✗ [3] task 3");
  });

  it("handles single index", () => {
    const todos: TodoItem[] = [{ text: "task 0", status: "not_started" }];
    const indices = [0];
    const result = formatRemainingList(todos, indices);
    expect(result).toBe("– [0] task 0");
  });

  it("handles empty indices array", () => {
    const todos: TodoItem[] = [{ text: "task 0", status: "not_started" }];
    const indices: number[] = [];
    const result = formatRemainingList(todos, indices);
    expect(result).toBe("");
  });
});

describe("getStatusIcon", () => {
  let mockTheme: ReturnType<typeof createMockTheme>;

  beforeEach(() => {
    mockTheme = createMockTheme();
  });

  it("calls theme.fg('dim', '–') for not_started", () => {
    const result = getStatusIcon("not_started", mockTheme);
    expect(result).toBe("[dim]–");
    expect(mockTheme.fg).toHaveBeenCalledWith("dim", "–");
  });

  it("calls theme.fg('warning', '●') for in_progress", () => {
    const result = getStatusIcon("in_progress", mockTheme);
    expect(result).toBe("[warning]●");
    expect(mockTheme.fg).toHaveBeenCalledWith("warning", "●");
  });

  it("calls theme.fg('success', '✓') for completed", () => {
    const result = getStatusIcon("completed", mockTheme);
    expect(result).toBe("[success]✓");
    expect(mockTheme.fg).toHaveBeenCalledWith("success", "✓");
  });

  it("calls theme.fg('error', '✗') for abandoned", () => {
    const result = getStatusIcon("abandoned", mockTheme);
    expect(result).toBe("[error]✗");
    expect(mockTheme.fg).toHaveBeenCalledWith("error", "✗");
  });
});

describe("getTodoLabel", () => {
  let mockTheme: ReturnType<typeof createMockTheme>;

  beforeEach(() => {
    mockTheme = createMockTheme();
  });

  it("calls theme.fg('dim', strikethrough(text)) for completed", () => {
    const result = getTodoLabel("my task", "completed", mockTheme);
    expect(mockTheme.strikethrough).toHaveBeenCalledWith("my task");
    expect(mockTheme.fg).toHaveBeenCalledWith("dim", "~~my task~~");
    expect(result).toBe("[dim]~~my task~~");
  });

  it("calls theme.fg('dim', strikethrough(text)) for abandoned", () => {
    const result = getTodoLabel("my task", "abandoned", mockTheme);
    expect(mockTheme.strikethrough).toHaveBeenCalledWith("my task");
    expect(mockTheme.fg).toHaveBeenCalledWith("dim", "~~my task~~");
    expect(result).toBe("[dim]~~my task~~");
  });

  it("calls theme.fg('text', text) for not_started", () => {
    const result = getTodoLabel("my task", "not_started", mockTheme);
    expect(mockTheme.strikethrough).not.toHaveBeenCalled();
    expect(mockTheme.fg).toHaveBeenCalledWith("text", "my task");
    expect(result).toBe("[text]my task");
  });

  it("calls theme.fg('text', text) for in_progress", () => {
    const result = getTodoLabel("my task", "in_progress", mockTheme);
    expect(mockTheme.strikethrough).not.toHaveBeenCalled();
    expect(mockTheme.fg).toHaveBeenCalledWith("text", "my task");
    expect(result).toBe("[text]my task");
  });
});

describe("renderTodoList", () => {
  let mockTheme: ReturnType<typeof createMockTheme>;

  beforeEach(() => {
    mockTheme = createMockTheme();
  });

  it("returns themed 'No todos' for empty array", () => {
    const result = renderTodoList([], mockTheme);
    expect(mockTheme.fg).toHaveBeenCalledWith("dim", "No todos");
    expect(result).toBe("[dim]No todos");
  });

  it("formats each item with icon, index, and label", () => {
    const todos: TodoItem[] = [
      { text: "first task", status: "not_started" },
      { text: "second task", status: "in_progress" },
      { text: "third task", status: "completed" },
    ];

    const result = renderTodoList(todos, mockTheme);

    expect(mockTheme.fg).toHaveBeenCalledWith("dim", "–");
    expect(mockTheme.fg).toHaveBeenCalledWith("accent", "[0]");
    expect(mockTheme.fg).toHaveBeenCalledWith("text", "first task");

    expect(mockTheme.fg).toHaveBeenCalledWith("warning", "●");
    expect(mockTheme.fg).toHaveBeenCalledWith("accent", "[1]");
    expect(mockTheme.fg).toHaveBeenCalledWith("text", "second task");

    expect(mockTheme.fg).toHaveBeenCalledWith("success", "✓");
    expect(mockTheme.fg).toHaveBeenCalledWith("accent", "[2]");
    expect(mockTheme.strikethrough).toHaveBeenCalledWith("third task");
    expect(mockTheme.fg).toHaveBeenCalledWith("dim", "~~third task~~");

    expect(result).toBe(
      "[dim]– [accent][0] [text]first task\n[warning]● [accent][1] [text]second task\n[success]✓ [accent][2] [dim]~~third task~~",
    );
  });

  it("handles single item correctly", () => {
    const todos: TodoItem[] = [{ text: "my task", status: "not_started" }];
    const result = renderTodoList(todos, mockTheme);
    expect(result).toBe("[dim]– [accent][0] [text]my task");
  });

  it("handles items with abandoned status", () => {
    const todos: TodoItem[] = [{ text: "abandoned task", status: "abandoned" }];
    const result = renderTodoList(todos, mockTheme);
    expect(mockTheme.fg).toHaveBeenCalledWith("error", "✗");
    expect(mockTheme.strikethrough).toHaveBeenCalledWith("abandoned task");
    expect(mockTheme.fg).toHaveBeenCalledWith("dim", "~~abandoned task~~");
    expect(result).toBe("[error]✗ [accent][0] [dim]~~abandoned task~~");
  });
});

describe("renderToolResult", () => {
  let mockTheme: ReturnType<typeof createMockTheme>;

  beforeEach(() => {
    mockTheme = createMockTheme();
  });

  it("returns Text with content[0].text when no details", () => {
    const result = { content: [{ type: "text", text: "some text" }] };
    const rendered = renderToolResult(result, { expanded: false, isPartial: false }, mockTheme);

    const renderedLines = rendered.render(100);
    expect(renderedLines[0]).toMatch(/^some text\s*$/);
  });

  it("returns Text with error styling when details.error is set", () => {
    const result = {
      content: [{ type: "text", text: "error message" }],
      details: {
        action: "write",
        todos: [],
        error: "something went wrong",
      },
    };

    const rendered = renderToolResult(result, { expanded: false, isPartial: false }, mockTheme);

    expect(mockTheme.fg).toHaveBeenCalledWith("error", "Error: something went wrong");
    const renderedLines = rendered.render(100);
    expect(renderedLines[0]).toMatch(/^\[error\]Error: something went wrong\s*$/);
  });

  it("returns Text with rendered todo list when details has todos", () => {
    const todos: TodoItem[] = [
      { text: "first task", status: "not_started" },
      { text: "second task", status: "completed" },
    ];

    const result = {
      content: [{ type: "text", text: "wrote todos" }],
      details: {
        action: "write",
        todos,
      },
    };

    const rendered = renderToolResult(result, { expanded: false, isPartial: false }, mockTheme);

    expect(mockTheme.fg).toHaveBeenCalledWith("dim", "–");
    expect(mockTheme.fg).toHaveBeenCalledWith("accent", "[0]");
    expect(mockTheme.fg).toHaveBeenCalledWith("text", "first task");
    expect(mockTheme.fg).toHaveBeenCalledWith("success", "✓");
    expect(mockTheme.fg).toHaveBeenCalledWith("accent", "[1]");
    expect(mockTheme.strikethrough).toHaveBeenCalledWith("second task");
    expect(mockTheme.fg).toHaveBeenCalledWith("dim", "~~second task~~");

    const renderedLines = rendered.render(100);
    expect(renderedLines[0]).toMatch(/^\[dim\]– \[accent\]\[0\] \[text\]first task\s*$/);
    expect(renderedLines[1]).toMatch(/^\[success\]✓ \[accent\]\[1\] \[dim\]~~second task~~\s*$/);
  });

  it("returns Text with 'No todos' when details has empty todos array", () => {
    const result = {
      content: [{ type: "text", text: "list" }],
      details: {
        action: "list",
        todos: [],
      },
    };

    const rendered = renderToolResult(result, { expanded: false, isPartial: false }, mockTheme);

    expect(mockTheme.fg).toHaveBeenCalledWith("dim", "No todos");
    const renderedLines = rendered.render(100);
    expect(renderedLines[0]).toMatch(/^\[dim\]No todos\s*$/);
  });

  it("handles result with empty content array", () => {
    const result = { content: [] };
    const rendered = renderToolResult(result, { expanded: false, isPartial: false }, mockTheme);
    const renderedLines = rendered.render(100);
    expect(renderedLines).toEqual([]);
  });

  it("ignores options parameter", () => {
    const todos: TodoItem[] = [{ text: "task", status: "not_started" }];
    const result = {
      content: [{ type: "text", text: "wrote" }],
      details: { action: "write", todos },
    };

    const expanded = renderToolResult(result, { expanded: true, isPartial: false }, mockTheme);
    const notExpanded = renderToolResult(result, { expanded: false, isPartial: false }, mockTheme);

    const expandedLines = expanded.render(100);
    const notExpandedLines = notExpanded.render(100);
    expect(expandedLines).toEqual(notExpandedLines);
  });
});
