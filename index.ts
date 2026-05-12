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
 * - In-progress items shown above the composer via widget
 * - Custom footer with cwd on left, progress aligned right
 * - Auto-continue via sendUserMessage when incomplete todos remain at agent_end
 * - Hidden context injection via before_agent_start listing remaining todos
 * - State persisted in tool result details for proper branching support
 */

import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";

// ── Types ──

type TodoStatus = "not_started" | "in_progress" | "completed" | "abandoned";

interface TodoItem {
	text: string;
	status: TodoStatus;
}

interface TillDoneDetails {
	action: "write" | "list" | "edit";
	todos: TodoItem[];
	error?: string;
}

// ── Constants ──

const TOOL_NAMES = new Set(["write_todos", "list_todos", "edit_todos"]);

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

// ── Helpers ──

function getStatusIcon(status: TodoStatus, theme: Theme): string {
	switch (status) {
		case "not_started":
			return theme.fg("dim", "–");
		case "in_progress":
			return theme.fg("warning", "●");
		case "completed":
			return theme.fg("success", "✓");
		case "abandoned":
			return theme.fg("error", "✗");
	}
}

function getTodoLabel(text: string, status: TodoStatus, theme: Theme): string {
	if (status === "completed" || status === "abandoned") {
		return theme.fg("dim", theme.strikethrough(text));
	}
	return theme.fg("text", text);
}

/** Themed todo list for TUI rendering */
function renderTodoList(todos: TodoItem[], theme: Theme): string {
	if (todos.length === 0) return theme.fg("dim", "No todos");
	return todos
		.map(
			(t, i) =>
				`${getStatusIcon(t.status, theme)} ${theme.fg("accent", `[${i}]`)} ${getTodoLabel(t.text, t.status, theme)}`,
		)
		.join("\n");
}

/** Plain text todo list for LLM content */
function formatTodoListText(todos: TodoItem[]): string {
	if (todos.length === 0) return "No todos";
	return todos
		.map((t, i) => {
			const icon =
				t.status === "in_progress"
					? "●"
					: t.status === "completed"
						? "✓"
						: t.status === "abandoned"
							? "✗"
							: "–";
			return `${icon} [${i}] ${t.text}`;
		})
		.join("\n");
}

function updateUI(ctx: ExtensionContext, todos: TodoItem[]): void {
	if (!ctx.hasUI) return;

	// Widget: show in-progress items above composer
	const lines: string[] = [];
	for (let i = 0; i < todos.length; i++) {
		if (todos[i].status !== "in_progress") continue;
		lines.push(
			ctx.ui.theme.fg("warning", "● ") +
				ctx.ui.theme.fg("accent", `[${i}] `) +
				ctx.ui.theme.fg("text", todos[i].text),
		);
	}
	ctx.ui.setWidget("till-done", lines.length > 0 ? lines : undefined);

	// Custom footer: cwd left, progress right — restore default when no todos
	if (todos.length > 0) {
		let completed = 0;
		for (let i = 0; i < todos.length; i++) {
			if (todos[i].status === "completed") completed++;
		}
		const total = todos.length;
		const cwd = ctx.cwd;

		ctx.ui.setFooter((tui, theme, footerData) => {
			let cachedWidth: number | undefined;
			let cachedLine: string | undefined;

			return {
				dispose: footerData.onBranchChange(() => tui.requestRender()),
				invalidate() {
					cachedWidth = undefined;
					cachedLine = undefined;
				},
				render(width: number): string[] {
					if (cachedWidth === width && cachedLine !== undefined) return [cachedLine];

					const branch = footerData.getGitBranch();
					const left = theme.fg("dim", branch ? `${cwd} (${branch})` : cwd);
					const right = theme.fg("accent", `📋 ${completed}/${total}`);

					const gap = width - visibleWidth(left) - visibleWidth(right);
					if (gap < 2) {
						cachedLine = truncateToWidth(left + " " + right, width, "");
					} else {
						cachedLine = left + " ".repeat(gap) + right;
					}
					cachedWidth = width;
					return [cachedLine];
				},
			};
		});
	} else {
		ctx.ui.setFooter(undefined);
	}
}

/** Validate reconstructed state from session storage */
function isValidTodoItem(t: unknown): t is TodoItem {
	return (
		typeof t === "object" &&
		t !== null &&
		typeof (t as Record<string, unknown>).text === "string" &&
		["not_started", "in_progress", "completed", "abandoned"].includes(
			(t as Record<string, unknown>).status as string,
		)
	);
}

function reconstructState(ctx: ExtensionContext): TodoItem[] {
	const branch = ctx.sessionManager.getBranch();

	// Iterate in reverse — only the last snapshot matters
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		if (entry.type !== "message") continue;
		const msg = entry.message;
		if (msg.role !== "toolResult") continue;
		if (!TOOL_NAMES.has(msg.toolName)) continue;

		const details = msg.details as TillDoneDetails | undefined;
		if (details?.todos && Array.isArray(details.todos)) {
			const valid = details.todos.filter(isValidTodoItem);
			return valid.map((t) => ({ text: t.text, status: t.status }));
		}
	}

	return [];
}

/** Shared renderResult — all tools show the full themed todo list */
function renderResultShared(
	result: { content: Array<{ type: string; text?: string }>; details?: unknown },
	_options: { expanded: boolean; isPartial: boolean },
	theme: Theme,
): Text {
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

	// ── Message Renderers ──

	pi.registerMessageRenderer("till-done-context", (message, _opts, theme) => {
		return new Text(theme.fg("accent", "📋 ") + theme.fg("dim", message.content as string), 0, 0);
	});

	pi.registerMessageRenderer("till-done-complete", (message, _opts, theme) => {
		return new Text(theme.fg("success", "✓ ") + theme.fg("text", message.content as string), 0, 0);
	});

	// ── Session Events — State Reconstruction ──

	pi.on("session_start", async (_event, ctx) => {
		todos = reconstructState(ctx);
		updateUI(ctx, todos);
	});

	pi.on("session_tree", async (_event, ctx) => {
		todos = reconstructState(ctx);
		updateUI(ctx, todos);
	});

	// ── before_agent_start — Inject hidden context with remaining todos ──

	pi.on("before_agent_start", async () => {
		let remaining = 0;
		for (let i = 0; i < todos.length; i++) {
			if (todos[i].status === "not_started" || todos[i].status === "in_progress") remaining++;
		}
		if (remaining === 0) return;

		const todoList = formatTodoListText(todos);

		return {
			message: {
				customType: "till-done-context",
				content: `[TILL-DONE ACTIVE]\n\nCurrent todo list:\n${todoList}\n\n${remaining} item(s) remaining. Continue working through the list. Call edit_todos with action 'start' on the next item before working on it, then 'complete' when done.`,
				display: false,
			},
		};
	});

	// ── agent_end — Auto-continue when incomplete todos remain ──

	pi.on("agent_end", async (_event, ctx) => {
		if (todos.length === 0) return;

		// Find incomplete items using index-based iteration
		const incompleteIndices: number[] = [];
		let nextInProgressIdx = -1;
		let firstNotStartedIdx = -1;

		for (let i = 0; i < todos.length; i++) {
			const t = todos[i];
			if (t.status === "not_started" || t.status === "in_progress") {
				incompleteIndices.push(i);
				if (t.status === "in_progress" && nextInProgressIdx === -1) nextInProgressIdx = i;
				if (t.status === "not_started" && firstNotStartedIdx === -1) firstNotStartedIdx = i;
			}
		}

		// All done (completed or abandoned)
		if (incompleteIndices.length === 0) {
			const total = todos.length;
			pi.sendMessage(
				{
					customType: "till-done-complete",
					content: `**All todos complete!** ✓ (${total} items)`,
					display: true,
				},
				{ triggerTurn: false },
			);
			todos = [];
			updateUI(ctx, todos);
			return;
		}

		// Build remaining items list
		const remainingList = incompleteIndices
			.map((i) => {
				const icon = todos[i].status === "in_progress" ? "●" : "–";
				return `${icon} [${i}] ${todos[i].text}`;
			})
			.join("\n");

		// Prefer in-progress, then first not_started
		const nextIdx = nextInProgressIdx !== -1 ? nextInProgressIdx : firstNotStartedIdx;
		const nextItem = todos[nextIdx];

		let prompt: string;
		if (nextInProgressIdx !== -1) {
			prompt = `There are still incomplete todos. Continue working on the remaining todos.\n\nRemaining items:\n${remainingList}\n\nYou are currently working on: [${nextIdx}] ${nextItem.text}. Call edit_todos with action 'complete' and indices [${nextIdx}] when done, then 'start' on the next item.`;
		} else {
			prompt = `There are still incomplete todos. Continue working on the remaining todos.\n\nRemaining items:\n${remainingList}\n\nCall edit_todos with action 'start' and indices [${nextIdx}] to begin: "${nextItem.text}", then 'complete' when done.`;
		}

		pi.sendUserMessage(prompt);
	});

	// ── Tool: write_todos ──

	pi.registerTool({
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
			todos = params.todos.map((t) => ({ text: t.text, status: "not_started" as TodoStatus }));
			updateUI(ctx, todos);
			return {
				content: [
					{
						type: "text" as const,
						text: `Wrote ${todos.length} todo item(s)\n\n${formatTodoListText(todos)}`,
					},
				],
				details: { action: "write" as const, todos: todos.map((t) => ({ ...t })) },
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

		renderResult: renderResultShared,
	});

	// ── Tool: list_todos ──

	pi.registerTool({
		name: "list_todos",
		label: "List Todos",
		description: "List all todos with their current status and 0-based indices.",
		parameters: ListTodosParams,

		async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
			// No state mutation — no UI update needed
			return {
				content: [{ type: "text" as const, text: formatTodoListText(todos) }],
				details: { action: "list" as const, todos: todos.map((t) => ({ ...t })) },
			};
		},

		renderCall(_args, theme) {
			return new Text(theme.fg("toolTitle", theme.bold("list_todos")), 0, 0);
		},

		renderResult: renderResultShared,
	});

	// ── Tool: edit_todos ──

	pi.registerTool({
		name: "edit_todos",
		label: "Edit Todos",
		description:
			"Apply an action ('start', 'complete', or 'abandon') to one or more todo items by their 0-based indices. Batch operations are atomic — if any index is invalid, no changes are applied.",
		parameters: EditTodosParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (todos.length === 0) {
				return {
					content: [{ type: "text" as const, text: "Error: no todos exist" }],
					details: { action: "edit" as const, todos: [], error: "no todos exist" },
				};
			}

			// Validate all indices atomically
			const invalid = params.indices.filter((i) => i < 0 || i >= todos.length);
			if (invalid.length > 0) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Error: indices [${invalid.join(", ")}] out of range (0 to ${todos.length - 1})`,
						},
					],
					details: {
						action: "edit" as const,
						todos: todos.map((t) => ({ ...t })),
						error: `indices [${invalid.join(", ")}] out of range (0 to ${todos.length - 1})`,
					},
				};
			}

			// Apply action to all indices
			const newStatus: TodoStatus =
				params.action === "start"
					? "in_progress"
					: params.action === "complete"
						? "completed"
						: "abandoned";

			for (const idx of params.indices) {
				todos[idx] = { ...todos[idx], status: newStatus };
			}

			updateUI(ctx, todos);

			const actionLabel =
				params.action === "start"
					? "Started"
					: params.action === "complete"
						? "Completed"
						: "Abandoned";

			return {
				content: [
					{
						type: "text" as const,
						text: `${actionLabel} [${params.indices.join(", ")}]\n\n${formatTodoListText(todos)}`,
					},
				],
				details: { action: "edit" as const, todos: todos.map((t) => ({ ...t })) },
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

		renderResult: renderResultShared,
	});
}
