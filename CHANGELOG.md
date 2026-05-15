# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.2.0] - 2026-05-15
### Changed
- `write_todos` now requires a `mode` parameter: `"replace"` (clears and replaces the entire list), `"append"` (appends to end without changing existing item statuses), `"insert"` (inserts at a specified index, requires `index` param, doesn't change existing statuses)
- `edit_todos` no longer supports the `"add"` action — only `start`, `complete`, and `abandon`
- `edit_todos` `indices` parameter is now required (no longer optional)
- `ACTION_LABELS` no longer includes `"add": "Added"` — append/insert functionality moved to `write_todos` modes

### Added
- `insertTodos(atIndex, newItems)` state accessor in `state.ts` — inserts items at a specific position, resets auto-continue counter
- `index` parameter on `write_todos` (required for `insert` mode, validated range 0 to list length inclusive)
- Index range validation for `insert` mode
- `MAX_TODOS` overflow guard for `append` and `insert` modes
- Defense-in-depth text validation for `append` and `insert` modes
- 18 new tests (171 → 189 total)

### Removed
- `edit_todos` `"add"` action (functionality replaced by `write_todos` `mode: "append"`)
- `edit_todos` `todos` parameter
- `ACTION_LABELS["add"]`

## [1.1.0] - 2026-05-14
### Added
- `edit_todos` 'add' action: append new items to an existing todo list without replacing it
- `appendTodos()` state accessor in `state.ts` — spreads new items onto existing array, resets auto-continue counter
- `ACTION_LABELS["add"] = "Added"` in `types.ts`
- `EditTodosParams` schema updated: `indices` is now optional (required only for status actions), new optional `todos` parameter (required for `add` action), `"add"` added to action enum
- `createEditTodosTool.execute()` branched into two paths: `add` (validates `todos`, text length, `MAX_TODOS` boundary, appends) vs. status actions (validates `indices`, applies status)
- `createEditTodosTool.renderCall()` branched: `add` shows truncated item previews (up to 3 items, 40-char truncation, `+N more` suffix) vs. status actions show indices
- Prompt guideline for `add` action (guidelines now total 7)
- Defense-in-depth text length validation for `add` action
- `MAX_TODOS` overflow guard for `add` action
- 20 new tests (151 → 171 total)

## [1.0.0] - 2025-05-14
### Added
- Initial release of pi-til-done: a pi-coding-agent extension for iterative todo lists
- Three tools: `write_todos` (create/replace list), `list_todos` (view list), `edit_todos` (batch status changes)
- Four status values: not_started (–), in_progress (●), completed (✓), abandoned (✗)
- Auto-continue engine: automatically re-prompts agent when incomplete todos remain after `agent_end`
- 3-second countdown with visual indicator before auto-continue; user can interrupt by typing
- Circuit breaker: caps auto-continue at 20 consecutive iterations (MAX_AUTO_CONTINUE)
- Hidden context injection via `before_agent_start`: lists the full todo list each agent turn (when items remain)
- Status bar integration: progress counter (📋 X/Y) and active items display via `setStatus()`
- Event-sourced state reconstruction from session history (survives session branching)
- Atomic batch edits: validates all indices before any mutation
- Security: todo text is never interpolated into agent instructions
- Dual-mode rendering: plain-text for LLM content, themed/styled for TUI display
- 151 unit tests across 6 test files (vitest)
- TypeScript strict mode, ESLint 9, Prettier

[Unreleased]: https://github.com/harms-haus/pi-til-done/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/harms-haus/pi-til-done/releases/tag/v1.0.0
