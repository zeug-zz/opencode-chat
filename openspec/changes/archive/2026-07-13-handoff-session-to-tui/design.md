## Context

Companion-owned `opencode serve` holds the project session DB. TUI attach keeps Scout overlay and shared process. User requirement: primary handoff = **independent full planner/builder TUI** + **chat must stay running** → session **copy** via export/import.

## Goals / Non-Goals

**Goals:**
- Export active session through companion APIs into import-compatible JSON `{ info, messages }`.
- Start independent OpenCode TUI on imported copy without stopping companion.
- Reliable terminal launch + user-visible progress/errors.
- Fallback when second OpenCode cannot open project DB.

**Non-Goals:**
- Kill companion to free lock.
- Live shared session after handoff.
- Auto-switching chat to the imported session.

## Decisions

### 1. Primary path = independent handoff (export/import)
Export format from OpenCode CLI: `{ info: Session, messages: Message[] }` (see opencode export command).

Populate via companion client (`session.get` + `session.messages` / agent equivalents), write JSON to a project-safe temp path under `os.tmpdir()` or workspace `.opencode-chat/handoff/` (prefer OS temp to avoid polluting repo).

Terminal command pattern (absolute opencode path):
```bash
opencode import "/path/to/session.json" && opencode --continue
```
(or equivalent if import prints session id — prefer `--continue` after successful import).

### 2. Chat stays up
Never call disconnect/close on companion as part of handoff.

### 3. Fallback = attach same session on companion (not fork)
If import/independent start fails with database lock (or generic failure after export succeeded):
- Show error explaining lock / second process issue.
- Offer or auto-offer action: `opencode attach <companionUrl> --session <activeSessionId>` (no fork) so user is not stuck.
- Product primary remains independent handoff; attach is degraded path.

### 4. Remove automatic fork-on-companion as primary
Drop `forkSession` from openTerminal happy path (was for isolation on shared server — wrong product now).

### 5. Reliability
- Progress: “Exporting session for TUI…”
- Errors via `vscode.window.showErrorMessage` (not console-only)
- Resolve `opencode` binary absolutely (PATH from extension host / known brew path)
- Wait for shell integration or short delay before `sendText`
- cwd = workspace folder

### 6. Capabilities lock
If companion `getServerUrl()` missing or no active session → error, no-op with message.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| DB lock on independent import/TUI | Spike + attach fallback; never kill chat |
| Export format drift | Match opencode `{info,messages}`; fixture tests |
| Large session export slow | Progress UI |
| User thinks histories stay linked | Copy wording in toast |
| Temp file retention | Prefer os.tmpdir; optional cleanup later |

## Migration

- Behavior change for terminal button: fork → handoff
- Update tests and button title if needed (“Hand off to TUI” / keep “Open session in terminal” with new semantics documented)

## Open Questions (resolved in-task)

- Exact chained CLI after import: verify `import && opencode -c` in implementation spike.
- Whether CLI export while companion runs is safe → prefer HTTP/client export only.
