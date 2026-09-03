---
description: Revise a research artifact while preserving its meaning and evidence boundaries.
---

Load and follow the `research-workflow`, `evidence-synthesis`, and `citation-audit` skills.

Use `$ARGUMENTS` to identify the artifact and requested revision. Select the smallest appropriate edit intensity: light polish, line edit, structural rewrite, or argument audit. Preserve the user's meaning and technical nuance. Work in macro, meso, micro, and technical passes when applicable. Flag unsupported claims, inferential gaps, scope overreach, and unresolved citations.

Return the revised text and a concise change log. Do not silently modify a
source artifact unless the user explicitly requests the edit. Do not conduct
MCP research for ordinary editing. If `$ARGUMENTS` explicitly requests new
research or source verification, also load and follow `mcp-research`, using only
the smallest adequate capabilities exposed by the current runtime and
reporting evidence or access limitations. Otherwise, do not invoke MCP tools.
