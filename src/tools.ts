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
import { getTodos, setTodos, appendTodos, insertTodos, updateTodoStatus, updateUI } from "./state";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

// ── Schemas ──

const WriteTodosParams = Type.Object({
  mode: StringEnum(["replace", "append", "insert"] as const, {
    description: "Mode: 'replace' clears and replaces the entire list, 'append' adds to the end, 'insert' inserts at a specific index",
  }),
  index: Type.Optional(
    Type.Integer({
      description: "0-based index to insert at (required for 'insert' mode)",
    }),
  ),
  todos: Type.Array(
    Type.Object({
      text: Type.String({ description: "Description of the task", maxLength: 1000 }),
    }),
    { description: "Ordered list of todo items", maxItems: 100 },
  ),
});

const ListTodosParams = Type.Object({});

const EditTodosParams = Type.Object({
  action: StringEnum(["start", "complete", "abandon"] as const, {
    description: "Action to apply to the todo items",
  }),
  indices: Type.Array(Type.Integer(), {
    description: "0-based indices to apply the action to",
    minItems: 1,
    maxItems: 50,
  }),
});

// ── Tool Factories ──

export function createWriteTodosTool(): ToolDefinition<typeof WriteTodosParams, TodoDetails> {
  return {
    name: "write_todos",
    label: "Write Todos",
    description:
      "Manage a todo list with modes: 'replace' clears and replaces the entire list, 'append' adds items to the end without changing existing item statuses, 'insert' inserts items at a specific index without changing existing item statuses. Each new item starts as 'not_started'.",
    parameters: WriteTodosParams,
    promptSnippet: "Manage a todo list: write (replace/append/insert), list, edit (start/complete/abandon by indices)",
    promptGuidelines: [
      "Use write_todos with mode 'replace' to create or replace the full todo list at the start of a task.",
      "Use write_todos with mode 'append' to add new items to the end of the existing list.",
      "Use write_todos with mode 'insert' and an 'index' parameter to insert items at a specific position.",
      "Use edit_todos with action 'start' and an array of 0-based indices to begin work on specific items.",
      "Use edit_todos with action 'complete' and an array of 0-based indices to mark items as done.",
      "Use edit_todos with action 'abandon' and an array of 0-based indices when items are no longer needed.",
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

      const currentTodos = getTodos();

      if (params.mode === "replace") {
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
      }

      if (params.mode === "append") {
        // Check total count
        if (currentTodos.length + params.todos.length > MAX_TODOS) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: appending ${params.todos.length} item(s) would exceed maximum of ${MAX_TODOS} todos (currently ${currentTodos.length})`,
              },
            ],
            details: {
              action: "write" as const,
              todos: [],
              error: "max todos exceeded",
            },
          };
        }

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
              text: `Appended ${newItems.length} item(s)\n\n${formatTodoListText(getTodos())}`,
            },
          ],
          details: { action: "write" as const, todos: cloneTodos(getTodos()) },
        };
      }

      if (params.mode === "insert") {
        // Validate index parameter
        if (params.index === undefined || params.index === null) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: 'index' is required for the 'insert' mode",
              },
            ],
            details: {
              action: "write" as const,
              todos: [],
              error: "index required for insert",
            },
          };
        }

        // Validate index range (0 to length inclusive)
        if (params.index < 0 || params.index > currentTodos.length) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: index ${params.index} out of range (0 to ${currentTodos.length})`,
              },
            ],
            details: {
              action: "write" as const,
              todos: [],
              error: `index ${params.index} out of range (0 to ${currentTodos.length})`,
            },
          };
        }

        // Check total count
        if (currentTodos.length + params.todos.length > MAX_TODOS) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: inserting ${params.todos.length} item(s) would exceed maximum of ${MAX_TODOS} todos (currently ${currentTodos.length})`,
              },
            ],
            details: {
              action: "write" as const,
              todos: [],
              error: "max todos exceeded",
            },
          };
        }

        const newItems: TodoItem[] = params.todos.map((t) => ({
          text: t.text,
          status: INITIAL_STATUS as TodoStatus,
        }));

        insertTodos(params.index, newItems);
        updateUI(ctx, getTodos());

        return {
          content: [
            {
              type: "text" as const,
              text: `Inserted ${newItems.length} item(s) at index ${params.index}\n\n${formatTodoListText(getTodos())}`,
            },
          ],
          details: { action: "write" as const, todos: cloneTodos(getTodos()) },
        };
      }

      // Should be unreachable due to schema validation, but just in case
      return {
        content: [{ type: "text" as const, text: `Error: unknown mode '${params.mode}'` }],
        details: { action: "write" as const, todos: [], error: `unknown mode '${params.mode}'` },
      };
    },

    renderCall(args, theme) {
      const modeLabel = args.mode ?? "replace";
      const count = args.todos?.length ?? 0;
      let extra = "";
      if (modeLabel === "insert" && args.index !== undefined) {
        extra = ` @${args.index}`;
      }
      return new Text(
        theme.fg("toolTitle", theme.bold("write_todos ")) +
          theme.fg("warning", `${modeLabel} `) +
          theme.fg("muted", `(${count} items${extra})`),
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
      "Apply an action ('start', 'complete', or 'abandon') to todo items by 0-based index. Batch operations are atomic — if any index is invalid, no changes are applied.",
    parameters: EditTodosParams,

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
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
    },

    renderCall(args, theme) {
      const indices = `[${(args.indices ?? []).join(", ")}]`;
      return new Text(
        theme.fg("toolTitle", theme.bold("edit_todos ")) +
          theme.fg("warning", `${args.action} `) +
          theme.fg("accent", indices),
        0,
        0,
      );
    },

    renderResult: renderToolResult,
  };
}
