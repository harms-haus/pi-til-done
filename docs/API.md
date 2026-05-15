# API Reference — pi-til-done

Complete reference of every exported function, type, interface, and constant in the `pi-til-done` extension.

> **Related**: [ARCHITECTURE.md](ARCHITECTURE.md) — system design and data flows  
> **Related**: [TOOLS.md](TOOLS.md) — tool descriptions and usage examples

---

## Table of Contents

1. [Types & Interfaces](#1-types--interfaces)
2. [Constants](#2-constants)
3. [Lookup Maps](#3-lookup-maps)
4. [State Module (`state.ts`)](#4-state-module-statets)
5. [Validation Module (`validation.ts`)](#5-validation-module-validationts)
6. [Formatting Module (`formatting.ts`)](#6-formatting-module-formattingts)
7. [Events Module (`events.ts`)](#7-events-module-eventsts)
8. [Tools Module (`tools.ts`)](#8-tools-module-toolsts)
9. [Entry Point (`index.ts`)](#9-entry-point-indexts)

---

## 1. Types & Interfaces

Source: [`src/types.ts`](../src/types.ts)

### `TodoStatus`

```ts
type TodoStatus = "not_started" | "in_progress" | "completed" | "abandoned";
```

Four-state lifecycle for a todo item. Each status maps to a distinct icon (see [Lookup Maps](#3-lookup-maps)) and determines whether the item is considered "incomplete" (see [`isIncomplete`](#isincomplete) in validation).

### `TodoItem`

```ts
interface TodoItem {
  text: string;
  status: TodoStatus;
}
```

A single todo entry. Items are ordered and identified by their **0-based index** in the array. The `text` field is validated at creation and state-reconstruction time: must be non-empty and ≤ 1000 characters (see [`MAX_TODO_TEXT_LENGTH`](#2-constants)).

### `TodoDetails`

```ts
interface TodoDetails {
  action: "write" | "list" | "edit";
  todos: TodoItem[];
  error?: string;
}
```

Details payload persisted inside tool result entries (`msg.details`). Used by [`reconstructState`](#reconstructstate) to recover todo state from session history after branching. The `todos` array contains a full snapshot of the todo list at the time the tool executed; `error` is present when a tool call fails validation.

---

## 2. Constants

Source: [`src/types.ts`](../src/types.ts)

| Name                  | Type                | Value / Expression                          | Description                                                              |
|-----------------------|---------------------|---------------------------------------------|--------------------------------------------------------------------------|
| `MAX_TODO_TEXT_LENGTH`| `number`            | `1000`                                      | Max characters allowed per todo item text.                               |
| `MAX_AUTO_CONTINUE`   | `number`            | `20`                                        | Max consecutive auto-continue iterations before circuit breaker trips.   |
| `MAX_TODOS`           | `number`            | `100`                                       | Max items in `write_todos` (TypeBox `maxItems`).                         |
| `MAX_INDICES`         | `number`            | `50`                                        | Max indices in a single `edit_todos` call (TypeBox `maxItems`).          |
| `INITIAL_STATUS`      | `TodoStatus`        | `"not_started"`                             | Default status assigned to items created by `write_todos`.               |
| `VALID_STATUSES`      | `ReadonlySet<string>` | `Set(["not_started","in_progress","completed","abandoned"])` | Runtime validation set used by [`isValidTodoItem`](#isvalidtodoitem). |
| `TOOL_NAMES`          | `Set<string>`       | `Set(["write_todos","list_todos","edit_todos"])` | Tools that produce `TodoDetails` for state reconstruction.           |

---

## 3. Lookup Maps

Source: [`src/types.ts`](../src/types.ts)

### `STATUS_ICONS`

```ts
const STATUS_ICONS: Record<TodoStatus, string> = {
  not_started: "–",
  in_progress: "●",
  completed:   "✓",
  abandoned:   "✗",
};
```

Plain-text icon for each status. Used by both [plain-text formatting](#6-formatting-module-formattingts) (LLM content) and [themed formatting](#6-formatting-module-formattingts) (TUI rendering).

### `ACTION_TO_STATUS`

```ts
const ACTION_TO_STATUS: Record<string, TodoStatus> = {
  start:    "in_progress",
  complete: "completed",
  abandon:  "abandoned",
};
```

Maps an `edit_todos` action string to the resulting `TodoStatus`. Used in [`createEditTodosTool`](#createedittodoostool).

### `ACTION_LABELS`

```ts
const ACTION_LABELS: Record<string, string> = {
  start:    "Started",
  complete: "Completed",
  abandon:  "Abandoned",
  add:      "Added",
};
```

Human-readable past-tense labels used in `edit_todos` success messages.

---

## 4. State Module (`state.ts`)

Source: [`src/state.ts`](../src/state.ts)

Holds two pieces of mutable module-level state: `todos: TodoItem[]` and `autoContinueCount: number`. All state accessors are synchronous.

| Export                              | Signature                                                                                                          | Returns           | Side Effects                                                | Called By                                                                 |
|-------------------------------------|--------------------------------------------------------------------------------------------------------------------|-------------------|-------------------------------------------------------------|---------------------------------------------------------------------------|
| `getTodos`                          | `() => readonly TodoItem[]`                                                                                        | Readonly todo array | None                                                        | `events.ts` (before_agent_start, agent_end); `tools.ts` (all three tools) |
| `setTodos`                          | `(newTodos: TodoItem[]) => void`                                                                                   | `void`            | Replaces `todos`; resets `autoContinueCount` to `0`         | `events.ts` (session_start, session_tree); `createWriteTodosTool`         |
| `updateTodoStatus`                  | `(indices: readonly number[], newStatus: TodoStatus) => void`                                                      | `void`            | Updates status at each index; resets `autoContinueCount` to `0` | `createEditTodosTool`                                                  |
| `appendTodos`                       | `(newItems: readonly TodoItem[]) => void`                                                                          | `void`            | Spreads `newItems` onto existing `todos` array; resets `autoContinueCount` to `0` | `createEditTodosTool` (add action) |
| `incrementAutoContinue`             | `() => number`                                                                                                     | New count (after increment) | Increments `autoContinueCount` by 1                         | `events.ts` (agent_end)                                                   |
| `resetAutoContinue`                 | `() => void`                                                                                                       | `void`            | Sets `autoContinueCount` to `0`                             | Not called in production source code; available for test suites and external use to reset the counter directly. |
| `resetState`                        | `() => void`                                                                                                       | `void`            | Clears `todos` and resets `autoContinueCount` to `0`        | Test suites only                                                            |
| `reconstructState`                  | `(ctx: ExtensionContext) => TodoItem[]`                                                                            | Reconstructed `TodoItem[]` | None (pure read from session history)                   | `events.ts` (session_start, session_tree)                                 |
| `updateUI`                          | `(ctx: ExtensionContext, todoList: readonly TodoItem[]) => void`                                                   | `void`            | Calls `ctx.ui.setStatus("til-done", ...)` and `ctx.ui.setStatus("til-done-active", ...)` | `events.ts` (session_start, session_tree); `tools.ts` (write, edit)   |

### `reconstructState` — Detail

Scans `ctx.sessionManager.getBranch()` **in reverse** to find the most recent `message` entry with `role === "toolResult"` whose `toolName` is in [`TOOL_NAMES`](#2-constants). Extracts the `details.todos` array, filters through [`isValidTodoItem`](#isvalidtodoitem), and returns a fresh `TodoItem[]`. Returns `[]` if no matching entry is found.

### `updateUI` — Detail

- **Empty list**: clears both `til-done` and `til-done-active` status bars (sets to `undefined`).
- **All completed**: sets `til-done` to `"✓ Done (N items)"`; clears `til-done-active`.
- **Otherwise**: sets `til-done` to `"📋 completed/total"`; sets `til-done-active` to a newline-separated list of `in_progress` items formatted as `"[index] text"`.
- No-op if `ctx.hasUI` is `false`.

---

## 5. Validation Module (`validation.ts`)

Source: [`src/validation.ts`](../src/validation.ts)

| Export               | Signature                                                                        | Returns          | Description                                                                 |
|----------------------|----------------------------------------------------------------------------------|------------------|-----------------------------------------------------------------------------|
| `isValidTodoItem`    | `(t: unknown) => t is TodoItem`                                                 | `boolean` (type guard) | Strict validation: rejects non-objects, null, objects with ≠2 keys, non-string `text`/`status`, invalid status values (checked against [`VALID_STATUSES`](#2-constants)), empty text, or text exceeding [`MAX_TODO_TEXT_LENGTH`](#2-constants). Also rejects extra properties. |
| `isIncomplete`       | `(status: TodoStatus) => boolean`                                                | `boolean`        | `true` if status is `"not_started"` or `"in_progress"`.                      |
| `cloneTodos`         | `(todos: readonly TodoItem[]) => TodoItem[]`                                     | `TodoItem[]`     | Deep copy: maps each item to a new `{ text, status }` object.               |
| `findOversizedItem`  | `(items: readonly { text: string }[], maxLength: number) => number`              | `number`         | Returns index of the first item whose `text.length > maxLength`, or `-1` if all valid. |

---

## 6. Formatting Module (`formatting.ts`)

Source: [`src/formatting.ts`](../src/formatting.ts)

### Plain-Text Formatting (LLM content)

| Export                  | Signature                                                    | Returns    | Description                                                                 |
|-------------------------|--------------------------------------------------------------|------------|-----------------------------------------------------------------------------|
| `getPlainIcon`          | `(status: TodoStatus) => string`                             | `string`   | Returns the plain-text icon from [`STATUS_ICONS`](#3-lookup-maps).          |
| `formatTodoListText`    | `(todos: readonly TodoItem[]) => string`                     | `string`   | Returns `"No todos"` if empty; otherwise each item as `"icon [i] text"`, joined by `\n`. |
| `formatRemainingList`   | `(todos: readonly TodoItem[], indices: readonly number[]) => string` | `string`   | Same format as `formatTodoListText`, but only for the specified indices.    |

### Themed Formatting (TUI rendering)

| Export            | Signature                                                         | Returns    | Description                                                                 |
|-------------------|-------------------------------------------------------------------|------------|-----------------------------------------------------------------------------|
| `getStatusIcon`   | `(status: TodoStatus, theme: Theme) => string`                    | `string`   | Returns a themed (colored) icon:<br/>`not_started` → `theme.fg("dim", "–")`<br/>`in_progress` → `theme.fg("warning", "●")`<br/>`completed` → `theme.fg("success", "✓")`<br/>`abandoned` → `theme.fg("error", "✗")` |
| `getTodoLabel`    | `(text: string, status: TodoStatus, theme: Theme) => string`      | `string`   | Returns `theme.fg("dim", theme.strikethrough(text))` for terminal statuses (`completed`/`abandoned`); otherwise `theme.fg("text", text)`. |
| `renderTodoList`  | `(todos: readonly TodoItem[], theme: Theme) => string`            | `string`   | Returns themed full list: `"icon [index] label"` per item, joined by `\n`. Returns themed `"No todos"` if empty. |

### Tool Result Renderer

| Export              | Signature                                                                                                      | Returns | Description                                                                 |
|---------------------|----------------------------------------------------------------------------------------------------------------|---------|-----------------------------------------------------------------------------|
| `renderToolResult`  | `(result: { content: Array<{ type: string; text?: string }>; details?: unknown }, _options: { expanded: boolean; isPartial: boolean }, theme: Theme) => Text` | `Text`  | Shared renderer for all three tools. If `details` is missing, returns raw content text. If `details.error` exists, returns themed error text. Otherwise returns the full themed todo list via [`renderTodoList`](#themed-formatting-tui-rendering). |

---

## 7. Events Module (`events.ts`)

Source: [`src/events.ts`](../src/events.ts)

### `registerMessageRenderers`

```ts
export function registerMessageRenderers(pi: ExtensionAPI): void
```

Registers **3** custom message renderers with the extension API:

| Renderer ID            | Appearance                                                                                                  |
|------------------------|-------------------------------------------------------------------------------------------------------------|
| `til-done-context`     | `📋 ` (accent) + dimmed content — used for hidden context messages injected before each agent turn.        |
| `til-done-complete`    | `✓ ` (success) + normal text content — used for circuit-breaker and completion notifications.               |
| `til-done-countdown`   | `⏳ ` (accent) + dimmed content — shown during the 3-second grace period before auto-continue.              |

### `registerEventHandlers`

```ts
export function registerEventHandlers(pi: ExtensionAPI): void
```

Registers **4** event handlers:

| Event              | Behavior                                                                                                                                                                                                                                                                                                                                                               |
|--------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `session_start`    | Clears any active countdown interval. Calls [`reconstructState`](#reconstructstate) and [`setTodos`](#4-state-module-statets) to restore todos from session history. Calls [`updateUI`](#updateui--detail).                                                                                                                                                         |
| `session_tree`     | Identical behavior to `session_start` — ensures state is reconstructed when the session tree is rebuilt (e.g., after branching).                                                                                                                                                                                                                                        |
| `before_agent_start`| If incomplete todos remain, returns a hidden message (`customType: "til-done-context"`, `display: false`) containing the formatted todo list, remaining count, and instructions to call `edit_todos` with action `'start'` on the next item before working on it.                                                                                                    |
| `agent_end`        | If todos exist and the agent was **not** aborted (`stopReason === "aborted"`), increments the auto-continue counter. If the counter exceeds [`MAX_AUTO_CONTINUE`](#2-constants), sends a completion message and stops. Otherwise, identifies the next incomplete item (prefer `in_progress`, then first `not_started`), and schedules a `sendUserMessage` after a 3-second countdown (with a live UI widget that can be interrupted by user input). |

The `agent_end` handler uses a module-level `activeCountdown: ReturnType<typeof setInterval> | null` variable to prevent stacked intervals when `agent_end` fires while a previous countdown is still active.

---

## 8. Tools Module (`tools.ts`)

Source: [`src/tools.ts`](../src/tools.ts)

### Parameter Schemas

#### `WriteTodosParams`

```ts
const WriteTodosParams = Type.Object({
  todos: Type.Array(
    Type.Object({
      text: Type.String({ description: "Description of the task", maxLength: 1000 }),
    }),
    { description: "Ordered list of todo items to write", maxItems: 100 },
  ),
});
```

All items are created with status `"not_started"`.

#### `ListTodosParams`

```ts
const ListTodosParams = Type.Object({});
```

No parameters.

#### `EditTodosParams`

```ts
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
```

### Tool Factory Functions

| Export                    | Signature                                            | Returns                | Description                                                                 |
|---------------------------|------------------------------------------------------|------------------------|-----------------------------------------------------------------------------|
| `createWriteTodosTool`    | `() => ToolDefinition<typeof WriteTodosParams, TodoDetails>` | `ToolDefinition` | Replaces the entire todo list. Validates text length via [`findOversizedItem`](#5-validation-module-validationts); returns error if any item exceeds [`MAX_TODO_TEXT_LENGTH`](#2-constants). Calls [`setTodos`](#4-state-module-statets) and [`updateUI`](#updateui--detail). Returns `{ action: "write", todos, error? }` in `details`. |
| `createListTodosTool`     | `() => ToolDefinition<typeof ListTodosParams, TodoDetails>`   | `ToolDefinition` | Returns formatted todo list via [`formatTodoListText`](#plain-text-formatting-llm-content). `details` has `action: "list"` and an empty `todos` array (list is read-only, no state change to persist). |
| `createEditTodosTool`     | `() => ToolDefinition<typeof EditTodosParams, TodoDetails>`   | `ToolDefinition` | Two execution paths: **status actions** (`start`/`complete`/`abandon`) require `indices`, validate range atomically, map action to status via [`ACTION_TO_STATUS`](#3-lookup-maps), and call [`updateTodoStatus`](#4-state-module-statets); **add action** requires `todos`, validates text length and [`MAX_TODOS`](#2-constants), and calls [`appendTodos`](#4-state-module-statets). Both paths call [`updateUI`](#updateui--detail). Returns `{ action: "edit", todos, error? }` in `details`. |

### Tool Execution Summary

| Tool            | Success `details`                          | Error `details`                                    |
|-----------------|--------------------------------------------|----------------------------------------------------|
| `write_todos`   | `{ action: "write", todos: [...], }`       | `{ action: "write", todos: [], error: "text too long" }` |
| `list_todos`    | `{ action: "list", todos: [] }`            | N/A (always succeeds)                              |
| `edit_todos`    | `{ action: "edit", todos: [...] }`         | `{ action: "edit", todos: [], error: "..." }`      |

**`edit_todos` error values**: `"no todos exist"`, `"indices required"`, `"indices [...] out of range (0 to N)"`, `"todos required for add"`, `"text too long"`, `"max todos exceeded"`.

Each tool's `renderResult` delegates to [`renderToolResult`](#tool-result-renderer).

---

## 9. Entry Point (`index.ts`)

Source: [`src/index.ts`](../src/index.ts)

```ts
export default function (pi: ExtensionAPI): void
```

The default export is the extension entry point. It performs three registration steps in order:

1. **Message renderers** — calls [`registerMessageRenderers`](#registermessagerenderers).
2. **Event handlers** — calls [`registerEventHandlers`](#registereventhandlers).
3. **Tools** — registers the three tool definitions via `pi.registerTool()`:
   - `createWriteTodosTool()`
   - `createListTodosTool()`
   - `createEditTodosTool()`

All three registrations use the `pi` (`ExtensionAPI`) parameter provided by the pi-coding-agent runtime.

---

## Cross-References

- **Architecture**: See [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) for the overall system design, data flow diagrams, and lifecycle documentation.
- **Tools**: See [`docs/TOOLS.md`](TOOLS.md) for user-facing tool descriptions, usage examples, and best practices.
