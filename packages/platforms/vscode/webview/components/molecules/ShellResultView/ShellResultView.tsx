import type { ToolPart } from "@opencode-chat/core";
import { useMemo, useState } from "react";
import { useLocale } from "../../../locales";
import { asRecord, formatToolOutput } from "../../../utils/format-tool-output";
import { ChevronRightIcon, SpinnerIcon, TerminalIcon } from "../../atoms/icons";
import styles from "./ShellResultView.module.css";

type Props = {
  parts: ToolPart[];
};

/**
 * ユーザーが ! プレフィクスで実行したシェルコマンドの結果をターミナル風に表示する。
 * 通常の ToolPartView（折りたたみカード）ではなく、コマンドと出力を一体で見せる。
 */
export function ShellResultView({ parts }: Props) {
  const t = useLocale();
  const [expanded, setExpanded] = useState(true);

  const entries = useMemo(() => {
    return parts
      .filter((p) => p.type === "tool")
      .map((p) => {
        const { state } = p;
        const input = asRecord(state.status !== "pending" ? state.input : null);
        const command = typeof input?.command === "string" ? input.command : "";
        const isRunning = state.status === "running" || state.status === "pending";
        const isError = state.status === "error";
        const output =
          state.status === "completed" ? formatToolOutput(state.output, t["tool.outputUnavailable"]) : null;
        const error = state.status === "error" ? formatToolOutput(state.error, t["tool.outputUnavailable"]) : null;
        return { command, output, error, isRunning, isError };
      });
  }, [parts]);

  return (
    <div className={styles.root}>
      <div className={styles.header} onClick={() => setExpanded((s) => !s)}>
        <span className={styles.headerIcon}>
          <TerminalIcon />
        </span>
        <span className={styles.headerLabel}>{t["shell.title"]}</span>
        <span className={`${styles.chevron} ${expanded ? styles.expanded : ""}`}>
          <ChevronRightIcon />
        </span>
      </div>
      {expanded && (
        <div className={styles.terminal}>
          {entries.map((entry, i) => (
            <div key={i} className={styles.entry}>
              <div className={styles.promptLine}>
                <span className={styles.dollar}>$</span>
                <span className={styles.command}>{entry.command}</span>
              </div>
              {entry.isRunning && (
                <div className={styles.running}>
                  <SpinnerIcon className={styles.spinner} width={14} height={14} />
                </div>
              )}
              {entry.output !== null && <pre className={styles.output}>{entry.output}</pre>}
              {entry.isError && entry.error !== null && (
                <pre className={`${styles.output} ${styles.outputError}`}>{entry.error}</pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
