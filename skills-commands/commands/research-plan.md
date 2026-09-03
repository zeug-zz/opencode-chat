---
description: Create a source-grounded research plan without executing the research.
---

Load and follow the `research-workflow` skill.

Turn `$ARGUMENTS` into a research plan before browsing. Identify:

- The question, scope, audience, and time range.
- The research mode.
- Required source types.
- The search plan.
- The output format.
- Stopping criteria.

Ask one focused question if the request is genuinely ambiguous. This command is
planning-only: do not browse, call MCP tools, retrieve sources, or conduct the
research, even if tools are exposed. The plan may describe the capability-based
tool sequence that a later execution would need; if executed later, that
sequence should follow the `mcp-research` skill and use only capabilities then
exposed by the runtime. Do not write repository files or durable research
memory.
