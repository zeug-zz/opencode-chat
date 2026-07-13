## Context

The extension creates a dedicated OpenCode server using SDK `createOpencodeServer({ port: 0 })`. SDK v1.17.11 accepts a typed `config` option and passes it only to that child process as `OPENCODE_CONFIG_CONTENT`; it does not write a config file. The GUI queries the server agent list and maps an eligible `scout` to the `chat` label.

On a clean OpenCode setup, this server does not advertise an eligible Scout until the user configures `agent.scout`. Adding the config globally materializes Scout as `all`, but also changes the user's independent TUI. The extension must provide its own Scout only to its server while keeping user configuration authoritative for all other fields.

There are currently uncommitted changes that incorrectly accept a `subagent` Scout as the GUI primary agent. The server's primary-agent contract requires primary or `all`; the companion overlay will make its Scout `all`, so those changes must be removed.

## Goals / Non-Goals

**Goals:**
- Provide an eligible, read-only Scout for every companion-owned OpenCode server.
- Scope the Scout configuration to the child server process and preserve global/project OpenCode config files byte-for-byte.
- Keep `scout` as the default `chat` agent and `build` as the alternate GUI agent.
- Allow the GUI-selected prompt model and effort to remain the request-level override.
- Preserve a user's independently launched TUI agent list.

**Non-Goals:**
- Do not change the OpenCode CLI, SDK, server protocol, or user configuration files.
- Do not make arbitrary server-returned `subagent` entries eligible primary chat agents.
- Do not change global/default model configuration or persist a Scout-specific model.
- Do not change the terminal attached to the companion server; it shares that process by design and may see Scout.

## Decisions

### Decision 1: Use the SDK server `config` option, not a file or process-global environment mutation

Call `createOpencodeServer` with its existing random port plus a typed config overlay:

```ts
{
  agent: {
    scout: {
      mode: "all",
      description: "Read-only chat and research companion.",
      permission: {
        edit: "deny",
        bash: "deny",
        task: "deny",
        read: "allow",
        glob: "allow",
        grep: "allow",
        list: "allow",
        webfetch: "allow",
        websearch: "allow",
        question: "allow"
      }
    }
  }
}
```

SDK server startup serializes that object to `OPENCODE_CONFIG_CONTENT` in the spawned server's environment. It is process-local and is merged by OpenCode with normal discovery. No `fs` config read/write is needed.

Alternatives considered:
- Write global `opencode.json`: rejected because it persists an unwanted agent in the normal TUI.
- Create a global `scout.md`: rejected for the same reason and because it bypasses OpenCode's normal config layering.
- Send `@scout` agent parts: rejected because that creates subtask invocation, not the companion's selected chat session.

### Decision 2: Omit a Scout model from the overlay

The overlay specifies mode, description, and permissions only. The existing GUI sends the selected model as `promptAsync`'s top-level `model`, so model choice remains visible and per-prompt. If the user has independently configured Scout model fields, normal config merge may retain them; the extension does not set or persist a model.

### Decision 3: Retain primary/all eligibility in GUI selection

Restore the committed primary-agent initialization condition: select Scout only when server metadata marks it primary or `all`. The overlay guarantees `all`; treating every subagent as a primary would violate the server contract and can cause unsupported `primaryAgent` requests.

## Risks / Trade-offs

- [SDK config semantics change] → Pin tests to the `createOpencodeServer` call shape and retain the SDK-config type check.
- [Companion terminal differs from independent TUI] → Document that `Open session in terminal` attaches to the companion-owned server and therefore correctly sees Scout.
- [A user expects editable Scout] → Fixed overlay permissions intentionally keep chat read-only; Build remains the explicit editing agent.
- [Configuration merge changes user Scout fields] → Overlay sets only the companion role/mode/permissions and omits model/provider fields.

## Migration Plan

1. Replace the bare server startup with the in-memory Scout overlay and update focused unit tests.
2. Restore primary/all-only Scout initialization and remove the pending subagent regression tests.
3. Verify the child server sees `scout (all)` while no config write path is used.
4. Roll back by restoring `createOpencodeServer({ port: 0 })`; no user config cleanup is required.

## Open Questions

- None.