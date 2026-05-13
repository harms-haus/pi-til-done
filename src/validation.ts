import type { TodoItem, TodoStatus } from "./types";
import { VALID_STATUSES, MAX_TODO_TEXT_LENGTH } from "./types";

/**
 * Type guard: validates that `t` is a well-formed TodoItem.
 *
 * Rejects:
 * - Non-objects or null
 * - Objects without exactly `text` (string) and `status` (valid TodoStatus)
 * - Objects with extra properties
 * - Text exceeding MAX_TODO_TEXT_LENGTH
 * - Empty text
 */
export function isValidTodoItem(t: unknown): t is TodoItem {
  if (typeof t !== "object" || t === null) return false;
  const keys = Object.keys(t);
  if (keys.length !== 2) return false;
  const obj = t as Record<string, unknown>;
  if (typeof obj.text !== "string") return false;
  if (typeof obj.status !== "string") return false;
  if (!VALID_STATUSES.has(obj.status)) return false;
  if (obj.text.length === 0) return false;
  if (obj.text.length > MAX_TODO_TEXT_LENGTH) return false;
  return true;
}

/** Returns true if the status represents an incomplete (actionable) item */
export function isIncomplete(status: TodoStatus): boolean {
  return status === "not_started" || status === "in_progress";
}

/** Creates a deep copy of a todo array */
export function cloneTodos(todos: readonly TodoItem[]): TodoItem[] {
  return todos.map((t) => ({ text: t.text, status: t.status }));
}

/**
 * Validates text length for write_todos input.
 * Returns the index of the first oversized item, or -1 if all valid.
 */
export function findOversizedItem(items: readonly { text: string }[], maxLength: number): number {
  return items.findIndex((t) => t.text.length > maxLength);
}
