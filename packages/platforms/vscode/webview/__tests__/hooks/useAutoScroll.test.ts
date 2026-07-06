import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useAutoScroll } from "../../hooks/useAutoScroll";

describe("useAutoScroll", () => {
  // initial state
  context("初期状態の場合", () => {
    it("containerRef と bottomRef を返すこと", () => {
      const { result } = renderHook(() => useAutoScroll([]));
      expect(result.current.containerRef).toBeDefined();
      expect(result.current.bottomRef).toBeDefined();
    });

    it("handleScroll コールバックを返すこと", () => {
      const { result } = renderHook(() => useAutoScroll([]));
      expect(typeof result.current.handleScroll).toBe("function");
    });

    it("isNearBottom がデフォルトで true であること", () => {
      const { result } = renderHook(() => useAutoScroll([]));
      expect(result.current.isNearBottom).toBe(true);
    });

    it("scrollToBottom コールバックを返すこと", () => {
      const { result } = renderHook(() => useAutoScroll([]));
      expect(typeof result.current.scrollToBottom).toBe("function");
    });
  });

  // messages 変更による自動スクロール
  context("messages 配列が変更された場合", () => {
    it("最下部付近にいれば scrollIntoView が呼ばれること", () => {
      const scrollIntoViewMock = vi.fn();
      const { result, rerender } = renderHook((props: { messages: unknown[] }) => useAutoScroll(props.messages), {
        initialProps: { messages: [] },
      });

      const bottomEl = document.createElement("div");
      bottomEl.scrollIntoView = scrollIntoViewMock;
      (result.current.bottomRef as React.MutableRefObject<HTMLDivElement | null>).current = bottomEl;

      // scrollToBottom from initial mount clears the mock
      scrollIntoViewMock.mockClear();

      // Rerender with new messages — effect should fire and scroll
      act(() => {
        rerender({ messages: ["new"] });
      });

      expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: "auto" });
    });

    it("scrollIntoView が呼ばれないこと（上部にスクロール済み）", () => {
      const scrollIntoViewMock = vi.fn();
      const { result, rerender } = renderHook((props: { messages: unknown[] }) => useAutoScroll(props.messages), {
        initialProps: { messages: [] },
      });

      const containerEl = document.createElement("div");
      Object.defineProperty(containerEl, "scrollHeight", { value: 1000 });
      Object.defineProperty(containerEl, "scrollTop", { value: 0 });
      Object.defineProperty(containerEl, "clientHeight", { value: 400 });
      (result.current.containerRef as React.MutableRefObject<HTMLDivElement | null>).current = containerEl;

      const bottomEl = document.createElement("div");
      bottomEl.scrollIntoView = scrollIntoViewMock;
      (result.current.bottomRef as React.MutableRefObject<HTMLDivElement | null>).current = bottomEl;

      act(() => {
        result.current.handleScroll();
      });
      expect(result.current.isNearBottom).toBe(false);

      scrollIntoViewMock.mockClear();

      act(() => {
        rerender({ messages: ["new"] });
      });

      expect(scrollIntoViewMock).not.toHaveBeenCalled();
    });

    it("最下部に戻った後に scrollIntoView が再び呼ばれること", () => {
      const scrollIntoViewMock = vi.fn();
      const { result, rerender } = renderHook((props: { messages: unknown[] }) => useAutoScroll(props.messages), {
        initialProps: { messages: [] },
      });

      const containerEl = document.createElement("div");
      Object.defineProperty(containerEl, "scrollHeight", { value: 1000, configurable: true });
      Object.defineProperty(containerEl, "scrollTop", { value: 0, configurable: true });
      Object.defineProperty(containerEl, "clientHeight", { value: 400, configurable: true });
      (result.current.containerRef as React.MutableRefObject<HTMLDivElement | null>).current = containerEl;

      const bottomEl = document.createElement("div");
      bottomEl.scrollIntoView = scrollIntoViewMock;
      (result.current.bottomRef as React.MutableRefObject<HTMLDivElement | null>).current = bottomEl;

      // Scroll away from bottom
      act(() => {
        result.current.handleScroll();
      });
      expect(result.current.isNearBottom).toBe(false);
      scrollIntoViewMock.mockClear();

      // Scroll back to near bottom
      Object.defineProperty(containerEl, "scrollTop", { value: 950, configurable: true });
      act(() => {
        result.current.handleScroll();
      });
      expect(result.current.isNearBottom).toBe(true);
      scrollIntoViewMock.mockClear();

      // Rerender with new messages — effect should fire and scroll
      act(() => {
        rerender({ messages: ["new"] });
      });

      expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: "auto" });
    });
  });

  context("scrollToBottom を明示的に呼び出した場合", () => {
    it("scrollIntoView が呼ばれること", () => {
      const scrollIntoViewMock = vi.fn();
      const { result } = renderHook(() => useAutoScroll([]));

      const bottomEl = document.createElement("div");
      bottomEl.scrollIntoView = scrollIntoViewMock;
      (result.current.bottomRef as React.MutableRefObject<HTMLDivElement | null>).current = bottomEl;

      act(() => {
        result.current.scrollToBottom();
      });

      expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: "smooth" });
    });
  });
});
