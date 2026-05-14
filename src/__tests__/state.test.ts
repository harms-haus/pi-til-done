import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getTodos,
  setTodos,
  updateTodoStatus,
  incrementAutoContinue,
  resetAutoContinue,
  resetState,
  appendTodos,
  reconstructState,
  updateUI,
} from "../state";
import type { TodoItem } from "../types";
import { createMockContext } from "./helpers/mocks";

describe("state management", () => {
  beforeEach(() => {
    resetState();
  });

  describe("getTodos / setTodos", () => {
    it("getTodos returns empty array initially", () => {
      expect(getTodos()).toEqual([]);
    });

    it("setTodos replaces todos and getTodos returns them", () => {
      const newTodos: TodoItem[] = [
        { text: "task 1", status: "not_started" },
        { text: "task 2", status: "completed" },
      ];
      setTodos(newTodos);
      expect(getTodos()).toEqual(newTodos);
    });

    it("setTodos resets autoContinueCount to 0", () => {
      incrementAutoContinue();
      incrementAutoContinue();
      expect(incrementAutoContinue()).toBe(3);
      setTodos([]);
      expect(incrementAutoContinue()).toBe(1); // Should be 1 after incrementing (counter was reset to 0)
    });
  });

  describe("updateTodoStatus", () => {
    it("updates status of specified indices", () => {
      const todos: TodoItem[] = [
        { text: "task 1", status: "not_started" },
        { text: "task 2", status: "not_started" },
        { text: "task 3", status: "not_started" },
      ];
      setTodos(todos);
      updateTodoStatus([0, 2], "completed");
      expect(getTodos()[0].status).toBe("completed");
      expect(getTodos()[1].status).toBe("not_started");
      expect(getTodos()[2].status).toBe("completed");
    });

    it("does not affect other indices", () => {
      const todos: TodoItem[] = [
        { text: "task 1", status: "not_started" },
        { text: "task 2", status: "not_started" },
        { text: "task 3", status: "not_started" },
      ];
      setTodos(todos);
      updateTodoStatus([1], "in_progress");
      expect(getTodos()[0].status).toBe("not_started");
      expect(getTodos()[1].status).toBe("in_progress");
      expect(getTodos()[2].status).toBe("not_started");
    });

    it("resets autoContinueCount to 0", () => {
      const todos: TodoItem[] = [{ text: "task 1", status: "not_started" }];
      setTodos(todos);
      incrementAutoContinue();
      incrementAutoContinue();
      expect(incrementAutoContinue()).toBe(3);
      updateTodoStatus([0], "completed");
      expect(incrementAutoContinue()).toBe(1); // Counter reset to 0
    });
  });

  describe("incrementAutoContinue", () => {
    it("increments from 0 to 1, returns 1", () => {
      expect(incrementAutoContinue()).toBe(1);
    });

    it("increments from 1 to 2, returns 2", () => {
      incrementAutoContinue();
      expect(incrementAutoContinue()).toBe(2);
    });

    it("accumulates across calls", () => {
      expect(incrementAutoContinue()).toBe(1);
      expect(incrementAutoContinue()).toBe(2);
      expect(incrementAutoContinue()).toBe(3);
      expect(incrementAutoContinue()).toBe(4);
    });
  });

  describe("resetAutoContinue", () => {
    it("resets counter to 0", () => {
      incrementAutoContinue();
      incrementAutoContinue();
      incrementAutoContinue();
      expect(incrementAutoContinue()).toBe(4);
      resetAutoContinue();
      expect(incrementAutoContinue()).toBe(1);
    });
  });

  describe("appendTodos", () => {
    it("appends to empty list", () => {
      expect(getTodos()).toEqual([]);
      appendTodos([{ text: "new task", status: "not_started" }]);
      expect(getTodos()).toEqual([{ text: "new task", status: "not_started" }]);
    });

    it("appends to existing list", () => {
      setTodos([
        { text: "task 1", status: "not_started" },
        { text: "task 2", status: "completed" },
      ]);
      appendTodos([{ text: "task 3", status: "in_progress" }]);
      expect(getTodos()).toEqual([
        { text: "task 1", status: "not_started" },
        { text: "task 2", status: "completed" },
        { text: "task 3", status: "in_progress" },
      ]);
    });

    it("resets autoContinueCount", () => {
      incrementAutoContinue();
      incrementAutoContinue();
      expect(incrementAutoContinue()).toBe(3);
      appendTodos([{ text: "appended", status: "not_started" }]);
      expect(incrementAutoContinue()).toBe(1); // Counter was reset to 0
    });

    it("mutation isolation", () => {
      const input: TodoItem[] = [{ text: "task", status: "not_started" }];
      appendTodos(input);
      // Mutate the input array after appending
      input.push({ text: "extra", status: "not_started" });
      // State should be unaffected
      expect(getTodos()).toEqual([{ text: "task", status: "not_started" }]);
    });

    it("multiple items appended", () => {
      setTodos([{ text: "existing", status: "not_started" }]);
      appendTodos([
        { text: "new 1", status: "not_started" },
        { text: "new 2", status: "in_progress" },
        { text: "new 3", status: "completed" },
      ]);
      expect(getTodos()).toEqual([
        { text: "existing", status: "not_started" },
        { text: "new 1", status: "not_started" },
        { text: "new 2", status: "in_progress" },
        { text: "new 3", status: "completed" },
      ]);
    });
  });
});

describe("reconstructState", () => {
  beforeEach(() => {
    resetState();
  });

  it("returns empty array for empty branch", () => {
    const ctx = createMockContext([]);
    const result = reconstructState(ctx);
    expect(result).toEqual([]);
  });

  it("returns empty array when no matching tool results exist", () => {
    const ctx = createMockContext([
      {
        type: "message",
        message: {
          role: "toolResult",
          toolName: "other_tool",
          details: { todos: [{ text: "task", status: "not_started" }] },
        },
      },
    ]);
    const result = reconstructState(ctx);
    expect(result).toEqual([]);
  });

  it("finds last matching tool result (reverse scan)", () => {
    const ctx = createMockContext([
      {
        type: "message",
        message: {
          role: "toolResult",
          toolName: "write_todos",
          details: {
            todos: [
              { text: "task 1", status: "completed" },
              { text: "task 2", status: "not_started" },
            ],
          },
        },
      },
      {
        type: "message",
        message: {
          role: "toolResult",
          toolName: "edit_todos",
          details: {
            todos: [
              { text: "task 1", status: "completed" },
              { text: "task 2", status: "completed" },
            ],
          },
        },
      },
    ]);
    const result = reconstructState(ctx);
    expect(result).toEqual([
      { text: "task 1", status: "completed" },
      { text: "task 2", status: "completed" },
    ]);
  });

  it("skips earlier results when later exists", () => {
    const ctx = createMockContext([
      {
        type: "message",
        message: {
          role: "toolResult",
          toolName: "write_todos",
          details: {
            todos: [{ text: "old task", status: "completed" }],
          },
        },
      },
      {
        type: "message",
        message: {
          role: "toolResult",
          toolName: "edit_todos",
          details: {
            todos: [{ text: "new task", status: "in_progress" }],
          },
        },
      },
    ]);
    const result = reconstructState(ctx);
    expect(result).toEqual([{ text: "new task", status: "in_progress" }]);
  });

  it("filters out invalid todo items", () => {
    const ctx = createMockContext([
      {
        type: "message",
        message: {
          role: "toolResult",
          toolName: "write_todos",
          details: {
            todos: [
              { text: "valid task", status: "not_started" },
              { text: "", status: "not_started" }, // Empty text
              { text: "another valid", status: "completed" },
              { text: "invalid status", status: "unknown" }, // Invalid status
            ],
          },
        },
      },
    ]);
    const result = reconstructState(ctx);
    expect(result).toEqual([
      { text: "valid task", status: "not_started" },
      { text: "another valid", status: "completed" },
    ]);
  });

  it("filters out items with extra properties", () => {
    const ctx = createMockContext([
      {
        type: "message",
        message: {
          role: "toolResult",
          toolName: "write_todos",
          details: {
            todos: [
              {
                text: "valid task",
                status: "not_started",
              },
              {
                text: "invalid task",
                status: "not_started",
                extra: "property", // Extra property makes this invalid
              } as unknown,
            ],
          },
        },
      },
    ]);
    const result = reconstructState(ctx);
    expect(result).toEqual([{ text: "valid task", status: "not_started" }]);
  });

  it("returns deep copies (not original references)", () => {
    const originalTodos = [{ text: "task", status: "not_started" }];
    const ctx = createMockContext([
      {
        type: "message",
        message: {
          role: "toolResult",
          toolName: "write_todos",
          details: { todos: originalTodos },
        },
      },
    ]);
    const result = reconstructState(ctx);
    result[0].text = "modified";
    expect(originalTodos[0].text).toBe("task");
  });

  it("skips results with empty todos array (from list_todos or error paths)", () => {
    const ctx = createMockContext([
      {
        type: "message",
        message: {
          role: "toolResult",
          toolName: "write_todos",
          details: {
            todos: [{ text: "task", status: "not_started" }],
          },
        },
      },
      {
        type: "message",
        message: {
          role: "toolResult",
          toolName: "list_todos",
          details: { todos: [] },
        },
      },
    ]);
    const result = reconstructState(ctx);
    expect(result).toEqual([{ text: "task", status: "not_started" }]);
  });
});

describe("updateUI", () => {
  it("clears both status keys when todos is empty", () => {
    const setStatus = vi.fn();
    const ctx = createMockContext([]);
    ctx.ui.setStatus = setStatus;
    updateUI(ctx, []);
    expect(setStatus).toHaveBeenCalledWith("til-done", undefined);
    expect(setStatus).toHaveBeenCalledWith("til-done-active", undefined);
  });

  it("shows progress counter 📋 X/Y when some completed", () => {
    const setStatus = vi.fn();
    const ctx = createMockContext([]);
    ctx.ui.setStatus = setStatus;
    const todos: TodoItem[] = [
      { text: "task 1", status: "completed" },
      { text: "task 2", status: "not_started" },
      { text: "task 3", status: "in_progress" },
    ];
    updateUI(ctx, todos);
    expect(setStatus).toHaveBeenCalledWith("til-done", "📋 1/3");
  });

  it("shows '✓ Done (N items)' when all completed", () => {
    const setStatus = vi.fn();
    const ctx = createMockContext([]);
    ctx.ui.setStatus = setStatus;
    const todos: TodoItem[] = [
      { text: "task 1", status: "completed" },
      { text: "task 2", status: "completed" },
      { text: "task 3", status: "completed" },
    ];
    updateUI(ctx, todos);
    expect(setStatus).toHaveBeenCalledWith("til-done", "✓ Done (3 items)");
    expect(setStatus).toHaveBeenCalledWith("til-done-active", undefined);
  });

  it("shows active items for in-progress items", () => {
    const setStatus = vi.fn();
    const ctx = createMockContext([]);
    ctx.ui.setStatus = setStatus;
    const todos: TodoItem[] = [
      { text: "task 1", status: "not_started" },
      { text: "task 2", status: "in_progress" },
      { text: "task 3", status: "in_progress" },
    ];
    updateUI(ctx, todos);
    expect(setStatus).toHaveBeenCalledWith("til-done-active", "[1] task 2\n[2] task 3");
  });

  it("clears active items when none are in-progress", () => {
    const setStatus = vi.fn();
    const ctx = createMockContext([]);
    ctx.ui.setStatus = setStatus;
    const todos: TodoItem[] = [
      { text: "task 1", status: "completed" },
      { text: "task 2", status: "not_started" },
    ];
    updateUI(ctx, todos);
    expect(setStatus).toHaveBeenCalledWith("til-done-active", undefined);
  });

  it("does nothing when hasUI is false", () => {
    const setStatus = vi.fn();
    const ctx = createMockContext([]);
    ctx.hasUI = false;
    ctx.ui.setStatus = setStatus;
    const todos: TodoItem[] = [{ text: "task 1", status: "not_started" }];
    updateUI(ctx, todos);
    expect(setStatus).not.toHaveBeenCalled();
  });

  it("single-pass: completed count and active lines computed correctly together", () => {
    const setStatus = vi.fn();
    const ctx = createMockContext([]);
    ctx.ui.setStatus = setStatus;
    const todos: TodoItem[] = [
      { text: "task 1", status: "completed" },
      { text: "task 2", status: "in_progress" },
      { text: "task 3", status: "completed" },
      { text: "task 4", status: "not_started" },
      { text: "task 5", status: "in_progress" },
    ];
    updateUI(ctx, todos);
    expect(setStatus).toHaveBeenCalledWith("til-done", "📋 2/5");
    expect(setStatus).toHaveBeenCalledWith("til-done-active", "[1] task 2\n[4] task 5");
  });
});
