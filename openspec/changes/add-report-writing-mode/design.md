## Context

The companion server currently injects a read-only Scout agent overlay, while the user-facing `write` label maps to OpenCode's internal `build` agent. `CHAT_SYSTEM.md` is loaded by the extension host and injected only for Scout messages. The webview also exposes a shell-mode path that sends `executeShell` directly, and the edit-and-resend protocol does not carry the selected primary agent. See proposal.md and the delta specs for the behavioral contract.

## Goals / Non-Goals

**Goals:**

- Preserve `scout`/`build` as the internal compatibility identifiers while presenting `chat`/`write` to users.
- Add a report-authoring prompt as a request-level companion instruction for Write without replacing OpenCode's built-in Build baseline.
- Enforce a companion Write permission boundary of read, workspace search, web research, and edit only.
- Remove direct companion shell execution and preserve the independent TUI handoff.
- Preserve Write mode and prompt routing through normal sends and edit-and-resend.

**Non-Goals:**

- Do not change the independent TUI's Build agent, permissions, prompts, or shell behavior.
- Do not add report templates, publishing, document conversion, or new providers.
- Do not mutate user or project `opencode.json` files.

## Decisions

### Use request-level Write instructions

Load a separate `WRITE_SYSTEM.md` beside `CHAT_SYSTEM.md` and select the default request-level system instruction from the internal primary-agent value. Scout continues to receive `CHAT_SYSTEM.md`; Build-backed Write receives `WRITE_SYSTEM.md`. Keep explicit `message.system` values authoritative.

This preserves OpenCode's built-in Build baseline and environment instructions while adding report-specific behavior. Reusing `CHAT_SYSTEM.md` is rejected because it explicitly says the agent is read-only and cannot write files. Replacing the Build agent prompt through agent configuration is also rejected because it could discard useful OpenCode baseline behavior and user-facing compatibility.

### Apply permissions in the companion server overlay

Extend the in-memory companion configuration with a Build-backed Write permission profile. The profile must use the OpenCode permission schema verified in the existing SDK/configuration path, deny Bash and task/subagent actions, and explicitly allow only read, workspace search, web research, and edit actions. The overlay must remain process-scoped and must not write `opencode.json`.

If OpenCode's permission precedence requires a deny-by-default rule, establish that rule before the allowlist. Add an agent configuration test that checks the effective permission result rather than only checking source literals.

### Remove the shell path at both UI and host boundaries

Remove the shell-mode control and `!` dispatch from the webview. Retain a defensive host protocol branch for legacy or malformed `executeShell` messages that rejects without calling the agent shell API. Keep any underlying interface method only if required by shared compatibility; it must not be reachable through the companion webview. The existing terminal handoff remains unchanged and is the supported path to unrestricted coding.

This is preferred over only hiding the UI because the current shell path is a direct host operation and would otherwise remain callable by a stale webview or protocol sender.

### Carry primary-agent context through edit-and-resend

Extend the edit-and-resend message contract with the selected primary-agent value and route it through the same prompt-selection logic as a normal send. Preserve the internal `build` value on the wire. Explicit system overrides, if supported on this path, take precedence over the default Scout or Write prompt.

### Keep the user-facing alias separate from the protocol identifier

Retain the existing selector alias `build` → `write` and do not rename persisted or server-provided agent identifiers. Existing sessions and host integrations therefore continue to use `primaryAgent: "build"`, while the UI and report-writing specifications use `write`.

## Risks / Trade-offs

- **[Permission schema drift]** OpenCode may change permission precedence or action names → verify against the installed SDK/configuration path and assert the effective agent permissions in tests.
- **[Report quality varies by model]** A prompt cannot guarantee citation accuracy → require source attribution and evidence/inference separation, but do not claim independent fact verification.
- **[Legacy shell callers]** Existing protocol clients may still send `executeShell` → reject at the host boundary without executing, and update the typed protocol and tests.
- **[Edit flow compatibility]** Adding primary-agent data to edit-and-resend can affect old messages → make the field optional for compatibility and fall back to the current selected/default behavior when absent.
- **[Prompt packaging]** The new prompt must be included in the VSIX → verify the packaged artifact contains `WRITE_SYSTEM.md` and run the existing build/package flow.

## Migration Plan

1. Add the new prompt and companion permission overlay without changing the internal agent IDs.
2. Update the webview protocol and shell UI, then wire prompt/mode preservation for send and edit-resend.
3. Run focused host, agent configuration, and webview tests, followed by the full webview suite and strict OpenSpec validation.
4. Build and package the extension; install the VSIX and manually verify the `chat`/`write` selector, report-file editing, disabled shell mode, and terminal handoff.

Rollback is to remove the Write prompt/permission overlay, restore the shell-mode UI and host dispatch, and revert the edit-and-resend field. No persisted data migration or user configuration rollback is required because internal agent identifiers and `opencode.json` remain unchanged.
