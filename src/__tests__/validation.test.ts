import { describe, it, expect } from "vitest";
import { isValidTodoItem, isIncomplete, cloneTodos, findOversizedItem } from "../validation";
import { MAX_TODO_TEXT_LENGTH } from "../types";

describe("isValidTodoItem", () => {
  it("returns true for valid TodoItem { text: 'hello', status: 'not_started' }", () => {
    const item = { text: "hello", status: "not_started" as const };
    expect(isValidTodoItem(item)).toBe(true);
  });

  it("returns true for status not_started", () => {
    const item = { text: "task", status: "not_started" as const };
    expect(isValidTodoItem(item)).toBe(true);
  });

  it("returns true for status in_progress", () => {
    const item = { text: "task", status: "in_progress" as const };
    expect(isValidTodoItem(item)).toBe(true);
  });

  it("returns true for status completed", () => {
    const item = { text: "task", status: "completed" as const };
    expect(isValidTodoItem(item)).toBe(true);
  });

  it("returns true for status abandoned", () => {
    const item = { text: "task", status: "abandoned" as const };
    expect(isValidTodoItem(item)).toBe(true);
  });

  it("returns false for null", () => {
    expect(isValidTodoItem(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isValidTodoItem(undefined)).toBe(false);
  });

  it("returns false for string", () => {
    expect(isValidTodoItem("not an object")).toBe(false);
  });

  it("returns false for number", () => {
    expect(isValidTodoItem(123)).toBe(false);
  });

  it("returns false for array", () => {
    expect(isValidTodoItem([{ text: "x", status: "not_started" }])).toBe(false);
  });

  it("returns false for object with extra property { text, status, extra }", () => {
    const item = { text: "task", status: "not_started", extra: true };
    expect(isValidTodoItem(item)).toBe(false);
  });

  it("returns false for object missing 'status' key { text: 'x' }", () => {
    const item = { text: "x" } as unknown;
    expect(isValidTodoItem(item)).toBe(false);
  });

  it("returns false for object missing 'text' key { status: 'not_started' }", () => {
    const item = { status: "not_started" } as unknown;
    expect(isValidTodoItem(item)).toBe(false);
  });

  it("returns false for non-string text (text: 123)", () => {
    const item = { text: 123, status: "not_started" } as unknown;
    expect(isValidTodoItem(item)).toBe(false);
  });

  it("returns false for non-string status (status: 123)", () => {
    const item = { text: "task", status: 123 } as unknown;
    expect(isValidTodoItem(item)).toBe(false);
  });

  it("returns false for invalid status 'unknown'", () => {
    const item = { text: "task", status: "unknown" as const };
    expect(isValidTodoItem(item)).toBe(false);
  });

  it("returns false for empty text string ''", () => {
    const item = { text: "", status: "not_started" as const };
    expect(isValidTodoItem(item)).toBe(false);
  });

  it("returns false for text exceeding MAX_TODO_TEXT_LENGTH (1001 chars)", () => {
    const item = {
      text: "a".repeat(MAX_TODO_TEXT_LENGTH + 1),
      status: "not_started" as const,
    };
    expect(isValidTodoItem(item)).toBe(false);
  });

  it("returns true for text at exactly MAX_TODO_TEXT_LENGTH (1000 chars)", () => {
    const item = {
      text: "a".repeat(MAX_TODO_TEXT_LENGTH),
      status: "not_started" as const,
    };
    expect(isValidTodoItem(item)).toBe(true);
  });

  it("returns false for object with only 1 key", () => {
    const item = { text: "task" } as unknown;
    expect(isValidTodoItem(item)).toBe(false);
  });

  it("returns false for object with 3 keys", () => {
    const item = { text: "task", status: "not_started", extra: "extra" } as unknown;
    expect(isValidTodoItem(item)).toBe(false);
  });
});

describe("isIncomplete", () => {
  it("returns true for 'not_started'", () => {
    expect(isIncomplete("not_started")).toBe(true);
  });

  it("returns true for 'in_progress'", () => {
    expect(isIncomplete("in_progress")).toBe(true);
  });

  it("returns false for 'completed'", () => {
    expect(isIncomplete("completed")).toBe(false);
  });

  it("returns false for 'abandoned'", () => {
    expect(isIncomplete("abandoned")).toBe(false);
  });
});

describe("cloneTodos", () => {
  it("returns a new array with same-length and same values", () => {
    const original = [
      { text: "task1", status: "not_started" as const },
      { text: "task2", status: "in_progress" as const },
    ];
    const cloned = cloneTodos(original);

    expect(cloned).not.toBe(original);
    expect(cloned).toHaveLength(original.length);
    expect(cloned).toEqual(original);
  });

  it("returned items are different object references (deep copy)", () => {
    const original = [{ text: "task1", status: "not_started" as const }];
    const cloned = cloneTodos(original);

    expect(cloned[0]!).not.toBe(original[0]!);
    expect(cloned[0]!.text).toBe(original[0]!.text);
    expect(cloned[0]!.status).toBe(original[0]!.status);
  });

  it("mutation of clone does not affect original", () => {
    const original = [{ text: "task1", status: "not_started" as const }];
    const cloned = cloneTodos(original);

    cloned[0]!.text = "modified";
    cloned[0]!.status = "completed";

    expect(original[0]!.text).toBe("task1");
    expect(original[0]!.status).toBe("not_started");
  });

  it("returns empty array for empty input", () => {
    const cloned = cloneTodos([]);
    expect(cloned).toEqual([]);
    expect(cloned).not.toBe([]);
  });

  it("handles multiple items correctly", () => {
    const original = [
      { text: "task1", status: "not_started" as const },
      { text: "task2", status: "in_progress" as const },
      { text: "task3", status: "completed" as const },
      { text: "task4", status: "abandoned" as const },
    ];
    const cloned = cloneTodos(original);

    expect(cloned).toHaveLength(4);
    expect(cloned).toEqual(original);
    for (let i = 0; i < original.length; i++) {
      expect(cloned[i]).not.toBe(original[i]);
    }
  });
});

describe("findOversizedItem", () => {
  it("returns -1 when all items are within limit", () => {
    const items = [
      { text: "short", status: "not_started" },
      { text: "medium", status: "in_progress" },
      { text: "longer text", status: "completed" },
    ];

    const result = findOversizedItem(items, 1000);
    expect(result).toBe(-1);
  });

  it("returns 0 for first oversized item", () => {
    const items = [
      { text: "a".repeat(1001), status: "not_started" },
      { text: "short", status: "in_progress" },
    ];

    const result = findOversizedItem(items, 1000);
    expect(result).toBe(0);
  });

  it("returns correct index for middle oversized item", () => {
    const items = [
      { text: "short", status: "not_started" },
      { text: "a".repeat(1001), status: "in_progress" },
      { text: "medium", status: "completed" },
    ];

    const result = findOversizedItem(items, 1000);
    expect(result).toBe(1);
  });

  it("returns last index for only-last oversized item", () => {
    const items = [
      { text: "short", status: "not_started" },
      { text: "medium", status: "in_progress" },
      { text: "a".repeat(1001), status: "completed" },
    ];

    const result = findOversizedItem(items, 1000);
    expect(result).toBe(2);
  });

  it("returns correct index when multiple items are oversized", () => {
    const items = [
      { text: "a".repeat(1001), status: "not_started" },
      { text: "a".repeat(1001), status: "in_progress" },
      { text: "a".repeat(1001), status: "completed" },
    ];

    const result = findOversizedItem(items, 1000);
    expect(result).toBe(0);
  });

  it("handles empty array", () => {
    const result = findOversizedItem([], 1000);
    expect(result).toBe(-1);
  });

  it("respects custom maxLength parameter", () => {
    const items = [
      { text: "123456", status: "not_started" },
      { text: "123", status: "in_progress" },
    ];

    const result = findOversizedItem(items, 5);
    expect(result).toBe(0);
  });

  it("returns -1 when all items are exactly at limit", () => {
    const items = [
      { text: "a".repeat(10), status: "not_started" },
      { text: "b".repeat(10), status: "in_progress" },
    ];

    const result = findOversizedItem(items, 10);
    expect(result).toBe(-1);
  });
});
