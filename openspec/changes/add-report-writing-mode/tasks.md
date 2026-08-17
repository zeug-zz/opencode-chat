## 1. Prompt assets and normal-send routing

- [x] 1.1 Add the packaged `WRITE_SYSTEM.md` report-authoring prompt, keep `CHAT_SYSTEM.md` Scout-only, and update stale user-facing references from `build` to `write`. Verify the prompt assets are included by the extension build and contain no read-only/coding contradiction for Write.
- [x] 1.2 Load both companion prompt assets and route the default request-level system instruction by internal primary agent for normal sends: Scout receives the chat prompt, Build-backed Write receives the report prompt, and an explicit `system` override remains authoritative. Add focused extension-host tests and run the host test file.

## 2. Companion Write permissions

- [x] 2.1 Add a companion-process-only permission profile for the Build-backed Write agent that allows only read, workspace search, web research, and edit actions and denies Bash and task/subagent execution. Preserve the built-in Build baseline prompt and avoid `opencode.json` writes. Add effective permission/configuration coverage and run the focused OpenCode agent tests.

## 3. Message-flow compatibility

- [x] 3.1 Extend the edit-and-resend protocol and webview flow with optional primary-agent context, preserving internal `primaryAgent: "build"` for Write. Route edit-and-resend through the same Scout/Write prompt selection as normal sends, preserve explicit overrides where supported, and retain compatibility when older messages omit the new fields. Add focused protocol, host, and webview tests.

## 4. Shell boundary and terminal handoff

- [x] 4.1 Remove the chat shell-mode control and `!` shell dispatch from the webview, and make the host reject legacy or malformed `executeShell` requests without invoking the agent shell API. Keep the existing terminal handoff available and unchanged. Update shell and handoff tests, then run the focused scenarios and host tests.

## 5. User-facing contract and regression coverage

- [x] 5.1 Update the Write selector description and security/documentation guidance to describe research report authoring, constrained tools, and terminal handoff for coding. Add or update regression coverage proving the selector still offers `chat`/`write`, Write sends the internal `build` identifier, Scout remains the default, shell mode is absent, and terminal handoff remains available. Run the affected webview scenarios and Biome checks.
