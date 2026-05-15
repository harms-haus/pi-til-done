# Testing

## Test Framework & Configuration

| Setting | Value |
|---|---|
| **Framework** | [Vitest](https://vitest.dev/) ^3.0.0 |
| **Config file** | `vitest.config.ts` |
| **Test file pattern** | `src/**/*.test.ts` |
| **Setup file** | `src/__tests__/setup.ts` |
| **Total tests** | 171 (across 6 test files, all passing) |

### Run Commands

```bash
npm test          # Run once
npm run test:watch  # Watch mode
```

### Global Setup

`src/__tests__/setup.ts` mocks the `@earendil-works/pi-tui` `Text` class globally. The mock `Text` class stores the input string and returns it as-is from `toString()`. The `render()` method splits text by newlines, returning an empty array for empty input. This prevents any real TUI rendering during tests.

## Test File Inventory

| File | Module Tested | Tests |
|---|---|---|
| `src/__tests__/index.test.ts` | `index.ts` | 4 |
| `src/__tests__/events.test.ts` | `events.ts` | 27 |
| `src/__tests__/state.test.ts` | `state.ts` | 30 |
| `src/__tests__/tools.test.ts` | `tools.ts` | 41 |
| `src/__tests__/formatting.test.ts` | `formatting.ts` | 31 |
| `src/__tests__/validation.test.ts` | `validation.ts` | 38 |

## Test Helpers

Located in `src/__tests__/helpers/mocks.ts`.

### `createMockTheme(): Theme`

Returns a `Theme` object whose methods are `vi.fn()` spies that produce predictable strings for assertion:

| Method | Return value |
|---|---|
| `fg(color, text)` | `[${color}]${text}` |
| `bold(text)` | `**${text}**` |
| `strikethrough(text)` | `~~${text}~~` |

### `createMockContext(branch?): ExtensionContext`

Returns an `ExtensionContext` with:

- `hasUI`: `true`
- `ui.setStatus`: `vi.fn()`
- `ui.setWidget`: `vi.fn()`
- `sessionManager.getBranch`: returns the provided `branch` array

The `branch` parameter is an array of `{ type, message: { role, toolName, details? } }` objects used to simulate the session conversation history.

### `createMockAPI()`

Returns an object with a fully-spied `ExtensionAPI` plus direct references to each spy:

```typescript
{
  api,               // ExtensionAPI with all methods as vi.fn()
  sendMessage,       // vi.fn() spy
  sendUserMessage,   // vi.fn() spy
  registerTool,      // vi.fn() spy
  on,                // vi.fn() spy
  registerMessageRenderer, // vi.fn() spy
  setWidget,         // vi.fn() spy
}
```

## Test Patterns

### State isolation

Every test suite that interacts with module-level state resets it before each test:

```typescript
beforeEach(() => { resetState(); });
```

### Testing tool `execute` functions

Tools are instantiated, a mock context is created, and the `execute` method is called directly:

```typescript
const tool = createWriteTodosTool();
const ctx = createMockContext();
const result = await tool.execute(
  "call-id",
  params,
  new AbortController().signal,
  () => {},
  ctx,
);
expect(result.details?.action).toBe("write");
```

### Testing event handlers

The handler is retrieved from the `on` mock's call arguments and invoked directly:

```typescript
const { api, on } = createMockAPI();
registerEventHandlers(api);
const handler = on.mock.calls.find(call => call[0] === "agent_end")![1];
await handler(event, ctx);
```

### Testing with fake timers

The `agent_end` handler uses a 3-second countdown with `setTimeout`. Tests use Vitest's fake timers:

```typescript
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

// ...

vi.advanceTimersByTime(3000);
```

## Coverage Areas by Module

### `index.test.ts` (4 tests)

- Extension factory registers **3 tools** by name (`write_todos`, `list_todos`, `edit_todos`)
- Registers **3 message renderers** (`til-done-context`, `til-done-complete`, `til-done-countdown`)
- Registers **4 event handlers** (`session_start`, `session_tree`, `before_agent_start`, `agent_end`)
- Factory function does not throw when called

### `events.test.ts` (27 tests)

#### `registerEventHandlers` (1 test)
- Registers handlers for `session_start`, `session_tree`, `before_agent_start`, `agent_end`

#### `registerMessageRenderers` (4 tests)
- `til-done-context` and `til-done-complete` renderers return themed text containing their message content

#### `session_start` handler (1 test)
- Reconstructs state from branch, updates UI status, clears auto-continue countdown

#### `session_tree` handler (1 test)
- Reconstructs state from branch, updates UI status, clears auto-continue countdown

#### `before_agent_start` handler (6 tests)
- Returns a context message (custom type `til-done-context`, `display: false`) when incomplete items exist
- Returns `undefined` when all todos are `completed`, all are `abandoned`, or the array is empty
- Context message contains a formatted todo list with status icons and indices

#### `agent_end` handler (14 tests)
- Sends `sendUserMessage` auto-continue prompt when incomplete todos remain
- **SEC-CRIT-01**: Prompt's instruction line does not contain `todo.text` — only action name and index
- Returns early (no action) when todos are empty, all completed, or all abandoned
- Sends `til-done-complete` message via `sendMessage` when `MAX_AUTO_CONTINUE` limit is reached
- Does not call `sendUserMessage` on the limit-hit call (only `MAX_AUTO_CONTINUE` times total)
- Auto-continue counter increments across successive calls
- Counter is **not** reset by `agent_end` itself (only by tool actions)
- Prompt contains "Remaining items:" list and "Next action:" structured instruction
- Does not auto-continue when agent was aborted (`stopReason: "aborted"`)
- Shows countdown widget (`til-done-countdown`) with 3s → 2s → 1s progression before auto-continue
- Clears widget and handles gracefully when `sendUserMessage` throws (no unhandled exception)

### `state.test.ts` (30 tests)

#### `getTodos` / `setTodos` (3 tests)
- Returns empty array initially
- Replaces todos and returns them on get
- `setTodos` resets `autoContinueCount` to 0

#### `updateTodoStatus` (3 tests)
- Updates status at specified indices, leaves others untouched
- Resets `autoContinueCount` to 0

#### `incrementAutoContinue` / `resetAutoContinue` (4 tests)
- Increments from 0 → 1, 1 → 2, and accumulates across calls
- `resetAutoContinue` sets counter back to 0

#### `appendTodos` (5 tests)
- Appends a single item to an empty list
- Appends an item to an existing list, preserving existing items
- Resets autoContinueCount to 0
- Mutation isolation: mutating the input array after calling appendTodos does not affect state
- Appends multiple items with mixed statuses correctly

#### `reconstructState` (8 tests)
- Returns empty array for empty branch or when no matching tool results exist
- Finds the **last** matching tool result via reverse scan
- Skips earlier results when a later one exists
- Filters out invalid todo items (empty text, invalid status, extra properties)
- Returns deep copies — mutations of result do not affect originals
- Skips results with empty `todos` arrays (e.g. from `list_todos`)

#### `updateUI` (7 tests)
- Clears both status keys (`til-done`, `til-done-active`) when todos is empty
- Shows progress counter `📋 X/Y` when some items are completed
- Shows `✓ Done (N items)` when all completed, and clears active status
- Shows active in-progress items as `[index] text\n[index] text`
- Clears active items when none are in-progress
- Does nothing when `ctx.hasUI` is `false`
- Single-pass computation: completed count and active lines correct together

### `tools.test.ts` (41 tests)

#### `write_todos` (6 tests)
- Creates items with `not_started` status
- Returns content with formatted todo list and item count
- Returns details with `action: "write"` and cloned todos (mutation isolation verified)
- Rejects text exceeding `MAX_TODO_TEXT_LENGTH` with error in result
- Reports correct index in error message for oversized items at position > 0
- Calls `updateUI` via context

#### `list_todos` (4 tests)
- Returns formatted todo list in content
- Returns details with `action: "list"`
- Does not modify state
- Returns `"No todos"` when state is empty

#### `edit_todos` — status actions (11 tests)
- Applies `start` action to specified indices (transitions to `in_progress`)
- Applies `complete` action to specified indices (transitions to `completed`)
- Applies `abandon` action to specified indices (transitions to `abandoned`)
- Returns error when no todos exist
- Returns error when indices are out of range
- Returns error when negative indices are provided
- Returns error when `indices` parameter is missing for status actions
- **Atomicity**: no state mutation when any index is invalid
- Returns content with action label (`"Started"`, `"Completed"`, `"Abandoned"`) and formatted list
- Returns details with `action: "edit"` and cloned todos
- Calls `updateUI` via context

#### `edit_todos` — 'add' action (9 tests)
- Appends new items to the todos list
- Works correctly with an empty list
- Returns error when `todos` parameter is missing for add action
- Returns error when todos is empty
- Rejects items with oversized text
- Accepts items at exactly the `MAX_TODOS` boundary
- Rejects items that would overflow `MAX_TODOS`
- Returns details with `action: "edit"` and cloned todos
- Calls `updateUI` via context

#### `renderCall` (8 tests)
- `write_todos`: shows name and item count
- `list_todos`: shows name
- `edit_todos` — status action: shows name, action, and indices
- `edit_todos` — 'add' action with single item: shows name, action, and item text
- `edit_todos` — 'add' action with multiple items: shows name, action, and item texts
- `edit_todos` — 'add' action with many items: shows `+N more` suffix after truncation
- `edit_todos` — 'add' action with many items: truncates long text correctly
- `edit_todos` — 'add' action with undefined todos: shows name and action only

#### `renderResult` (3 tests)
- Renders error message with error styling when `details.error` is set
- Renders todo list when `details.todos` is populated
- Renders raw content text when no `details` present

### `formatting.test.ts` (31 tests)

#### `getPlainIcon` (4 tests)
Returns plain text icons for each status: `–` (not_started), `●` (in_progress), `✓` (completed), `✗` (abandoned)

#### `formatTodoListText` (4 tests)
- Returns `"No todos"` for empty array
- Formats single item: `"– [0] my task"`
- Formats multiple items with correct icons and indices
- Correct icon per status in multi-item output

#### `formatRemainingList` (5 tests)
- Formats only the specified indices
- Preserves order from the `indices` array (not ascending sort)
- Correct icons per status
- Handles single index and empty indices array

#### `getStatusIcon` (4 tests)
Returns themed status icons via `theme.fg`: `dim` for `–`, `warning` for `●`, `success` for `✓`, `error` for `✗`

#### `getTodoLabel` (4 tests)
- Terminal statuses (`completed`, `abandoned`): applies `strikethrough` then `fg("dim", ...)`
- Active statuses (`not_started`, `in_progress`): applies `fg("text", text)` without strikethrough

#### `renderTodoList` (4 tests)
- Returns themed `"No todos"` for empty array via `theme.fg("dim", ...)`
- Formats each item with themed icon, index (`accent`), and label
- Handles single item and abandoned status correctly

#### `renderToolResult` (6 tests)
- Returns `Text` with `content[0].text` when no details
- Returns error-styled `Text` when `details.error` is set
- Returns themed todo list when `details.todos` is populated
- Returns themed `"No todos"` for empty todos array in details
- Handles result with empty `content` array
- Ignores `options` parameter (expanded/notExpanded produce same output)

### `validation.test.ts` (38 tests)

#### `isValidTodoItem` (21 tests)
- **Valid items**: accepts all 4 valid status values
- **Rejects primitives**: `null`, `undefined`, string, number, array
- **Rejects extra properties**: object with 3 keys (e.g. `{ text, status, extra }`) or only 1 key
- **Rejects missing keys**: object missing `status` or missing `text`
- **Rejects wrong types**: `text` as number, `status` as number
- **Rejects invalid status**: `"unknown"`
- **Rejects empty text**: `""`
- **Length boundary**: rejects text exceeding `MAX_TODO_TEXT_LENGTH` (1001 chars), accepts exactly at limit (1000 chars)

#### `isIncomplete` (4 tests)
Returns `true` for `not_started` and `in_progress`; `false` for `completed` and `abandoned`

#### `cloneTodos` (5 tests)
- Returns new array with same length and values
- Returned items are different object references (deep copy)
- Mutation of clone does not affect original
- Returns empty array for empty input (new array, not same reference)
- Handles multiple items correctly (each item is a new reference)

#### `findOversizedItem` (8 tests)
- Returns `-1` when all items within limit
- Returns `0` for first oversized item
- Returns correct index for middle and last oversized items
- Returns `0` (first match) when multiple items are oversized
- Returns `-1` for empty array
- Respects custom `maxLength` parameter
- Returns `-1` when all items are exactly at the limit

## Security Test

### SEC-CRIT-01: Todo text not interpolated into instruction

The test in `events.test.ts` validates that `todo.text` is never placed into the instruction portion of the auto-continue prompt sent via `sendUserMessage`. The instruction line (identified by `"Next action:"`) contains only the action name (`edit_todos`), the action type (`'complete'`, `'start'`), and the item index (`[1]`) — never the todo text itself. This prevents prompt injection via crafted todo item text.

```typescript
const prompt = sendUserMessage.mock.calls[0][0];
const lines = prompt.split("\n");
const instructionLine = lines.find((line: string) => line.includes("Next action:"));
expect(instructionLine).not.toContain("task 2");  // todo.text must not appear
```

## Coverage Notes

- **No coverage tool configured**: `vitest.config.ts` does not include a `--coverage` flag or coverage configuration.
- **Coverage gap**: The no-UI fallback branch in `agent_end` (setTimeout path) is exercised indirectly by tests that pass `{}` as context, making `ctx.hasUI` falsy. However, there is no dedicated test explicitly verifying setTimeout behavior and prompt delivery in no-UI mode.

## Cross-References

- [CONTRIBUTING.md](../CONTRIBUTING.md) — development workflow requirements
