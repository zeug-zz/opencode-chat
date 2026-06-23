## 1. Domain Type — Add event to AgentEvent union

- [x] 1.1 Add `session.next.context.updated` variant to `AgentEvent` in `packages/core/src/domain.ts`. Properties include `sessionID: string` and `text: string`. No mappers, protocol types, or agent interface changes needed.

## 2. App.tsx — State + handler + prop threading

- [x] 2.1 Add `const [contextMemory, setContextMemory] = useState<string>("")` alongside existing simple states (line 41-55 area).
- [x] 2.2 In `handleEvent`, add a branch for `event.type === "session.next.context.updated"` that filters by `activeSessionRef.current?.id === event.properties.sessionID` and calls `setContextMemory(event.properties.text)`.
- [x] 2.3 Clear `contextMemory` when the active session changes — add a `useEffect` keyed on `session.activeSession?.id` that calls `setContextMemory("")`.
- [x] 2.4 Pass `contextMemoryText={contextMemory}` to `InputArea` in the JSX (line 543-571 area).

## 3. InputArea — Prop + render

- [x] 3.1 Add `contextMemoryText?: string` to the `Props` type and destructure it in the component signature.
- [x] 3.2 Render a conditional `<span className={styles.contextMemory} title={t["input.contextMemory"]}>{contextMemoryText}</span>` inside `actionsLeft`, after the terminal button and before the closing `</div>`.

## 4. Styles — Chip CSS

- [x] 4.1 Add `.contextMemory` rule to `InputArea.module.css`: monospace font at 11px with `--vscode-descriptionForeground` color, `white-space: nowrap`, `user-select: none`.

## 5. Internationalization

- [x] 5.1 Add `"input.contextMemory": "Contextual memory"` (plus translated values) to all eight locale files: `en.ts`, `ja.ts`, `zh-cn.ts`, `zh-tw.ts`, `pt-br.ts`, `es.ts`, `ru.ts`, `ko.ts`. Place alongside existing `input.*` keys.

## 6. Verification

- [x] 6.1 Run `npm run check` — Biome lint + format must pass with zero errors.
- [x] 6.2 Run `npm test` — all existing tests must pass. No regressions.
- [x] 6.3 Run `npm run build` — webview + extension must compile with zero errors.

## 7. Fallback — step.ended computation

Testing revealed that the opencode server does not emit `session.next.context.updated` during normal chat sessions (it may be TUI-internal or compaction-only). The `session.next.step.ended` event was tried but also may not be emitted reliably. The definitive fallback is `message.updated` — confirmed to fire for every message including streaming completion — which carries `info.tokens` on assistant messages when the response finishes. This slice adds a fallback computation path so the chip populates even without `context.updated`.

- [x] 7.1 Add `session.next.step.ended` variant to `AgentEvent` in `packages/core/src/domain.ts`. Properties: `sessionID: string` and `tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }`. Place after the existing `session.next.context.updated` variant.
- [x] 7.2 In `App.tsx` `handleEvent`, add a `message.updated` handler branch (after the existing `context.updated` branch) that: (a) filters by `info.sessionID === currentSession?.id`; (b) only processes assistant messages with `info.tokens` present; (c) computes `contextTokens = info.tokens.input + info.tokens.cache.read`; (d) resolves the selected model's `limit.context` from `prov.providers` using `prov.selectedModel`; (e) formats as `${formatK(contextTokens)} (${pct}%)` when limit is available, or `${formatK(contextTokens)}` when not; (f) calls `setContextMemory(...)`. Add `prov.selectedModel` and `prov.providers` to the `handleEvent` useCallback dependency array. Add a `formatK` helper (e.g. `134600 → "134.6K"`, `1500 → "1.5K"`) as a module-level function before the App component.
- [x] 7.3 Package and verify: `npm run check && npm test && npm run build`.
