## Context

See `proposal.md` for motivation. The extension currently represents sandboxing as one boolean: a supported enabled state starts a `SandboxManager`-wrapped `opencode serve` child, while disabled uses the SDK server. The child launch lifecycle, readiness parser, diagnostics, fallback, and cleanup are built around that binary choice. Hindsight’s current queue attempts to serialize an installed TUI contract, translate a nono profile into compatibility-sandbox grants, and reproduce provider lifecycle behavior, but it does not actually launch nono.

The existing compatibility sandbox remains the project’s fallback security boundary. It has a static protected-read baseline and workspace/runtime write containment. It must remain unchanged when nono is absent. The selected nono profile is a distinct, external enforcement boundary and must not be represented as equivalent until its actual behavior is verified.

## Goals / Non-Goals

**Goals:**

- Select one launch backend in the extension host before every new companion connection.
- Use a real, direct-argv `nono wrap` child for a preflighted, documented Hindsight-capable profile.
- Keep backend selection, provider operation policy, lifecycle suppression, diagnostic attribution, and cleanup coherent across activation and reconnect.
- Keep the compatibility backend free of provider-state reconstruction and full-Hindsight lifecycle behavior.

**Non-Goals:**

- Changing the independent TUI, installing/configuring nono, or creating a general profile discovery system.
- Making the two sandbox policies claim byte-for-byte equivalence.
- Modifying the separate uncommitted parity queue or using git cleanup to establish a baseline.

## Decisions

### 1. Use a resolved backend discriminant, not `sandbox.enabled`

Add a launch-backend value to the host-to-agent configuration: `nono`, `vscode`, or `sdk`. The extension host resolves it once using the effective Chat sandbox setting and bounded nono preflight. `sandbox.enabled` continues to describe the user’s requested compatibility setting, but it must not decide whether the agent uses the SDK path when the backend is nono.

**Rationale:** the present boolean would treat “do not use SandboxManager” as “launch unsandboxed.” A discriminant allows nono to be visibly sandboxed and prevents accidental backend changes during reconnect.

**Alternative rejected:** infer nono in `OpenCodeAgent`. That would give the agent filesystem/environment discovery responsibility and make reconnect behavior nondeterministic.

### 2. Default to `opencode`; optionally select a custom user profile

The extension host treats nono’s built-in `opencode` profile as the default native boundary. When sandboxing is first enabled and custom user profiles are discovered through supported introspection plus the documented user-profile directory (`$XDG_CONFIG_HOME/nono/profiles`, default `~/.config/nono/profiles`), it offers a nonblocking picker: retain `opencode` or choose one custom profile. It persists only the chosen profile name; choosing the default persists `opencode`. No custom profiles means no prompt. Scribe never writes or parses profile contents. The host resolves bounded executable locations, preferring `NONO_BIN`, and preflights the effective profile with bounded noninteractive `nono profile show <name>`. Preflight output is not surfaced raw and the decision is cached for the connection.

**Rationale:** `opencode` is the supported safe default, so profile absence must not downgrade a viable native boundary. The picker lets users align Scribe with a custom TUI profile without silently trusting it.

**Alternative rejected:** translating profile JSON to Scribe filesystem grants. It duplicates a policy that nono already enforces and cannot represent all process/network semantics.

### 3. Launch nono with direct argv; retain shared child lifecycle

The nono branch constructs `[nono, "wrap", "--profile", profile, "--allow-cwd", "--", opencode, ...args, "serve", "--hostname", "127.0.0.1", "--port", "0"]` as separate argv values with `shell: false`. It shares the workspace cwd, environment construction, in-memory overlay, bounded output capture, readiness wait, SDK client setup, event subscription, process-group teardown, and plugin-free fallback with the existing sandbox child lifecycle. Only the wrapper creation and runtime-specific diagnostics differ.

The supported nono CLI/version must be confirmed during implementation; if dynamic loopback binding cannot be granted under that profile, implementation must use a scoped dynamic-port strategy backed by tests rather than a fixed port.

**Rationale:** direct argv prevents quoting/injection errors and `nono wrap` execs the child rather than adding a long-lived supervisor.

**Alternative rejected:** shell strings and a second independent launcher abstraction. The former is unsafe; the latter duplicates readiness and cleanup logic.

### 4. Scope Hindsight by backend

Provider identity and observed-tool inventory remain mandatory in both backends. The nono backend receives the exact observed approved native surface and allows provider-native hooks. The compatibility backend receives only the three recall operations and suppresses lifecycle hooks; it never receives provider state/write grants, reflection, explicit writes, diagnostics, synchronization, or automatic retention. The research worker never receives Hindsight.

**Rationale:** read-only recall can operate under the existing safe fallback; provider hooks and durable state need the actual trusted nono boundary. This replaces attempted provider-contract emulation with explicit capability tiers.

**Alternative rejected:** a full TUI-parity emulation in the compatibility sandbox. It has already required broad contract reconstruction and still cannot prove provider state or lifecycle equivalence.

### 5. Split preflight fallback from runtime failure

Nono unavailable before launch selects the VS Code compatibility backend. Once nono is selected, any startup, readiness, exit, or plugin failure remains in the nono backend: a permitted plugin-free retry reuses nono; otherwise Chat is unavailable. No runtime backend downgrade is allowed.

**Rationale:** a switch after nono starts changes the requested security semantics and could mask a policy failure.

## Risks / Trade-offs

- **Nono profile differs from the compatibility baseline** → treat it as a separately verified backend; add an opt-in integration suite for protected reads, workspace/OpenCode state, loopback, network modes, descendant inheritance, and cleanup before release.
- **nono CLI/profile changes** → bounded preflight rejects unsupported versions/forms before launch; external documentation identifies the supported setup.
- **Readiness output contains nono diagnostics** → bind readiness to the launched child and retain bounded/redacted output; do not accept arbitrary diagnostic URLs.
- **Full Hindsight fallback regression** → document the intentional recall-only boundary and assert the denied operations in unit tests.
- **Dirty superseded queue masks the diff** → do not start implementation until the user explicitly separates, retains, or discards that queue; no task may reset, stash, commit, or otherwise clean it implicitly.

## Migration Plan

1. Land the additive resolver/backend configuration and focused tests without changing user configuration.
2. Add the nono child-launch path and backend-aware lifecycle tests.
3. Apply backend-scoped Hindsight policy and remove only the now-redundant parity reconstruction code from the implementation being replaced.
4. Add external-installation documentation and opt-in nono smoke coverage.
5. Verify the selected nono profile in a disposable environment, then build/package the extension.

Rollback removes the nono backend selection and returns enabled Chat to the existing compatibility sandbox. It does not change nono profiles, Hindsight data, TUI behavior, or user configuration.

## Open Questions

None. The documented Hindsight-capable nono profile and exact supported CLI flags must be evidenced during implementation; failure to validate them is a fail-closed preflight result, not an invitation to infer a profile.