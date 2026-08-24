import { describe, expect, it, vi } from "vitest";
import { CHAT_MCP_PREFS_KEY, VscodeChatMcpPrefsStore } from "../chat-mcp-prefs";

function createMemento(value: unknown) {
  return {
    get: vi.fn(() => value),
    update: vi.fn().mockResolvedValue(undefined),
  };
}

describe("VscodeChatMcpPrefsStore", () => {
  it("reads only string keys with boolean values", () => {
    const memento = createMemento({ enabled: true, disabled: false, invalid: "yes", nested: {} });
    const store = new VscodeChatMcpPrefsStore(memento);

    expect(store.read()).toEqual({ enabled: true, disabled: false });
    expect(memento.get).toHaveBeenCalledWith(CHAT_MCP_PREFS_KEY);
  });

  it("returns an empty map for absent or malformed state", () => {
    expect(new VscodeChatMcpPrefsStore(createMemento(undefined)).read()).toEqual({});
    expect(new VscodeChatMcpPrefsStore(createMemento(null)).read()).toEqual({});
    expect(new VscodeChatMcpPrefsStore(createMemento([])).read()).toEqual({});
    expect(new VscodeChatMcpPrefsStore(createMemento("invalid")).read()).toEqual({});
  });

  it("sanitizes values before storing them", async () => {
    const memento = createMemento(undefined);
    const store = new VscodeChatMcpPrefsStore(memento);

    await store.write({ enabled: true, invalid: "yes" as never, nested: {} as never });

    expect(memento.update).toHaveBeenCalledWith(CHAT_MCP_PREFS_KEY, { enabled: true });
  });
});
