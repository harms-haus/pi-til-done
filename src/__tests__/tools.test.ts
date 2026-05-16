import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetState, setTodos, getTodos } from "../state";
import { createWriteTodosTool, createListTodosTool, createEditTodosTool } from "../tools";
import { createMockContext, createMockTheme } from "./helpers/mocks";
import { MAX_TODO_TEXT_LENGTH, MAX_TODOS } from "../types";

describe("write_todos tool", () => {
  beforeEach(() => {
    resetState();
  });

  it("creates todos with not_started status", async () => {
    const tool = createWriteTodosTool();
    const ctx = createMockContext();
    const result = await tool.execute(
      "call-id",
      { mode: "replace", todos: [{ text: "task 1" }, { text: "task 2" }] },
      new AbortController().signal,
      () => {},
      ctx,
    );

    expect(result.details?.action).toBe("write");
    expect(result.details?.todos).toEqual([
      { text: "task 1", status: "not_started" as const },
      { text: "task 2", status: "not_started" as const },
    ]);
  });

  it("returns content with formatted todo list", async () => {
    const tool = createWriteTodosTool();
    const ctx = createMockContext();
    const result = await tool.execute(
      "call-id",
      { mode: "replace", todos: [{ text: "task 1" }] },
      new AbortController().signal,
      () => {},
      ctx,
    );

    expect(result.content[0]!.type).toBe("text");
    if (result.content[0]!.type === "text") {
      expect(result.content[0]!.text).toContain("task 1");
      expect(result.content[0]!.text).toContain("Wrote 1 todo item(s)");
    }
  });

  it("returns details with action 'write' and cloned todos", async () => {
    const tool = createWriteTodosTool();
    const ctx = createMockContext();
    const result = await tool.execute(
      "call-id",
      { mode: "replace", todos: [{ text: "task 1" }] },
      new AbortController().signal,
      () => {},
      ctx,
    );

    expect(result.details?.action).toBe("write");
    const resultTodos = result.details?.todos as Array<{ text: string; status: string }>;
    expect(resultTodos).toEqual([{ text: "task 1", status: "not_started" }]);
    // Verify it's a clone by modifying original and checking it doesn't affect result
    if (resultTodos) {
      resultTodos[0]!.text = "modified";
      const currentTodos = getTodos();
      expect(currentTodos[0]!.text).toBe("task 1");
    }
  });

  it("rejects text exceeding MAX_TODO_TEXT_LENGTH with error result", async () => {
    const tool = createWriteTodosTool();
    const ctx = createMockContext();
    const longText = "a".repeat(MAX_TODO_TEXT_LENGTH + 1);
    const result = await tool.execute(
      "call-id",
      { mode: "replace", todos: [{ text: longText }] },
      new AbortController().signal,
      () => {},
      ctx,
    );

    expect(result.details?.action).toBe("write");
    expect(result.details?.error).toBe("text too long");
    expect(result.details?.todos).toEqual([]);
    if (result.content[0]!.type === "text") {
      expect(result.content[0]!.text).toContain("Error");
      expect(result.content[0]!.text).toContain("exceeds maximum text length");
    }
  });

  it("rejects item at index > 0 with correct index in error message", async () => {
    const tool = createWriteTodosTool();
    const ctx = createMockContext();
    const longText = "a".repeat(MAX_TODO_TEXT_LENGTH + 1);
    const result = await tool.execute(
      "call-id",
      { mode: "replace", todos: [{ text: "valid" }, { text: longText }, { text: "also valid" }] },
      new AbortController().signal,
      () => {},
      ctx,
    );

    if (result.content[0]!.type === "text") {
      expect(result.content[0]!.text).toContain("index 1");
    }
  });

  it("calls updateUI via context", async () => {
    const tool = createWriteTodosTool();
    const setStatus = vi.fn();
    const ctx = createMockContext();
    ctx.ui.setStatus = setStatus;

    await tool.execute(
      "call-id",
      { mode: "replace", todos: [{ text: "task 1" }] },
      new AbortController().signal,
      () => {},
      ctx,
    );

    expect(setStatus).toHaveBeenCalled();
  });

  it("allows replacing with empty array (clears all todos)", async () => {
    const tool = createWriteTodosTool();
    const ctx = createMockContext();
    setTodos([{ text: "existing", status: "not_started" as const }]);
    const result = await tool.execute(
      "call-id",
      { mode: "replace", todos: [] },
      new AbortController().signal,
      () => {},
      ctx,
    );
    expect(getTodos()).toEqual([]);
    expect(result.details?.todos).toEqual([]);
    if (result.content[0]!.type === "text") {
      expect(result.content[0]!.text).toContain("Wrote 0 todo item(s)");
    }
  });
});

describe("write_todos append mode", () => {
  beforeEach(() => {
    resetState();
  });

  it("appends items with not_started status", async () => {
    const tool = createWriteTodosTool();
    const ctx = createMockContext();
    setTodos([{ text: "existing task", status: "not_started" as const }]);

    await tool.execute(
      "call-id",
      { mode: "append", todos: [{ text: "appended 1" }, { text: "appended 2" }] },
      new AbortController().signal,
      () => {},
      ctx,
    );

    const todos = getTodos();
    expect(todos).toHaveLength(3);
    expect(todos[0]).toEqual({ text: "existing task", status: "not_started" });
    expect(todos[1]).toEqual({ text: "appended 1", status: "not_started" });
    expect(todos[2]).toEqual({ text: "appended 2", status: "not_started" });
  });

  it("appends to empty list", async () => {
    const tool = createWriteTodosTool();
    const ctx = createMockContext();

    await tool.execute(
      "call-id",
      { mode: "append", todos: [{ text: "first item" }] },
      new AbortController().signal,
      () => {},
      ctx,
    );

    const todos = getTodos();
    expect(todos).toHaveLength(1);
    expect(todos[0]).toEqual({ text: "first item", status: "not_started" });
  });

  it("returns content with 'Appended' text", async () => {
    const tool = createWriteTodosTool();
    const ctx = createMockContext();

    const result = await tool.execute(
      "call-id",
      { mode: "append", todos: [{ text: "task a" }, { text: "task b" }] },
      new AbortController().signal,
      () => {},
      ctx,
    );

    expect(result.content[0]!.type).toBe("text");
    if (result.content[0]!.type === "text") {
      expect(result.content[0]!.text).toContain("Appended 2 item(s)");
    }
  });

  it("returns details with action 'write' and cloned todos", async () => {
    const tool = createWriteTodosTool();
    const ctx = createMockContext();
    setTodos([{ text: "existing", status: "not_started" as const }]);

    const result = await tool.execute(
      "call-id",
      { mode: "append", todos: [{ text: "new task" }] },
      new AbortController().signal,
      () => {},
      ctx,
    );

    expect(result.details?.action).toBe("write");
    const resultTodos = result.details?.todos as Array<{ text: string; status: string }>;
    expect(resultTodos).toHaveLength(2);
    // Verify clone isolation
    resultTodos[0]!.text = "modified";
    expect(getTodos()[0]!.text).toBe("existing");
  });

  it("rejects oversized text", async () => {
    const tool = createWriteTodosTool();
    const ctx = createMockContext();
    const longText = "a".repeat(MAX_TODO_TEXT_LENGTH + 1);

    const result = await tool.execute(
      "call-id",
      { mode: "append", todos: [{ text: longText }] },
      new AbortController().signal,
      () => {},
      ctx,
    );

    expect(result.details?.error).toBe("text too long");
    expect(result.details?.todos).toEqual([]);
  });

  it("allows appending up to exactly MAX_TODOS", async () => {
    const tool = createWriteTodosTool();
    const ctx = createMockContext();
    const existing: Array<{ text: string; status: "not_started" }> = [];
    for (let i = 0; i < MAX_TODOS - 1; i++) {
      existing.push({ text: `task ${i}`, status: "not_started" as const });
    }
    setTodos(existing);

    const result = await tool.execute(
      "call-id",
      { mode: "append", todos: [{ text: "last task" }] },
      new AbortController().signal,
      () => {},
      ctx,
    );

    expect(getTodos()).toHaveLength(MAX_TODOS);
    expect(result.details?.error).toBeUndefined();
  });

  it("rejects when appending would exceed MAX_TODOS", async () => {
    const tool = createWriteTodosTool();
    const ctx = createMockContext();
    const existing: Array<{ text: string; status: "not_started" }> = [];
    for (let i = 0; i < MAX_TODOS - 1; i++) {
      existing.push({ text: `task ${i}`, status: "not_started" as const });
    }
    setTodos(existing);

    const result = await tool.execute(
      "call-id",
      { mode: "append", todos: [{ text: "one too many" }, { text: "two too many" }] },
      new AbortController().signal,
      () => {},
      ctx,
    );

    expect(result.details?.error).toBe("max todos exceeded");
    // Verify no mutation
    expect(getTodos()).toHaveLength(MAX_TODOS - 1);
  });

  it("calls updateUI via context", async () => {
    const tool = createWriteTodosTool();
    const setStatus = vi.fn();
    const ctx = createMockContext();
    ctx.ui.setStatus = setStatus;

    await tool.execute(
      "call-id",
      { mode: "append", todos: [{ text: "task" }] },
      new AbortController().signal,
      () => {},
      ctx,
    );

    expect(setStatus).toHaveBeenCalled();
  });

  it("does not change status of existing todos", async () => {
    const tool = createWriteTodosTool();
    const ctx = createMockContext();
    setTodos([{ text: "in-progress task", status: "in_progress" as const }]);

    await tool.execute(
      "call-id",
      { mode: "append", todos: [{ text: "new task" }] },
      new AbortController().signal,
      () => {},
      ctx,
    );

    const todos = getTodos();
    expect(todos[0]!.status).toBe("in_progress");
    expect(todos[0]!.text).toBe("in-progress task");
  });
});

describe("write_todos insert mode", () => {
  beforeEach(() => {
    resetState();
  });

  it("inserts items at beginning", async () => {
    const tool = createWriteTodosTool();
    const ctx = createMockContext();
    setTodos([
      { text: "old 1", status: "not_started" as const },
      { text: "old 2", status: "not_started" as const },
    ]);

    await tool.execute(
      "call-id",
      { mode: "insert", index: 0, todos: [{ text: "new" }] },
      new AbortController().signal,
      () => {},
      ctx,
    );

    const todos = getTodos();
    expect(todos).toHaveLength(3);
    expect(todos.map((t) => t.text)).toEqual(["new", "old 1", "old 2"]);
  });

  it("inserts items at middle", async () => {
    const tool = createWriteTodosTool();
    const ctx = createMockContext();
    setTodos([
      { text: "old 0", status: "not_started" as const },
      { text: "old 1", status: "not_started" as const },
      { text: "old 2", status: "not_started" as const },
    ]);

    await tool.execute(
      "call-id",
      { mode: "insert", index: 1, todos: [{ text: "new" }] },
      new AbortController().signal,
      () => {},
      ctx,
    );

    const todos = getTodos();
    expect(todos).toHaveLength(4);
    expect(todos.map((t) => t.text)).toEqual(["old 0", "new", "old 1", "old 2"]);
  });

  it("inserts items at end", async () => {
    const tool = createWriteTodosTool();
    const ctx = createMockContext();
    setTodos([
      { text: "old 0", status: "not_started" as const },
      { text: "old 1", status: "not_started" as const },
    ]);

    await tool.execute(
      "call-id",
      { mode: "insert", index: 2, todos: [{ text: "new" }] },
      new AbortController().signal,
      () => {},
      ctx,
    );

    const todos = getTodos();
    expect(todos).toHaveLength(3);
    expect(todos.map((t) => t.text)).toEqual(["old 0", "old 1", "new"]);
  });

  it("inserts multiple items", async () => {
    const tool = createWriteTodosTool();
    const ctx = createMockContext();
    setTodos([
      { text: "old 0", status: "not_started" as const },
      { text: "old 1", status: "not_started" as const },
      { text: "old 2", status: "not_started" as const },
    ]);

    await tool.execute(
      "call-id",
      {
        mode: "insert",
        index: 1,
        todos: [{ text: "new a" }, { text: "new b" }, { text: "new c" }],
      },
      new AbortController().signal,
      () => {},
      ctx,
    );

    const todos = getTodos();
    expect(todos).toHaveLength(6);
    expect(todos.map((t) => t.text)).toEqual([
      "old 0",
      "new a",
      "new b",
      "new c",
      "old 1",
      "old 2",
    ]);
  });

  it("returns content with 'Inserted' text", async () => {
    const tool = createWriteTodosTool();
    const ctx = createMockContext();

    const result = await tool.execute(
      "call-id",
      { mode: "insert", index: 0, todos: [{ text: "task a" }, { text: "task b" }] },
      new AbortController().signal,
      () => {},
      ctx,
    );

    expect(result.content[0]!.type).toBe("text");
    if (result.content[0]!.type === "text") {
      expect(result.content[0]!.text).toContain("Inserted 2 item(s) at index 0");
    }
  });

  it("returns details with action 'write' and cloned todos", async () => {
    const tool = createWriteTodosTool();
    const ctx = createMockContext();
    setTodos([{ text: "existing", status: "not_started" as const }]);

    const result = await tool.execute(
      "call-id",
      { mode: "insert", index: 0, todos: [{ text: "new" }] },
      new AbortController().signal,
      () => {},
      ctx,
    );

    expect(result.details?.action).toBe("write");
    const resultTodos = result.details?.todos as Array<{ text: string; status: string }>;
    expect(resultTodos).toHaveLength(2);
    // Verify clone isolation
    resultTodos[0]!.text = "modified";
    expect(getTodos()[0]!.text).toBe("new");
  });

  it("requires index parameter", async () => {
    const tool = createWriteTodosTool();
    const ctx = createMockContext();

    const result = await tool.execute(
      "call-id",
      { mode: "insert", todos: [{ text: "task" }] } as any,
      new AbortController().signal,
      () => {},
      ctx,
    );

    expect(result.details?.error).toBe("index required for insert");
  });

  it("rejects negative index", async () => {
    const tool = createWriteTodosTool();
    const ctx = createMockContext();

    const result = await tool.execute(
      "call-id",
      { mode: "insert", index: -1, todos: [{ text: "task" }] },
      new AbortController().signal,
      () => {},
      ctx,
    );

    expect(result.details?.error).toContain("out of range");
    if (result.content[0]!.type === "text") {
      expect(result.content[0]!.text).toContain("index -1 out of range");
    }
  });

  it("rejects index beyond length", async () => {
    const tool = createWriteTodosTool();
    const ctx = createMockContext();
    setTodos([
      { text: "task 0", status: "not_started" as const },
      { text: "task 1", status: "not_started" as const },
    ]);

    const result = await tool.execute(
      "call-id",
      { mode: "insert", index: 3, todos: [{ text: "task" }] },
      new AbortController().signal,
      () => {},
      ctx,
    );

    expect(result.details?.error).toContain("out of range");
    if (result.content[0]!.type === "text") {
      expect(result.content[0]!.text).toContain("index 3 out of range");
    }
  });

  it("rejects oversized text", async () => {
    const tool = createWriteTodosTool();
    const ctx = createMockContext();
    const longText = "a".repeat(MAX_TODO_TEXT_LENGTH + 1);

    const result = await tool.execute(
      "call-id",
      { mode: "insert", index: 0, todos: [{ text: longText }] },
      new AbortController().signal,
      () => {},
      ctx,
    );

    expect(result.details?.error).toBe("text too long");
    expect(result.details?.todos).toEqual([]);
  });

  it("rejects when inserting would exceed MAX_TODOS", async () => {
    const tool = createWriteTodosTool();
    const ctx = createMockContext();
    const existing: Array<{ text: string; status: "not_started" }> = [];
    for (let i = 0; i < MAX_TODOS - 1; i++) {
      existing.push({ text: `task ${i}`, status: "not_started" as const });
    }
    setTodos(existing);

    const result = await tool.execute(
      "call-id",
      { mode: "insert", index: 0, todos: [{ text: "one" }, { text: "two" }] },
      new AbortController().signal,
      () => {},
      ctx,
    );

    expect(result.details?.error).toBe("max todos exceeded");
    // Verify no mutation
    expect(getTodos()).toHaveLength(MAX_TODOS - 1);
  });

  it("does not change status of existing todos", async () => {
    const tool = createWriteTodosTool();
    const ctx = createMockContext();
    setTodos([
      { text: "in-progress", status: "in_progress" as const },
      { text: "completed", status: "completed" as const },
    ]);

    await tool.execute(
      "call-id",
      { mode: "insert", index: 1, todos: [{ text: "new" }] },
      new AbortController().signal,
      () => {},
      ctx,
    );

    const todos = getTodos();
    expect(todos[0]!.status).toBe("in_progress");
    expect(todos[2]!.status).toBe("completed");
  });

  it("atomic: no mutation when index invalid", async () => {
    const tool = createWriteTodosTool();
    const ctx = createMockContext();
    setTodos([{ text: "original", status: "not_started" as const }]);
    const originalSnapshot = [...getTodos()];

    await tool.execute(
      "call-id",
      { mode: "insert", index: 5, todos: [{ text: "bad" }] },
      new AbortController().signal,
      () => {},
      ctx,
    );

    expect(getTodos()).toEqual(originalSnapshot);
  });

  it("calls updateUI via context", async () => {
    const tool = createWriteTodosTool();
    const setStatus = vi.fn();
    const ctx = createMockContext();
    ctx.ui.setStatus = setStatus;

    await tool.execute(
      "call-id",
      { mode: "insert", index: 0, todos: [{ text: "task" }] },
      new AbortController().signal,
      () => {},
      ctx,
    );

    expect(setStatus).toHaveBeenCalled();
  });
});

describe("list_todos tool", () => {
  beforeEach(() => {
    resetState();
  });

  it("returns formatted todo list in content", async () => {
    const tool = createListTodosTool();
    const ctx = createMockContext();
    setTodos([
      { text: "task 1", status: "completed" as const },
      { text: "task 2", status: "in_progress" as const },
    ]);

    const result = await tool.execute("call-id", {}, new AbortController().signal, () => {}, ctx);

    expect(result.content[0]!.type).toBe("text");
    if (result.content[0]!.type === "text") {
      expect(result.content[0]!.text).toContain("task 1");
      expect(result.content[0]!.text).toContain("task 2");
    }
  });

  it("returns details with action 'list'", async () => {
    const tool = createListTodosTool();
    const ctx = createMockContext();

    const result = await tool.execute("call-id", {}, new AbortController().signal, () => {}, ctx);

    expect(result.details?.action).toBe("list");
  });

  it("does not modify state", async () => {
    const tool = createListTodosTool();
    const ctx = createMockContext();
    const originalTodos = [{ text: "task 1", status: "not_started" as const }];
    setTodos(originalTodos);

    await tool.execute("call-id", {}, new AbortController().signal, () => {}, ctx);

    expect(getTodos()).toEqual(originalTodos);
  });

  it("returns 'No todos' when state is empty", async () => {
    const tool = createListTodosTool();
    const ctx = createMockContext();

    const result = await tool.execute("call-id", {}, new AbortController().signal, () => {}, ctx);

    if (result.content[0]!.type === "text") {
      expect(result.content[0]!.text).toBe("No todos");
    }
  });
});

describe("edit_todos tool", () => {
  beforeEach(() => {
    resetState();
  });

  it("applies 'start' action to specified indices", async () => {
    const tool = createEditTodosTool();
    const ctx = createMockContext();
    setTodos([
      { text: "task 1", status: "not_started" as const },
      { text: "task 2", status: "not_started" as const },
      { text: "task 3", status: "not_started" as const },
    ]);

    const result = await tool.execute(
      "call-id",
      { action: "start", indices: [0, 2] },
      new AbortController().signal,
      () => {},
      ctx,
    );

    expect(getTodos()[0]!.status).toBe("in_progress");
    expect(getTodos()[1]!.status).toBe("not_started");
    expect(getTodos()[2]!.status).toBe("in_progress");
    expect(result.details?.action).toBe("edit");
  });

  it("applies 'complete' action to specified indices", async () => {
    const tool = createEditTodosTool();
    const ctx = createMockContext();
    setTodos([
      { text: "task 1", status: "in_progress" as const },
      { text: "task 2", status: "in_progress" as const },
    ]);

    await tool.execute(
      "call-id",
      { action: "complete", indices: [0] },
      new AbortController().signal,
      () => {},
      ctx,
    );

    expect(getTodos()[0]!.status).toBe("completed");
    expect(getTodos()[1]!.status).toBe("in_progress");
  });

  it("applies 'abandon' action to specified indices", async () => {
    const tool = createEditTodosTool();
    const ctx = createMockContext();
    setTodos([
      { text: "task 1", status: "in_progress" as const },
      { text: "task 2", status: "not_started" as const },
    ]);

    await tool.execute(
      "call-id",
      { action: "abandon", indices: [1] },
      new AbortController().signal,
      () => {},
      ctx,
    );

    expect(getTodos()[0]!.status).toBe("in_progress");
    expect(getTodos()[1]!.status).toBe("abandoned");
  });

  it("returns error when no todos exist", async () => {
    const tool = createEditTodosTool();
    const ctx = createMockContext();

    const result = await tool.execute(
      "call-id",
      { action: "start", indices: [0] },
      new AbortController().signal,
      () => {},
      ctx,
    );

    if (result.content[0]!.type === "text") {
      expect(result.content[0]!.text).toContain("Error: no todos exist");
    }
    expect(result.details?.error).toBe("no todos exist");
  });

  it("returns error when index is out of range", async () => {
    const tool = createEditTodosTool();
    const ctx = createMockContext();
    setTodos([{ text: "task 1", status: "not_started" as const }]);

    const result = await tool.execute(
      "call-id",
      { action: "start", indices: [0, 1, 2] },
      new AbortController().signal,
      () => {},
      ctx,
    );

    if (result.content[0]!.type === "text") {
      expect(result.content[0]!.text).toContain("Error");
      expect(result.content[0]!.text).toContain("indices [1, 2] out of range");
    }
    expect(result.details?.error).toContain("indices [1, 2] out of range");
  });

  it("returns error when negative index provided", async () => {
    const tool = createEditTodosTool();
    const ctx = createMockContext();
    setTodos([{ text: "task 1", status: "not_started" as const }]);

    const result = await tool.execute(
      "call-id",
      { action: "start", indices: [-1] },
      new AbortController().signal,
      () => {},
      ctx,
    );

    if (result.content[0]!.type === "text") {
      expect(result.content[0]!.text).toContain("Error");
      expect(result.content[0]!.text).toContain("indices [-1] out of range");
    }
  });

  it("returns error when indices is missing for status actions", async () => {
    const tool = createEditTodosTool();
    const ctx = createMockContext();
    setTodos([{ text: "Task 1", status: "not_started" as const }]);

    const result = await tool.execute(
      "call-id",
      { action: "start" } as any,
      new AbortController().signal,
      () => {},
      ctx,
    );

    if (result.content[0]!.type === "text") {
      expect(result.content[0]!.text).toContain("Error");
    }
    expect(result.details.error).toBeDefined();
    // Verify no mutation occurred
    expect(getTodos()[0]!.status).toBe("not_started");
  });

  it("atomic: no mutation when any index is invalid", async () => {
    const tool = createEditTodosTool();
    const ctx = createMockContext();
    setTodos([
      { text: "task 1", status: "not_started" as const },
      { text: "task 2", status: "not_started" as const },
    ]);

    const originalTodos = getTodos();
    await tool.execute(
      "call-id",
      { action: "complete", indices: [0, 5] }, // 5 is out of range
      new AbortController().signal,
      () => {},
      ctx,
    );

    expect(getTodos()).toEqual(originalTodos);
  });

  it("returns content with action label and formatted list", async () => {
    const tool = createEditTodosTool();
    const ctx = createMockContext();
    setTodos([{ text: "task 1", status: "not_started" as const }]);

    const result = await tool.execute(
      "call-id",
      { action: "start", indices: [0] },
      new AbortController().signal,
      () => {},
      ctx,
    );

    if (result.content[0]!.type === "text") {
      expect(result.content[0]!.text).toContain("Started");
      expect(result.content[0]!.text).toContain("[0]");
      expect(result.content[0]!.text).toContain("task 1");
    }
  });

  it("returns details with action 'edit' and cloned todos", async () => {
    const tool = createEditTodosTool();
    const ctx = createMockContext();
    setTodos([{ text: "task 1", status: "not_started" as const }]);

    const result = await tool.execute(
      "call-id",
      { action: "start", indices: [0] },
      new AbortController().signal,
      () => {},
      ctx,
    );

    expect(result.details?.action).toBe("edit");
    const resultTodos = result.details?.todos as Array<{ text: string; status: string }>;
    expect(resultTodos).toEqual([{ text: "task 1", status: "in_progress" }]);
    // Verify it's a clone
    if (resultTodos) {
      resultTodos[0]!.text = "modified";
      expect(getTodos()[0]!.text).toBe("task 1");
    }
  });

  it("calls updateUI via context", async () => {
    const tool = createEditTodosTool();
    const setStatus = vi.fn();
    const ctx = createMockContext();
    ctx.ui.setStatus = setStatus;
    setTodos([{ text: "task 1", status: "not_started" as const }]);

    await tool.execute(
      "call-id",
      { action: "start", indices: [0] },
      new AbortController().signal,
      () => {},
      ctx,
    );

    expect(setStatus).toHaveBeenCalled();
  });

  it("returns error when indices array is empty", async () => {
    const tool = createEditTodosTool();
    const ctx = createMockContext();
    setTodos([{ text: "task 1", status: "not_started" as const }]);
    const result = await tool.execute(
      "call-id",
      { action: "start", indices: [] },
      new AbortController().signal,
      () => {},
      ctx,
    );
    expect(result.details?.error).toBe("indices required");
    expect(getTodos()[0]!.status).toBe("not_started");
  });
});

describe("renderCall", () => {
  it("write_todos renderCall shows name and item count", () => {
    const tool = createWriteTodosTool();
    const mockTheme = createMockTheme();
    if (tool.renderCall) {
      const result = tool.renderCall(
        { mode: "replace", todos: [{ text: "task 1" }, { text: "task 2" }] },
        mockTheme,
        { expanded: false, isPartial: false } as any,
      );

      expect(result.toString()).toContain("write_todos");
      expect(result.toString()).toContain("2 items");
    }
  });

  it("list_todos renderCall shows name", () => {
    const tool = createListTodosTool();
    const mockTheme = createMockTheme();
    if (tool.renderCall) {
      const result = tool.renderCall({}, mockTheme, { expanded: false, isPartial: false } as any);

      expect(result.toString()).toContain("list_todos");
    }
  });

  it("edit_todos renderCall shows name, action, and indices", () => {
    const tool = createEditTodosTool();
    const mockTheme = createMockTheme();
    if (tool.renderCall) {
      const result = tool.renderCall({ action: "start", indices: [0, 2] }, mockTheme, {
        expanded: false,
        isPartial: false,
      } as any);

      expect(result.toString()).toContain("edit_todos");
      expect(result.toString()).toContain("start");
      expect(result.toString()).toContain("[0, 2]");
    }
  });

  it("write_todos renderCall shows append mode", () => {
    const tool = createWriteTodosTool();
    const mockTheme = createMockTheme();
    if (tool.renderCall) {
      const result = tool.renderCall(
        { mode: "append", todos: [{ text: "task 1" }, { text: "task 2" }, { text: "task 3" }] },
        mockTheme,
        { expanded: false, isPartial: false } as any,
      );

      expect(result.toString()).toContain("append");
      expect(result.toString()).toContain("3 items");
    }
  });

  it("write_todos renderCall shows insert mode with index", () => {
    const tool = createWriteTodosTool();
    const mockTheme = createMockTheme();
    if (tool.renderCall) {
      const result = tool.renderCall(
        { mode: "insert", index: 2, todos: [{ text: "task 1" }] },
        mockTheme,
        { expanded: false, isPartial: false } as any,
      );

      expect(result.toString()).toContain("insert");
      expect(result.toString()).toContain("@2");
    }
  });
});

describe("renderResult (shared via renderToolResult)", () => {
  it("renders error message for error details", () => {
    const tool = createWriteTodosTool();
    const mockTheme = createMockTheme();
    if (tool.renderResult) {
      const result = tool.renderResult(
        {
          content: [{ type: "text", text: "Error: something went wrong" }],
          details: { action: "write", todos: [], error: "something went wrong" },
        },
        { expanded: false, isPartial: false },
        mockTheme,
        {} as any,
      );

      const text = result.toString();
      expect(text).toContain("Error");
      expect(text).toContain("something went wrong");
    }
  });

  it("renders todo list for success details", () => {
    const tool = createWriteTodosTool();
    const mockTheme = createMockTheme();
    if (tool.renderResult) {
      const result = tool.renderResult(
        {
          content: [{ type: "text", text: "Wrote 1 todo item(s)" }],
          details: {
            action: "write",
            todos: [{ text: "task 1", status: "completed" as const }],
          },
        },
        { expanded: false, isPartial: false },
        mockTheme,
        {} as any,
      );

      expect(result.toString()).toContain("task 1");
    }
  });

  it("renders raw content text when no details", () => {
    const tool = createWriteTodosTool();
    const mockTheme = createMockTheme();
    if (tool.renderResult) {
      const result = tool.renderResult(
        {
          content: [{ type: "text", text: "Some raw content" }],
          details: undefined as unknown as {
            action: "write" | "list" | "edit";
            todos: Array<{
              text: string;
              status: "completed" | "not_started" | "in_progress" | "abandoned";
            }>;
            error?: string;
          },
        },
        { expanded: false, isPartial: false },
        mockTheme,
        {} as any,
      );

      expect(result.toString()).toBe("Some raw content");
    }
  });
});
