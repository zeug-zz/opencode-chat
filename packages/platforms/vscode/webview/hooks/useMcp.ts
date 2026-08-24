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
    if (pref && !serverStatus.connected && (serverStatus.status === "disabled" || serverStatus.status === "unknown")) {
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
  const lastNotifiedPrefsRef = useRef<Record<string, boolean> | null>(null);
  const lastProcessedActionsRef = useRef<
    Record<string, { status: McpStatus[string]["status"]; action: ReapplyAction["action"] }>
  >({});

  useEffect(() => {
    if (lastNotifiedPrefsRef.current === null) {
      lastNotifiedPrefsRef.current = prefs;
      return;
    }
    if (arePrefsEqual(lastNotifiedPrefsRef.current, prefs)) return;
    postMessage({ type: "setMcpPrefs", prefs });
    lastNotifiedPrefsRef.current = prefs;
  }, [prefs]);

  // Request initial status once when MCP capability is present.
  useEffect(() => {
    if (capabilities?.mcp) {
      postMessage({ type: "getMcpStatus" });
    }
  }, [capabilities?.mcp]);

  /**
   * Called by App.tsx's message handler when a `mcpStatus` message arrives.
   * Updates live server state and reapplies persisted preferences. Reapplying on
   * every status snapshot makes a reconnect after a companion transition
   * converge without requiring the webview to be recreated.
   */
  const handleMcpStatus = useCallback((status: McpStatus) => {
    setServers(status);

    const currentPrefs = getPersistedState()?.mcpEnabledByServer ?? {};
    if (Object.keys(currentPrefs).length > 0) {
      const actions = computeReapplyActions(currentPrefs, status);
      for (const { server, action } of actions) {
        const previous = lastProcessedActionsRef.current[server];
        if (previous?.status === status[server].status && previous.action === action) continue;
        postMessage({
          type: action === "connect" ? "connectMcp" : "disconnectMcp",
          server,
        });
        lastProcessedActionsRef.current[server] = { status: status[server].status, action };
      }
    }

    for (const [server, previous] of Object.entries(lastProcessedActionsRef.current)) {
      if (status[server]?.status !== previous.status) delete lastProcessedActionsRef.current[server];
    }
  }, []);

  const handleMcpPrefs = useCallback((message: { prefs: Record<string, boolean>; locked: string[] }) => {
    const nextPrefs = message.prefs;
    const adoptedPrefs = { ...nextPrefs };
    lastProcessedActionsRef.current = {};
    lastNotifiedPrefsRef.current = adoptedPrefs;
    setPrefsState(adoptedPrefs);
    setPersistedState({ ...getPersistedState(), mcpEnabledByServer: adoptedPrefs });
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
    handleMcpPrefs,
  } as const;
}

function arePrefsEqual(left: Record<string, boolean>, right: Record<string, boolean>): boolean {
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) return false;
  return leftKeys.every((key) => left[key] === right[key]);
}
