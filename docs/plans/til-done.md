# Implementation Plan: `pi-til-done` Extension

## 1. SCOPE & BOUNDARIES

### Single File

```
/home/blake/Documents/software/pi-extensions/pi-til-done/index.ts
```

Deployment copy (symlink or copy):
```
~/.pi/agent/extensions/pi-til-done/index.ts
```

### OUT OF SCOPE
- No `package.json` — extension uses pi-coding-agent's runtime packages only
- No separate `utils.ts` — all logic in `index.ts` (single-file extension)
- No tests file — testing is manual via pi agent interaction (no test framework in extension runtime)
- No `registerCommand`, `registerShortcut`, `registerFlag` — not required by the spec
- No context filtering (`context` event) — not needed since all tools are always active
- No tool call interception (`tool_call` event) — no commands to block
- No `prepareArguments` — no argument compatibility shimming needed
- No custom editor, custom footer, or custom header

---

## 2. DATA MODEL & STATE CHANGES

### 2.1 In-Memory State

```typescript
// Shared mutable state within the extension closure
let todos: TodoItem[] = [];
```

### 2.2 TodoItem Interface

```typescript
interface TodoItem {
  text: string;     // The todo description
  status: TodoStatus;
}
```

### 2.3 TodoStatus Type

```typescript
type TodoStatus = "not_started" | "in_progress" | "completed" | "abandoned";
```

### 2.4 Tool Result Details (state snapshot stored in every tool result)

```typescript
interface TillDoneDetails {
  action: "write" | "list" | "start" | "complete" | "abandon";
  todos: TodoItem[];  // Full snapshot of the current todo list at the time of this result
  error?: string;     // Set only when an error occurred (e.g., invalid index)
}
```

### 2.5 State Transitions

The state is an **ordered array** of `TodoItem`. Each tool mutates the array and returns a full snapshot.

| Tool | Mutation | Before → After |
|------|----------|----------------|
| `write_todos` | Full replace of `todos` array | Any state → New array of `not_started` items |
| `list_todos` | None (read-only) | State unchanged |
| `start_todo` | `todos[INDEX].status = "in_progress"` | `"not_started"` → `"in_progress"` |
| `complete_todo` | `todos[INDEX].status = "completed"` | Any → `"completed"` |
| `abandon_todo` | `todos[INDEX].status = "abandoned"` | Any → `"abandoned"` |

### 2.6 State Reconstruction

On `session_start` and `session_tree`, scan `ctx.sessionManager.getBranch()` for tool result messages from **any** of the 5 registered tools. The last matching result's `details.todos` is the authoritative state.

Tool names to match during reconstruction: `"write_todos"`, `"list_todos"`, `"start_todo"`, `"complete_todo"`, `"abandon_todo"`.

Algorithm:
```
todos = []
for each entry in ctx.sessionManager.getBranch():
    if entry.type !== "message": skip
    if entry.message.role !== "toolResult": skip
    if entry.message.toolName not in [5 tool names]: skip
    details = entry.message.details as TillDoneDetails | undefined
    if details?.todos exists:
        todos = deep copy of details.todos
```

After reconstruction, update widget and status.

---

## 3. ALGORITHM & LOGIC

### 3.1 Tool Schemas (TypeBox)

#### `write_todos`
```typescript
const WriteTodosParams = Type.Object({
  todos: Type.Array(Type.Object({
    text: Type.String({ description: "Description of the task" }),
  }), { description: "Ordered list of todo items to write" }),
});
```
Replaces entire `todos` array with new items, all set to `status: "not_started"`.

#### `list_todos`
```typescript
const ListTodosParams = Type.Object({});
```
No parameters. Returns current state without mutation.

#### `start_todo`
```typescript
const StartTodoParams = Type.Object({
  index: Type.Number({ description: "0-based index of the todo item to start" }),
});
```
Sets `todos[index].status = "in_progress"`.

#### `complete_todo`
```typescript
const CompleteTodoParams = Type.Object({
  index: Type.Number({ description: "0-based index of the todo item to complete" }),
});
```
Sets `todos[index].status = "completed"`.

#### `abandon_todo`
```typescript
const AbandonTodoParams = Type.Object({
  index: Type.Number({ description: "0-based index of the todo item to abandon" }),
});
```
Sets `todos[index].status = "abandoned"`.

### 3.2 Tool Execute Logic

Each tool's `execute()` follows this pattern:

1. Perform mutation on `todos` array (or none for `list_todos`)
2. Handle error cases:
   - For `start_todo`, `complete_todo`, `abandon_todo`: if `index < 0 || index >= todos.length`, return error result with `details.error` set, `details.todos` still containing the full current state snapshot (no mutation applied)
   - For `write_todos`: if `todos` array param is empty, still proceed (empty list is valid — clears everything)
3. Return `{ content: [...], details: { action, todos: [...todos] } }` where `todos` is a shallow copy of the current state

**Error handling detail:**
- If `index` is out of bounds for `start_todo`/`complete_todo`/`abandon_todo`:
  - `content`: `[{ type: "text", text: "Error: index N is out of range (0 to M-1)" }]`
  - `details`: `{ action, todos: [...todos], error: "index N out of range" }`
  - The in-memory `todos` array is NOT mutated

### 3.3 Helper: Render Todo List (shared across all renderResult calls)

A single function builds the themed todo list string used by all 5 tools' `renderResult`:

```typescript
function renderTodoList(todos: TodoItem[], theme: Theme): string {
  if (todos.length === 0) return theme.fg("dim", "No todos");
  
  let lines = "";
  for (let i = 0; i < todos.length; i++) {
    const todo = todos[i];
    const icon = getIcon(todo.status, theme);
    const label = getLabel(todo.text, todo.status, theme);
    lines += `${icon} ${theme.fg("accent", `[${i}]`)} ${label}\n`;
  }
  return lines.trimEnd();
}
```

Where:
- `getIcon` returns themed status icon:
  - `"not_started"` → `theme.fg("dim", "–")`
  - `"in_progress"` → `theme.fg("warning", "●")`
  - `"completed"` → `theme.fg("success", "✓")`
  - `"abandoned"` → `theme.fg("error", "✗")`
- `getLabel` returns themed text:
  - `"completed"` → `theme.fg("dim", theme.strikethrough(text))`
  - `"abandoned"` → `theme.fg("dim", theme.strikethrough(text))`
  - `"in_progress"` → `theme.fg("text", text)`
  - `"not_started"` → `theme.fg("text", text)`

### 3.4 Helper: Update Widget & Status (shared side effect)

```typescript
function updateUI(ctx: ExtensionContext): void {
  if (!ctx.hasUI) return;
  
  // Widget: show in-progress items only
  const inProgress = todos.filter(t => t.status === "in_progress");
  if (inProgress.length > 0) {
    const lines = inProgress.map((item) => {
      const idx = todos.indexOf(item);
      return ctx.ui.theme.fg("warning", "● ") +
             ctx.ui.theme.fg("accent", `[${idx}] `) +
             ctx.ui.theme.fg("text", item.text);
    });
    ctx.ui.setWidget("til-done", lines);
  } else {
    ctx.ui.setWidget("til-done", undefined);
  }
  
  // Status footer
  if (todos.length > 0) {
    const completed = todos.filter(t => t.status === "completed").length;
    ctx.ui.setStatus("til-done", ctx.ui.theme.fg("accent", `📋 ${completed}/${todos.length}`));
  } else {
    ctx.ui.setStatus("til-done", undefined);
  }
}
```

Called after:
- Every tool `execute()` (via a shared helper that both mutates state and updates UI)
- State reconstruction in `session_start` and `session_tree`
- `agent_end` when all todos are completed (to clear widget)

### 3.5 Tool Execute → UI Update Flow

Each mutating tool's `execute()` calls `updateUI(ctx)` at the end (after mutation, before return). `list_todos` also calls `updateUI(ctx)` even though it doesn't mutate, to ensure the widget reflects current state.

### 3.6 `before_agent_start` Event

If `todos.length > 0` and there is at least one item with `status === "not_started"` or `status === "in_progress"`, inject a hidden context message:

```typescript
pi.on("before_agent_start", async () => {
  const remaining = todos.filter(t => t.status === "not_started" || t.status === "in_progress");
  if (remaining.length === 0) return;
  
  const todoList = todos.map((t, i) => {
    const icon = t.status === "in_progress" ? "●" : t.status === "completed" ? "✓" : t.status === "abandoned" ? "✗" : "–";
    return `${icon} [${i}] ${t.text}`;
  }).join("\n");
  
  return {
    message: {
      customType: "til-done-context",
      content: `[TILL-DONE ACTIVE]\n\nCurrent todo list:\n${todoList}\n\n${remaining.length} item(s) remaining. Continue working through the list. Call start_todo on the next item before working on it, then complete_todo when done.`,
      display: false,
    },
  };
});
```

This is `display: false` — visible to LLM but not rendered in TUI history.

### 3.7 `agent_end` Event — Auto-Continue

```typescript
pi.on("agent_end", async (_event, ctx) => {
  if (todos.length === 0) return;
  
  // Check if all todos are done (completed or abandoned)
  const incomplete = todos.filter(t => t.status === "not_started" || t.status === "in_progress");
  
  if (incomplete.length === 0) {
    // All done — send completion message and clear state
    pi.sendMessage({
      customType: "til-done-complete",
      content: `**All todos complete!** ✓ (${todos.length} items)`,
      display: true,
    }, { triggerTurn: false });
    
    todos = [];
    updateUI(ctx);
    return;
  }
  
  // Incomplete todos remain — auto-continue
  const nextItems = incomplete.map(t => {
    const idx = todos.indexOf(t);
    return `[${idx}] ${t.status === "in_progress" ? "●" : "–"} ${t.text}`;
  });
  
  // Pick the first in-progress item, or the first not_started item
  const nextInProgress = incomplete.find(t => t.status === "in_progress");
  const nextItem = nextInProgress || incomplete.find(t => t.status === "not_started");
  const nextIdx = nextItem ? todos.indexOf(nextItem) : -1;
  
  let prompt: string;
  if (nextInProgress) {
    prompt = `Continue working on the remaining todos. You are currently working on: [${nextIdx}] ${nextItem.text}. Call complete_todo when done, then start_todo on the next item.`;
  } else {
    prompt = `Continue working on the remaining todos. Call start_todo on index ${nextIdx} to begin: "${nextItem?.text}", then complete_todo when done.`;
  }
  
  pi.sendUserMessage(prompt);
});
```

**Key decision**: Use `pi.sendUserMessage()` (not `pi.sendMessage()`) for auto-continue because:
- `agent_end` fires when agent is idle, so `sendUserMessage` works without `deliverAs`
- It always triggers a new turn
- It appears as a user message in the conversation, which is the most natural continuation signal

### 3.8 `registerMessageRenderer` for Custom Messages

Register two message renderers:

1. **`"til-done-context"`** — renders the injected context message (though `display: false` means it won't typically be shown; register as a safety measure):
```typescript
pi.registerMessageRenderer("til-done-context", (message, _options, theme) => {
  return new Text(theme.fg("accent", "📋 ") + theme.fg("dim", message.content), 0, 0);
});
```

2. **`"til-done-complete"`** — renders the completion message:
```typescript
pi.registerMessageRenderer("til-done-complete", (message, _options, theme) => {
  return new Text(theme.fg("success", "✓ ") + theme.fg("text", message.content), 0, 0);
});
```

### 3.9 State Reconstruction on `session_start` and `session_tree`

```typescript
const TOOL_NAMES = new Set(["write_todos", "list_todos", "start_todo", "complete_todo", "abandon_todo"]);

function reconstructState(ctx: ExtensionContext): void {
  todos = [];
  
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "message") continue;
    const msg = entry.message;
    if (msg.role !== "toolResult") continue;
    if (!TOOL_NAMES.has(msg.toolName)) continue;
    
    const details = msg.details as TillDoneDetails | undefined;
    if (details?.todos) {
      todos = details.todos.map(t => ({ ...t })); // defensive copy
    }
  }
  
  updateUI(ctx);
}

pi.on("session_start", async (_event, ctx) => reconstructState(ctx));
pi.on("session_tree", async (_event, ctx) => reconstructState(ctx));
```

### 3.10 Tool `renderCall` Implementations

Each tool's `renderCall` shows the tool name and relevant args:

| Tool | renderCall output |
|------|-------------------|
| `write_todos` | `theme.fg("toolTitle", theme.bold("write_todos ")) + theme.fg("muted", `(${args.todos.length} items)`)` |
| `list_todos` | `theme.fg("toolTitle", theme.bold("list_todos "))` |
| `start_todo` | `theme.fg("toolTitle", theme.bold("start_todo ")) + theme.fg("accent", `[${args.index}]`)` |
| `complete_todo` | `theme.fg("toolTitle", theme.bold("complete_todo ")) + theme.fg("accent", `[${args.index}]`)` |
| `abandon_todo` | `theme.fg("toolTitle", theme.bold("abandon_todo ")) + theme.fg("accent", `[${args.index}]`)` |

### 3.11 Tool `renderResult` Implementations

ALL 5 tools share the same `renderResult` pattern:

1. Extract `details` from result
2. If `details.error` exists, render: `theme.fg("error", "Error: " + details.error)`
3. Otherwise, render the full todo list via `renderTodoList(details.todos, theme)`

This ensures every tool result in history shows the complete current todo list with status icons.

### 3.12 Edge Cases

| Edge Case | Behavior |
|-----------|----------|
| `write_todos` with empty `todos` array | Valid — clears the list. Returns empty state. |
| `start_todo` / `complete_todo` / `abandon_todo` with negative index | Error: "index -1 is out of range (0 to M-1)". No mutation. |
| `start_todo` / `complete_todo` / `abandon_todo` with index ≥ length | Error: "index N is out of range (0 to M-1)". No mutation. |
| `start_todo` on item already `"in_progress"` | Proceed silently, status stays `"in_progress"`. |
| `complete_todo` on item already `"completed"` | Proceed silently, status stays `"completed"`. |
| `list_todos` when no todos exist | Returns "No todos" text, renders as `theme.fg("dim", "No todos")`. |
| `agent_end` when all items are abandoned | Treated as "done" (no incomplete items). Sends completion message. Clears state. |
| `agent_end` when todos array is empty | Returns immediately — no auto-continue. |
| Session resume with no prior tool calls | `todos` stays empty. No widget, no status. |
| Branch navigation to point before any todos | `todos` becomes empty (no matching tool results found). |

---

## 4. INTEGRATION & CONTRACTS

### 4.1 Imports

```typescript
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
```

### 4.2 Extension Factory

```typescript
export default function (pi: ExtensionAPI): void { ... }
```

Sync factory (no `async`). All setup is synchronous registration.

### 4.3 Tool Registration Signatures

Each tool is registered via `pi.registerTool()` with the following constant properties:

| Property | All 5 tools share |
|----------|-------------------|
| `renderShell` | Not set (default framing) |
| `executionMode` | Not set (default) |
| `prepareArguments` | Not set |

#### Tool 1: `write_todos`

```typescript
pi.registerTool({
  name: "write_todos",
  label: "Write Todos",
  description: "Write a full list of todo items, replacing any existing list. Each item starts as 'not_started'. Use this to create or replace the entire plan.",
  parameters: WriteTodosParams,
  promptSnippet: "Manage a todo list: write, list, start, complete, abandon tasks",
  promptGuidelines: [
    "Use write_todos to create or replace the full todo list at the start of a task.",
    "Use start_todo (by 0-based index) before beginning work on a specific todo item.",
    "Use complete_todo (by 0-based index) when finishing a todo item.",
    "Use abandon_todo (by 0-based index) when a todo item is no longer needed.",
    "Use list_todos to review the current todo list.",
    "Always call start_todo on the next item before working on it, then complete_todo when done.",
  ],
  async execute(toolCallId, params, signal, onUpdate, ctx) { ... },
  renderCall(args, theme, context) { ... },
  renderResult(result, options, theme, context) { ... },
});
```

The `promptSnippet` and `promptGuidelines` are only registered on `write_todos` (the first tool). The other 4 tools omit these so guidelines aren't duplicated 5×.

#### Tool 2: `list_todos`

```typescript
pi.registerTool({
  name: "list_todos",
  label: "List Todos",
  description: "List all todos with their current status and 0-based indices.",
  parameters: ListTodosParams,
  async execute(toolCallId, params, signal, onUpdate, ctx) { ... },
  renderCall(args, theme, context) { ... },
  renderResult(result, options, theme, context) { ... },
});
```

#### Tool 3: `start_todo`

```typescript
pi.registerTool({
  name: "start_todo",
  label: "Start Todo",
  description: "Mark a todo item as 'in_progress' by its 0-based index.",
  parameters: StartTodoParams,
  async execute(toolCallId, params, signal, onUpdate, ctx) { ... },
  renderCall(args, theme, context) { ... },
  renderResult(result, options, theme, context) { ... },
});
```

#### Tool 4: `complete_todo`

```typescript
pi.registerTool({
  name: "complete_todo",
  label: "Complete Todo",
  description: "Mark a todo item as 'completed' by its 0-based index.",
  parameters: CompleteTodoParams,
  async execute(toolCallId, params, signal, onUpdate, ctx) { ... },
  renderCall(args, theme, context) { ... },
  renderResult(result, options, theme, context) { ... },
});
```

#### Tool 5: `abandon_todo`

```typescript
pi.registerTool({
  name: "abandon_todo",
  label: "Abandon Todo",
  description: "Mark a todo item as 'abandoned' by its 0-based index. Use when a task is no longer needed.",
  parameters: AbandonTodoParams,
  async execute(toolCallId, params, signal, onUpdate, ctx) { ... },
  renderCall(args, theme, context) { ... },
  renderResult(result, options, theme, context) { ... },
});
```

### 4.4 Event Handler Registrations

| Event | Handler Purpose |
|-------|-----------------|
| `session_start` | Reconstruct state from `getBranch()`, update widget/status |
| `session_tree` | Reconstruct state from `getBranch()`, update widget/status |
| `before_agent_start` | Inject remaining todo list as hidden context (`display: false`) |
| `agent_end` | Auto-continue via `pi.sendUserMessage()` if incomplete todos remain; send completion message and clear state if all done |

### 4.5 Message Renderer Registrations

| customType | Purpose |
|------------|---------|
| `"til-done-context"` | Render injected context (hidden, but registered for safety) |
| `"til-done-complete"` | Render "All todos complete!" message |

### 4.6 Widget & Status Keys

| Key | Purpose |
|-----|---------|
| `"til-done"` | Widget showing in-progress items above composer |
| `"til-done"` | Footer status showing `📋 X/Y` progress |

Both use the same key namespace since they're different API calls (setWidget vs setStatus).

---

## 5. TESTING STRATEGY

### 5.1 Manual Test Scenarios

Since there is no test framework, verification is manual via pi agent interaction:

#### Happy Path Tests

1. **Create todos** — Tell the agent "Create a todo list with items: A, B, C". Verify:
   - `write_todos` is called with 3 items
   - `renderResult` shows all 3 with `–` icons and `[0]`, `[1]`, `[2]` indices
   - Footer status shows `📋 0/3`
   - No widget (nothing in-progress)

2. **Start first item** — Agent should call `start_todo({ index: 0 })`. Verify:
   - Item 0 shows `●` icon
   - Widget appears above composer showing `[0] A`
   - Footer status shows `📋 0/3`

3. **Complete first item** — Agent should call `complete_todo({ index: 0 })`. Verify:
   - Item 0 shows `✓` icon with strikethrough text
   - Widget clears (no in-progress items)
   - Footer status shows `📋 1/3`

4. **Start second item** — Agent calls `start_todo({ index: 1 })`. Verify widget shows `[1] B`.

5. **Agent auto-continues** — After completing item 1, the agent should auto-continue (via `agent_end` handler sending `sendUserMessage`). Verify:
   - A new user message appears in conversation
   - Agent proceeds to work on remaining items
   - No user intervention needed

6. **All items completed** — After all 3 items are done, verify:
   - "All todos complete!" message appears in history
   - Widget clears
   - Footer status clears

7. **Abandon an item** — Create a new list with 3 items, complete item 0, then `abandon_todo({ index: 1 })`. Verify:
   - Item 1 shows `✗` icon with strikethrough text
   - Agent auto-continues with item 2
   - After completing item 2, all done message fires (no incomplete items)

#### Error Path Tests

8. **Invalid index** — Call `start_todo({ index: 99 })` when only 3 items exist. Verify:
   - Error message returned to LLM: "index 99 is out of range (0 to 2)"
   - `renderResult` shows error in red
   - In-memory state unchanged
   - `details.todos` still contains full state snapshot

9. **Negative index** — Call `complete_todo({ index: -1 })`. Verify same error behavior.

#### Branching Tests

10. **Branch to earlier point** — Create 3 todos, complete items 0 and 1. Navigate tree to the point after `write_todos` but before `start_todo`. Verify:
    - `session_tree` handler fires
    - State is reconstructed from branch (all 3 items `not_started`)
    - Widget and status update correctly

11. **Resume session** — Quit pi, reopen the session. Verify:
    - `session_start` handler fires
    - State is reconstructed from session entries
    - Widget and status are correct

#### Display Tests

12. **Render result shows full list** — Call `list_todos`. Verify `renderResult` shows ALL items with status icons (not just a count or summary).

13. **Hidden context injection** — During auto-continue, verify the `before_agent_start` handler injects a hidden message with the full remaining todo list. Check that `display: false` means it's not visible in TUI but is in LLM context.

14. **Widget shows only in-progress** — Have 2 items in-progress. Verify widget shows both lines. Complete one. Verify widget shows only the remaining in-progress item.

### 5.2 Existing Tests

No existing tests to maintain — this is a new extension with no test suite.

---

## 6. FILE STRUCTURE — CODE ORGANIZATION

The single file `/home/blake/Documents/software/pi-extensions/pi-til-done/index.ts` will be organized in this order:

```
1. Imports
2. Type definitions (TodoStatus, TodoItem, TillDoneDetails)
3. TOOL_NAMES constant (Set of 5 tool names for reconstruction)
4. Helper: getStatusIcon(status, theme) → themed string
5. Helper: getTodoLabel(text, status, theme) → themed string
6. Helper: renderTodoList(todos, theme) → string (multiline themed list)
7. Helper: updateUI(ctx) → void (widget + status)
8. Helper: reconstructState(ctx) → void
9. TypeBox schemas (WriteTodosParams, ListTodosParams, StartTodoParams, CompleteTodoParams, AbandonTodoParams)
10. Helper: renderResultAll(result, options, theme, context) → Component (shared by all 5 tools)
11. export default function(pi) — main extension body:
    a. let todos: TodoItem[] = []
    b. Register message renderers (til-done-context, til-done-complete)
    c. Register event handlers:
       - session_start → reconstructState
       - session_tree → reconstructState
       - before_agent_start → inject context
       - agent_end → auto-continue / completion
    d. Register 5 tools (write_todos, list_todos, start_todo, complete_todo, abandon_todo)
```

### Approximate Line Count Estimate: ~350-400 lines

---

## 7. COMPLETE PSEUDOCODE

```typescript
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

// ── Types ──

type TodoStatus = "not_started" | "in_progress" | "completed" | "abandoned";

interface TodoItem {
  text: string;
  status: TodoStatus;
}

interface TillDoneDetails {
  action: "write" | "list" | "start" | "complete" | "abandon";
  todos: TodoItem[];
  error?: string;
}

// ── Constants ──

const TOOL_NAMES = new Set([
  "write_todos", "list_todos", "start_todo", "complete_todo", "abandon_todo"
]);

// ── Helpers ──

function getStatusIcon(status: TodoStatus, theme: Theme): string {
  switch (status) {
    case "not_started": return theme.fg("dim", "–");
    case "in_progress": return theme.fg("warning", "●");
    case "completed": return theme.fg("success", "✓");
    case "abandoned": return theme.fg("error", "✗");
  }
}

function getTodoLabel(text: string, status: TodoStatus, theme: Theme): string {
  if (status === "completed" || status === "abandoned") {
    return theme.fg("dim", theme.strikethrough(text));
  }
  return theme.fg("text", text);
}

function renderTodoList(todos: TodoItem[], theme: Theme): string {
  if (todos.length === 0) return theme.fg("dim", "No todos");
  return todos.map((t, i) =>
    `${getStatusIcon(t.status, theme)} ${theme.fg("accent", `[${i}]`)} ${getTodoLabel(t.text, t.status, theme)}`
  ).join("\n");
}

function updateUI(ctx: ExtensionContext, todos: TodoItem[]): void {
  if (!ctx.hasUI) return;

  const inProgress = todos.filter(t => t.status === "in_progress");
  if (inProgress.length > 0) {
    const lines = inProgress.map(item => {
      const idx = todos.indexOf(item);
      return ctx.ui.theme.fg("warning", "● ") +
             ctx.ui.theme.fg("accent", `[${idx}] `) +
             ctx.ui.theme.fg("text", item.text);
    });
    ctx.ui.setWidget("til-done", lines);
  } else {
    ctx.ui.setWidget("til-done", undefined);
  }

  if (todos.length > 0) {
    const completed = todos.filter(t => t.status === "completed").length;
    ctx.ui.setStatus("til-done", ctx.ui.theme.fg("accent", `📋 ${completed}/${todos.length}`));
  } else {
    ctx.ui.setStatus("til-done", undefined);
  }
}

function reconstructState(ctx: ExtensionContext): TodoItem[] {
  const todos: TodoItem[] = [];
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "message") continue;
    const msg = entry.message;
    if (msg.role !== "toolResult") continue;
    if (!TOOL_NAMES.has(msg.toolName)) continue;
    const details = msg.details as TillDoneDetails | undefined;
    if (details?.todos) {
      todos.length = 0;
      todos.push(...details.todos.map(t => ({ ...t })));
    }
  }
  return todos;
}

// ── Schemas ──

const WriteTodosParams = Type.Object({
  todos: Type.Array(Type.Object({
    text: Type.String({ description: "Description of the task" }),
  }), { description: "Ordered list of todo items to write" }),
});

const ListTodosParams = Type.Object({});

const StartTodoParams = Type.Object({
  index: Type.Number({ description: "0-based index of the todo item to start" }),
});

const CompleteTodoParams = Type.Object({
  index: Type.Number({ description: "0-based index of the todo item to complete" }),
});

const AbandonTodoParams = Type.Object({
  index: Type.Number({ description: "0-based index of the todo item to abandon" }),
});

// ── Shared renderResult ──

function renderResultShared(
  result: { content: Array<{ type: string; text: string }>; details?: unknown },
  _options: { expanded: boolean; isPartial: boolean },
  theme: Theme,
): Component {
  const details = result.details as TillDoneDetails | undefined;
  if (!details) {
    const text = result.content[0]?.text ?? "";
    return new Text(text, 0, 0);
  }
  if (details.error) {
    return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);
  }
  return new Text(renderTodoList(details.todos, theme), 0, 0);
}

// ── Extension ──

export default function (pi: ExtensionAPI): void {
  let todos: TodoItem[] = [];

  // Message renderers
  pi.registerMessageRenderer("til-done-context", (message, _opts, theme) => {
    return new Text(theme.fg("accent", "📋 ") + theme.fg("dim", message.content as string), 0, 0);
  });

  pi.registerMessageRenderer("til-done-complete", (message, _opts, theme) => {
    return new Text(theme.fg("success", "✓ ") + theme.fg("text", message.content as string), 0, 0);
  });

  // Session events — state reconstruction
  pi.on("session_start", async (_event, ctx) => {
    todos = reconstructState(ctx);
    updateUI(ctx, todos);
  });

  pi.on("session_tree", async (_event, ctx) => {
    todos = reconstructState(ctx);
    updateUI(ctx, todos);
  });

  // before_agent_start — inject context
  pi.on("before_agent_start", async () => {
    const remaining = todos.filter(t => t.status === "not_started" || t.status === "in_progress");
    if (remaining.length === 0) return;

    const todoList = todos.map((t, i) => {
      const icon = t.status === "in_progress" ? "●" : t.status === "completed" ? "✓" : t.status === "abandoned" ? "✗" : "–";
      return `${icon} [${i}] ${t.text}`;
    }).join("\n");

    return {
      message: {
        customType: "til-done-context",
        content: `[TILL-DONE ACTIVE]\n\nCurrent todo list:\n${todoList}\n\n${remaining.length} item(s) remaining. Continue working through the list. Call start_todo on the next item before working on it, then complete_todo when done.`,
        display: false,
      },
    };
  });

  // agent_end — auto-continue
  pi.on("agent_end", async (_event, ctx) => {
    if (todos.length === 0) return;

    const incomplete = todos.filter(t => t.status === "not_started" || t.status === "in_progress");

    if (incomplete.length === 0) {
      pi.sendMessage({
        customType: "til-done-complete",
        content: `**All todos complete!** ✓ (${todos.length} items)`,
        display: true,
      }, { triggerTurn: false });
      todos = [];
      updateUI(ctx, todos);
      return;
    }

    const nextInProgress = incomplete.find(t => t.status === "in_progress");
    const nextItem = nextInProgress ?? incomplete.find(t => t.status === "not_started");
    const nextIdx = nextItem ? todos.indexOf(nextItem) : -1;

    let prompt: string;
    if (nextInProgress) {
      prompt = `Continue working on the remaining todos. You are currently working on: [${nextIdx}] ${nextItem!.text}. Call complete_todo when done, then start_todo on the next item.`;
    } else {
      prompt = `Continue working on the remaining todos. Call start_todo on index ${nextIdx} to begin: "${nextItem!.text}", then complete_todo when done.`;
    }

    pi.sendUserMessage(prompt);
  });

  // ── Tool: write_todos ──
  pi.registerTool({
    name: "write_todos",
    label: "Write Todos",
    description: "Write a full list of todo items, replacing any existing list. Each item starts as 'not_started'. Use this to create or replace the entire plan.",
    parameters: WriteTodosParams,
    promptSnippet: "Manage a todo list: write, list, start, complete, abandon tasks",
    promptGuidelines: [
      "Use write_todos to create or replace the full todo list at the start of a task.",
      "Use start_todo (by 0-based index) before beginning work on a specific todo item.",
      "Use complete_todo (by 0-based index) when finishing a todo item.",
      "Use abandon_todo (by 0-based index) when a todo item is no longer needed.",
      "Use list_todos to review the current todo list.",
      "Always call start_todo on the next item before working on it, then complete_todo when done.",
    ],
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      todos = params.todos.map(t => ({ text: t.text, status: "not_started" as TodoStatus }));
      updateUI(ctx, todos);
      return {
        content: [{ type: "text" as const, text: `Wrote ${todos.length} todo item(s)` }],
        details: { action: "write" as const, todos: todos.map(t => ({ ...t })) },
      };
    },
    renderCall(args, theme) {
      return new Text(
        theme.fg("toolTitle", theme.bold("write_todos ")) + theme.fg("muted", `(${args.todos.length} items)`),
        0, 0
      );
    },
    renderResult: renderResultShared as any,
  });

  // ── Tool: list_todos ──
  pi.registerTool({
    name: "list_todos",
    label: "List Todos",
    description: "List all todos with their current status and 0-based indices.",
    parameters: ListTodosParams,
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      updateUI(ctx, todos);
      return {
        content: [{ type: "text" as const, text: todos.length ? `${todos.length} todo(s)` : "No todos" }],
        details: { action: "list" as const, todos: todos.map(t => ({ ...t })) },
      };
    },
    renderCall(_args, theme) {
      return new Text(theme.fg("toolTitle", theme.bold("list_todos")), 0, 0);
    },
    renderResult: renderResultShared as any,
  });

  // ── Tool: start_todo ──
  pi.registerTool({
    name: "start_todo",
    label: "Start Todo",
    description: "Mark a todo item as 'in_progress' by its 0-based index.",
    parameters: StartTodoParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (params.index < 0 || params.index >= todos.length) {
        return {
          content: [{ type: "text" as const, text: `Error: index ${params.index} is out of range (0 to ${todos.length - 1})` }],
          details: { action: "start" as const, todos: todos.map(t => ({ ...t })), error: `index ${params.index} out of range (0 to ${todos.length - 1})` },
        };
      }
      todos[params.index] = { ...todos[params.index], status: "in_progress" };
      updateUI(ctx, todos);
      return {
        content: [{ type: "text" as const, text: `Started [${params.index}]: ${todos[params.index].text}` }],
        details: { action: "start" as const, todos: todos.map(t => ({ ...t })) },
      };
    },
    renderCall(args, theme) {
      return new Text(
        theme.fg("toolTitle", theme.bold("start_todo ")) + theme.fg("accent", `[${args.index}]`),
        0, 0
      );
    },
    renderResult: renderResultShared as any,
  });

  // ── Tool: complete_todo ──
  pi.registerTool({
    name: "complete_todo",
    label: "Complete Todo",
    description: "Mark a todo item as 'completed' by its 0-based index.",
    parameters: CompleteTodoParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (params.index < 0 || params.index >= todos.length) {
        return {
          content: [{ type: "text" as const, text: `Error: index ${params.index} is out of range (0 to ${todos.length - 1})` }],
          details: { action: "complete" as const, todos: todos.map(t => ({ ...t })), error: `index ${params.index} out of range (0 to ${todos.length - 1})` },
        };
      }
      todos[params.index] = { ...todos[params.index], status: "completed" };
      updateUI(ctx, todos);
      return {
        content: [{ type: "text" as const, text: `Completed [${params.index}]: ${todos[params.index].text}` }],
        details: { action: "complete" as const, todos: todos.map(t => ({ ...t })) },
      };
    },
    renderCall(args, theme) {
      return new Text(
        theme.fg("toolTitle", theme.bold("complete_todo ")) + theme.fg("accent", `[${args.index}]`),
        0, 0
      );
    },
    renderResult: renderResultShared as any,
  });

  // ── Tool: abandon_todo ──
  pi.registerTool({
    name: "abandon_todo",
    label: "Abandon Todo",
    description: "Mark a todo item as 'abandoned' by its 0-based index. Use when a task is no longer needed.",
    parameters: AbandonTodoParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (params.index < 0 || params.index >= todos.length) {
        return {
          content: [{ type: "text" as const, text: `Error: index ${params.index} is out of range (0 to ${todos.length - 1})` }],
          details: { action: "abandon" as const, todos: todos.map(t => ({ ...t })), error: `index ${params.index} out of range (0 to ${todos.length - 1})` },
        };
      }
      todos[params.index] = { ...todos[params.index], status: "abandoned" };
      updateUI(ctx, todos);
      return {
        content: [{ type: "text" as const, text: `Abandoned [${params.index}]: ${todos[params.index].text}` }],
        details: { action: "abandon" as const, todos: todos.map(t => ({ ...t })) },
      };
    },
    renderCall(args, theme) {
      return new Text(
        theme.fg("toolTitle", theme.bold("abandon_todo ")) + theme.fg("accent", `[${args.index}]`),
        0, 0
      );
    },
    renderResult: renderResultShared as any,
  });
}
```

---

## 8. DEPLOYMENT

After writing `index.ts`:

```bash
mkdir -p ~/.pi/agent/extensions/pi-til-done
ln -sf /home/blake/Documents/software/pi-extensions/pi-til-done/index.ts ~/.pi/agent/extensions/pi-til-done/index.ts
```

Or copy the file if symlinks are not preferred. The extension auto-loads on next pi session start or via `/reload`.
