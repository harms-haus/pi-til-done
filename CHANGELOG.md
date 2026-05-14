# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
