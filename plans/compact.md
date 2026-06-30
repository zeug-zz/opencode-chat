# Compact Session Action — Full Implementation Plan

## Goal
Fully implement the compact session action in the VS Code GUI, matching the
opencode TUI `/compact` behavior. The compact button currently calls
`summarizeSession` correctly but the GUI doesn't render compaction messages,
stream the summary live, or show pruned tool outputs.

## Architecture
The `/compact` command spans 3 key locations in the opencode monorepo:
1. **TUI command dispatch** — `packages/tui/src/prompt/` parses `/compact` (alias `/summarize`)
   and dispatches to the session service.
2. **Session compaction service** — `packages/opencode/src/session/compaction.ts`:
   - `create()` — inserts a compaction marker user message with `CompactionPart`
   - `processCompaction()` — calls LLM to generate summary, handles overflow,
     preserves recent turns
   - `select()` — splits conversation into compactable head and preserved recent tail
   - `prune()` — strips old tool outputs, marking them with `time.compacted`
3. **Core compaction logic** — `packages/core/src/session/compaction.ts`:
   - `buildPrompt()` — generates structured summary prompt with
     Goal/Progress/Decisions sections
   - `select()` — splits conversation into compactable head and preserved recent tail
   - `make()` — auto-compaction on context overflow

## Server Compaction Flow
```
User clicks compact
  → server create(): inserts user msg with CompactionPart {auto: false}
  → server emits session.next.compaction.started {reason: "manual"}
  → server processCompaction():
      select() → splits head (compactable) / tail (preserved)
      buildPrompt() → structured summary prompt
      LLM streams summary → emits session.next.compaction.delta {text} (multiple)
      summary stored as assistant msg with info.summary = true
  → server prune(): marks old tool outputs with time.compacted
  → server emits session.next.compaction.ended {text, recent}
  → server emits session.compacted {sessionID}
  → on next LLM call: context uses summary + tail only (head excluded)
```

## Current State: What Works
- **Backend stubs**: `summarizeSession` in agent interface and OpenCodeAgent,
  `compressSession` protocol handler in chat-view-provider, SSE event handler
  for `session.compacted` / `session.next.compaction.ended` (re-fetches
  session+messages)
- **GUI plumbing**: `App.tsx` context display fixes (token count = input +
  cache.read), compaction guard (blocks fallback tokens during compaction)
- **AgentSelector**: compact action button wired through InputArea → App.tsx
  → postMessage → chat-view-provider → summarizeSession

## GUI Button Removed (Temporary)
The compact button was removed from AgentSelector to keep the partial
implementation from misleading users. The backend stubs remain so the
feature can be re-enabled when the full rendering pipeline is implemented.

## To Implement: Phase 1 — Fix Domain Types (domain.ts)

### 1.1 CompactionPart — add missing fields
```ts
export type CompactionPart = {
  id: string;
  sessionID: string;
  messageID: string;
  type: "compaction";
  auto: boolean;          // ADD
  overflow?: boolean;      // ADD
  tail_start_id?: string;  // ADD
};
```

### 1.2 ChatMessage.summary — fix type
```ts
// From: summary?: unknown;
summary?: boolean;  // marks assistant messages that are compaction summaries
```

### 1.3 ToolStateCompleted — add time field
```ts
export type ToolStateCompleted = {
  status: "completed";
  input: unknown;
  output: unknown;
  title?: string;
  metadata?: unknown;
  time: {                           // ADD
    start: number;                  // ADD
    end: number;                    // ADD
    compacted?: number;             // ADD — set when tool output is pruned
  };                                // ADD
};
```

### 1.4 AgentEvent — add compaction events
```ts
// ADD:
| {
    type: "session.next.compaction.delta";
    properties: { timestamp: number; sessionID: string; messageID: string; text: string };
  }

// MODIFY (add reason):
| {
    type: "session.next.compaction.started";
    properties: { sessionID: string; messageID: string; timestamp: number; reason: "auto" | "manual" };
  }

// MODIFY (add timestamp, messageID, reason):
| {
    type: "session.next.compaction.ended";
    properties: { sessionID: string; messageID: string; timestamp: number; text: string; recent: string; reason: "auto" | "manual" };
  }
```

## To Implement: Phase 2 — Render Compaction Messages

### 2.1 CompactionPartView component (`components/molecules/CompactionPartView/`)
Render the compaction marker (user message containing a `compaction` part):
- Main state: "Compacting session…" with spinner
- When message is completed: "Session compacted" with checkmark
- Badge for `auto` vs `manual`
- Badge for `overflow` if set
- Collapsible to show `tail_start_id`

### 2.2 Summary assistant message rendering
When `ChatMessage.summary === true`:
- Render with "Session Summary" header (bold, distinct background)
- Content is the structured markdown (Goal/Progress/Decisions/etc.)
- Collapsible by default (expand to read full summary)
- Different left border or background color to distinguish from regular messages

### 2.3 Pruned tool output handling
When `ToolStateCompleted.time.compacted` is set:
- Collapse the tool output (don't show full output)
- Show a single line: "Tool output pruned (compacted)"
- Optional: expand button to show truncated output

## To Implement: Phase 3 — Handle Compaction Streaming

### 3.1 session.next.compaction.delta events
In `App.tsx` (or a dedicated context):
- Accumulate delta text into a streaming buffer
- Render the live summary text in the message list (or in a floating progress bar)
- Clear the buffer on `compaction.ended`

### 3.2 Show compaction progress
Between `compaction.started` and `compaction.ended`:
- Show "Compacting session… (generating summary)" in the context chip area
- Show progress indicator (spinner) next to the context meter
- On `compaction.ended`, immediately update context from `text` and `recent` fields

### 3.3 Re-enable compact button
Once Phases 1-3 are complete, re-add the compact action row to AgentSelector
(undo the "GUI Button Removed" step) and re-add the `handleCompactSession`
callback and `onCompactSession` prop plumbing.

## Tests Needed

### Phase 1 tests
- `domain.ts` type compilation checks (compile-time)

### Phase 2 tests
- `CompactionPartView.test.tsx`: renders "Compacting…" / "Compacted" states
- `MessageItem.test.tsx`: renders summary message with distinct styling
- `ToolPartView.test.tsx`: collapsed state for pruned tools

### Phase 3 tests
- Compaction context guard tests (exist: 28-compaction-context-guard.test.tsx)
- Delta streaming test: accumulates text, renders live, clears on ended
- Progress indicator test: shown between started and ended

### Integration test
- Full compaction flow scenario: button click → started → deltas → ended → summary rendered
