## Context

See `proposal.md` and `plans/vibefeld-scribe.md`. The observed dormancy is an
environmental discovery gap, not a policy decision: `vibefeld-settings.ts`
already defaults the review preference to on, and the activation preflight
publishes `available` whenever discovery succeeds. `af` on the development host
is `~/go/bin/af` (0.1.11).

Verified during planning:

- `AF_DISCOVERY_ROOTS` is a fixed four-entry list; candidates are approved roots
  followed by host `PATH` entries, deduplicated, and every candidate must be a
  host-uid-owned file with executable access.
- A second distinct valid candidate resolves `ambiguous` and the runtime stays
  dormant; this fail-closed behavior is intentional.
- `resolveAfRuntime` is called once during activation (`extension.ts`, alongside
  `createVibefeldActivation`) and never from status reads.

## Goals / Non-Goals

**Goals:**

- Find a host-owned `af` installed in the user's home (`go/bin`, `.local/bin`,
  `bin`) without requiring a shell-inherited `PATH`.
- Let a user pin an explicit absolute executable path through one bounded,
  host-owned setting, validated exactly like a discovered candidate.
- Keep every existing bounded result, reason, and fail-closed behavior.

**Non-Goals:**

- No re-selection of the review controller without a window reload. Changing
  `vibefeld.afPath` takes effect on the next activation; the plan records
  dynamic re-selection as a possible follow-up if manual testing shows it is
  needed.
- No composition of claim projection and adversarial review (separate planned
  change), no automatic routing, no response gating.
- No `package.json` setting contribution in this slice: the key is read-only and
  matches the existing `vibefeld.enabled` pattern.
- No `PATH` mutation, configuration-file write, or process launch during
  discovery.

## Decisions

### Home-relative roots appended behind the system roots

`AF_DISCOVERY_ROOTS` stays the system list. A new `createAfDiscoveryRoots(homePath)`
returns the system roots followed by `~/go/bin`, `~/bin`, and `~/.local/bin`
(when `homePath` is a usable absolute path), deduplicated. Candidate ordering
stays system-roots-then-home-roots-then-PATH; ownership and executable checks
are unchanged, and two distinct valid candidates still fail closed as
`ambiguous`.

**Alternative considered:** relying on the host `PATH` only. Rejected: the exact
failure mode being fixed — Dock-launched extension hosts do not carry the user
shell's `PATH`.

**Alternative rejected:** probing the home directory with a shell. Rejected:
discovery must not spawn processes.

### Explicit path setting, fail-closed, no fallback

`opencode-chat.vibefeld.afPath` is read once at activation. When present, the
value must be an absolute path to a host-uid-owned executable file; it is
validated with the same stat/access seams as discovery and, when valid, used as
the resolved executable. An invalid value resolves dormant (`missing-af`) and
does not silently fall back to discovery; an unset value leaves discovery
unchanged.

**Alternative considered:** treating the setting as another candidate root to
scan. Rejected: it would re-introduce ambiguity semantics for an explicit user
choice and hide configuration mistakes.

**Alternative considered:** falling back to discovery when the explicit path is
invalid. Rejected: silent fallback masks typos and makes the effective
executable unpredictable.

### Activation semantics unchanged

The setting is read in the same single activation step that already resolves the
runtime; no new preflight, no status-read re-probe, no configuration write, and
no change to the dormant reason vocabulary. A reload applies a setting change.

## Risks / Trade-offs

- [Two AF installs, one in a home root] -> still `ambiguous` and dormant, exactly
  as today; the explicit setting is the supported way to disambiguate.
- [A typo in the explicit path] -> bounded dormant result with the existing
  `missing-af` reason; no fallback, surfaced on the next reload.
- [Home roots make discovery broader] -> every candidate keeps the uid-owned and
  executable checks; no PATH, environment, or model-supplied input is accepted.

## Migration Plan

No persisted data, protocol, or configuration migration. Rollback removes the
home roots and the setting read; the four-root discovery behavior returns.

## Open Questions

None for this slice; dynamic re-selection without reload is deferred and
recorded in `plans/adversarial-review.md`.
