## 1. Deterministic package contents

- [x] 1.1 Clean only the generated VS Code extension `dist` output before each extension build, and add narrow `.vscodeignore` rules for compiled tests, source maps, and packaging/build scripts; verify with a fresh package that required runtime entries remain while excluded development artifacts are absent.

## 2. Archive verification

- [x] 2.1 Extend `verify-bundled-research-package.ts` to validate the actual VSIX manifest identity/version/main entry and reject forbidden development/native archive entries while preserving bundled-resource checks; add focused tests for valid archives and each rejection class, and verify the focused test suite passes.

## 3. Reproducible release metadata

- [x] 3.1 Update the root distributed third-party notice's former product identity and demonstrably stale dependency-version metadata from current repository package/lockfile evidence; verify the notice remains complete and the release copy step produces the same content in the extension package.
- [x] 3.2 Update `.github/workflows/release.yml` to install with `--frozen-lockfile`, run the package verifier after packaging, and upload exactly the manifest-derived `opencode-scribe-<version>.vsix`; verify the workflow references no ambiguous VSIX glob and the package/release scripts remain valid.
