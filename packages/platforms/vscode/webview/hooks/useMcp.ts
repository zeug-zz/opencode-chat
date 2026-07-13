import type { McpStatus } from "@opencode-chat/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { getPersistedState, postMessage, setPersistedState } from "../vscode-api";

export type ReapplyAction = { server: string; action: "connect" | "disconnect" };

/**
 * Pure function: given prefs and live status, compute the connect/disconnect
 * actions needed to bring actual state in line with desired prefs.
 *
 * Only servers present in **both** prefs and status are considered.
 * Pref keys for servers absent from status are silently ignored.
 */
export function computeReapplyActions(prefs: Record<string, boolean>, status: McpStatus): ReapplyAction[] {
  const actions: ReapplyAction[] = [];
  for (const [server, serverStatus] of Object.entries(status)) {
    const pref = prefs[server];
    if (pref === undefined) continue;
    if (pref && !serverStatus.connected) {
      actions.push({ server, action: "connect" });
    } else if (!pref && serverStatus.connected) {
      actions.push({ server, action: "disconnect" });
    }
  }
  return actions;
}

/**
 * Webview hook for MCP server connection state and preferences.
 *
 * Accepts an optional `capabilities` object so the hook can request initial
 * status when the companion advertises MCP capability.
 */
export function useMcp(capabilities?: { mcp?: boolean }) {
  const [prefs, setPrefsState] = useState<Record<string, boolean>>(() => getPersistedState()?.mcpEnabledByServer ?? {});
  const [servers, setServers] = useState<McpStatus>({});
  const reappliedRef = useRef(false);

  // Request initial status once when MCP capability is present.
  useEffect(() => {
    if (capabilities?.mcp) {
      postMessage({ type: "getMcpStatus" });
    }
  }, [capabilities?.mcp]);

  /**
   * Called by App.tsx's message handler when a `mcpStatus` message arrives.
   * Updates live server state and runs the reapply policy on first invocation.
   */
  const handleMcpStatus = useCallback((status: McpStatus) => {
    setServers(status);

    if (!reappliedRef.current) {
      reappliedRef.current = true;
      const currentPrefs = getPersistedState()?.mcpEnabledByServer ?? {};
      if (Object.keys(currentPrefs).length > 0) {
        const actions = computeReapplyActions(currentPrefs, status);
        for (const { server, action } of actions) {
          postMessage({
            type: action === "connect" ? "connectMcp" : "disconnectMcp",
            server,
          });
        }
      }
    }
  }, []);

  /**
   * Toggle a server's desired enabled state.
   * Persists the preference, sends the RPC, and refreshes status.
   */
  const toggle = useCallback((server: string, enabled: boolean) => {
    setPrefsState((prev) => {
      const next = { ...prev, [server]: enabled };
      setPersistedState({ ...getPersistedState(), mcpEnabledByServer: next });
      return next;
    });
    postMessage({ type: enabled ? "connectMcp" : "disconnectMcp", server });
    postMessage({ type: "getMcpStatus" });
  }, []);

  /** Refresh live MCP status from the companion. */
  const refresh = useCallback(() => {
    postMessage({ type: "getMcpStatus" });
  }, []);

  return {
    prefs,
    servers,
    toggle,
    refresh,
    handleMcpStatus,
  } as const;
}
