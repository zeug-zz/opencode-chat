## Context

The current retention implementation has three provider-neutral workspace
settings: explicit retention enabled, confirmation required, and automatic
session retention. Automatic retention already defaults to enabled, while
explicit retention defaults to disabled. The webview renders both controls and a
status explanation, and the host accepts policy update messages from that
panel.

The desired product behavior is simpler: installing/configuring the exact
approved Hindsight integration means the user wants the companion capability.
The extension should not add another opt-in checkbox, but it must continue to
treat durable writes as sensitive and require confirmation for each explicit
request.

## Goals / Non-goals

**Goals:**

- Make automatic and explicit retention effective by default for a verified
  Hindsight provider.
- Keep `requireConfirmation` permanently true for explicit retention.
- Preserve exact identity, capability, observed-tool, lifecycle, payload, and
  sandbox checks.
- Remove retention controls and status clutter from the Chat settings panel.
- Keep ordinary Chat/Write and AGENTS.md fallback behavior nonfatal.
- Ignore old workspace disable values without modifying configuration files.

**Non-goals:**

- Removing Hindsight provider verification or exact tool matching.
- Allowing retention wildcards, deletion, administration, diagnostics, or
  synchronization tools.
- Removing the host-side permission and bounded payload validation path.
- Changing independent TUI memory/retention configuration.
- Exposing provider-specific retention state through the webview after the
  settings section is removed.

## Decisions

### 1. Use a fixed always-on effective policy

The effective companion policy is:

```text
enabled: true
requireConfirmation: true
```

The policy is applied only after the approved Hindsight provider passes existing
identity, capability, observed-inventory, lifecycle, and sandbox checks. Without
such a provider, the policy is a no-op and no provider operation is attempted.

The extension no longer reads workspace retention booleans to decide whether the
policy is active. Previously stored false values are ignored rather than
rewritten, matching the requested always-on behavior. The independent TUI does
not receive this policy.

### 2. Keep explicit retention confirmation mandatory

The exact `hindsight_ingest_document` operation remains configured as a
confirmation-gated permission. The host continues to validate the structured
bounded summary, reject secrets/oversized or unsafe payloads, and clamp an
`always` permission response to a single request. Removing the settings checkbox
does not remove the per-request user confirmation.

The research worker continues to receive no retention operation. Scout and
Build-backed Write may receive only the exact operation after provider inventory
and capability checks pass, with the existing agent-level denials intact.

### 3. Remove the retention settings surface, not the enforcement boundary

Remove the retention section from `ToolConfigPanel`, its webview props/state,
the policy update message, and the contributed VS Code retention settings. Keep
the host-side policy and provider status necessary for launch composition,
permission routing, lifecycle verification, and bounded diagnostics. Those
internal values are not serialized to the settings webview.

The provider-neutral memory status used by other existing surfaces, if any,
remains separate from the removed retention controls. No provider paths,
credentials, raw payloads, or raw errors are added to a replacement UI.

### 4. Keep automatic lifecycle retention safe and nonfatal

Automatic retention remains active only for the exact approved provider after
observed lifecycle support and sandbox path checks pass. The lifecycle receives
only bounded provider-approved summaries, excludes secrets/raw tool payloads and
untrusted documents, and deduplicates completed-session writes as before.

If provider startup or a lifecycle write fails, the companion keeps the requested
sandbox and ordinary agent permissions. It marks the provider capability
unavailable internally and continues without an unsandboxed retry or a provider
configuration write.

### 5. Treat legacy settings as inert

The extension will stop contributing the three retention settings and stop
subscribing to their configuration changes. It will not delete existing values
from user or workspace settings. This avoids a migration write while ensuring
old disable values cannot silently turn the new always-on policy off.

## Risks / Trade-offs

- **Unexpected durable writes:** Automatic retention is enabled for an approved
  provider by default. Bounded summary construction, provider capability gates,
  sandbox checks, and nonfatal failure handling remain mandatory.
- **Explicit write consent:** Explicit retention remains available by default,
  but every request still requires confirmation and an “always” response cannot
  bypass that requirement.
- **Removed escape hatch:** Users cannot disable retention from the extension
  settings panel after this change. This is intentional; the TUI/provider
  configuration remains independent, and missing/unsafe providers remain no-op.
- **Legacy configuration drift:** Old settings values remain on disk but are
  ignored. Documentation and tests must make that behavior explicit.
- **Status visibility:** Removing the settings section reduces provider detail
  in the webview. Host diagnostics remain bounded and provider-neutral.

## Migration Plan

No settings migration is performed. Existing retention values are ignored on the
next extension activation. The fixed policy takes effect only when an exact
approved provider is present and passes all existing verification gates.

## Verification Commitments

Verification must cover fixed defaults, ignored legacy values, exact provider
and tool gating, per-request confirmation, `always` clamping, payload redaction
and bounds, automatic lifecycle retention, provider/sandbox failure fallback,
absence of retention settings UI and protocol updates, all locale cleanup, and
independent TUI configuration isolation.
