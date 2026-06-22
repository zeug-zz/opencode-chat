import type { AgentEvent, ChatSession, FileDiff } from "@opencode-chat/core";
import { type RefObject, useCallback, useState } from "react";

/**
 * セッションレベルのファイル変更差分を管理するフック。
 *
 * SSE の `file.edited` / `session.diff` イベントに応じて差分データを更新し、
 * FileChangesHeader に提供する。
 */
export function useFileChanges(activeSessionRef: RefObject<ChatSession | null>) {
  const [diffs, setDiffs] = useState<FileDiff[]>([]);

  const clearDiffs = useCallback(() => {
    setDiffs([]);
  }, []);

  // SSE event handler for file-change-related events
  const handleFileChangeEvent = useCallback(
    (event: AgentEvent) => {
      if (event.type === "session.diff") {
        const activeId = activeSessionRef.current?.id;
        if (activeId && event.properties.sessionID !== activeId) return;
        setDiffs(event.properties.diff);
      }
    },
    [activeSessionRef],
  );

  return {
    diffs,
    setDiffs,
    clearDiffs,
    handleFileChangeEvent,
  } as const;
}
