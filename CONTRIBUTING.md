# Contributing to pi-til-done

Thank you for your interest in contributing! This project is a [pi-coding-agent](https://github.com/earendil-works/pi-coding-agent) extension that provides a todo list iterating until all tasks are done.

## Development Setup

### Prerequisites

- **Node.js** — compatible with `@types/node` ^22.0.0
- **npm**

### Clone and Install

```bash
git clone https://github.com/harms-haus/pi-til-done.git
cd pi-til-done
npm install
```

### Peer Dependencies

This extension declares peer dependencies on the host pi-coding-agent environment:

- `@earendil-works/pi-coding-agent`
- `@earendil-works/pi-ai`
- `@earendil-works/pi-tui`
- `typebox`

These must be available in the host pi-coding-agent installation. You do not need to install them separately in this repository.

## Available Scripts

| Script | Description |
|---|---|
| `npm test` | Run tests once (vitest run) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run lint` | ESLint check (ESLint 9 flat config + typescript-eslint) |
| `npm run format` | Prettier format (writes changes) |
| `npm run format:check` | Prettier check without writing |
| `npm run typecheck` | TypeScript type checking (`tsc --noEmit`, strict mode) |

## Code Style

- **TypeScript strict mode** — enforced by `tsconfig.json` (`"strict": true`)
- **ESLint 9 flat config** with typescript-eslint:
  - `@typescript-eslint/no-explicit-any` — error
  - `@typescript-eslint/explicit-function-return-type` — off
  - Unused args prefixed with `_` are allowed (`argsIgnorePattern: "^_"`)
  - Test files (`*.test.ts`, `setup.ts`) allow `@typescript-eslint/no-explicit-any`
- **Prettier**:
  - Double quotes (`singleQuote: false`)
  - Semicolons (`semi: true`)
  - Trailing commas (`trailingComma: "all"`)
  - 2-space indent (`tabWidth: 2`)
  - 100 character print width (`printWidth: 100`)

Run `npm run lint` and `npm run format:check` before submitting to verify compliance.

## Testing Requirements

- All new features must have corresponding tests.
- Run `npm test` before submitting — all tests must pass.
- There are **189 tests across 6 test files** in `src/__tests__/`.

### Test Helpers

Use the helpers from `src/__tests__/helpers/mocks.ts`:

- `createMockTheme()` — creates a mock `Theme` that wraps output in brackets for easy assertion (e.g., `[red]text`, `**bold**`, `~~strikethrough~~`)
- `createMockContext(branch?)` — creates a mock `ExtensionContext` with an optional message branch
- `createMockAPI()` — returns an object with the mock `ExtensionAPI` and individual spy references (`sendMessage`, `sendUserMessage`, `registerTool`, `on`, `registerMessageRenderer`, `setWidget`)

### Setup and Teardown

- Call `resetState()` in `beforeEach` for any test that depends on module-level state (most tests).
- Use `vi.useFakeTimers()` / `vi.useRealTimers()` for timer-dependent tests (e.g., `agent_end` countdown).

See [docs/TESTING.md](docs/TESTING.md) for detailed test patterns and examples.

## Pull Request Process

1. **All tests pass**: `npm test`
2. **Linting passes**: `npm run lint`
3. **Type checking passes**: `npm run typecheck`
4. **Formatting is correct**: `npm run format:check`
5. **Documentation is updated** if adding new features or changing behavior
6. **Link to relevant docs**: [docs/TESTING.md](docs/TESTING.md) for test patterns, [docs/API.md](docs/API.md) for API changes

## Project Structure

```
src/
  index.ts          — Extension entry point (registerMessageRenderers, registerEventHandlers, registerTool)
  types.ts          — Types, constants, lookup maps
  state.ts          — Mutable state management (get/set/update/append/insert/reset/reconstruct)
  events.ts         — Event handlers and message renderers
  tools.ts          — Tool definitions (write_todos, list_todos, edit_todos)
  validation.ts     — Type guards and helpers
  formatting.ts     — Plain-text and themed rendering
  __tests__/        — Test files (6 test files covering all source modules; types.ts tested indirectly through other modules)
    helpers/
      mocks.ts      — Shared test mock factories
    setup.ts        — Vitest setup (global resetState helper)
```

## Reporting Issues

If you find a bug or have a feature request, please [open an issue on GitHub](https://github.com/harms-haus/pi-til-done/issues).
