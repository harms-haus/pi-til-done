# pi-til-done

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Version](https://img.shields.io/badge/version-1.1.0-blue)

A pi-coding-agent extension that provides an iterative todo list — tracks tasks and automatically loops the agent until every task is marked done.

## Features

- **Three tools** — `write_todos`, `list_todos`, `edit_todos` for create, read, and update task lists
- **Four statuses** — `not_started` (–), `in_progress` (●), `completed` (✓), `abandoned` (✗)
- **Auto-continue engine** — after each agent turn, a 3-second countdown fires if incomplete items remain; the user can interrupt by typing
- **Circuit breaker** — caps auto-continue at 20 consecutive iterations to prevent runaway loops
- **Hidden context injection** — `before_agent_start` hook injects the full todo list into each agent turn (when incomplete items remain) as a non-displayed system message
- **Status bar** — progress counter (setStatus) and active items display (setStatus); countdown widget above editor (setWidget)
- **Event-sourced state reconstruction** — state is rebuilt from session history on `session_start` / `session_tree`, surviving branch switches
- **Atomic batch edits** — `edit_todos` validates all indices before any mutation; if any index is invalid, no changes are applied
- **Security** — todo text is excluded from the instruction portion of the auto-continue prompt (only the 'Remaining items' display contains the actual text)
- **Dual-mode rendering** — plain-text formatting for LLM content, themed (colored, strikethrough) rendering for the TUI

## Installation

This extension requires the following peer dependencies:

- `@earendil-works/pi-coding-agent`
- `@earendil-works/pi-ai`
- `@earendil-works/pi-tui`
- `typebox`

Install via npm:

```bash
npm install pi-til-done
```

The extension auto-registers when placed in a pi-coding-agent project via the `pi.extensions` field in `package.json`:

```json
{
  "pi": {
    "extensions": ["./src/index.ts"]
  }
}
```

## Quick Start

The agent uses the three tools to plan and track work:

**1. Write the full todo list:**

```json
{
  "tool": "write_todos",
  "parameters": {
    "todos": [
      { "text": "Read requirements from docs/" },
      { "text": "Implement the core logic in src/" },
      { "text": "Write tests" },
      { "text": "Update README" }
    ]
  }
}
```

All items start with status `not_started`.

**2. Start working on the first task:**

```json
{
  "tool": "edit_todos",
  "parameters": {
    "action": "start",
    "indices": [0]
  }
}
```

The item at index 0 transitions to `in_progress`.

**3. Agent performs the work** (writes code, creates files, etc.).

**4. Mark the task complete:**

```json
{
  "tool": "edit_todos",
  "parameters": {
    "action": "complete",
    "indices": [0]
  }
}
```

**5. Auto-continue fires** — when the agent's turn ends and incomplete items remain, a 3-second countdown begins. The agent is then prompted to continue with the next item. The user can interrupt by typing during the countdown.

This loop continues until all items are either `completed` or `abandoned`, or until the 20-iteration circuit breaker trips.

## Tools Overview

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `write_todos` | Replace the entire todo list. All items start as `not_started`. | `todos: { text: string }[]` |
| `list_todos` | View the current list with statuses and indices. | _(none)_ |
| `edit_todos` | Apply a status action to items by index, or append new items via the 'add' action. Batch operations are atomic. | `action: "start" \| "complete" \| "abandon" \| "add"`, `indices?: number[]`, `todos?: { text: string }[]` |

See [docs/TOOLS.md](docs/TOOLS.md) for full tool reference and schema details.

## Architecture Overview

The extension consists of **7 source modules** organized around a single entry point:

| Module | Responsibility |
|--------|---------------|
| `index.ts` | Extension factory — registers tools, renderers, and event handlers |
| `types.ts` | Type definitions, constants, and lookup maps |
| `state.ts` | Module-level mutable singleton; state reconstruction from session history; UI sync |
| `tools.ts` | Tool definitions for `write_todos`, `list_todos`, `edit_todos` with TypeBox schemas |
| `events.ts` | Event handlers (`session_start`, `session_tree`, `before_agent_start`, `agent_end`) and message renderers |
| `formatting.ts` | Dual-mode formatting: plain-text for LLM, themed for TUI |
| `validation.ts` | Type guards, deep-cloning helpers, and input validation |

Key design patterns:

- **Event-sourced state** — tool results store `TodoDetails` in message entry `details`, enabling state reconstruction from any point in the session tree.
- **Dual rendering** — tool content uses plain-text icons (for LLM consumption), while TUI renderers apply color themes and strikethrough for completed/abandoned items.
- **Counter reset semantics** — the auto-continue counter resets on `write_todos` and `edit_todos` (user-directed actions, including the 'add' action), but _not_ on `agent_end` (auto iterations). This ensures the 20-iteration limit counts only consecutive auto-continues.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for detailed diagrams and data flow.

## Configuration

There are **no user-configurable settings**. All limits are defined as constants in `types.ts`:

| Constant | Value | Description |
|----------|-------|-------------|
| `MAX_TODO_TEXT_LENGTH` | `1000` | Maximum characters per todo item text |
| `MAX_AUTO_CONTINUE` | `20` | Maximum consecutive auto-continue iterations (circuit breaker) |
| `MAX_TODOS` | `100` | Maximum items in a todo list |
| `MAX_INDICES` | `50` | Maximum indices in a single `edit_todos` call |
| `INITIAL_STATUS` | `"not_started"` | Status assigned to newly created items |

## Development

### Scripts

```bash
npm test              # Run test suite (Vitest)
npm run test:watch    # Run tests in watch mode
npm run lint          # ESLint check
npm run format        # Prettier format (write)
npm run format:check  # Prettier format check (dry run)
npm run typecheck     # TypeScript type check (no emit)
```

### Testing

Tests use Vitest with mock implementations of the pi-coding-agent API. Test files live in `src/__tests__/` and cover all modules.

See [docs/TESTING.md](docs/TESTING.md) for the testing strategy and how to add tests.

### Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines.

## License

[MIT](LICENSE)
