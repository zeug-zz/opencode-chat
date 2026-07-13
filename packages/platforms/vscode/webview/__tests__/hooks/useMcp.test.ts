import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { computeReapplyActions, useMcp } from "../../hooks/useMcp";
import { getPersistedState, postMessage, setPersistedState } from "../../vscode-api";

describe("computeReapplyActions", () => {
  // ==========================================================
  // First-run / empty prefs
  // ==========================================================
  context("first run with empty prefs", () => {
    it("returns empty actions when both prefs and status are empty", () => {
      expect(computeReapplyActions({}, {})).toEqual([]);
    });

    it("returns empty actions when prefs empty and status non-empty", () => {
      const status = { "my-server": { connected: true, status: "connected" } };
      expect(computeReapplyActions({}, status)).toEqual([]);
    });
  });

  // ==========================================================
  // Re-apply connect/disconnect diffs
  // ==========================================================
  context("re-apply connect", () => {
    it("returns connect action when pref true but server disconnected", () => {
      const prefs = { "my-server": true };
      const status = { "my-server": { connected: false, status: "disabled" } };
      expect(computeReapplyActions(prefs, status)).toEqual([{ server: "my-server", action: "connect" }]);
    });

    it("returns no action when pref true and server already connected", () => {
      const prefs = { "my-server": true };
      const status = { "my-server": { connected: true, status: "connected" } };
      expect(computeReapplyActions(prefs, status)).toEqual([]);
    });
  });

  context("re-apply disconnect", () => {
    it("returns disconnect action when pref false but server connected", () => {
      const prefs = { "my-server": false };
      const status = { "my-server": { connected: true, status: "connected" } };
      expect(computeReapplyActions(prefs, status)).toEqual([{ server: "my-server", action: "disconnect" }]);
    });

    it("returns no action when pref false and server already disconnected", () => {
      const prefs = { "my-server": false };
      const status = { "my-server": { connected: false, status: "disabled" } };
      expect(computeReapplyActions(prefs, status)).toEqual([]);
    });
  });

  // ==========================================================
  // Ignore unknown pref keys
  // ==========================================================
  context("unknown pref keys", () => {
    it("ignores prefs for servers not present in status", () => {
      const prefs = { "ghost-server": true };
      const status = { "live-server": { connected: true, status: "connected" } };
      expect(computeReapplyActions(prefs, status)).toEqual([]);
    });

    it("ignores prefs for servers absent from status even with mixed matches", () => {
      const prefs = { "server-a": true, "ghost-server": true };
      const status = {
        "server-a": { connected: false, status: "disabled" },
        "server-b": { connected: true, status: "connected" },
      };
      expect(computeReapplyActions(prefs, status)).toEqual([{ server: "server-a", action: "connect" }]);
    });
  });

  // ==========================================================
  // Mixed scenarios
  // ==========================================================
  context("mixed multiple servers", () => {
    it("handles multiple servers with different states", () => {
      const prefs = {
        "server-a": true,
        "server-b": false,
        "server-c": true,
      };
      const status = {
        "server-a": { connected: false, status: "disabled" },
        "server-b": { connected: true, status: "connected" },
        "server-c": { connected: true, status: "connected" },
      };
      expect(computeReapplyActions(prefs, status)).toEqual([
        { server: "server-a", action: "connect" },
        { server: "server-b", action: "disconnect" },
      ]);
    });
  });

  // ==========================================================
  // Tools field is irrelevant for reapply logic
  // ==========================================================
  context("tools field in status", () => {
    it("ignores tools field when computing actions", () => {
      const prefs = { "my-server": true };
      const status = { "my-server": { connected: false, status: "disabled", tools: ["read_file"] } };
      expect(computeReapplyActions(prefs, status)).toEqual([{ server: "my-server", action: "connect" }]);
    });
  });
});

describe("useMcp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getPersistedState).mockReturnValue(undefined);
  });

  // ==========================================================
  // Initial state
  // ==========================================================
  context("initial state", () => {
    it("prefs defaults to empty object", () => {
      const { result } = renderHook(() => useMcp());
      expect(result.current.prefs).toEqual({});
    });

    it("servers defaults to empty object", () => {
      const { result } = renderHook(() => useMcp());
      expect(result.current.servers).toEqual({});
    });
  });

  // ==========================================================
  // Persisted state loading
  // ==========================================================
  context("persisted prefs exist", () => {
    it("loads mcpEnabledByServer from persisted state", () => {
      vi.mocked(getPersistedState).mockReturnValue({
        mcpEnabledByServer: { "my-server": true, "other-server": false },
      });
      const { result } = renderHook(() => useMcp());
      expect(result.current.prefs).toEqual({
        "my-server": true,
        "other-server": false,
      });
    });
  });

  // ==========================================================
  // handleMcpStatus
  // ==========================================================
  context("handleMcpStatus", () => {
    it("updates servers state", () => {
      const { result } = renderHook(() => useMcp());
      act(() => {
        result.current.handleMcpStatus({ "my-server": { connected: true, status: "connected" } });
      });
      expect(result.current.servers).toEqual({ "my-server": { connected: true, status: "connected" } });
    });

    it("replaces previous servers state entirely", () => {
      const { result } = renderHook(() => useMcp());
      act(() => {
        result.current.handleMcpStatus({ "server-a": { connected: true, status: "connected" } });
      });
      act(() => {
        result.current.handleMcpStatus({ "server-b": { connected: false, status: "disabled" } });
      });
      expect(result.current.servers).toEqual({ "server-b": { connected: false, status: "disabled" } });
    });
  });

  // ==========================================================
  // Reapply on first handleMcpStatus
  // ==========================================================
  context("reapply on first handleMcpStatus", () => {
    it("connects servers where pref true and disconnected", () => {
      vi.mocked(getPersistedState).mockReturnValue({
        mcpEnabledByServer: { "my-server": true },
      });
      const { result } = renderHook(() => useMcp());
      act(() => {
        result.current.handleMcpStatus({ "my-server": { connected: false, status: "disabled" } });
      });
      expect(postMessage).toHaveBeenCalledWith({ type: "connectMcp", server: "my-server" });
    });

    it("disconnects servers where pref false and connected", () => {
      vi.mocked(getPersistedState).mockReturnValue({
        mcpEnabledByServer: { "my-server": false },
      });
      const { result } = renderHook(() => useMcp());
      act(() => {
        result.current.handleMcpStatus({ "my-server": { connected: true, status: "connected" } });
      });
      expect(postMessage).toHaveBeenCalledWith({ type: "disconnectMcp", server: "my-server" });
    });

    it("skips servers with matching state", () => {
      vi.mocked(getPersistedState).mockReturnValue({
        mcpEnabledByServer: { "my-server": true },
      });
      const { result } = renderHook(() => useMcp());
      act(() => {
        result.current.handleMcpStatus({ "my-server": { connected: true, status: "connected" } });
      });
      expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "connectMcp" }));
      expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "disconnectMcp" }));
    });

    it("ignores unknown pref keys not in status", () => {
      vi.mocked(getPersistedState).mockReturnValue({
        mcpEnabledByServer: { "ghost-server": true },
      });
      const { result } = renderHook(() => useMcp());
      act(() => {
        result.current.handleMcpStatus({ "live-server": { connected: false, status: "disabled" } });
      });
      expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "connectMcp" }));
      expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "disconnectMcp" }));
    });
  });

  // ==========================================================
  // First run — empty prefs, no force
  // ==========================================================
  context("first run with empty prefs", () => {
    it("does not call connectMcp or disconnectMcp on first status", () => {
      const { result } = renderHook(() => useMcp());
      act(() => {
        result.current.handleMcpStatus({ "my-server": { connected: true, status: "connected" } });
      });
      expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "connectMcp" }));
      expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "disconnectMcp" }));
    });
  });

  // ==========================================================
  // Reapply only runs once
  // ==========================================================
  context("reapply runs only once", () => {
    it("does not reapply on subsequent handleMcpStatus calls", () => {
      vi.mocked(getPersistedState).mockReturnValue({
        mcpEnabledByServer: { "my-server": true },
      });
      const { result } = renderHook(() => useMcp());

      // First call: reapply triggers connectMcp
      act(() => {
        result.current.handleMcpStatus({ "my-server": { connected: false, status: "disabled" } });
      });
      expect(postMessage).toHaveBeenCalledWith({ type: "connectMcp", server: "my-server" });

      vi.mocked(postMessage).mockClear();

      // Second call: should NOT reapply again
      act(() => {
        result.current.handleMcpStatus({ "my-server": { connected: false, status: "disabled" } });
      });
      expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "connectMcp" }));
    });
  });

  // ==========================================================
  // toggle
  // ==========================================================
  context("toggle", () => {
    it("updates prefs state", () => {
      const { result } = renderHook(() => useMcp());
      act(() => result.current.toggle("my-server", true));
      expect(result.current.prefs).toEqual({ "my-server": true });
    });

    it("preserves existing prefs when adding new entry", () => {
      const { result } = renderHook(() => useMcp());
      act(() => result.current.toggle("server-a", true));
      act(() => result.current.toggle("server-b", false));
      expect(result.current.prefs).toEqual({ "server-a": true, "server-b": false });
    });

    it("overwrites an existing pref", () => {
      const { result } = renderHook(() => useMcp());
      act(() => result.current.toggle("my-server", true));
      act(() => result.current.toggle("my-server", false));
      expect(result.current.prefs).toEqual({ "my-server": false });
    });

    it("persists to state", () => {
      const { result } = renderHook(() => useMcp());
      act(() => result.current.toggle("my-server", true));
      expect(setPersistedState).toHaveBeenCalledWith(
        expect.objectContaining({
          mcpEnabledByServer: { "my-server": true },
        }),
      );
    });

    it("posts connectMcp when enabled is true", () => {
      const { result } = renderHook(() => useMcp());
      act(() => result.current.toggle("my-server", true));
      expect(postMessage).toHaveBeenCalledWith({ type: "connectMcp", server: "my-server" });
    });

    it("posts disconnectMcp when enabled is false", () => {
      const { result } = renderHook(() => useMcp());
      act(() => result.current.toggle("my-server", false));
      expect(postMessage).toHaveBeenCalledWith({ type: "disconnectMcp", server: "my-server" });
    });

    it("posts getMcpStatus after toggle for refresh", () => {
      const { result } = renderHook(() => useMcp());
      act(() => result.current.toggle("my-server", true));
      expect(postMessage).toHaveBeenCalledWith({ type: "getMcpStatus" });
    });
  });

  // ==========================================================
  // refresh
  // ==========================================================
  context("refresh", () => {
    it("posts getMcpStatus", () => {
      const { result } = renderHook(() => useMcp());
      act(() => result.current.refresh());
      expect(postMessage).toHaveBeenCalledWith({ type: "getMcpStatus" });
    });
  });

  // ==========================================================
  // init with capabilities
  // ==========================================================
  context("capabilities.mcp is true", () => {
    it("posts getMcpStatus on mount", () => {
      renderHook(() => useMcp({ mcp: true }));
      expect(postMessage).toHaveBeenCalledWith({ type: "getMcpStatus" });
    });
  });

  context("capabilities.mcp is false", () => {
    it("does not post getMcpStatus on mount", () => {
      renderHook(() => useMcp({ mcp: false }));
      expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "getMcpStatus" }));
    });
  });

  context("capabilities is undefined", () => {
    it("does not post getMcpStatus on mount", () => {
      renderHook(() => useMcp());
      expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "getMcpStatus" }));
    });

    it("does not post getMcpStatus when capabilities is empty", () => {
      renderHook(() => useMcp({}));
      expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "getMcpStatus" }));
    });
  });
});
