# Tool Reference — pi-til-done

Detailed documentation for the three tools registered by the pi-til-done extension with the pi-coding-agent framework.

> **Related**: [ARCHITECTURE.md](ARCHITECTURE.md) — system design, module dependency graph, and dual-mode rendering  
> **Related**: [API.md](API.md) — full API reference for types, constants, and exported functions

---

## Table of Contents

1. [Overview](#1-overview)
2. [`write_todos`](#2-write_todos)
3. [`list_todos`](#3-list_todos)
4. [`edit_todos`](#4-edit_todos)
5. [Prompt Snippet & Guidelines](#5-prompt-snippet--guidelines)
6. [TUI Rendering](#6-tui-rendering)
7. [State Reconstruction via Tool Details](#7-state-reconstruction-via-tool-details)

---

## 1. Overview

The extension registers **3 tools** with the pi-coding-agent framework. Each tool is defined by the `ToolDefinition` interface from `@earendil-works/pi-coding-agent`, which provides the following fields:

| Field | Type | Purpose |
|---|---|---|
| `name` | `string` | Tool identifier used in API calls and session history |
| `label` | `string` | Human-readable label for UI display |
| `description` | `string` | Shown to the agent as the tool's purpose |
| `parameters` | TypeBox schema | JSON schema for parameter validation at the framework level |
| `promptSnippet` | `string` | Short summary injected into agent context |
| `promptGuidelines` | `string[]` | Usage guidelines injected into agent context |
| `execute` | `async function` | The tool's runtime logic |
| `renderCall` | `function` | Produces a themed `Text` node for the TUI call display |
| `renderResult` | `function` | Produces a themed `Text` node for the TUI result display |

All tools store a `TodoDetails` object in their result `details` field, enabling [state reconstruction](#7-state-reconstruction-via-tool-details) from session history. The `TodoDetails` interface:

```ts
interface TodoDetails {
  action: "write" | "list" | "edit";
  todos: TodoItem[];
  error?: string;
}
```

---

## 2. `write_todos`

**Purpose**: Replace the entire todo list with a new set of items. All items start as `not_started`. Existing items are discarded.

### Parameters

| Parameter | Type | Required | Constraints |
|---|---|---|---|
| `todos` | `array` | Yes | Max 100 items |
| `todos[].text` | `string` | Yes | Max 1000 characters |

**TypeBox schema** (`WriteTodosParams`):

```ts
const WriteTodosParams = Type.Object({
  todos: Type.Array(
    Type.Object({
      text: Type.String({
        description: "Description of the task",
        maxLength: 1000,
      }),
    }),
    {
      description: "Ordered list of todo items to write",
      maxItems: 100,
    },
  ),
});
```

### Execute Behavior

1. **Defense-in-depth validation**: Calls `findOversizedItem(params.todos, 1000)` to scan every item's text length.
2. **Oversized error**: If any item exceeds 1000 characters, returns immediately with an error message and `details: { action: "write", todos: [], error: "text too long" }`. No state is modified.
3. **Map to TodoItem**: Each input item is converted to `{ text, status: "not_started" }`.
4. **Replace state**: Calls `setTodos(newTodos)`, which replaces the full list and resets the auto-continue counter to `0`.
5. **Sync UI**: Calls `updateUI(ctx, getTodos())` to refresh the status bar and active-items display.
6. **Return**: Content string `"Wrote N todo item(s)\n\n<formatted list>"` with `details: { action: "write", todos: clonedTodos }`.

### Error Cases

| Condition | Response Content | `details.error` | `details.todos` |
|---|---|---|---|
| Text > 1000 chars | `Error: todo item at index N exceeds maximum text length (1000 characters)` | `"text too long"` | `[]` |

### Example

**Request**:

```json
{
  "name": "write_todos",
  "arguments": {
    "todos": [
      { "text": "Write database schema" },
      { "text": "Implement migration script" },
      { "text": "Add API endpoints" }
    ]
  }
}
```

**Response content**:

```
Wrote 3 todo item(s)

– [0] Write database schema
– [1] Implement migration script
– [2] Add API endpoints
```

**Response details**:

```json
{
  "action": "write",
  "todos": [
    { "text": "Write database schema", "status": "not_started" },
    { "text": "Implement migration script", "status": "not_started" },
    { "text": "Add API endpoints", "status": "not_started" }
  ]
}
```

---

## 3. `list_todos`

**Purpose**: View the current todo list. Read-only — does not modify state or trigger UI updates.

### Parameters

None. The schema is an empty object:

```ts
const ListTodosParams = Type.Object({});
```

### Execute Behavior

1. Calls `formatTodoListText(getTodos())` to produce a plain-text formatted list.
2. **Does NOT call `updateUI`** — this is a pure read operation.
3. Returns the formatted string as content with `details: { action: "list", todos: [] }`.

### Output

| State | Content |
|---|---|
| Empty list | `No todos` |
| Non-empty | `icon [index] text` per line, joined by `\n` |

Icons: `–` (not_started), `●` (in_progress), `✓` (completed), `✗` (abandoned).

### Example

**Request**:

```json
{ "name": "list_todos", "arguments": {} }
```

**Response content** (with items in progress):

```
– [0] Write database schema
● [1] Implement migration script
✓ [2] Add API endpoints
```

**Response details**:

```json
{
  "action": "list",
  "todos": []
}
```

> **Note**: `list_todos` stores an empty `todos` array in details. This is intentional — it prevents `list_todos` results from being used during [state reconstruction](#7-state-reconstruction-via-tool-details). Only `write_todos` and `edit_todos` carry meaningful todo snapshots.

---

## 4. `edit_todos`

**Purpose**: Apply a status action (`start`/`complete`/`abandon`) to one or more todo items by their 0-based indices, or append new items via the `add` action. Batch status operations are **atomic** — if any index is invalid, no changes are applied.

### Parameters

| Parameter | Type | Required | Constraints |
|---|---|---|---|
| `action` | `enum` | Yes | One of: `"start"`, `"complete"`, `"abandon"`, `"add"` |
| `indices` | `integer[]` | Conditional | Min 1, max 50 items. Required for `start`/`complete`/`abandon`; omitted for `add`. |
| `todos` | `array` | Conditional | Max 50 items. Required for `add`; omitted for `start`/`complete`/`abandon`. |
| `todos[].text` | `string` | Yes (for add) | Max 1000 characters |

**TypeBox schema** (`EditTodosParams`):

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

### Action → Status Mapping

| `action` | Resulting `status` | Success label |
|---|---|---|
| `start` | `in_progress` | `Started` |
| `complete` | `completed` | `Completed` |
| `abandon` | `abandoned` | `Abandoned` |
| `add` | _(appends items as `not_started`)_ | `Added` |

Mappings are defined in `ACTION_TO_STATUS` and `ACTION_LABELS` in [`types.ts`](API.md#3-lookup-maps).

### Execute Behavior — Status Actions (start/complete/abandon)

1. **Missing indices guard**: If `params.indices` is absent or empty, returns error `"'indices' is required for start/complete/abandon actions"`. No state is modified.
2. **Empty list check**: If `getTodos().length === 0`, returns error `"no todos exist"`. No state is modified.
3. **Atomic index validation**: Filters `params.indices` to find any `i < 0 || i >= currentTodos.length`. If any are invalid, returns an error listing the bad indices and the valid range. No mutation occurs — validation is all-or-nothing.
4. **Apply action**: Calls `updateTodoStatus(params.indices, ACTION_TO_STATUS[action])`, which updates each item's status in place and resets the auto-continue counter to `0`.
5. **Sync UI**: Calls `updateUI(ctx, getTodos())`.
6. **Return**: Content string `"<ActionLabel> [indices]\n\n<formatted list>"` with `details: { action: "edit", todos: clonedTodos }`.

### Execute Behavior — Add Action

1. **Missing todos guard**: If `params.todos` is absent or empty, returns error `"'todos' is required for the 'add' action"`. No state is modified.
2. **Text length check**: Calls `findOversizedItem(params.todos, MAX_TODO_TEXT_LENGTH)` to scan every item's text length. If any item exceeds the limit, returns immediately with an error. No state is modified.
3. **MAX_TODOS boundary**: Checks `currentTodos.length + params.todos.length > MAX_TODOS`. If exceeded, returns an error showing current count and overflow. No state is modified.
4. **Map to TodoItem**: Each input item is converted to `{ text, status: INITIAL_STATUS }` (i.e. `not_started`).
5. **Append to state**: Calls `appendTodos(newItems)`, which adds items to the end of the existing list and resets the auto-continue counter to `0`.
6. **Sync UI**: Calls `updateUI(ctx, getTodos())`.
7. **Return**: Content string `"Added N item(s):\n\n<formatted list>"` with `details: { action: "edit", todos: clonedTodos }`.

### Error Cases

| Condition | Response Content | `details.error` | `details.todos` |
|---|---|---|---|
| No todos exist (status action) | `Error: no todos exist` | `"no todos exist"` | `[]` |
| Index out of range | `Error: indices [X, Y] out of range (0 to N)` | `"indices [X, Y] out of range (0 to N)"` | `[]` |
| Missing indices for status action | `Error: 'indices' is required for start/complete/abandon actions` | `"indices required"` | `[]` |
| Missing todos for add | `Error: 'todos' is required for the 'add' action` | `"todos required for add"` | `[]` |
| Text too long in add | `Error: todo item at index N exceeds maximum text length (1000 characters)` | `"text too long"` | `[]` |
| Max todos exceeded in add | `Error: adding N item(s) would exceed maximum of M todos (currently K)` | `"max todos exceeded"` | `[]` |

### Atomicity Guarantee

All indices are validated **before** any mutation. The validation step collects every invalid index into an array — partial application is impossible. Either all specified indices are valid and the action applies to every one, or the call fails with no state change.

### Examples

**Start items 0 and 1**:

```json
{
  "name": "edit_todos",
  "arguments": {
    "action": "start",
    "indices": [0, 1]
  }
}
```

**Response content**:

```
Started [0, 1]

● [0] Write database schema
● [1] Implement migration script
– [2] Add API endpoints
```

**Complete item 0 with an invalid index (atomic failure)**:

```json
{
  "name": "edit_todos",
  "arguments": {
    "action": "complete",
    "indices": [0, 5]
  }
}
```

**Response content** (list has only 3 items, so index 5 is out of range):

```
Error: indices [5] out of range (0 to 2)
```

No items are modified — the call fails atomically.

**Add items to an existing list**:

```json
{
  "name": "edit_todos",
  "arguments": {
    "action": "add",
    "todos": [
      { "text": "Write unit tests" },
      { "text": "Update documentation" }
    ]
  }
}
```

**Response content** (assuming 3 items already exist):

```
Added 2 item(s):

– [0] Write database schema
● [1] Implement migration script
✓ [2] Add API endpoints
– [3] Write unit tests
– [4] Update documentation
```

**Response details**:

```json
{
  "action": "edit",
  "todos": [
    { "text": "Write database schema", "status": "not_started" },
    { "text": "Implement migration script", "status": "in_progress" },
    { "text": "Add API endpoints", "status": "completed" },
    { "text": "Write unit tests", "status": "not_started" },
    { "text": "Update documentation", "status": "not_started" }
  ]
}
```

**Add to an empty list**:

```json
{
  "name": "edit_todos",
  "arguments": {
    "action": "add",
    "todos": [
      { "text": "First task" }
    ]
  }
}
```

**Response content**:

```
Added 1 item(s):

– [0] First task
```

New items are appended as `not_started` regardless of whether the list was previously empty.

---

## 5. Prompt Snippet & Guidelines

All three tools share the same `promptSnippet`, which is injected into the agent's context as a short summary of available todo management capabilities:

```
Manage a todo list: write, list, edit (start/complete/abandon by indices)
```

The `write_todos` tool also defines **7 `promptGuidelines`** that are injected into agent context to guide tool usage:

| # | Guideline |
|---|---|
| 1 | Use `write_todos` to create or replace the full todo list at the start of a task. |
| 2 | Use `edit_todos` with action `start` and an array of 0-based indices to begin work on specific items. |
| 3 | Use `edit_todos` with action `complete` and an array of 0-based indices to mark items as done. |
| 4 | Use `edit_todos` with action `abandon` and an array of 0-based indices when items are no longer needed. |
| 5 | Use `edit_todos` with action `add` and a `todos` array to append new items to the existing list. |
| 6 | Use `list_todos` to review the current todo list. |
| 7 | Always call `edit_todos` with action `start` on the next item before working on it, then `complete` when done. |

These guidelines enforce the intended workflow: write → start → (work) → complete → repeat. Guideline 7 is particularly important — it ensures the auto-continue engine can correctly identify `in_progress` items as the next item to work on.

---

## 6. TUI Rendering

Each tool defines a custom `renderCall` function for displaying the tool invocation in the TUI, and all three share `renderToolResult` from [`formatting.ts`](API.md#tool-result-renderer) for result display.

### Tool Call Rendering

| Tool | `renderCall` Output | Color Scheme |
|---|---|---|
| `write_todos` | `write_todos (N items)` | `write_todos` → bold + `toolTitle`; `(N items)` → `muted` |
| `list_todos` | `list_todos` | bold + `toolTitle` |
| `edit_todos` (status actions) | `edit_todos action [indices]` | `edit_todos` → bold + `toolTitle`; `action` → `warning`; `[indices]` → `accent` |
| `edit_todos` (add action) | `edit_todos add previewText` | `edit_todos` → bold + `toolTitle`; `add` → `warning`; `previewText` → `accent` |

### Tool Result Rendering

`renderToolResult` inspects the result's `details` field:

| Condition | Output |
|---|---|
| `details` is missing | Raw content text (unthemed) |
| `details.error` is present | Themed error text: `theme.fg("error", "Error: ...")` |
| Success | Full themed todo list via [`renderTodoList`](API.md#themed-formatting-tui-rendering) |

The themed list applies per-status coloring to icons (`not_started` → dim, `in_progress` → warning, `completed` → success, `abandoned` → error), accent-colored indices, and strikethrough + dim for terminal statuses (`completed`, `abandoned`).

### Add Action Rendering Detail

When `renderCall` receives an `add` action, it does **not** show raw JSON. Instead, it builds a preview from the `todos` array:

- **Up to 3 items** are shown. Each item's text is truncated to **40 characters** with a `…` suffix if it exceeds that length.
- Previews are joined with `, ` (comma-space).
- If more than 3 items are being added, a **`… (+N more)`** suffix is appended (e.g. `"task one, task two, task three… (+2 more)"`).

This keeps the TUI line compact while giving the user a quick sense of what is being appended.

---

## 7. State Reconstruction via Tool Details

The `details` field in each tool's result is used by [`reconstructState`](API.md#reconstructstate--detail) to recover todo state from session history after a session restart or branch switch. The reconstruction algorithm scans the session branch in reverse, finds the most recent `toolResult` message from this extension, and extracts the `details.todos` array.

### Details Payload Summary

| Tool | `details.action` | `details.todos` | Used for Reconstruction? |
|---|---|---|---|
| `write_todos` | `"write"` | Full snapshot of all items (cloned) | ✅ Yes |
| `list_todos` | `"list"` | `[]` (always empty) | ❌ No — guard `todos.length > 0` rejects it |
| `edit_todos` | `"edit"` | Full snapshot of all items after mutation (cloned) | ✅ Yes |

On error, all tools store an empty `todos` array and set `details.error`, so failed calls also do not contribute to state reconstruction.

The todo arrays stored in `details` are deep copies produced by [`cloneTodos`](API.md#5-validation-module-validationts), ensuring the persisted snapshot is decoupled from the mutable module-level state.

---

## Cross-References

- **[ARCHITECTURE.md](ARCHITECTURE.md)** — Module dependency graph, state management, auto-continue engine, context injection, UI integration, security design, and dual-mode rendering.
- **[API.md](API.md)** — Full reference for `ToolDefinition`, `TodoDetails`, `TodoItem`, `TodoStatus`, all constants, lookup maps, and exported functions from every module.
