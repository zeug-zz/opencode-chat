import { RESTRICTED_REVIEW_AGENT_NAME } from "@opencode-chat/agent-opencode";
import type { ChatSession } from "@opencode-chat/core";
import { describe, expect, it } from "vitest";
import { createHiddenSessionRegistry, HIDDEN_SESSION_MARKER_PREFIX } from "../vibefeld/hidden-session-registry";

describe("hidden session registry", () => {
  it("tracks pending and confirmed sessions without title-wide hiding", () => {
    let now = 100;
    const registry = createHiddenSessionRegistry({ now: () => now, pendingTtlMs: 10 });
    const marker = `${HIDDEN_SESSION_MARKER_PREFIX}token`;
    const token = registry.beginHiddenSession(marker);
    expect(token).toBeDefined();
    expect(registry.isHiddenSessionMarker(marker)).toBe(true);
    expect(registry.suppressPendingEvent(marker)).toBe(true);
    expect(registry.isHiddenSessionId("session-1")).toBe(false);
    expect(registry.confirmHiddenSession(token!, "session-1")).toBe(true);
    expect(registry.isHiddenSessionId("session-1")).toBe(true);
    expect(registry.isHiddenSessionMarker(marker)).toBe(false);
    expect(registry.suppressPendingEvent(marker)).toBe(false);
    expect(registry.filterSessions([{ id: "session-1" }, { id: "ordinary" }] as never)).toEqual([{ id: "ordinary" }]);
    expect(registry.filterAgents([{ name: RESTRICTED_REVIEW_AGENT_NAME }, { name: "scout" }])).toEqual([
      { name: "scout" },
    ]);
    registry.forgetHiddenSession("session-1");
    expect(registry.isHiddenSessionId("session-1")).toBe(false);
    now = 200;
    expect(registry.isHiddenSessionMarker(marker)).toBe(false);
  });

  it("fails closed at the two-live-session bound and releases pending entries", () => {
    const registry = createHiddenSessionRegistry();
    const first = registry.beginHiddenSession(`${HIDDEN_SESSION_MARKER_PREFIX}one`)!;
    const second = registry.beginHiddenSession(`${HIDDEN_SESSION_MARKER_PREFIX}two`)!;
    expect(registry.beginHiddenSession(`${HIDDEN_SESSION_MARKER_PREFIX}three`)).toBeUndefined();
    registry.releaseHiddenSession(first);
    expect(registry.beginHiddenSession(`${HIDDEN_SESSION_MARKER_PREFIX}three`)).toBeDefined();
    expect(registry.liveCount()).toBe(2);
    registry.reset();
  });
});
