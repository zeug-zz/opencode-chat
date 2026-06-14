## 1. Primary-Agent Default Selection

- [X] 1.1 Update `packages/platforms/vscode/webview/App.tsx` so the initial primary-agent selection prefers an eligible `plan` agent before falling back to the first `primary`/`all` agent; verify by static inspection that existing non-null selection is preserved.
- [X] 1.2 Add focused webview scenario tests covering `plan` preferred when `build` appears first, fallback to first primary/all when `plan` is absent, and no overwrite after a user-selected primary agent; verify with the focused webview test command for the touched scenario file.
- [X] 1.3 Run repository-appropriate verification for the webview change, at minimum the focused scenario test and the nearest package-level typecheck/build/test command available; record any unrelated pre-existing failures.
