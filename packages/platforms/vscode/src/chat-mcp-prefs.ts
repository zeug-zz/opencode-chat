import type * as vscode from "vscode";

export const CHAT_MCP_PREFS_KEY = "chatMcpPrefsByServer";

export type ChatMcpPrefs = Record<string, boolean>;

export interface ChatMcpPrefsStore {
  read(): ChatMcpPrefs;
  write(prefs: ChatMcpPrefs): Promise<void>;
}

function sanitizePrefs(value: unknown): ChatMcpPrefs {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};

  const prefs: ChatMcpPrefs = {};
  for (const [key, enabled] of Object.entries(value)) {
    if (typeof key === "string" && typeof enabled === "boolean") {
      prefs[key] = enabled;
    }
  }
  return prefs;
}

export class VscodeChatMcpPrefsStore implements ChatMcpPrefsStore {
  constructor(private readonly workspaceState: Pick<vscode.Memento, "get" | "update">) {}

  read(): ChatMcpPrefs {
    return sanitizePrefs(this.workspaceState.get<unknown>(CHAT_MCP_PREFS_KEY));
  }

  async write(prefs: ChatMcpPrefs): Promise<void> {
    await this.workspaceState.update(CHAT_MCP_PREFS_KEY, sanitizePrefs(prefs));
  }
}
