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
      setWidget: vi.fn(),
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
