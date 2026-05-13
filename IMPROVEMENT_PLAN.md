# Improvement Plan — `pi-til-done`

**Date:** 2026-05-12
**Scope:** Security fixes, bug fixes, infrastructure setup, module decomposition, code smell cleanup, efficiency improvements, comprehensive testing, and lint/type compliance.
**Principle:** Every step is ATOMIC. One focused change per step. Each step leaves the project in a working state.

---

## Table of Contents

1. [Phase 1 — Critical Security & Bug Fixes](#phase-1--critical-security--bug-fixes)
2. [Phase 2 — Project Infrastructure](#phase-2--project-infrastructure)
3. [Phase 3 — Module Split](#phase-3--module-split)
4. [Phase 4 — Code Smell Cleanup](#phase-4--code-smell-cleanup)
5. [Phase 5 — Efficiency Improvements](#phase-5--efficiency-improvements)
6. [Phase 6 — Comprehensive Tests](#phase-6--comprehensive-tests)
7. [Phase 7 — Lint & Type Compliance](#phase-7--lint--type-compliance)
8. [Phase 8 — Final Verification](#phase-8--final-verification)
9. [File Inventory](#file-inventory)
10. [Module Dependency Graph](#module-dependency-graph)
11. [State Management Design](#state-management-design)
12. [Out of Scope](#out-of-scope)

---

## Phase 1 — Critical Security & Bug Fixes

These fixes are applied to the **existing** `index.ts` before the module split. This ensures security fixes are not entangled with structural changes.

### Step 1.1 — Fix SEC-CRIT-01: Sanitize todo.text in `agent_end` auto-continue prompt

**File:** `index.ts`
**Problem:** `todo.text` (user-influenced data) is interpolated directly into `sendUserMessage()` as a user-role message. This is an indirect prompt injection vector.
**Change:**

In the `agent_end` handler (lines ~269–287), replace the two prompt construction blocks that interpolate `nextItem.text` into natural-language instruction text. Restructure so that `todo.text` appears only in the structured listing section (where it's already part of a formatted list), never in the instructional part of the prompt.

**Before (lines ~276–287):**
```typescript
let prompt: string;
if (nextInProgressIdx !== -1) {
    prompt = `There are still incomplete todos. Continue working on the remaining todos.\n\nRemaining items:\n${remainingList}\n\nYou are currently working on: [${nextIdx}] ${nextItem.text}. Call edit_todos with action 'complete' and indices [${nextIdx}] when done, then 'start' on the next item.`;
} else {
    prompt = `There are still incomplete todos. Continue working on the remaining todos.\n\nRemaining items:\n${remainingList}\n\nCall edit_todos with action 'start' and indices [${nextIdx}] to begin: "${nextItem.text}", then 'complete' when done.`;
}
```

**After:**
```typescript
const nextAction = nextItem.status === "in_progress" ? "complete" : "start";
const prompt = [
    "There are still incomplete todos. Continue working on the remaining todos.",
    "",
    "Remaining items:",
    remainingList,
    "",
    `Next action: edit_todos with action '${nextAction}' and indices [${nextIdx}]`,
].join("\n");
```

**Key property:** `nextItem.text` is completely eliminated from the prompt. The item text is already visible to the LLM in `remainingList` (the structured listing above). The instruction portion references only the index number and action name — never user-controlled text.

**Verify:** Manual code review confirms zero interpolation of `todo.text` into `sendUserMessage` content. The `remainingList` variable (lines ~269–274) already formats items as `icon [index] text` in a structured way that is not instructional.

---

### Step 1.2 — Fix SEC-HIGH-01: Add auto-continue circuit breaker

**File:** `index.ts`
**Problem:** `agent_end` → `sendUserMessage` loop can fire indefinitely if the LLM never calls `edit_todos`.
**Change:**

1. Add a module-level counter at the top of the exported function (near `let todos`):
```typescript
let autoContinueCount = 0;
```

2. Reset the counter in two places:
   - In `write_todos.execute()` after setting todos (after line ~309): `autoContinueCount = 0;`
   - In `edit_todos.execute()` after applying status changes (after the `for` loop around line ~401): `autoContinueCount = 0;`

3. In the `agent_end` handler, add a guard immediately after the `if (todos.length === 0) return;` check:
```typescript
const MAX_AUTO_CONTINUE = 20;
if (autoContinueCount >= MAX_AUTO_CONTINUE) {
    pi.sendMessage(
        {
            customType: "til-done-complete",
            content: `Auto-continue limit reached (${MAX_AUTO_CONTINUE} iterations). Remaining todos were not completed. Take over manually.`,
            display: true,
        },
        { triggerTurn: false },
    );
    return;
}
```

4. Increment the counter immediately before `pi.sendUserMessage(prompt)` at the bottom of the `agent_end` handler:
```typescript
autoContinueCount++;
pi.sendUserMessage(prompt);
```

**Verify:** The counter increments only when auto-continue fires, resets on any tool-driven progress, and caps at 20.

---

### Step 1.3 — Fix BUG: `agent_end` completion path persists stale state on branch navigation

**File:** `index.ts`
**Problem:** `agent_end` sets `todos = []` in memory when all items are completed, but this is not persisted to session history. When the user navigates branches, `reconstructState` restores the completed todos from the last tool result, and they visually reappear.
**Change:**

1. Remove `todos = [];` from the completion path in `agent_end` (line ~263). Keep the completed todos in state.

2. Replace the `updateUI(ctx, todos);` call in the completion path with a call that shows the "done" state:
```typescript
updateUI(ctx, todos); // todos is still populated with all-completed items
```

3. Modify the `agent_end` guard at the top. Change from:
```typescript
if (todos.length === 0) return;
```
to:
```typescript
if (todos.length === 0) return;

const hasIncomplete = todos.some(
    (t) => t.status === "not_started" || t.status === "in_progress",
);
if (!hasIncomplete) return;
```

This prevents re-sending the "all complete" message on subsequent `agent_end` fires when the todos are restored from session history.

4. In the `updateUI` function, add handling for the all-completed case. After the existing `if (todos.length > 0)` block's `for` loop that counts completed items, add:
```typescript
if (completed === total) {
    ctx.ui.setStatus("til-done", `✓ Done (${total} items)`);
    ctx.ui.setStatus("til-done-active", undefined);
    return;
}
```

**Result:** Completed todos persist in session history (via tool result `details`). `reconstructState` correctly restores them. `updateUI` shows "✓ Done (N items)". `agent_end` exits early when no incomplete items remain.

**Verify:** After completing all todos, branch away and back. UI should show "✓ Done (N items)" without flickering or re-triggering the completion message.

---

### Step 1.4 — Fix SEC-HIGH-02: Add runtime text length validation in `write_todos`

**File:** `index.ts`
**Problem:** `maxLength: 1000` in the TypeBox schema is enforced by the SDK's AJV pipeline, but the extension performs no defense-in-depth check. If SDK validation is bypassed, arbitrarily long text can enter the system.
**Change:**

In `write_todos.execute()`, add a validation check before creating the todos array (before line ~309):
```typescript
const MAX_TODO_TEXT_LENGTH = 1000;
const oversized = params.todos.findIndex((t) => t.text.length > MAX_TODO_TEXT_LENGTH);
if (oversized !== -1) {
    return {
        content: [
            {
                type: "text" as const,
                text: `Error: todo item at index ${oversized} exceeds maximum text length (${MAX_TODO_TEXT_LENGTH} characters)`,
            },
        ],
        details: { action: "write" as const, todos: [], error: "text too long" },
    };
}
```

**Verify:** Calling `write_todos` with text exceeding 1000 chars returns an error result.

---

### Step 1.5 — Fix SEC-HIGH-02: Tighten `isValidTodoItem` to reject extra properties and enforce text length

**File:** `index.ts`
**Problem:** `isValidTodoItem` allows objects with extra properties and arbitrarily long `text`. It's the gatekeeper for persisted data loaded from session files (potentially corrupted/tampered).
**Change:**

Replace the existing `isValidTodoItem` function (lines ~137–146) with:
```typescript
const MAX_TODO_TEXT_LENGTH = 1000;
const VALID_STATUSES = new Set(["not_started", "in_progress", "completed", "abandoned"]);

function isValidTodoItem(t: unknown): t is TodoItem {
    if (typeof t !== "object" || t === null) return false;
    const keys = Object.keys(t);
    if (keys.length !== 2) return false; // Must have exactly text + status
    const obj = t as Record<string, unknown>;
    if (typeof obj.text !== "string") return false;
    if (typeof obj.status !== "string") return false;
    if (!VALID_STATUSES.has(obj.status)) return false;
    if (obj.text.length > MAX_TODO_TEXT_LENGTH) return false;
    return true;
}
```

**Verify:** Objects with extra properties like `{ text: "x", status: "not_started", extra: true }` return `false`. Text longer than 1000 chars returns `false`.

---

## Phase 2 — Project Infrastructure

Set up all tooling to match sibling project `pi-lint`. After this phase, `npm run lint`, `npm run format:check`, `npm run typecheck`, and `npm run test` all work.

### Step 2.1 — Create `.gitignore`

**File to create:** `.gitignore`
**Content:**
```
node_modules/
dist/
coverage/
*.js
*.d.ts
!.prettierrc
!.eslintrc.*
```

**Verify:** `git status` no longer shows generated/artifact files as untracked.

---

### Step 2.2 — Update `package.json`

**File:** `package.json`
**Changes:**

1. Add `"type": "module"` to the top level.
2. Add `"scripts"` section:
```json
"scripts": {
    "lint": "eslint src/",
    "test": "vitest run",
    "test:watch": "vitest",
    "format": "prettier --write src/",
    "format:check": "prettier --check src/",
    "typecheck": "tsc --noEmit"
}
```
3. Add `"devDependencies"`:
```json
"devDependencies": {
    "@types/node": "^22.0.0",
    "eslint": "^9.0.0",
    "@eslint/js": "^9.0.0",
    "typescript-eslint": "^8.0.0",
    "prettier": "^3.0.0",
    "vitest": "^3.0.0"
}
```
4. Change `"main"` from `"index.ts"` to `"src/index.ts"`.
5. Change `"pi"."extensions"` from `["./index.ts"]` to `["./src/index.ts"]`.

**Verify:** `npm install` succeeds.

---

### Step 2.3 — Create `tsconfig.json`

**File to create:** `tsconfig.json`
**Content:** Match `pi-lint` pattern but adjusted for `src/` layout:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true
  },
  "include": ["src/**/*"]
}
```

**Verify:** `npm run typecheck` runs (will report errors since code is still in root `index.ts` — that's expected until Phase 3).

---

### Step 2.4 — Create `eslint.config.js`

**File to create:** `eslint.config.js`
**Content:** Match `pi-lint` exactly:
```javascript
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ["dist/", "node_modules/", "coverage/", "vitest.config.ts"],
  },
  {
    files: ["src/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
    },
  },
);
```

**Verify:** `npm run lint` runs (will report errors until Phase 3).

---

### Step 2.5 — Create `.prettierrc`

**File to create:** `.prettierrc`
**Content:** Match `pi-lint` exactly:
```json
{
  "semi": true,
  "singleQuote": false,
  "trailingComma": "all",
  "tabWidth": 2,
  "printWidth": 100
}
```

**Verify:** `npm run format:check src/` runs.

---

### Step 2.6 — Create `vitest.config.ts`

**File to create:** `vitest.config.ts`
**Content:** Match `pi-lint` pattern:
```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
```

**Verify:** `npm run test` runs (reports "no test files found" until Phase 6 — that's expected).

---

### Step 2.7 — Install dependencies and verify infrastructure

**Command:** `cd /home/blake/Documents/software/pi-extensions/pi-til-done && npm install`
**Verify:**
- `npm run typecheck` — runs without crashing (may report errors about missing `src/`)
- `npm run lint` — runs without crashing (may report errors about missing `src/`)
- `npm run format:check` — runs without crashing
- `npm run test` — runs and reports "no test files found"

---

## Phase 3 — Module Split

Move `index.ts` into `src/` as 7 focused modules + 1 entry point. The entry point becomes a thin orchestrator.

### Module Boundaries

| Module | Responsibility | Exports |
|--------|---------------|---------|
| `src/types.ts` | Type definitions, constants, lookup maps | `TodoStatus`, `TodoItem`, `TodoDetails`, `STATUS_ICONS`, `ACTION_TO_STATUS`, `ACTION_LABELS`, `VALID_STATUSES`, `TOOL_NAMES`, `MAX_TODO_TEXT_LENGTH`, `MAX_AUTO_CONTINUE`, `INITIAL_STATUS` |
| `src/validation.ts` | Input validation predicates | `isValidTodoItem`, `isIncomplete`, `validateTodoTextLength` |
| `src/formatting.ts` | Rendering, text formatting | `getPlainIcon`, `getStatusIcon`, `getTodoLabel`, `renderTodoList`, `formatTodoListText`, `formatRemainingList`, `renderToolResult` |
| `src/state.ts` | Mutable state management + UI sync | `getTodos`, `setTodos`, `updateTodoStatus`, `incrementAutoContinue`, `resetAutoContinue`, `reconstructState`, `updateUI` |
| `src/tools.ts` | Tool definitions | `createWriteTodosTool`, `createListTodosTool`, `createEditTodosTool` |
| `src/events.ts` | Event handler registration | `registerEventHandlers`, `registerMessageRenderers` |
| `src/index.ts` | Entry point orchestrator | `default` export (factory function) |

**Dependency graph** (no cycles):
```
types ← validation ← state ← tools
                      ↑       ↑
types ← formatting ← events ← tools
                      ↑
                   index ← events, tools
```

---

### Step 3.1 — Create `src/types.ts`

**File to create:** `src/types.ts`
**Content:**
```typescript
/** Status values for a todo item */
export type TodoStatus = "not_started" | "in_progress" | "completed" | "abandoned";

/** A single todo item */
export interface TodoItem {
  text: string;
  status: TodoStatus;
}

/** Details persisted in tool result entries for state reconstruction */
export interface TodoDetails {
  action: "write" | "list" | "edit";
  todos: TodoItem[];
  error?: string;
}

// ── Constants ──

/** Maximum length of a todo item's text string */
export const MAX_TODO_TEXT_LENGTH = 1000;

/** Maximum consecutive auto-continue iterations before circuit breaker trips */
export const MAX_AUTO_CONTINUE = 20;

/** Maximum number of todos allowed */
export const MAX_TODOS = 100;

/** Maximum number of indices in a single edit_todos call */
export const MAX_INDICES = 50;

/** Initial status for newly created todo items */
export const INITIAL_STATUS: TodoStatus = "not_started";

/** Set of valid TodoStatus values for runtime validation */
export const VALID_STATUSES: ReadonlySet<string> = new Set<TodoStatus>([
  "not_started",
  "in_progress",
  "completed",
  "abandoned",
]);

/** Tool names that produce TodoDetails for state reconstruction */
export const TOOL_NAMES = new Set(["write_todos", "list_todos", "edit_todos"]);

// ── Lookup Maps (single source of truth for all mappings) ──

/** Status → plain-text icon character */
export const STATUS_ICONS: Record<TodoStatus, string> = {
  not_started: "–",
  in_progress: "●",
  completed: "✓",
  abandoned: "✗",
};

/** edit_todos action → resulting TodoStatus */
export const ACTION_TO_STATUS: Record<string, TodoStatus> = {
  start: "in_progress",
  complete: "completed",
  abandon: "abandoned",
};

/** edit_todos action → human-readable past-tense label */
export const ACTION_LABELS: Record<string, string> = {
  start: "Started",
  complete: "Completed",
  abandon: "Abandoned",
};
```

**Verify:** `npx tsc --noEmit src/types.ts` passes (with skipLibCheck).

---

### Step 3.2 — Create `src/validation.ts`

**File to create:** `src/validation.ts`
**Content:**
```typescript
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
export function findOversizedItem(
  items: readonly { text: string }[],
  maxLength: number,
): number {
  return items.findIndex((t) => t.text.length > maxLength);
}
```

**Verify:** `npx tsc --noEmit` passes for this file.

---

### Step 3.3 — Create `src/formatting.ts`

**File to create:** `src/formatting.ts`
**Content:**
```typescript
import type { Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { TodoItem, TodoStatus, TodoDetails } from "./types";
import { STATUS_ICONS } from "./types";

// ── Plain-Text Formatting (for LLM content) ──

/** Returns the plain-text icon character for a given status */
export function getPlainIcon(status: TodoStatus): string {
  return STATUS_ICONS[status];
}

/** Formats the full todo list as plain text for LLM consumption */
export function formatTodoListText(todos: readonly TodoItem[]): string {
  if (todos.length === 0) return "No todos";
  return todos
    .map((t, i) => `${getPlainIcon(t.status)} [${i}] ${t.text}`)
    .join("\n");
}

/** Formats a subset of todos (by index) as plain text for remaining-item display */
export function formatRemainingList(
  todos: readonly TodoItem[],
  indices: readonly number[],
): string {
  return indices
    .map((i) => `${getPlainIcon(todos[i].status)} [${i}] ${todos[i].text}`)
    .join("\n");
}

// ── Themed Formatting (for TUI rendering) ──

/** Returns a themed (colored) icon string for a given status */
export function getStatusIcon(status: TodoStatus, theme: Theme): string {
  switch (status) {
    case "not_started":
      return theme.fg("dim", STATUS_ICONS.not_started);
    case "in_progress":
      return theme.fg("warning", STATUS_ICONS.in_progress);
    case "completed":
      return theme.fg("success", STATUS_ICONS.completed);
    case "abandoned":
      return theme.fg("error", STATUS_ICONS.abandoned);
  }
}

/** Returns a themed label for a todo item, with strikethrough for terminal statuses */
export function getTodoLabel(text: string, status: TodoStatus, theme: Theme): string {
  if (status === "completed" || status === "abandoned") {
    return theme.fg("dim", theme.strikethrough(text));
  }
  return theme.fg("text", text);
}

/** Renders the full todo list as themed text for TUI display */
export function renderTodoList(todos: readonly TodoItem[], theme: Theme): string {
  if (todos.length === 0) return theme.fg("dim", "No todos");
  return todos
    .map(
      (t, i) =>
        `${getStatusIcon(t.status, theme)} ${theme.fg("accent", `[${i}]`)} ${getTodoLabel(t.text, t.status, theme)}`,
    )
    .join("\n");
}

// ── Tool Result Renderer ──

/** Shared renderResult for all three tools — renders themed todo list or error */
export function renderToolResult(
  result: { content: Array<{ type: string; text?: string }>; details?: unknown },
  _options: { expanded: boolean; isPartial: boolean },
  theme: Theme,
): Text {
  const details = result.details as TodoDetails | undefined;
  if (!details) {
    const text = result.content[0]?.text ?? "";
    return new Text(text, 0, 0);
  }
  if (details.error) {
    return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);
  }
  return new Text(renderTodoList(details.todos, theme), 0, 0);
}
```

**Verify:** `npx tsc --noEmit` passes for this file.

---

### Step 3.4 — Create `src/state.ts`

**File to create:** `src/state.ts`
**Content:**
```typescript
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TodoItem, TodoStatus } from "./types";
import { TOOL_NAMES } from "./types";
import { isValidTodoItem, isIncomplete } from "./validation";

// ── Mutable State ──

let todos: TodoItem[] = [];
let autoContinueCount = 0;

// ── State Accessors ──

/** Returns a readonly reference to the current todos */
export function getTodos(): readonly TodoItem[] {
  return todos;
}

/** Replaces the entire todo list. Resets auto-continue counter. */
export function setTodos(newTodos: TodoItem[]): void {
  todos = newTodos;
  autoContinueCount = 0;
}

/** Updates the status of specific todo items by index. Resets auto-continue counter. */
export function updateTodoStatus(
  indices: readonly number[],
  newStatus: TodoStatus,
): void {
  for (const idx of indices) {
    todos[idx] = { ...todos[idx], status: newStatus };
  }
  autoContinueCount = 0;
}

/** Increments and returns the auto-continue counter */
export function incrementAutoContinue(): number {
  return ++autoContinueCount;
}

/** Resets the auto-continue counter (called when todos are set or edited) */
export function resetAutoContinue(): void {
  autoContinueCount = 0;
}

// ── State Reconstruction ──

/**
 * Reconstructs todo state from session history.
 * Scans the branch in reverse to find the last tool result from this extension.
 * Filters entries through isValidTodoItem for safety.
 */
export function reconstructState(ctx: ExtensionContext): TodoItem[] {
  const branch = ctx.sessionManager.getBranch();

  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (entry.type !== "message") continue;
    const msg = entry.message;
    if (msg.role !== "toolResult") continue;
    if (!TOOL_NAMES.has(msg.toolName)) continue;

    const details = msg.details as { todos?: unknown[] } | undefined;
    if (details?.todos && Array.isArray(details.todos)) {
      const valid = details.todos.filter(isValidTodoItem);
      return valid.map((t) => ({ text: t.text, status: t.status }));
    }
  }

  return [];
}

// ── UI Sync ──

/** Updates the status bar and active-items display to reflect current state */
export function updateUI(ctx: ExtensionContext, todoList: readonly TodoItem[]): void {
  if (!ctx.hasUI) return;

  if (todoList.length === 0) {
    ctx.ui.setStatus("til-done", undefined);
    ctx.ui.setStatus("til-done-active", undefined);
    return;
  }

  const total = todoList.length;
  let completed = 0;
  const activeLines: string[] = [];

  for (let i = 0; i < total; i++) {
    const item = todoList[i];
    if (item.status === "completed") {
      completed++;
    }
    if (item.status === "in_progress") {
      activeLines.push(`[${i}] ${item.text}`);
    }
  }

  // All completed — show done state
  if (completed === total) {
    ctx.ui.setStatus("til-done", `✓ Done (${total} items)`);
    ctx.ui.setStatus("til-done-active", undefined);
    return;
  }

  ctx.ui.setStatus("til-done", `📋 ${completed}/${total}`);
  ctx.ui.setStatus(
    "til-done-active",
    activeLines.length > 0 ? activeLines.join("\n") : undefined,
  );
}
```

**Verify:** `npx tsc --noEmit` passes for this file.

---

### Step 3.5 — Create `src/tools.ts`

**File to create:** `src/tools.ts`
**Content:**
```typescript
import { StringEnum } from "@earendil-works/pi-ai";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import type { TodoStatus, TodoDetails } from "./types";
import { ACTION_TO_STATUS, ACTION_LABELS, INITIAL_STATUS, MAX_TODO_TEXT_LENGTH } from "./types";
import { cloneTodos, findOversizedItem } from "./validation";
import { formatTodoListText, renderToolResult } from "./formatting";
import {
  getTodos,
  setTodos,
  updateTodoStatus,
  reconstructState,
  updateUI,
} from "./state";
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
  action: StringEnum(["start", "complete", "abandon"] as const, {
    description: "Action to apply to the specified indices",
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
      "Write a full list of todo items, replacing any existing list. Each item starts as 'not_started'. Use this to create or replace the entire plan.",
    parameters: WriteTodosParams,
    promptSnippet: "Manage a todo list: write, list, edit (start/complete/abandon by indices)",
    promptGuidelines: [
      "Use write_todos to create or replace the full todo list at the start of a task.",
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
        details: { action: "list" as const, todos: cloneTodos(getTodos()) },
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
      "Apply an action ('start', 'complete', or 'abandon') to one or more todo items by their 0-based indices. Batch operations are atomic — if any index is invalid, no changes are applied.",
    parameters: EditTodosParams,

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
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
            todos: cloneTodos(currentTodos),
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
      const indices = args.indices.map((i: number) => `[${i}]`).join(", ");
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
```

**Verify:** `npx tsc --noEmit` passes for this file.

---

### Step 3.6 — Create `src/events.ts`

**File to create:** `src/events.ts`
**Content:**
```typescript
import type {
  ExtensionAPI,
  ExtensionContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { MAX_AUTO_CONTINUE } from "./types";
import { isIncomplete, cloneTodos } from "./validation";
import { formatTodoListText, formatRemainingList } from "./formatting";
import {
  getTodos,
  reconstructState,
  updateUI,
  incrementAutoContinue,
} from "./state";

// ── Message Renderers ──

export function registerMessageRenderers(pi: ExtensionAPI): void {
  pi.registerMessageRenderer(
    "til-done-context",
    (message, _opts, theme) => {
      return new Text(
        theme.fg("accent", "📋 ") + theme.fg("dim", message.content as string),
        0,
        0,
      );
    },
  );

  pi.registerMessageRenderer(
    "til-done-complete",
    (message, _opts, theme) => {
      return new Text(
        theme.fg("success", "✓ ") + theme.fg("text", message.content as string),
        0,
        0,
      );
    },
  );
}

// ── Event Handlers ──

function handleStateReconstruction(_event: unknown, ctx: ExtensionContext): void {
  const todos = reconstructState(ctx);
  // setTodos resets autoContinueCount
  // We use a direct assignment here to avoid the counter reset,
  // since state reconstruction is not a user action.
  // However, we still want to reset the counter on reconstruction.
  // We'll call the setter:
  const { setTodos } = require("./state");
  setTodos(todos);
  updateUI(ctx, todos);
}

export function registerEventHandlers(pi: ExtensionAPI): void {
  // ── State Reconstruction Events ──

  pi.on("session_start", async (_event, ctx) => {
    const todos = reconstructState(ctx);
    setTodosViaModule(todos);
    updateUI(ctx, todos);
  });

  pi.on("session_tree", async (_event, ctx) => {
    const todos = reconstructState(ctx);
    setTodosViaModule(todos);
    updateUI(ctx, todos);
  });

  // ── before_agent_start — Inject hidden context ──

  pi.on("before_agent_start", async () => {
    const todos = getTodos();
    const remaining = todos.filter((t) => isIncomplete(t.status)).length;
    if (remaining === 0) return;

    const todoList = formatTodoListText(todos);

    return {
      message: {
        customType: "til-done-context",
        content: `[TILL-DONE ACTIVE]\n\nCurrent todo list:\n${todoList}\n\n${remaining} item(s) remaining. Continue working through the list. Call edit_todos with action 'start' on the next item before working on it, then 'complete' when done.`,
        display: false,
      },
    };
  });

  // ── agent_end — Auto-continue when incomplete todos remain ──

  pi.on("agent_end", async (_event, ctx) => {
    const todos = getTodos();

    if (todos.length === 0) return;

    // Check if any items are incomplete
    if (!todos.some((t) => isIncomplete(t.status))) return;

    // Circuit breaker
    const count = incrementAutoContinue();
    if (count > MAX_AUTO_CONTINUE) {
      pi.sendMessage(
        {
          customType: "til-done-complete",
          content: `Auto-continue limit reached (${MAX_AUTO_CONTINUE} iterations). Remaining todos were not completed. Take over manually.`,
          display: true,
        },
        { triggerTurn: false },
      );
      return;
    }

    // Find incomplete items
    const incompleteIndices: number[] = [];
    let nextInProgressIdx = -1;
    let firstNotStartedIdx = -1;

    for (let i = 0; i < todos.length; i++) {
      if (!isIncomplete(todos[i].status)) continue;
      incompleteIndices.push(i);
      if (todos[i].status === "in_progress" && nextInProgressIdx === -1) {
        nextInProgressIdx = i;
      }
      if (todos[i].status === "not_started" && firstNotStartedIdx === -1) {
        firstNotStartedIdx = i;
      }
    }

    // All done (completed or abandoned) — this shouldn't happen due to the guard above,
    // but is a safety net
    if (incompleteIndices.length === 0) return;

    // Build remaining items display
    const remainingList = formatRemainingList(todos, incompleteIndices);

    // Select next item: prefer in-progress, then first not_started
    const nextIdx = nextInProgressIdx !== -1 ? nextInProgressIdx : firstNotStartedIdx;
    const nextItem = todos[nextIdx];
    const nextAction = nextItem.status === "in_progress" ? "complete" : "start";

    // Structured prompt — no interpolation of todo.text into instructions
    const prompt = [
      "There are still incomplete todos. Continue working on the remaining todos.",
      "",
      "Remaining items:",
      remainingList,
      "",
      `Next action: edit_todos with action '${nextAction}' and indices [${nextIdx}]`,
    ].join("\n");

    pi.sendUserMessage(prompt);
  });
}

/** Helper to set todos from event handlers without circular import issues */
function setTodosViaModule(todos: import("./types").TodoItem[]): void {
  // Dynamic import avoided — this function exists to break circular dependency
  // We import setTodos at the top level through a re-export pattern
  const { setTodos } = require("./state") as typeof import("./state");
  setTodos(todos);
}
```

**IMPORTANT NOTE FOR IMPLEMENTER:** The `require()` calls above are a placeholder pattern to avoid circular imports. Since `events.ts` imports from `state.ts` and both are ESM modules, replace the `require("./state")` calls and `setTodosViaModule` with a direct named import of `setTodos` from `./state` at the top of the file. The `require()` pattern will not work in ESM. The correct approach is:

```typescript
import { getTodos, setTodos, reconstructState, updateUI, incrementAutoContinue } from "./state";
```

Then replace `setTodosViaModule(todos)` with `setTodos(todos)` directly, and remove the `setTodosViaModule` function entirely. Also remove the `handleStateReconstruction` function (it's unused).

**Verify:** `npx tsc --noEmit` passes for this file.

---

### Step 3.7 — Create `src/index.ts` (thin orchestrator)

**File to create:** `src/index.ts`
**Content:**
```typescript
/**
 * Till-Done Extension — Todo list that iterates until all tasks are complete
 *
 * Registers 3 tools: write_todos, list_todos, edit_todos
 * Todo items are ordered and identified by 0-based index.
 * Statuses: not_started (–), in_progress (●), completed (✓), abandoned (✗)
 *
 * Features:
 * - Full todo list in LLM content after every tool call
 * - Full todo list rendered in history with themed status icons
 * - Progress published via setStatus() for powerline extension to display
 * - Active items published via setStatus() for powerline extension to display
 * - Auto-continue via sendUserMessage when incomplete todos remain at agent_end
 * - Circuit breaker limits auto-continue to 20 iterations
 * - Hidden context injection via before_agent_start listing remaining todos
 * - State persisted in tool result details for proper branching support
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerMessageRenderers, registerEventHandlers } from "./events";
import {
  createWriteTodosTool,
  createListTodosTool,
  createEditTodosTool,
} from "./tools";

export default function (pi: ExtensionAPI): void {
  // Register message renderers
  registerMessageRenderers(pi);

  // Register event handlers
  registerEventHandlers(pi);

  // Register tools
  pi.registerTool(createWriteTodosTool());
  pi.registerTool(createListTodosTool());
  pi.registerTool(createEditTodosTool());
}
```

**Verify:** `npx tsc --noEmit` passes. `npm run typecheck` passes.

---

### Step 3.8 — Delete root `index.ts`

**File to delete:** `index.ts` (project root)

**Pre-deletion verification:**
1. `npm run typecheck` passes (reads from `src/` via `tsconfig.json` `rootDir`)
2. `npm run lint` passes or shows only warnings
3. The `"pi"."extensions"` path in `package.json` already points to `./src/index.ts` (from Step 2.2)

**Command:** `rm index.ts`

**Post-deletion verification:**
1. `npm run typecheck` — passes
2. `npm run lint` — passes or shows only fixable issues
3. `ls index.ts` — file not found

---

### Step 3.9 — Verify module split is clean

**Checks:**
1. `npm run typecheck` — 0 errors
2. `npm run lint` — 0 errors (warnings acceptable)
3. `npm run format:check` — 0 errors
4. `ls src/*.ts` shows exactly: `types.ts`, `validation.ts`, `formatting.ts`, `state.ts`, `tools.ts`, `events.ts`, `index.ts`
5. `ls index.ts` — file not found
6. `grep -r "require(" src/` — returns nothing (no `require()` calls)
7. `grep -r "from.*\.\./\.\." src/` — returns nothing (no deep relative imports)

---

## Phase 4 — Code Smell Cleanup

### Step 4.1 — Rename `TillDoneDetails` → `TodoDetails`

Already done in the module split (Step 3.1). The new type is `TodoDetails` in `src/types.ts`. Verify no references to `TillDoneDetails` remain:

```
grep -r "TillDoneDetails" src/
```

Should return nothing.

---

### Step 4.2 — Extract `isIncomplete()` helper (eliminates SMELL-02)

Already done in the module split (Step 3.2). Verify that the incomplete check is used consistently:

```
grep -r "not_started.*in_progress\|in_progress.*not_started" src/
```

Should return only the `isIncomplete` function definition in `src/validation.ts`.

---

### Step 4.3 — Extract `cloneTodos()` helper (eliminates SMELL-03)

Already done in the module split (Step 3.2). Verify:

```
grep -r "\.map.*\.\.\.t" src/
```

Should return nothing — all deep-copy patterns replaced by `cloneTodos()`.

---

### Step 4.4 — Extract `formatRemainingList()` helper (eliminates SMELL-06 partial)

Already done in the module split (Step 3.3). The inline `remainingList` construction in `agent_end` is now a call to `formatRemainingList()`.

---

### Step 4.5 — Replace nested ternaries with lookup maps (eliminates SMELL-12, SMELL-13, SMELL-14)

Already done in the module split via:
- `STATUS_ICONS` lookup map (replaces nested ternary in `formatTodoListText`)
- `ACTION_TO_STATUS` lookup map (replaces nested ternary for `newStatus` in `edit_todos`)
- `ACTION_LABELS` lookup map (replaces nested ternary for `actionLabel` in `edit_todos`)

Verify:

```
grep -r "?" src/ | grep -v "\.test\." | grep "?" | head -20
```

Review output to confirm no multi-line nested ternaries remain.

---

### Step 4.6 — Single-pass `updateUI` (eliminates SMELL-07, EFF-LOW-01)

Already done in the module split (Step 3.4). The `updateUI` function now uses a single `for` loop that counts completed items AND collects active lines simultaneously.

---

### Step 4.7 — Remove the stale plan document (eliminates SMELL-16)

**File to delete:** `docs/plans/til-done.md`

**Reason:** Describes a 5-tool architecture that no longer exists. Actively misleading as reference material.

**Command:** `rm -rf docs/`

**Verify:** `ls docs/` — not found.

---

### Step 4.8 — Rename `remainingList` variable (eliminates SMELL-09)

Already addressed in the module split — the variable is now `remainingList` but constructed via `formatRemainingList()`. The function name `formatRemainingList` clearly describes what it returns. No further action needed.

---

### Step 4.9 — Add explicit guard for `nextIdx` safety (eliminates SMELL-18)

**File:** `src/events.ts`

In the `agent_end` handler, after computing `nextIdx`, add an explicit guard:
```typescript
if (nextIdx < 0 || nextIdx >= todos.length) {
  // Safety net — should never happen if incompleteIndices.length > 0
  return;
}
```

This makes the implicit guarantee explicit.

**Verify:** `npm run typecheck` passes.

---

### Step 4.10 — Remove audit/report files from project root

**Files to delete:**
- `AUDIT-REPORT.md`
- `CODE_SMELL_AUDIT_REPORT.md`
- `CODE_SMELL_REPORT.md`
- `RESEARCH-LINTING.md`
- `SECURITY_EFFICIENCY_AUDIT_REPORT.md`
- `TEST_AUDIT_REPORT.md`

These are reference documents produced during the audit, not part of the extension. They should not be in the shipped project.

**Command:**
```bash
rm AUDIT-REPORT.md CODE_SMELL_AUDIT_REPORT.md CODE_SMELL_REPORT.md RESEARCH-LINTING.md SECURITY_EFFICIENCY_AUDIT_REPORT.md TEST_AUDIT_REPORT.md
```

**Verify:** `ls *.md` returns only `IMPROVEMENT_PLAN.md` (and optionally a `README.md` if one exists).

---

## Phase 5 — Efficiency Improvements

### Step 5.1 — Reduce snapshot duplication in `list_todos` and `edit_todos` error paths

**File:** `src/tools.ts`
**Problem:** EFF-HIGH-01 — Every tool result stores a full todo snapshot, causing quadratic session growth.
**Change:**

1. In `createListTodosTool().execute()`, omit the `todos` snapshot from details. Store only the action:
```typescript
details: { action: "list" as const, todos: [] },
```

`list_todos` is a read-only operation — it doesn't change state. `reconstructState` should never need to reconstruct from a `list_todos` result because there will always be a preceding `write_todos` or `edit_todos` that reflects the actual state.

2. In `createEditTodosTool().execute()`, in the **error path** (when indices are invalid), omit the snapshot:
```typescript
details: {
  action: "edit" as const,
  todos: [],
  error: `indices [${invalid.join(", ")}] out of range (0 to ${currentTodos.length - 1})`,
},
```

Error paths don't change state, so the snapshot is unnecessary for reconstruction.

3. Keep full snapshots only in:
   - `write_todos` success (authoritative full-state write)
   - `edit_todos` success (state mutation)

**Verify:** `npm run typecheck` passes. `reconstructState` still works because it finds the last tool result with a non-empty `todos` array.

---

### Step 5.2 — Update `reconstructState` to skip empty snapshots

**File:** `src/state.ts`
**Problem:** After Step 5.1, some tool results have `todos: []`. `reconstructState` should skip these.
**Change:**

In `reconstructState`, change the validation condition from:
```typescript
if (details?.todos && Array.isArray(details.todos)) {
```
to:
```typescript
if (details?.todos && Array.isArray(details.todos) && details.todos.length > 0) {
```

This ensures empty snapshots from `list_todos` or error paths are not used for reconstruction.

**Verify:** `npm run typecheck` passes.

---

## Phase 6 — Comprehensive Tests

All tests use Vitest. Test files go in `src/__tests__/`. Mocks for framework types are defined in a shared test helper file.

### Step 6.1 — Create test helper: `src/__tests__/helpers/mocks.ts`

**File to create:** `src/__tests__/helpers/mocks.ts`
**Content:** Mocks for `Theme`, `ExtensionContext`, and `ExtensionAPI`:

```typescript
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { vi } from "vitest";

/** Creates a mock Theme that returns its arguments wrapped in brackets for assertion */
export function createMockTheme(): Theme {
  return {
    fg: vi.fn((color: string, text: string) => `[${color}]${text}`),
    bold: vi.fn((text: string) => `**${text}**`),
    strikethrough: vi.fn((text: string) => `~~${text}~~`),
  } as unknown as Theme;
}

/** Creates a mock ExtensionContext with a configurable branch */
export function createMockContext(
  branch: Array<{
    type: string;
    message: {
      role: string;
      toolName: string;
      details?: unknown;
    };
  }> = [],
): ExtensionContext {
  return {
    hasUI: true,
    ui: {
      setStatus: vi.fn(),
    },
    sessionManager: {
      getBranch: vi.fn(() => branch),
    },
  } as unknown as ExtensionContext;
}

/** Creates a mock ExtensionAPI */
export function createMockAPI(): {
  api: ExtensionAPI;
  sendMessage: ReturnType<typeof vi.fn>;
  sendUserMessage: ReturnType<typeof vi.fn>;
  registerTool: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  registerMessageRenderer: ReturnType<typeof vi.fn>;
} {
  const sendMessage = vi.fn();
  const sendUserMessage = vi.fn();
  const registerTool = vi.fn();
  const on = vi.fn();
  const registerMessageRenderer = vi.fn();

  return {
    api: {
      sendMessage,
      sendUserMessage,
      registerTool,
      on,
      registerMessageRenderer,
    } as unknown as ExtensionAPI,
    sendMessage,
    sendUserMessage,
    registerTool,
    on,
    registerMessageRenderer,
  };
}
```

**Verify:** `npm run typecheck` passes.

---

### Step 6.2 — Create `src/__tests__/validation.test.ts`

**File to create:** `src/__tests__/validation.test.ts`
**Tests to write:**

```
describe("isValidTodoItem")
  ✓ returns true for valid TodoItem { text: "hello", status: "not_started" }
  ✓ returns true for each valid status: not_started, in_progress, completed, abandoned
  ✓ returns false for null
  ✓ returns false for undefined
  ✓ returns false for string
  ✓ returns false for number
  ✓ returns false for object with extra property { text, status, extra }
  ✓ returns false for object missing "status" key { text: "x" }
  ✓ returns false for object missing "text" key { status: "not_started" }
  ✓ returns false for non-string text (text: 123)
  ✓ returns false for non-string status (status: 123)
  ✓ returns false for invalid status "unknown"
  ✓ returns false for empty text string ""
  ✓ returns false for text exceeding MAX_TODO_TEXT_LENGTH (1001 chars)
  ✓ returns true for text at exactly MAX_TODO_TEXT_LENGTH (1000 chars)

describe("isIncomplete")
  ✓ returns true for "not_started"
  ✓ returns true for "in_progress"
  ✓ returns false for "completed"
  ✓ returns false for "abandoned"

describe("cloneTodos")
  ✓ returns a new array with same-length and same values
  ✓ returned items are different object references (deep copy)
  ✓ mutation of clone does not affect original

describe("findOversizedItem")
  ✓ returns -1 when all items are within limit
  ✓ returns 0 for first oversized item
  ✓ returns correct index for middle oversized item
  ✓ returns last index for only-last oversized item
```

**Verify:** `npm run test` — all tests pass.

---

### Step 6.3 — Create `src/__tests__/formatting.test.ts`

**File to create:** `src/__tests__/formatting.test.ts`
**Tests to write:**

```
describe("getPlainIcon")
  ✓ returns "–" for not_started
  ✓ returns "●" for in_progress
  ✓ returns "✓" for completed
  ✓ returns "✗" for abandoned

describe("formatTodoListText")
  ✓ returns "No todos" for empty array
  ✓ formats single item correctly: "– [0] my task"
  ✓ formats multiple items with correct icons and indices
  ✓ uses correct icon for each status

describe("formatRemainingList")
  ✓ formats only the specified indices
  ✓ preserves order from the indices array
  ✓ formats with correct icons

describe("getStatusIcon") (with mockTheme)
  ✓ calls theme.fg("dim", "–") for not_started
  ✓ calls theme.fg("warning", "●") for in_progress
  ✓ calls theme.fg("success", "✓") for completed
  ✓ calls theme.fg("error", "✗") for abandoned

describe("getTodoLabel") (with mockTheme)
  ✓ calls theme.fg("dim", strikethrough(text)) for completed
  ✓ calls theme.fg("dim", strikethrough(text)) for abandoned
  ✓ calls theme.fg("text", text) for not_started
  ✓ calls theme.fg("text", text) for in_progress

describe("renderTodoList") (with mockTheme)
  ✓ returns themed "No todos" for empty array
  ✓ formats each item with icon, index, and label

describe("renderToolResult")
  ✓ returns Text with content[0].text when no details
  ✓ returns Text with error styling when details.error is set
  ✓ returns Text with rendered todo list when details has todos
```

**Verify:** `npm run test` — all tests pass.

---

### Step 6.4 — Create `src/__tests__/state.test.ts`

**File to create:** `src/__tests__/state.test.ts`

**IMPORTANT:** State module has module-level mutable state. Each test must call a reset function. Add a `resetState()` export to `src/state.ts`:
```typescript
/** Resets all mutable state. For testing only. */
export function resetState(): void {
  todos = [];
  autoContinueCount = 0;
}
```

**Tests to write:**

```
describe("state management")
  beforeEach: call resetState()

  describe("getTodos / setTodos")
    ✓ getTodos returns empty array initially
    ✓ setTodos replaces todos and getTodos returns them
    ✓ setTodos resets autoContinueCount to 0

  describe("updateTodoStatus")
    ✓ updates status of specified indices
    ✓ does not affect other indices
    ✓ resets autoContinueCount to 0

  describe("incrementAutoContinue")
    ✓ increments from 0 to 1, returns 1
    ✓ increments from 1 to 2, returns 2
    ✓ accumulates across calls

  describe("resetAutoContinue")
    ✓ resets counter to 0

describe("reconstructState")
  beforeEach: call resetState()

  ✓ returns empty array for empty branch
  ✓ returns empty array when no matching tool results exist
  ✓ finds last matching tool result (reverse scan)
  ✓ skips earlier results when later exists
  ✓ filters out invalid todo items
  ✓ strips extra properties from valid items
  ✓ returns deep copies (not original references)
  ✓ skips results with empty todos array (from list_todos or error paths)

describe("updateUI")
  ✓ clears both status keys when todos is empty
  ✓ shows progress counter "📋 X/Y" when some completed
  ✓ shows "✓ Done (N items)" when all completed
  ✓ shows active items for in-progress items
  ✓ clears active items when none are in-progress
  ✓ does nothing when hasUI is false
  ✓ single-pass: completed count and active lines computed correctly together
```

**Verify:** `npm run test` — all tests pass.

---

### Step 6.5 — Create `src/__tests__/tools.test.ts`

**File to create:** `src/__tests__/tools.test.ts`
**Tests to write:**

These tests call the tool factory functions to get tool definitions, then call `execute()` directly.

```
describe("write_todos tool")
  beforeEach: resetState()

  ✓ creates todos with not_started status
  ✓ returns content with formatted todo list
  ✓ returns details with action "write" and cloned todos
  ✓ rejects text exceeding MAX_TODO_TEXT_LENGTH with error result
  ✓ rejects item at index > 0 with correct index in error message
  ✓ calls updateUI via context

describe("list_todos tool")
  beforeEach: resetState()

  ✓ returns formatted todo list in content
  ✓ returns details with action "list"
  ✓ does not modify state
  ✓ returns "No todos" when state is empty

describe("edit_todos tool")
  beforeEach: resetState()

  ✓ applies "start" action to specified indices
  ✓ applies "complete" action to specified indices
  ✓ applies "abandon" action to specified indices
  ✓ returns error when no todos exist
  ✓ returns error when index is out of range
  ✓ returns error when negative index provided
  ✓ atomic: no mutation when any index is invalid
  ✓ returns content with action label and formatted list
  ✓ returns details with action "edit" and cloned todos
  ✓ calls updateUI via context

describe("renderCall") (for each tool)
  ✓ write_todos renderCall shows name and item count
  ✓ list_todos renderCall shows name
  ✓ edit_todos renderCall shows name, action, and indices

describe("renderResult") (shared via renderToolResult)
  ✓ renders error message for error details
  ✓ renders todo list for success details
  ✓ renders raw content text when no details
```

**Verify:** `npm run test` — all tests pass.

---

### Step 6.6 — Create `src/__tests__/events.test.ts`

**File to create:** `src/__tests__/events.test.ts`
**Tests to write:**

```
describe("registerMessageRenderers")
  ✓ registers "til-done-context" renderer
  ✓ registers "til-done-complete" renderer
  ✓ "til-done-context" renderer returns themed text
  ✓ "til-done-complete" renderer returns themed text

describe("registerEventHandlers")
  beforeEach: resetState()

  ✓ registers handlers for session_start, session_tree, before_agent_start, agent_end

describe("session_start handler")
  ✓ reconstructs state and updates UI

describe("session_tree handler")
  ✓ reconstructs state and updates UI

describe("before_agent_start handler")
  beforeEach: setTodos([...some incomplete todos...])

  ✓ returns context message when incomplete todos exist
  ✓ returns undefined when all todos are completed
  ✓ returns undefined when todos array is empty
  ✓ message has display: false
  ✓ message contains formatted todo list

describe("agent_end handler")
  beforeEach: setTodos([...])

  ✓ sends sendUserMessage when incomplete todos remain
  ✓ sendUserMessage content does not contain todo.text in instruction portion (SEC-CRIT-01)
  ✓ returns early when todos is empty
  ✓ returns early when all todos are completed
  ✓ sends completion message via sendMessage when auto-continue limit reached
  ✓ does not send sendUserMessage when limit reached
  ✓ increments auto-continue counter on each call
  ✓ resets counter is NOT called by agent_end itself (only by tool actions)
  ✓ prompt contains structured format with remaining list
  ✓ prompt contains next action instruction with index and action name only
```

**Verify:** `npm run test` — all tests pass.

---

### Step 6.7 — Create `src/__tests__/index.test.ts`

**File to create:** `src/__tests__/index.test.ts`
**Tests to write:**

```
describe("default export (extension factory)")
  ✓ registers 3 tools (write_todos, list_todos, edit_todos)
  ✓ registers 2 message renderers
  ✓ registers 4+ event handlers (session_start, session_tree, before_agent_start, agent_end)
  ✓ does not throw
```

This is a smoke test verifying the orchestrator wires everything correctly.

**Verify:** `npm run test` — all tests pass.

---

### Step 6.8 — Verify full test suite

**Command:** `npm run test`
**Expected:** All tests pass. Zero failures.
**Also verify:** `npm run test -- --coverage` runs (coverage reporting is informational, no threshold gate yet).

---

## Phase 7 — Lint & Type Compliance

### Step 7.1 — Run formatter on all source files

**Command:** `npm run format`
**Expected:** All files in `src/` are reformatted to match `.prettierrc`.

**Verify:** `npm run format:check` exits 0.

---

### Step 7.2 — Fix type errors

**Command:** `npm run typecheck 2>&1`
**Expected:** 0 errors.

If errors remain, fix each one:
- Missing return type annotations on exported functions
- Implicit `any` types
- Unused imports
- Incorrect generic parameters on tool definitions

**Common expected fixes:**
- `ToolDefinition` generic may need explicit type parameters
- `renderToolResult` return type needs to match `Component` (the `Text` class)
- `ExtensionContext` mock types in tests may need `as unknown as ExtensionContext`

**Verify:** `npm run typecheck` exits 0.

---

### Step 7.3 — Fix lint errors

**Command:** `npm run lint 2>&1`
**Expected:** 0 errors. Warnings are acceptable.

Common expected fixes:
- `@typescript-eslint/no-explicit-any` — replace `any` with proper types
- `@typescript-eslint/no-unused-vars` — remove or underscore-prefix unused params
- Remove any remaining `require()` calls
- Ensure all exports are used

**Verify:** `npm run lint` exits 0.

---

### Step 7.4 — Verify all checks pass simultaneously

Run all checks in sequence:
```bash
npm run format:check && npm run typecheck && npm run lint && npm run test
```

**Expected:** All four commands exit 0.

---

## Phase 8 — Final Verification

### Step 8.1 — Clean git state

```bash
git add -A
git status
```

**Expected files in git:**
```
.eslint.config.js
.gitignore
.prettierrc
IMPROVEMENT_PLAN.md
package.json
tsconfig.json
vitest.config.ts
src/
  index.ts
  types.ts
  validation.ts
  formatting.ts
  state.ts
  tools.ts
  events.ts
  __tests__/
    helpers/
      mocks.ts
    validation.test.ts
    formatting.test.ts
    state.test.ts
    tools.test.ts
    events.test.ts
    index.test.ts
```

**Files NOT in git:**
```
index.ts                          (deleted — moved to src/)
docs/                             (deleted — stale)
AUDIT-REPORT.md                   (deleted — audit artifact)
CODE_SMELL_*.md                   (deleted — audit artifact)
RESEARCH-LINTING.md               (deleted — audit artifact)
SECURITY_EFFICIENCY_AUDIT_REPORT.md (deleted — audit artifact)
TEST_AUDIT_REPORT.md              (deleted — audit artifact)
node_modules/                     (ignored)
dist/                             (ignored)
coverage/                         (ignored)
```

---

### Step 8.2 — Final full check

```bash
npm run format:check
npm run typecheck
npm run lint
npm run test
```

All four must pass.

---

### Step 8.3 — Manual smoke test in pi

If the pi-coding-agent is available for testing:
1. Start pi with the pi-til-done extension loaded
2. Create a session
3. Ask the agent to create a 3-item todo list
4. Verify the status bar shows "📋 0/3"
5. Let the agent work through the items via auto-continue
6. Verify each item transitions: not_started → in_progress → completed
7. Verify "✓ Done (3 items)" appears when complete
8. Navigate to a different branch and back
9. Verify state is correctly restored

---

## File Inventory

### Files Created
| File | Phase | Purpose |
|------|-------|---------|
| `.gitignore` | 2.1 | Ignore node_modules, dist, coverage |
| `tsconfig.json` | 2.3 | TypeScript compiler config |
| `eslint.config.js` | 2.4 | ESLint flat config |
| `.prettierrc` | 2.5 | Prettier formatting rules |
| `vitest.config.ts` | 2.6 | Vitest test runner config |
| `src/types.ts` | 3.1 | Type definitions, constants, lookup maps |
| `src/validation.ts` | 3.2 | Input validation predicates |
| `src/formatting.ts` | 3.3 | Text rendering and formatting |
| `src/state.ts` | 3.4 | Mutable state management + UI sync |
| `src/tools.ts` | 3.5 | Tool definitions |
| `src/events.ts` | 3.6 | Event handler registration |
| `src/index.ts` | 3.7 | Entry point orchestrator |
| `src/__tests__/helpers/mocks.ts` | 6.1 | Test mocks |
| `src/__tests__/validation.test.ts` | 6.2 | Validation tests |
| `src/__tests__/formatting.test.ts` | 6.3 | Formatting tests |
| `src/__tests__/state.test.ts` | 6.4 | State management tests |
| `src/__tests__/tools.test.ts` | 6.5 | Tool tests |
| `src/__tests__/events.test.ts` | 6.6 | Event handler tests |
| `src/__tests__/index.test.ts` | 6.7 | Entry point smoke test |

### Files Modified
| File | Phase | Change |
|------|-------|--------|
| `index.ts` | 1.1–1.5 | Security and bug fixes (pre-split) |
| `package.json` | 2.2 | Add scripts, devDeps, type:module, updated paths |

### Files Deleted
| File | Phase | Reason |
|------|-------|--------|
| `index.ts` (root) | 3.8 | Moved to `src/index.ts` |
| `docs/plans/til-done.md` | 4.7 | Stale 5-tool architecture doc |
| `AUDIT-REPORT.md` | 4.10 | Audit artifact |
| `CODE_SMELL_AUDIT_REPORT.md` | 4.10 | Audit artifact |
| `CODE_SMELL_REPORT.md` | 4.10 | Audit artifact |
| `RESEARCH-LINTING.md` | 4.10 | Audit artifact |
| `SECURITY_EFFICIENCY_AUDIT_REPORT.md` | 4.10 | Audit artifact |
| `TEST_AUDIT_REPORT.md` | 4.10 | Audit artifact |

---

## Module Dependency Graph

```
src/types.ts
  ↑
src/validation.ts  (imports from types)
  ↑
src/formatting.ts  (imports from types)
  ↑
src/state.ts       (imports from types, validation)
  ↑
src/tools.ts       (imports from types, validation, formatting, state)
  ↑
src/events.ts      (imports from types, validation, formatting, state)
  ↑
src/index.ts       (imports from tools, events)
```

No circular dependencies. Each module has a single, clear responsibility.

---

## State Management Design

The mutable state (`todos` array + `autoContinueCount` counter) lives in `src/state.ts` behind accessor functions:

```
┌──────────────────────────────────────────────────┐
│                   state.ts                        │
│                                                   │
│  let todos: TodoItem[] = []                       │
│  let autoContinueCount = 0                        │
│                                                   │
│  getTodos()         → readonly TodoItem[]         │
│  setTodos(new)      → void  (resets counter)      │
│  updateTodoStatus() → void  (resets counter)      │
│  incrementAutoContinue() → number                 │
│  resetAutoContinue() → void                       │
│  resetState()       → void  (testing only)        │
│  reconstructState() → TodoItem[]                  │
│  updateUI()         → void                        │
└──────────────────────────────────────────────────┘
         ↑ writes              ↑ writes        ↑ reads
    tools.ts              events.ts         events.ts, tools.ts
```

**Counter reset logic:**
- `setTodos()` resets counter (new plan = fresh start)
- `updateTodoStatus()` resets counter (progress made = reset auto-continue)
- `incrementAutoContinue()` increments counter (agent_end auto-continue)
- Counter is NOT reset on `session_start`/`session_tree` (preserves cross-navigation)

---

## Out of Scope

The following are explicitly **NOT** part of this plan:

1. **SDK-level changes** — The extension API (`ExtensionAPI`, `ToolDefinition`, etc.) is external and cannot be modified.
2. **`session_shutdown` handler** — The SDK calls the factory function for each session, so stale state is overwritten by `session_start`. Adding `session_shutdown` is defensive but not required.
3. **`before_agent_start` token amplification** — The context injection duplicates todo text into the conversation. This is by design: the LLM needs to see the current state. Reducing it would harm functionality.
4. **`Text` object pooling** — The GC overhead is negligible. Not worth the complexity.
5. **`reconstructState` optimization** — The O(n) branch scan is bounded by session length and mitigated by reverse-scan early return. A delta-based reconstruction would be a major redesign.
6. **Custom message type for auto-continue instead of `sendUserMessage`** — Using `sendMessage` with `triggerTurn` would change the message role, potentially reducing the LLM's responsiveness to the prompt. The current approach (with the injection fix from Step 1.1) is safer.
7. **Migration of existing session files** — Session files with old `TillDoneDetails` will continue to work because `reconstructState` uses the `TOOL_NAMES` set and `isValidTodoItem` validation, which are field-name agnostic.
8. **Removing `IMPROVEMENT_PLAN.md`** — This file stays as documentation of the improvement process.
