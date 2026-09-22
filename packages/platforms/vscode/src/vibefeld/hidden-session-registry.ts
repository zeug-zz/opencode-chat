import { RESTRICTED_REVIEW_AGENT_NAME } from "@opencode-chat/agent-opencode";
import type { AgentInfo, ChatSession } from "@opencode-chat/core";

export const HIDDEN_SESSION_MARKER_PREFIX = "vibefeld-restricted-review-";
const DEFAULT_PENDING_TTL_MS = 5_000;
const MAX_PENDING = 8;
const MAX_LIVE = 2;
const MAX_BUFFERED_EVENTS = 32;

type Pending = { marker: string; expiresAt: number; bufferedEvents: number };

export type HiddenSessionRegistry = ReturnType<typeof createHiddenSessionRegistry>;

export function createHiddenSessionRegistry(options: { now?: () => number; pendingTtlMs?: number } = {}) {
  const now = options.now ?? Date.now;
  const pendingTtlMs = options.pendingTtlMs ?? DEFAULT_PENDING_TTL_MS;
  const pending = new Map<string, Pending>();
  const confirmed = new Set<string>();

  const expire = (): void => {
    const timestamp = now();
    for (const [token, entry] of pending) {
      if (entry.expiresAt <= timestamp) pending.delete(token);
    }
  };

  const liveCount = (): number => {
    expire();
    return pending.size + confirmed.size;
  };

  return {
    beginHiddenSession(marker: string): string | undefined {
      expire();
      if (!marker.startsWith(HIDDEN_SESSION_MARKER_PREFIX)) return undefined;
      if (pending.size >= MAX_PENDING || liveCount() >= MAX_LIVE) return undefined;
      const token = marker.slice(HIDDEN_SESSION_MARKER_PREFIX.length);
      if (!token || pendingHasMarker(marker)) return undefined;
      const registration = `${token}-${Math.random().toString(36).slice(2)}`;
      pending.set(registration, { marker, expiresAt: now() + pendingTtlMs, bufferedEvents: 0 });
      return registration;
    },

    confirmHiddenSession(token: string, sessionId: string): boolean {
      expire();
      if (!sessionId) return false;
      const entry = pending.get(token);
      if (!entry || liveCount() > MAX_LIVE) return false;
      pending.delete(token);
      // The SDK normally returns unique ids. Treat a duplicate as the same
      // hidden session so test doubles and reconnect races cannot leak it.
      if (confirmed.has(sessionId)) return true;
      confirmed.add(sessionId);
      return true;
    },

    releaseHiddenSession(token: string): void {
      pending.delete(token);
    },

    forgetHiddenSession(sessionId: string): void {
      confirmed.delete(sessionId);
    },

    isHiddenSessionId(id: string): boolean {
      expire();
      return confirmed.has(id);
    },

    isHiddenSessionMarker(title: string): boolean {
      expire();
      for (const entry of pending.values()) if (entry.marker === title) return true;
      return false;
    },

    isHiddenSession(value: { id: string; title?: string }): boolean {
      expire();
      return confirmed.has(value.id) || (value.title !== undefined && pendingHasMarker(value.title));
    },

    filterSessions(list: readonly ChatSession[]): ChatSession[] {
      expire();
      return list.filter(
        (session) => !confirmed.has(session.id) && (session.title === undefined || !pendingHasMarker(session.title)),
      );
    },

    filterAgents(list: readonly AgentInfo[]): AgentInfo[] {
      return list.filter((agent) => agent.name !== RESTRICTED_REVIEW_AGENT_NAME);
    },

    /** Suppress pending-marker events without retaining their payload. */
    suppressPendingEvent(title: string): boolean {
      expire();
      for (const entry of pending.values()) {
        if (entry.marker !== title) continue;
        if (entry.bufferedEvents < MAX_BUFFERED_EVENTS) entry.bufferedEvents += 1;
        return true;
      }
      return false;
    },

    liveCount,

    reset(): void {
      pending.clear();
      confirmed.clear();
    },
  };

  function pendingHasMarker(marker: string): boolean {
    for (const entry of pending.values()) if (entry.marker === marker) return true;
    return false;
  }
}

export const hiddenSessionRegistry = createHiddenSessionRegistry({ now: () => Date.now() });
