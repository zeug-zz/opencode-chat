import type { AgentEvent, ChatSession, Permission } from "@opencode-chat/core";
import { type RefObject, useCallback, useState } from "react";

/**
 * ツール実行時の許可リクエスト（Allow / Once / Deny）の状態管理フック。
 *
 * AI がツールを使おうとすると permission.asked で許可リクエストが届き、
 * ユーザーが回答すると permission.replied で解消される。
 * Map が空でなければ未回答のリクエストがあり、PermissionView が表示される。
 */
export function usePermissions(activeSessionRef: RefObject<ChatSession | null>) {
  const [permissions, setPermissions] = useState<Map<string, Permission>>(new Map());

  const addPermission = useCallback((permission: Permission) => {
    setPermissions((prev) => {
      const next = new Map(prev);
      next.set(permission.id, permission);
      return next;
    });
  }, []);

  const removePermission = useCallback((requestID: string) => {
    setPermissions((prev) => {
      const next = new Map(prev);
      next.delete(requestID);
      return next;
    });
  }, []);

  const handlePermissionEvent = useCallback(
    (event: AgentEvent) => {
      const activeId = activeSessionRef.current?.id;
      switch (event.type) {
        case "permission.asked": {
          if (activeId && event.properties.sessionID !== activeId) break;
          addPermission(event.properties);
          break;
        }
        case "permission.replied":
          removePermission(event.properties.requestID);
          break;
      }
    },
    [activeSessionRef, addPermission, removePermission],
  );

  return {
    permissions,
    handlePermissionEvent,
  } as const;
}
