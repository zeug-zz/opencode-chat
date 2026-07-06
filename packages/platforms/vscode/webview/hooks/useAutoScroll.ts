import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/** ユーザーが「最下部付近」と判定するスクロール閾値（px） */
const NEAR_BOTTOM_THRESHOLD = 100;

/**
 * メッセージ一覧の自動スクロールを管理するフック。
 *
 * - 初回マウント時は無条件に最下部へスクロールする
 * - messages 変更時に useLayoutEffect で同期的にスクロールする
 *   （ペイント前にスクロール位置を更新するため、コンテンツ増加による
 *   ジャンプが発生しない。Reasoning 折りたたみ時も state 更新に連動する）
 * - ユーザーが上方にスクロールしている場合は追従しない
 * - ユーザーがテキスト選択中は追従しない
 */
export function useAutoScroll(messages: unknown[]) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const [isNearBottom, setIsNearBottom] = useState(true);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    bottomRef.current?.scrollIntoView({ behavior });
  }, []);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nextIsNearBottom = distanceFromBottom <= NEAR_BOTTOM_THRESHOLD;
    isNearBottomRef.current = nextIsNearBottom;
    setIsNearBottom(nextIsNearBottom);
  }, []);

  // 初回マウント時に最下部へスクロールする
  useEffect(() => {
    scrollToBottom();
  }, [scrollToBottom]);

  // messages 変更時に最下部付近ならスクロールする
  // （Reasoning 折りたたみ時も state は更新されるため、ResizeObserver より確実）
  useLayoutEffect(() => {
    if (!isNearBottomRef.current) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    scrollToBottom("auto");
  }, [messages, scrollToBottom]);

  return { containerRef, bottomRef, handleScroll, isNearBottom, scrollToBottom } as const;
}
