# Plan: Fix Webview Text Selection Flash-Clearing

## Symptoms

In the opencode-chat VS Code webview, click-drag text selection appears for an instant then blinks off. The TUI (terminal) selection works correctly. The Copy Markdown button works, but native rendered-text selection is broken.

## Root Cause

Two interacting mechanisms in the webview progressively destroy DOM text selection:

### 1. `TextPartView` `dangerouslySetInnerHTML` reconciliation (primary)

**File:** `packages/platforms/vscode/webview/components/molecules/TextPartView/TextPartView.tsx`

- Line 474-480: `html` computed via `useMemo` with deps `[part.text, renderedTick]`
- Line 606: rendered as `dangerouslySetInnerHTML={{ __html: html }}`
- Every parent re-render reaches `TextPartView` with a new `html` string reference (even if content is identical)
- React reconciles `dangerouslySetInnerHTML` by replacing `innerHTML` — this destroys all DOM nodes, clearing any text selection

### 2. `useAutoScroll` `scrollIntoView` on message updates (contributing)

**File:** `packages/platforms/vscode/webview/hooks/useAutoScroll.ts`

- Lines 38-42: calls `scrollIntoView({ behavior: "smooth" })` on EVERY `messages` array change
- During streaming, this fires on every token
- After streaming stops, side-effect re-renders (context token updates, file change events, `message.updated` events) propagate through the message tree
- In WebKit (VS Code on macOS), `scrollIntoView` is known to clear text selection on the scrolled element

### Re-render chain

```
extension host event → handleEvent() → React state set → re-render cascade:
  App → MessagesArea → MessageItem → TextPartView
                                          ↓
                              dangerouslySetInnerHTML replaced
                                          ↓
                              DOM nodes destroyed → selection cleared
```

### Mermaid `renderedTick` exacerbation

- Line 531/552: `setRenderedTick((t) => t + 1)` fires after Mermaid rendering
- `renderedTick` is a `useMemo` dependency for `html`
- Each tick triggers a full `html` recalculation → DOM replacement → selection clear
- This affects even non-Mermaid messages if they share a parent render context

## Fix Plan

### Step 1: Memoize `TextPartView` to skip needless re-renders

Add `React.memo` with a custom comparator that only re-renders when `part.text` content actually changes (not just reference).

```tsx
// Before
export function TextPartView({ part }: Props) { ... }

// After
export const TextPartView = React.memo(
  function TextPartView({ part }: Props) { ... },
  (prev, next) => prev.part.text === next.part.text
);
```

### Step 2: Guard `useAutoScroll` against selection-destroying scrolls

Skip `scrollIntoView` when the user has an active text selection in the document.

```ts
// In useAutoScroll.ts, useEffect for messages:
useEffect(() => {
  if (isNearBottomRef.current) {
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return; // user has active selection, don't scroll
    scrollToBottom();
  }
}, [messages, scrollToBottom]);
```

### Step 3 (optional): Replace `dangerouslySetInnerHTML` with ref-based content diffing

Add a `useLayoutEffect` that compares the new HTML against the DOM's existing `innerHTML` and only sets it when they differ. This avoids DOM node destruction when content hasn't changed.

```tsx
const containerRef = useRef<HTMLDivElement>(null);

useLayoutEffect(() => {
  const el = containerRef.current;
  if (el && el.innerHTML !== html) {
    el.innerHTML = html;
  }
}, [html]);

// Replace dangerousSetInnerHTML with plain ref:
return <div ref={containerRef} className="markdown" onClick={handleClick} />;
```

Step 3 is the most robust fix but changes the rendering approach. Steps 1+2 together should resolve the issue for the common case without architectural changes. Consider Step 3 if selection still flashes after Steps 1+2.

## Verification

After fix, verify:
1. Select text in a fully-rendered assistant message — selection persists
2. Select text during streaming (busy state) — selection persists if the selected message's content is stable
3. Copy Markdown button still works
4. Code block copy buttons still work
5. Mermaid diagrams still render correctly
6. Auto-scroll still works when user is at bottom and has no active selection
7. File path link clicks still work

## Files Affected

- `packages/platforms/vscode/webview/components/molecules/TextPartView/TextPartView.tsx`
- `packages/platforms/vscode/webview/hooks/useAutoScroll.ts`
