# Architecture

## 1. Overview

pi-til-done is a [pi-coding-agent](https://github.com/earendil-works/pi-coding-agent) extension that provides an ordered todo list with automatic iteration until all tasks are complete. It enables agents to plan, track, and execute multi-step work with visible progress and automatic continuation.

**Entry point:** `src/index.ts` exports a default function matching the `ExtensionFactory` signature — it receives an `ExtensionAPI` instance and returns `void`.

The extension registers:

| Resource | Count | Details |
|---|---|---|
| Tools | 3 | `write_todos`, `list_todos`, `edit_todos` |
| Event handlers | 4 | `session_start`, `session_tree`, `before_agent_start`, `agent_end` |
| Message renderers | 3 | `til-done-context`, `til-done-complete`, `til-done-countdown` |

---

## 2. Module Dependency Graph

```
index.ts
  ├── events.ts (registerMessageRenderers, registerEventHandlers)
  │     ├── state.ts (getTodos, setTodos, reconstructState, updateUI, incrementAutoContinue)
  │     ├── formatting.ts (formatTodoListText, formatRemainingList)
  │     ├── validation.ts (isIncomplete)
  │     └── types.ts (MAX_AUTO_CONTINUE)
  ├── tools.ts (createWriteTodosTool, createListTodosTool, createEditTodosTool)
  │     ├── types.ts (ACTION_TO_STATUS, ACTION_LABELS, INITIAL_STATUS, MAX_TODO_TEXT_LENGTH, MAX_TODOS)
  │     ├── state.ts (getTodos, setTodos, appendTodos, updateTodoStatus, updateUI)
  │     ├── validation.ts (cloneTodos, findOversizedItem)
  │     └── formatting.ts (formatTodoListText, renderToolResult)
  └── types.ts (types, constants, lookup maps)
```

**Peer dependencies** (imported but not bundled):

| Package | Imported by | Purpose |
|---|---|---|
| `@earendil-works/pi-coding-agent` | `index.ts`, `events.ts`, `tools.ts`, `state.ts` | Extension API, types, context |
| `@earendil-works/pi-ai` | `tools.ts` | `StringEnum` schema helper |
| `@earendil-works/pi-tui` | `events.ts`, `tools.ts` | `Text` class |
| `@earendil-works/pi-coding-agent` | `formatting.ts` | `Theme` type |
| `typebox` | `tools.ts` | Parameter validation schemas |

---

## 3. State Management

### Mutable Singleton

State lives at module scope in `src/state.ts`:

```ts
let todos: TodoItem[] = [];
let autoContinueCount = 0;
```

This is a **singleton** — one shared instance per loaded module. There is no persistence layer; state exists entirely in memory.

### Accessors

| Function | Effect on `autoContinueCount` |
|---|---|
| `getTodos()` | Returns readonly reference; no side effects |
| `setTodos(newTodos)` | Replaces list; **resets** to `0` |
| `updateTodoStatus(indices, newStatus)` | Updates items in-place; **resets** to `0` |
| `appendTodos(newItems)` | Spreads `newItems` onto existing list; **resets** to `0` |
| `incrementAutoContinue()` | Increments and returns new value |
| `resetAutoContinue()` | Resets to `0` |
| `resetState()` | Clears both `todos` and `autoContinueCount` (testing only) |

### Auto-Continue Counter Reset Rules

- `setTodos()`, `updateTodoStatus()`, and `appendTodos()` always reset the counter to `0`, breaking the auto-continue chain whenever the list is written or edited.
- `agent_end` calls `incrementAutoContinue()` but **does not** reset it — the counter accumulates across iterations until the circuit breaker trips.
- `session_start` and `session_tree` call `reconstructState()`, which calls `setTodos()` — **this resets the counter to `0`**. While this follows from `setTodos()`'s reset behavior, the chain is worth calling out explicitly: session events → `reconstructState()` → `setTodos()` → counter reset.

### Deep Copying

`cloneTodos()` in `validation.ts` produces new `TodoItem` objects (shallow copy of each item, new array). This is used for tool result `details.todos` so that the persisted snapshot is decoupled from the mutable singleton.

---

## 4. State Reconstruction (Event-Sourced)

State reconstruction replays history to recover todos after a session restart or branch switch. It is triggered by both `session_start` and `session_tree` events.

### Algorithm

1. **Get branch**: `ctx.sessionManager.getBranch()` returns the current session branch as an array of entries.
2. **Iterate in reverse**: Scans from `branch.length - 1` down to `0`.
3. **Match criteria** for each entry:
   - `entry.type === "message"`
   - `entry.message.role === "toolResult"`
   - `entry.message.toolName` is in `TOOL_NAMES` set (`write_todos`, `list_todos`, `edit_todos`)
   - `entry.message.details.todos` is a non-empty array
4. **Validate**: Each candidate item passes through `isValidTodoItem()` (see [§9 Security Design](#9-security-design)).
5. **Return**: Deep copies of valid items (`{ text, status }`). If no match is found, returns `[]`.

### Key Detail: `list_todos` is Skipped

Although `list_todos` is in `TOOL_NAMES`, its tool result stores `todos: []` in details:

```ts
// tools.ts — createListTodosTool().execute()
details: { action: "list" as const, todos: [] }
```

The reconstruction guard `details.todos.length > 0` rejects it, so `list_todos` results are never used for state recovery. Only `write_todos` and `edit_todos` carry meaningful todo arrays in their details.

---

## 5. Auto-Continue Engine

The auto-continue engine drives automatic progression through the todo list when the agent finishes a turn with incomplete items remaining.

### Trigger

`agent_end` event.

### Skip Conditions (early return)

1. **No todos**: `todos.length === 0`
2. **User aborted**: `wasAborted(event.messages)` — walks messages in reverse; returns `true` if the last assistant message has `stopReason === "aborted"`
3. **Circuit breaker**: `incrementAutoContinue() > MAX_AUTO_CONTINUE` (20) — sends a `til-done-complete` message and stops
4. **All done (safety-net)**: After the counter is incremented, `incompleteIndices.length === 0` causes an early return. This catches a race where the last remaining todo was completed between the `incrementAutoContinue()` call and the incomplete-items scan — the counter was bumped but there is nothing left to continue on.

### Next Item Selection

Iterates the list once to collect incomplete items and find:

- `nextInProgressIdx` — first item with status `in_progress`
- `firstNotStartedIdx` — first item with status `not_started`

Selection: **prefer `in_progress`, fall back to `not_started`**.

### Prompt Structure

The auto-continue prompt is built as a plain string — **no interpolation of `todo.text` into instructions**:

```
There are still incomplete todos. Continue working on the remaining todos.

Remaining items:
– [0] Write database schema
● [1] Implement migration script

Next action: edit_todos with action 'complete' and indices [1]
```

The agent receives the remaining items list and a specific next action instruction. Todo text appears only in the `Remaining items:` list, never embedded in imperative instructions.

### Countdown Mechanism

A 3-second countdown with two code paths:

| Mode | Mechanism | Widget |
|---|---|---|
| **UI mode** (`ctx.hasUI === true`) | `setInterval` at 1s ticks, updates `til-done-countdown` widget each second | `aboveEditor` placement |
| **Headless mode** (`ctx.hasUI === false`) | Single `setTimeout` for 3000ms | None |

**Race guard:** Module-level `activeCountdown` prevents stacked intervals. If `agent_end` fires while a previous countdown is active, the old interval is cleared first. Cleared on `session_start` and `session_tree` as well.

**Interrupt:** In UI mode, typing in the editor throws, caught by the `try/catch`, which clears the interval and skips auto-continue.

### Circuit Breaker

When `autoContinueCount` exceeds 20:

```ts
pi.sendMessage(
  {
    customType: "til-done-complete",
    content: `Auto-continue limit reached (20 iterations). Remaining todos were not completed. Take over manually.`,
    display: true,
  },
  { triggerTurn: false },
);
```

---

## 6. Context Injection

### Trigger

`before_agent_start` event.

### Behavior

Only fires when incomplete todos exist (`remaining > 0`). Injects a **hidden** message:

```ts
{
  customType: "til-done-context",
  content: "[TILL-DONE ACTIVE]\n\nCurrent todo list:\n...\n\n3 item(s) remaining. Continue working through the list. Call edit_todos with action 'start' on the next item before working on it, then 'complete' when done.",
  display: false,
}
```

Key properties:

- **`display: false`** — the message is visible to the LLM but not rendered in the TUI history (the renderer is registered but never invoked for hidden messages).
- **Content includes**: full formatted todo list, count of remaining items, and generic instructions.
- **No interpolation of individual todo text into instructions** — the instruction text is static; todo text appears only in the formatted list.

---

## 7. UI Integration

All UI calls are guarded by `ctx.hasUI`.

### Status Bar Keys

| Key | Value | When |
|---|---|---|
| `til-done` | `📋 {completed}/{total}` (e.g., `📋 2/5`) | Incomplete items remain |
| `til-done` | `✓ Done ({total} items)` | All items completed |
| `til-done` | `undefined` | No todos |
| `til-done-active` | `[i] text\n[i] text` (one per `in_progress` item) | One or more items in progress |
| `til-done-active` | `undefined` | No in-progress items or all done |

### Widget

| Property | Value |
|---|---|
| ID | `til-done-countdown` |
| Placement | `aboveEditor` |
| Content | `⏳ Auto-continuing in {n}s... (type anything to interrupt)` |
| Lifecycle | Shown during countdown, cleared on tick 0, session events, or error |

---

## 8. Message Renderers

Each renderer returns a `Text` node (from `@earendil-works/pi-tui`) with a themed prefix and content:

| Custom Type | Icon | Icon Style | Content Style | Trigger |
|---|---|---|---|---|
| `til-done-context` | `📋` | `accent` | `dim` | Context injection (hidden) |
| `til-done-complete` | `✓` | `success` | `text` | Circuit breaker message |
| `til-done-countdown` | `⏳` | `accent` | `dim` | Auto-continue countdown |

Renderers are registered in `registerMessageRenderers()` and invoked by pi-coding-agent when rendering messages of the corresponding `customType` in the TUI history.

---

## 9. Security Design

### No Instruction Interpolation

Todo text is **never** interpolated into agent instructions. The auto-continue prompt and context injection use a structured format:

- Instructions are static strings (e.g., `"Next action: edit_todos with action 'complete' and indices [1]"`).
- Todo text appears only in the formatted list section, separated from imperative instructions.

This prevents todo text from being parsed as executable commands by the LLM.

### Input Validation

`isValidTodoItem()` in `validation.ts` validates reconstructed state during event-sourced replay. It rejects:

- Non-objects or `null`
- Objects without exactly two keys (`text`, `status`)
- Non-string `text` or `status`
- Status values not in `VALID_STATUSES`
- Empty text (`length === 0`)
- Text exceeding `MAX_TODO_TEXT_LENGTH` (1000 characters)

### TypeBox Schema Enforcement

Tool parameters are validated by TypeBox schemas at the pi-coding-agent level:

| Tool | Schema | Constraints |
|---|---|---|
| `write_todos` | `WriteTodosParams` | `todos.text` maxLength 1000, `todos` maxItems 100 |
| `edit_todos` | `EditTodosParams` | `indices` minItems 1, maxItems 50, `action` enum |
| `list_todos` | `ListTodosParams` | No parameters |

### Defense-in-Depth

`write_todos` performs a secondary text length check (`findOversizedItem`) inside `execute()` in addition to the TypeBox schema, ensuring oversized items are caught even if schema validation is bypassed.

---

## 10. Dual-Mode Rendering

The extension supports two rendering paths — one for LLM consumption (plain text) and one for TUI display (themed).

### Plain-Text (LLM)

Used in tool result `content[].text` and context injection:

| Function | Purpose | Output Example |
|---|---|---|
| `getPlainIcon(status)` | Internal utility used by `formatTodoListText` and `formatRemainingList`; returns Unicode icon character | `–`, `●`, `✓`, `✗` |
| `formatTodoListText(todos)` | Formats full list for LLM | `– [0] Task one\n● [1] Task two` |
| `formatRemainingList(todos, indices)` | Formats subset for auto-continue prompt | Same format, filtered |

### Themed (TUI)

Used in tool call/result rendering in the TUI history:

| Function | Purpose | Styling |
|---|---|---|
| `getStatusIcon(status, theme)` | Themed icon | `not_started→dim`, `in_progress→warning`, `completed→success`, `abandoned→error` |
| `getTodoLabel(text, status, theme)` | Themed text | Terminal statuses (`completed`, `abandoned`) get `dim` + `strikethrough` |
| `renderTodoList(todos, theme)` | Full themed list | Icon + accent index + styled label |
| `renderToolResult(result, options, theme)` | Shared tool result renderer | Renders themed list or error |

Tool call rendering is handled per-tool in `tools.ts` with custom `renderCall` functions that format the call signature with themed colors.

---

## See Also

- [API Reference](API.md) — Full API documentation for types, constants, and exported functions
- [Tool Reference](TOOLS.md) — Detailed documentation for `write_todos`, `list_todos`, and `edit_todos`
