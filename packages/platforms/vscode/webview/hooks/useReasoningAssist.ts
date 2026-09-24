import type { HostToUIMessage, ReasoningAssistStage, ReasoningAssistSummary } from "@opencode-chat/core";
import { useCallback, useState } from "react";

/** Compact per-prompt row rendered in the transcript for the active session. */
export type ReasoningAssistRowState = {
  sessionId: string;
  promptToken: string;
  stage: ReasoningAssistStage;
  summary?: ReasoningAssistSummary;
  applied: boolean;
  anchorMessageId?: string;
};

/** Host message context: the user message the row is attached to, if known. */
export type ReasoningAssistMessageContext = { anchorMessageId?: string };

type ReasoningAssistHostMessage = Extract<
  HostToUIMessage,
  { type: "reasoningAssistProgress" | "reasoningAssistSummary" | "reasoningAssistCleared" }
>;

type RowsBySession = Map<string, Map<string, ReasoningAssistRowState>>;

/**
 * Prompt-scoped reasoning-assist rows keyed by session and host prompt token.
 *
 * Only the validated summary object is retained; raw stage packets, graph
 * identifiers, and hidden model output never enter this state. Rows are scoped
 * per session so an applied row survives later turns, and a cleared event
 * deletes exactly one prompt token so a stale preflight cannot remove a newer
 * row. The anchor message is captured once, never overwritten.
 */
export function useReasoningAssist() {
  const [rowsBySession, setRowsBySession] = useState<RowsBySession>(() => new Map());

  const handleHostMessage = useCallback(
    (message: ReasoningAssistHostMessage, context?: ReasoningAssistMessageContext) => {
      setRowsBySession((prev) => {
        const next = new Map(prev);
        const sessionRows = new Map(next.get(message.sessionId) ?? []);

        if (message.type === "reasoningAssistCleared") {
          if (!sessionRows.delete(message.promptToken)) return prev;
          if (sessionRows.size === 0) next.delete(message.sessionId);
          else next.set(message.sessionId, sessionRows);
          return next;
        }

        const existing = sessionRows.get(message.promptToken);
        // A summary without prior progress still describes answer preparation.
        const stage = message.type === "reasoningAssistProgress" ? message.stage : (existing?.stage ?? "preparing");
        const applied = (existing?.applied ?? false) || stage === "applied";
        const summary = message.type === "reasoningAssistSummary" ? message.summary : existing?.summary;
        const anchorMessageId = existing?.anchorMessageId ?? context?.anchorMessageId;

        sessionRows.set(message.promptToken, {
          sessionId: message.sessionId,
          promptToken: message.promptToken,
          stage,
          applied,
          ...(summary !== undefined ? { summary } : {}),
          ...(anchorMessageId !== undefined ? { anchorMessageId } : {}),
        });
        next.set(message.sessionId, sessionRows);
        return next;
      });
    },
    [],
  );

  /**
   * Drops pending activity (session change, cancellation, or a failed
   * preflight) while retaining rows already applied to their response.
   */
  const clearPendingOnSessionChange = useCallback(() => {
    setRowsBySession((prev) => {
      let changed = false;
      const next: RowsBySession = new Map();
      for (const [sessionId, sessionRows] of prev) {
        const retained = new Map<string, ReasoningAssistRowState>();
        for (const [promptToken, row] of sessionRows) {
          if (row.applied && row.summary !== undefined) retained.set(promptToken, row);
          else changed = true;
        }
        if (retained.size > 0) next.set(sessionId, retained);
      }
      return changed ? next : prev;
    });
  }, []);

  /**
   * Fixes the still-unanchored rows of one session to the prompt message that
   * just materialized. Host progress can be published before that prompt
   * reaches the webview; rows that already carry an anchor are never
   * overwritten, other sessions are untouched, and the previous state object
   * is returned unchanged when there is nothing to anchor.
   */
  const anchorUnanchoredRows = useCallback((sessionId: string, anchorMessageId: string) => {
    setRowsBySession((prev) => {
      const sessionRows = prev.get(sessionId);
      if (!sessionRows) return prev;
      let changed = false;
      const nextSessionRows = new Map<string, ReasoningAssistRowState>();
      for (const [promptToken, row] of sessionRows) {
        if (row.anchorMessageId === undefined) {
          changed = true;
          nextSessionRows.set(promptToken, { ...row, anchorMessageId });
        } else {
          nextSessionRows.set(promptToken, row);
        }
      }
      if (!changed) return prev;
      const next = new Map(prev);
      next.set(sessionId, nextSessionRows);
      return next;
    });
  }, []);

  /** Rows for one session in first-seen (insertion) order. */
  const rowsForSession = useCallback(
    (sessionId: string): ReasoningAssistRowState[] => Array.from(rowsBySession.get(sessionId)?.values() ?? []),
    [rowsBySession],
  );

  return { rowsForSession, handleHostMessage, clearPendingOnSessionChange, anchorUnanchoredRows } as const;
}
