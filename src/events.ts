import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { MAX_AUTO_CONTINUE } from "./types";
import { isIncomplete } from "./validation";
import { formatTodoListText, formatRemainingList } from "./formatting";
import { getTodos, setTodos, reconstructState, updateUI, incrementAutoContinue } from "./state";

// Module-level countdown handle — prevents stacked intervals when agent_end
// fires while a previous countdown is still active (race condition guard).
let activeCountdown: ReturnType<typeof setInterval> | null = null;

/** Clear any active countdown interval and remove the countdown widget. */
function clearCountdown(ctx: ExtensionContext): void {
  if (activeCountdown !== null) {
    clearInterval(activeCountdown);
    activeCountdown = null;
    if (ctx.hasUI) {
      ctx.ui.setWidget("til-done-countdown", undefined);
    }
  }
}

// ── Message Renderers ──

export function registerMessageRenderers(pi: ExtensionAPI): void {
  pi.registerMessageRenderer("til-done-context", (message, _opts, theme) => {
    return new Text(theme.fg("accent", "📋 ") + theme.fg("dim", String(message.content)), 0, 0);
  });

  pi.registerMessageRenderer("til-done-complete", (message, _opts, theme) => {
    return new Text(theme.fg("success", "✓ ") + theme.fg("text", String(message.content)), 0, 0);
  });

  // Countdown shown during the grace period before auto-continue
  pi.registerMessageRenderer("til-done-countdown", (message, _opts, theme) => {
    return new Text(theme.fg("accent", "⏳ ") + theme.fg("dim", String(message.content)), 0, 0);
  });
}

// ── Event Handlers ──

export function registerEventHandlers(pi: ExtensionAPI): void {
  // ── State Reconstruction Events ──

  pi.on("session_start", async (_, ctx) => {
    clearCountdown(ctx);
    const todos = reconstructState(ctx);
    setTodos(todos);
    updateUI(ctx, todos);
  });

  pi.on("session_tree", async (_, ctx) => {
    clearCountdown(ctx);
    const todos = reconstructState(ctx);
    setTodos(todos);
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

  /**
   * Check if the last assistant message was aborted (user interrupted).
   * Returns true if the agent was interrupted, false if it stopped naturally.
   */
  function wasAborted(messages: { role: string; stopReason?: string }[]): boolean {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (!msg) continue;
      if (msg.role === "assistant") {
        return msg.stopReason === "aborted";
      }
    }
    return false;
  }

  pi.on("agent_end", async (event, ctx) => {
    const todos = getTodos();

    if (todos.length === 0) return;

    // If the user interrupted the agent, don't auto-continue
    if (wasAborted(event.messages)) return;

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
      const todo = todos[i];
      if (!todo) continue;
      if (!isIncomplete(todo.status)) continue;
      incompleteIndices.push(i);
      if (todo.status === "in_progress" && nextInProgressIdx === -1) {
        nextInProgressIdx = i;
      }
      if (todo.status === "not_started" && firstNotStartedIdx === -1) {
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
    if (nextIdx === -1) return;
    const nextItem = todos[nextIdx];
    if (!nextItem) return;
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

    // Show live countdown and auto-continue after 3 seconds
    if (ctx.hasUI) {
      // Clear any existing countdown to prevent stacked intervals
      if (activeCountdown !== null) {
        clearInterval(activeCountdown);
      }

      let remaining = 3;
      const interval = setInterval(() => {
        try {
          remaining--;
          if (remaining > 0) {
            ctx.ui.setWidget(
              "til-done-countdown",
              [`⏳ Auto-continuing in ${remaining}s... (type anything to interrupt)`],
              { placement: "aboveEditor" },
            );
          } else {
            clearCountdown(ctx);
            try {
              pi.sendUserMessage(prompt);
            } catch {
              // User already started typing — skip auto-continue
            }
          }
        } catch {
          clearCountdown(ctx);
        }
      }, 1000);
      activeCountdown = interval;

      // Show initial widget immediately
      ctx.ui.setWidget(
        "til-done-countdown",
        ["⏳ Auto-continuing in 3s... (type anything to interrupt)"],
        { placement: "aboveEditor" },
      );
    } else {
      // Fallback for RPC/print mode — no UI available
      setTimeout(() => {
        try {
          pi.sendUserMessage(prompt);
        } catch {
          // User already started typing — skip auto-continue
        }
      }, 3000);
    }
  });
}
