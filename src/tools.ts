import { StringEnum } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import type { TodoItem, TodoStatus, TodoDetails } from "./types";
import {
  ACTION_TO_STATUS,
  ACTION_LABELS,
  INITIAL_STATUS,
  MAX_TODO_TEXT_LENGTH,
  MAX_TODOS,
} from "./types";
import { cloneTodos, findOversizedItem } from "./validation";
import { formatTodoListText, renderToolResult } from "./formatting";
import { getTodos, setTodos, appendTodos, updateTodoStatus, updateUI } from "./state";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

// ── Schemas ──

const WriteTodosParams = Type.Object({
  todos: Type.Array(
    Type.Object({
      text: Type.String({ description: "Description of the task", maxLength: 1000 }),
    }),
    { description: "Ordered list of todo items to write", maxItems: 100 },
  ),
});

const ListTodosParams = Type.Object({});

const EditTodosParams = Type.Object({
  action: StringEnum(["start", "complete", "abandon", "add"] as const, {
    description: "Action to apply to the todo items",
  }),
  indices: Type.Optional(
    Type.Array(Type.Integer(), {
      description: "0-based indices to apply the action to (required for start/complete/abandon)",
      minItems: 1,
      maxItems: 50,
    }),
  ),
  todos: Type.Optional(
    Type.Array(
      Type.Object({
        text: Type.String({ description: "Description of the task", maxLength: 1000 }),
      }),
      { description: "Todo items to add (required for 'add' action)", maxItems: 50 },
    ),
  ),
});

// ── Tool Factories ──

export function createWriteTodosTool(): ToolDefinition<typeof WriteTodosParams, TodoDetails> {
  return {
    name: "write_todos",
    label: "Write Todos",
    description:
      "Write a full list of todo items, replacing any existing list. Each item starts as 'not_started'. Use this to create or replace the entire plan.",
    parameters: WriteTodosParams,
    promptSnippet: "Manage a todo list: write, list, edit (start/complete/abandon by indices)",
    promptGuidelines: [
      "Use write_todos to create or replace the full todo list at the start of a task.",
      "Use edit_todos with action 'start' and an array of 0-based indices to begin work on specific items.",
      "Use edit_todos with action 'complete' and an array of 0-based indices to mark items as done.",
      "Use edit_todos with action 'abandon' and an array of 0-based indices when items are no longer needed.",
      "Use edit_todos with action 'add' and a 'todos' array to append new items to the existing list.",
      "Use list_todos to review the current todo list.",
      "Always call edit_todos with action 'start' on the next item before working on it, then 'complete' when done.",
    ],

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      // Defense-in-depth text length check
      const oversizedIdx = findOversizedItem(params.todos, MAX_TODO_TEXT_LENGTH);
      if (oversizedIdx !== -1) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: todo item at index ${oversizedIdx} exceeds maximum text length (${MAX_TODO_TEXT_LENGTH} characters)`,
            },
          ],
          details: {
            action: "write" as const,
            todos: [],
            error: "text too long",
          },
        };
      }

      const newTodos = params.todos.map((t) => ({
        text: t.text,
        status: INITIAL_STATUS as TodoStatus,
      }));
      setTodos(newTodos);
      updateUI(ctx, getTodos());

      return {
        content: [
          {
            type: "text" as const,
            text: `Wrote ${newTodos.length} todo item(s)\n\n${formatTodoListText(getTodos())}`,
          },
        ],
        details: { action: "write" as const, todos: cloneTodos(getTodos()) },
      };
    },

    renderCall(args, theme) {
      return new Text(
        theme.fg("toolTitle", theme.bold("write_todos ")) +
          theme.fg("muted", `(${args.todos.length} items)`),
        0,
        0,
      );
    },

    renderResult: renderToolResult,
  };
}

export function createListTodosTool(): ToolDefinition<typeof ListTodosParams, TodoDetails> {
  return {
    name: "list_todos",
    label: "List Todos",
    description: "List all todos with their current status and 0-based indices.",
    parameters: ListTodosParams,

    async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
      return {
        content: [{ type: "text" as const, text: formatTodoListText(getTodos()) }],
        details: { action: "list" as const, todos: [] },
      };
    },

    renderCall(_args, theme) {
      return new Text(theme.fg("toolTitle", theme.bold("list_todos")), 0, 0);
    },

    renderResult: renderToolResult,
  };
}

export function createEditTodosTool(): ToolDefinition<typeof EditTodosParams, TodoDetails> {
  return {
    name: "edit_todos",
    label: "Edit Todos",
    description:
      "Apply an action ('start', 'complete', 'abandon', or 'add') to todo items. Use 'add' to append new items. For start/complete/abandon, provide 0-based indices. Batch operations are atomic — if any index is invalid, no changes are applied.",
    parameters: EditTodosParams,

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (params.action === "add") {
        // Validate todos parameter
        if (!params.todos || params.todos.length === 0) {
          return {
            content: [
              { type: "text" as const, text: "Error: 'todos' is required for the 'add' action" },
            ],
            details: { action: "edit" as const, todos: [], error: "todos required for add" },
          };
        }

        // Defense-in-depth: check text lengths
        const oversizedIdx = findOversizedItem(params.todos, MAX_TODO_TEXT_LENGTH);
        if (oversizedIdx !== -1) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: todo item at index ${oversizedIdx} exceeds maximum text length (${MAX_TODO_TEXT_LENGTH} characters)`,
              },
            ],
            details: {
              action: "edit" as const,
              todos: [],
              error: "text too long",
            },
          };
        }

        // Check total count
        const currentTodos = getTodos();
        if (currentTodos.length + params.todos.length > MAX_TODOS) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: adding ${params.todos.length} item(s) would exceed maximum of ${MAX_TODOS} todos (currently ${currentTodos.length})`,
              },
            ],
            details: {
              action: "edit" as const,
              todos: [],
              error: "max todos exceeded",
            },
          };
        }

        // Map to TodoItem[] with INITIAL_STATUS
        const newItems: TodoItem[] = params.todos.map((t) => ({
          text: t.text,
          status: INITIAL_STATUS as TodoStatus,
        }));

        appendTodos(newItems);
        updateUI(ctx, getTodos());

        return {
          content: [
            {
              type: "text" as const,
              text: `Added ${params.todos.length} item(s):\n\n${formatTodoListText(getTodos())}`,
            },
          ],
          details: { action: "edit" as const, todos: cloneTodos(getTodos()) },
        };
      } else {
        // Validate indices parameter
        if (!params.indices || params.indices.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: 'indices' is required for start/complete/abandon actions",
              },
            ],
            details: { action: "edit" as const, todos: [], error: "indices required" },
          };
        }

        const currentTodos = getTodos();

        if (currentTodos.length === 0) {
          return {
            content: [{ type: "text" as const, text: "Error: no todos exist" }],
            details: { action: "edit" as const, todos: [], error: "no todos exist" },
          };
        }

        // Validate all indices atomically
        const invalid = params.indices.filter((i) => i < 0 || i >= currentTodos.length);
        if (invalid.length > 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: indices [${invalid.join(", ")}] out of range (0 to ${currentTodos.length - 1})`,
              },
            ],
            details: {
              action: "edit" as const,
              todos: [],
              error: `indices [${invalid.join(", ")}] out of range (0 to ${currentTodos.length - 1})`,
            },
          };
        }

        // Apply action
        const newStatus = ACTION_TO_STATUS[params.action];
        updateTodoStatus(params.indices, newStatus);
        updateUI(ctx, getTodos());

        const actionLabel = ACTION_LABELS[params.action];

        return {
          content: [
            {
              type: "text" as const,
              text: `${actionLabel} [${params.indices.join(", ")}]\n\n${formatTodoListText(getTodos())}`,
            },
          ],
          details: { action: "edit" as const, todos: cloneTodos(getTodos()) },
        };
      }
    },

    renderCall(args, theme) {
      if (args.action === "add") {
        const todos = args.todos ?? [];
        const MAX_PREVIEW_ITEMS = 3;
        const MAX_TEXT_LEN = 40;
        const previews = todos
          .slice(0, MAX_PREVIEW_ITEMS)
          .map((t) =>
            t.text.length > MAX_TEXT_LEN ? t.text.slice(0, MAX_TEXT_LEN) + "…" : t.text,
          );
        let previewText = previews.join(", ");
        const remaining = todos.length - MAX_PREVIEW_ITEMS;
        if (remaining > 0) {
          previewText = `${previewText}… (+${remaining} more)`;
        }
        return new Text(
          theme.fg("toolTitle", theme.bold("edit_todos ")) +
            theme.fg("warning", "add ") +
            theme.fg("accent", previewText),
          0,
          0,
        );
      } else {
        const indices = `[${(args.indices ?? []).join(", ")}]`;
        return new Text(
          theme.fg("toolTitle", theme.bold("edit_todos ")) +
            theme.fg("warning", `${args.action} `) +
            theme.fg("accent", indices),
          0,
          0,
        );
      }
    },

    renderResult: renderToolResult,
  };
}
