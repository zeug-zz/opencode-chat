---
description: Audit claims, citations, and bibliographic metadata in a research artifact.
---

Load and follow the `research-workflow`, `citation-audit`, and `mcp-research`
skills. Use `mcp-research` only for source or metadata verification that the
current runtime can support; do not assume any provider or MCP tool is enabled.

Audit the artifact or target named in `$ARGUMENTS`. If none is named, identify the current research artifact. Extract externally verifiable claims, verify their citations and metadata, and assign support statuses.

Return compact rows containing claim, status, source, support problem, and
recommended next action. Preserve the `supported`, `plausible-uncited`,
`speculative`, and `unresolved` statuses. Never invent missing bibliographic
details, and report unavailable tools or verification limitations explicitly.
Do not silently modify the artifact or its bibliography.
