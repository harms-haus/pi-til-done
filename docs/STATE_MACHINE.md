# State Machine — pi-til-done

Complete documentation of the todo status lifecycle, auto-continue decision tree, counter management, session reconstruction, and countdown behavior.

> **Related**: [ARCHITECTURE.md](ARCHITECTURE.md) — system design and module dependencies  
> **Related**: [API.md](API.md) — full API reference  
> **Related**: [TOOLS.md](TOOLS.md) — tool descriptions and usage examples

---

## 1. Todo Status Transitions

Todo items have four statuses, defined in [`src/types.ts`](../src/types.ts):

```ts
type TodoStatus = "not_started" | "in_progress" | "completed" | "abandoned";
```

Each status maps to a distinct icon for display:

| Status | Icon | Meaning |
|--------|------|---------|
| `not_started` | `–` | Item is on the list but work has not begun |
| `in_progress` | `●` | Item is actively being worked on |
| `completed` | `✓` | Item is finished successfully |
| `abandoned` | `✗` | Item was intentionally dropped |

### edit_todos Action Mapping

The `edit_todos` tool applies actions to items by index. Each action maps to a resulting status via the `ACTION_TO_STATUS` lookup:

| Action | Resulting Status |
|--------|-----------------|
| `start` | `in_progress` |
| `complete` | `completed` |
| `abandon` | `abandoned` |

**Important**: The code does **not** check an item's current status before applying an action. Any action can be applied to any item regardless of its current state. The `updateTodoStatus()` function in [`src/state.ts`](../src/state.ts) directly overwrites the status field:

```ts
todos[idx] = { ...todos[idx], status: newStatus };
```

### Semantic State Machine

While the code permits any transition, the *intended* lifecycle is:

```
not_started ──(start)──→ in_progress ──(complete)──→ completed
                              │
                          (abandon)
                              ↓
                          abandoned
```

**Terminal states**: `completed` and `abandoned` are semantically terminal. The auto-continue engine treats both as "done" — it will not suggest further actions on items in these states (see [Auto-Continue Decision Tree](#2-auto-continue-decision-tree)). However, the code technically allows re-applying actions (e.g., `start` on a `completed` item would set it back to `in_progress`). This is a deliberate design choice: the extension trusts the agent to manage lifecycle transitions correctly.

---

## 2. Auto-Continue Decision Tree

When the agent finishes a turn, the `agent_end` event handler in [`src/events.ts`](../src/events.ts) runs the following decision tree to determine whether to auto-continue:

```
agent_end fires
    │
    ├─ todos.length === 0?
    │   └─ YES → STOP (no todos to process)
    │
    ├─ wasAborted(messages)? ── last assistant message has stopReason === "aborted"?
    │   └─ YES → STOP (user interrupted)
    │
    ├─ incrementAutoContinue() > MAX_AUTO_CONTINUE (20)?
    │   └─ YES → Send til-done-complete message → STOP
    │
    ├─ Scan todos for incomplete items (not_started or in_progress)
    │   └─ None found?
    │       └─ YES → STOP (safety net — race condition between check and scan)
    │
    ├─ Select next item:
    │   ├─ Prefer first item with status "in_progress"
    │   └─ Else: first item with status "not_started"
    │
    ├─ Determine suggested action:
    │   ├─ If in_progress → suggest 'complete'
    │   └─ If not_started → suggest 'start'
    │
    ├─ Build prompt:
    │   └─ Include remaining items list via formatRemainingList()
    │      (no interpolation of todo.text into instructions — see security note below)
    │
    ├─ Start 3-second countdown:
    │   ├─ UI mode (ctx.hasUI): setInterval(1000) with til-done-countdown widget
    │   └─ Headless mode: setTimeout(3000) with no widget
    │
    └─ After countdown:
        └─ pi.sendUserMessage(prompt)
            └─ catch if user started typing → silently skip
                └─ Agent receives message → new turn begins
```

### Security Note: No Text Interpolation into Instructions

The auto-continue prompt is built from static template strings plus the remaining items list. Todo text is **never** interpolated into the instruction portion of the prompt:

```ts
const prompt = [
  "There are still incomplete todos. Continue working on the remaining todos.",
  "",
  "Remaining items:",
  remainingList,     // ← todo text appears only here, as data
  "",
  `Next action: edit_todos with action '${nextAction}' and indices [${nextIdx}]`,
].join("\n");
```

This separation prevents todo content from being misinterpreted as instructions — a form of prompt injection defense.

### Incomplete Item Detection

An item is considered "incomplete" if its status is `not_started` or `in_progress`, as determined by the `isIncomplete()` function in [`src/validation.ts`](../src/validation.ts):

```ts
export function isIncomplete(status: TodoStatus): boolean {
  return status === "not_started" || status === "in_progress";
}
```

Items with status `completed` or `abandoned` are excluded from the remaining items list and do not trigger auto-continue.

---

## 3. Auto-Continue Counter Lifecycle

The `autoContinueCount` variable (module-level in [`src/state.ts`](../src/state.ts)) tracks consecutive agent-driven auto-continues. It acts as a circuit breaker to prevent runaway loops.

### Counter Value = 20

Defined as `MAX_AUTO_CONTINUE` in [`src/types.ts`](../src/types.ts):

```ts
export const MAX_AUTO_CONTINUE = 20;
```

When the counter exceeds this threshold, the extension sends a `til-done-complete` message and stops auto-continuing:

```
✓ Auto-continue limit reached (20 iterations). Remaining todos were not completed. Take over manually.
```

### When the Counter Changes

| Event | Effect on Counter | Source |
|-------|-------------------|--------|
| `setTodos()` | **Reset to 0** | `state.ts` |
| `updateTodoStatus()` | **Reset to 0** | `state.ts` |
| `agent_end` handler | **Incremented by 1** via `incrementAutoContinue()` | `events.ts` |
| `resetAutoContinue()` | **Reset to 0** (internal utility) | `state.ts` |
| `resetState()` | **Reset to 0** (testing only) | `state.ts` |

### When the Counter Does NOT Change

| Event | Counter Behavior |
|-------|-----------------|
| `agent_end` (early exit — no todos exist) | Not incremented (handler returns before `incrementAutoContinue()`) |
| `agent_end` (early exit — agent aborted / user interrupted) | Not incremented (handler returns before `incrementAutoContinue()`) |
| `list_todos` tool call | No effect |
| `getTodos()` | No effect |
| `reconstructState()` | No effect |

### Special Case: All Items Complete (Safety Net)

When `agent_end` fires but all todos are already `completed` or `abandoned`, the counter **is incremented** — `incrementAutoContinue()` runs before the `incompleteIndices.length === 0` check. However, the handler returns immediately afterward without starting a countdown or calling `pi.sendUserMessage()`. This path is a safety net for a race condition between the circuit-breaker check and the incomplete-item scan, and in practice should rarely occur.

### Design Intent

The counter only accumulates for **consecutive agent-driven auto-continues**. Any user or tool interaction that calls `setTodos()` or `updateTodoStatus()` resets the counter to zero. This means:

- If the user edits todos via `write_todos`, the counter resets.
- If the user manually changes a status via `edit_todos`, the counter resets.
- Only when the agent repeatedly finishes turns without any intervening tool calls that modify todos does the counter climb toward the circuit breaker threshold.

---

## 4. Session State Reconstruction Flow

When a session begins or the session tree changes, the extension reconstructs todo state from the conversation history. This handles scenarios like the agent restarting, the user switching branches, or a session reconnecting.

### Trigger Events

| Event | Triggered By | Purpose |
|-------|-------------|---------|
| `session_start` | Agent session begins | Restore todos from previous conversation |
| `session_tree` | Session tree changes (branch switch, tree operation) | Re-sync todos to current branch state |

Both events run identical reconstruction logic in [`src/events.ts`](../src/events.ts):

```ts
pi.on("session_start", async (_, ctx) => {
  // Clear active countdown
  if (activeCountdown !== null) {
    clearInterval(activeCountdown);
    activeCountdown = null;
    if (ctx.hasUI) { ctx.ui.setWidget("til-done-countdown", undefined); }
  }
  // Reconstruct and sync
  const todos = reconstructState(ctx);
  setTodos(todos);
  updateUI(ctx, todos);
});
```

### Reconstruction Steps

1. **Clear active countdown** — If a countdown is running (from a previous auto-continue), it is cleared and the widget is removed. This prevents a stale countdown from firing after session state has changed.

2. **Scan branch history in reverse** — `reconstructState(ctx)` calls `ctx.sessionManager.getBranch()` and iterates from the last entry backward:

   ```ts
   for (let i = branch.length - 1; i >= 0; i--) {
   ```

3. **Filter for relevant entries** — Each entry is checked:
   - Must be a `"message"` type entry
   - Must have `role === "toolResult"`
   - Must be from one of this extension's tools (`write_todos`, `list_todos`, `edit_todos`) via `TOOL_NAMES`

4. **Check for non-empty todos** — The entry's `details.todos` must exist, be an array, and have `length > 0`.

5. **Validate each item** — Items are filtered through `isValidTodoItem()` (see [Validation Details](#validation-details) below).

6. **Return deep copies** — Valid items are mapped to `{ text, status }` objects, producing clean copies:

   ```ts
   return valid.map((t) => ({ text: t.text, status: t.status }));
   ```

7. **Replace in-memory state** — `setTodos(result)` replaces the module-level `todos` array and resets the auto-continue counter.

8. **Sync UI** — `updateUI(ctx, todos)` updates the status bar widgets to reflect the reconstructed state.

### Validation Details

The `isValidTodoItem()` type guard in [`src/validation.ts`](../src/validation.ts) is strict. It rejects items that:

- Are not objects or are `null`
- Do not have exactly 2 keys (`text` and `status`)
- Have a `text` that is not a string
- Have a `status` that is not a valid `TodoStatus` value
- Have empty text (`text.length === 0`)
- Have text exceeding `MAX_TODO_TEXT_LENGTH` (1000 characters)

### Why `list_todos` Results Are Skipped

Although `list_todos` is in `TOOL_NAMES`, its tool results have an **empty** `details.todos` array. The reconstruction loop checks `details.todos.length > 0`, so `list_todos` entries are effectively skipped. Only `write_todos` and `edit_todos` results populate `details.todos` with actual items.

---

## 5. Countdown State

The countdown provides a grace period before auto-continuing, giving the user time to interrupt.

### Module-Level Guard

A single module-level variable prevents stacked intervals:

```ts
let activeCountdown: ReturnType<typeof setInterval> | null = null;
```

### When Countdown Is Cleared

| Trigger | Location |
|---------|----------|
| `session_start` event | `events.ts` — clears interval and removes widget |
| `session_tree` event | `events.ts` — clears interval and removes widget |
| `agent_end` (before creating new countdown, UI mode) | `events.ts` — clears existing interval |
| Countdown reaches 0 (completion) | `events.ts` — clears interval inside the tick callback |
| Error during countdown tick | `events.ts` — clears interval in catch block |

### UI Mode (`ctx.hasUI === true`)

Uses `setInterval(1000)` with 3 ticks, updating a widget above the editor:

```
Tick 0 (initial display, set BEFORE setInterval starts):
                  ["⏳ Auto-continuing in 3s... (type anything to interrupt)"]
Tick 1 (1s):      ["⏳ Auto-continuing in 2s... (type anything to interrupt)"]
Tick 2 (2s):      ["⏳ Auto-continuing in 1s... (type anything to interrupt)"]
Tick 3 (3s):      Widget cleared → pi.sendUserMessage(prompt)
```

Note: "Tick 0" is not an actual `setInterval` tick — it is the initial widget content written immediately before `setInterval` is called. Only ticks 1–3 are produced by the interval callback.

Widget placement: `aboveEditor`
Widget ID: `til-done-countdown`
Message renderer: `til-done-countdown` (renders as `⏳` + dim text)

### Headless Mode (`ctx.hasUI === false`)

Uses a simple `setTimeout(3000)` with no widget updates. After 3 seconds, `pi.sendUserMessage(prompt)` is called directly.

### Race Condition Handling

`pi.sendUserMessage()` is wrapped in a try/catch because the user may have started typing during the countdown. If they did, `sendUserMessage` throws, and the auto-continue is silently abandoned:

```ts
try {
  pi.sendUserMessage(prompt);
} catch {
  // User already started typing — skip auto-continue
}
```

This same pattern is used in both UI and headless modes.

---

## 6. Cross-References

| Concept | Primary Documentation | Source File |
|---------|----------------------|-------------|
| Overall system design and module dependencies | [ARCHITECTURE.md](ARCHITECTURE.md) | `src/index.ts` |
| Full API reference (types, constants, state functions) | [API.md](API.md) | `src/types.ts`, `src/state.ts` |
| Tool schemas and usage examples | [TOOLS.md](TOOLS.md) | `src/tools.ts` |
| Validation logic and type guards | [API.md § Validation Module](API.md#5-validation-module-validationts) | `src/validation.ts` |
| Auto-continue prompt formatting | [API.md § Formatting Module](API.md#6-formatting-module-formattingts) | `src/formatting.ts` |
| Event handler registration | [ARCHITECTURE.md § Module Dependency Graph](ARCHITECTURE.md#2-module-dependency-graph) | `src/events.ts` |
