/**
 * @opencode-chat/core - Platform Interface
 *
 * Defines the contract for platform-specific functionality.
 * Each platform (VS Code, Electron, Web, etc.) implements these interfaces.
 */

import type { Disposable, FileAttachment } from "./domain";
import type { HostToUIMessage, UIToHostMessage } from "./protocol";

/** UI <-> Platform communication bridge */
export interface IBridge {
  postMessage(message: UIToHostMessage): void;
  onMessage(handler: (message: HostToUIMessage) => void): Disposable;
  getPersistedState(): UIPersistedState | null;
  setPersistedState(state: UIPersistedState): void;
}

export type SoundEventType = "responseComplete" | "permissionRequest" | "questionAsked" | "error";

export type SoundEventSetting = {
  enabled?: boolean;
  volume?: number;
};

export type SoundSettings = {
  [K in SoundEventType]?: SoundEventSetting;
};

export type UIPersistedState = {
  localeSetting?: "auto" | "en" | "ja";
  inputHistory?: string[];
  soundSettings?: SoundSettings;
  /** Per-model effort variant selection, keyed by `${providerID}/${modelID}` */
  modelEffortByModel?: Record<string, string>;
  /** Most-recent-first list of recently selected models, capped at five. */
  recentModels?: Array<{ providerID: string; modelID: string }>;
  /** Per-server MCP connection preference, keyed by server name. Applied after companion ready. */
  mcpEnabledByServer?: Record<string, boolean>;
};

/** Platform-specific services */
export interface IPlatformServices {
  /** Open a diff viewer */
  openDiffEditor(filePath: string, before: string, after: string): Promise<void>;

  /** Copy text to clipboard */
  copyToClipboard(text: string): Promise<void>;

  /**
   * Open a terminal attached to the companion server (fallback path).
   * @deprecated Prefer independent handoff via runHandoffTerminal when possible.
   */
  openTerminal(serverUrl: string, sessionId?: string): Promise<void>;

  /**
   * Independent TUI handoff: import a session export file then continue in full OpenCode.
   * Companion must stay running; this starts a separate process.
   */
  runHandoffTerminal(exportFilePath: string): Promise<void>;

  /** Open a config file in the editor */
  openConfigFile(filePath: string): Promise<void>;

  /** Open a file in the editor, optionally at a specific line */
  openFile(filePath: string, line?: number): Promise<void>;

  /** Search for files in the workspace */
  searchWorkspaceFiles(query: string): Promise<FileAttachment[]>;

  /** Get currently open editor files */
  getOpenEditors(): Promise<FileAttachment[]>;
}
