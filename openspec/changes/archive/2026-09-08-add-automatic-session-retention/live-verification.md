# Automatic session retention live gate

**Status: BLOCKED — disposable Hindsight inputs are not present in this
workspace.**

This is an opt-in operator checklist, not a claim that the provider is
operational. The live gate must use a newly-created disposable Hindsight bank
and a provider endpoint supplied by the operator. It must never use the
personal/default bank, a checked-in configuration file, or credentials from
source.

## Explicit gate

Set all of the following only in the environment of the one verification
process. Do not print their values or include them in test output, transcripts,
logs, screenshots, or bug reports.

```sh
OPENCODE_CHAT_HINDSIGHT_LIVE=1
OPENCODE_CHAT_HINDSIGHT_DISPOSABLE_BANK=<new-empty-bank-id>
OPENCODE_CHAT_HINDSIGHT_DISPOSABLE_ENDPOINT=<approved-test-endpoint>
OPENCODE_CHAT_HINDSIGHT_DISPOSABLE_TOKEN=<injected-test-credential>
```

If any input is absent, the gate remains **BLOCKED** with the missing input
name(s). Synthetic readiness tests may still run. The harness must not create
a bank, contact a provider, or retry with another bank when the gate is
blocked.

## Disposable-provider checklist

- [ ] Confirm the bank is new, disposable, empty, and not the personal/default
      bank; record only its non-sensitive test identifier in the operator's
      private test record.
- [ ] Confirm the companion uses the exact approved Hindsight provider and
      process-scoped overlay. Confirm the independent OpenCode TUI config and
      lifecycle are unchanged.
- [ ] With automatic retention absent from workspace settings, start one Chat
      session and one Write session. Confirm status is active only after the
      provider, lifecycle capability, observed inventory, and requested
      sandbox checks pass.
- [ ] In each session, use only this known non-sensitive fact:
      `retention-live-check: the workspace test marker is alpine-otter-42`.
      Complete/idle the sessions once; do not include secrets, credentials,
      private documents, web content, or raw tool payloads.
- [ ] Start later Chat and Write sessions and recall the marker. Confirm the
      result is evidence rather than instructions and that no full transcript
      or provider payload is displayed.
- [ ] Verify the retained entry is bounded: at most one summary per session,
      no credentials/secrets/auth material, raw tool payloads, large documents,
      untrusted web content, unrelated workspace data, provider config, or
      sandbox diagnostics. Repeat completion/idle notification and confirm no
      duplicate automatic retention.
- [ ] Exercise `reflect` in Chat and Write. Record only active/unavailable and
      a bounded provider-neutral reason; never copy provider output into the
      report.
- [ ] Attempt shell/Bash, file edit, task delegation, package, terminal,
      deletion, provider administration/diagnostics, synchronization, and
      unknown-plugin operations from both agents. Confirm every operation is
      denied and that no wildcard or arbitrary plugin permission appears.
- [ ] Set the workspace automatic-retention setting to false. Confirm no
      automatic write occurs, explicit retention remains separate, Chat/Write
      remain usable, and the independent TUI is unchanged.
- [ ] Remove/disable the provider and repeat startup. Confirm the AGENTS.md
      and ordinary workspace-context fallback works, no automatic write or
      provider initialization occurs, and no success is reported.
- [ ] Repeat the active and disabled cases through SDK-managed and sandboxed
      launches. Confirm identical provider identity, lifecycle decision,
      exact read grants, permissions, MCP/guidance overlays, and no
      unsandboxed retry after a sandbox failure.
- [ ] Destroy the disposable bank and redact the operator's private record.

## Recording rule

The live result is **PASS** only when every applicable checkbox above passes
and the disposable bank is destroyed. Otherwise record **BLOCKED** (missing
service/credentials or unsupported sandbox) or **FAIL** (an observed
behavioral violation), including only the missing prerequisite or bounded
provider-neutral status. Never claim operational success from synthetic tests.
