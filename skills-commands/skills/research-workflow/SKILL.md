---
name: research-workflow
description: Use when turning an open-ended question into a source-grounded answer, evidence brief, literature review, or adversarial audit.
---

# Research Workflow

Use a repeatable, source-grounded process for turning an open-ended question into a useful research output.

## Mode Selection

Route each request to one primary mode:

- Direct answer: a concise answer with only the necessary verification.
- Exploratory research: broad discovery followed by a map of the field.
- Evidence brief: a focused answer with claim-level support and caveats.
- Literature review: structured comparison of a defined body of sources.
- Adversarial audit: pressure-test claims, assumptions, sources, and conclusions.

Follow an explicitly selected mode first. If no mode is specified, infer it from the request. Ask one concise question when the intended mode remains unclear.

## Workflow

Follow this sequence:

1. Clarify the question, scope, audience, time range, and desired output.
2. Form a search plan and identify the source types needed.
3. Search broadly, then narrow to authoritative and relevant sources.
4. Verify important claims against the source itself.
5. Extract exact evidence, metadata, limitations, and relevant context.
6. Synthesize findings while separating evidence from inference.
7. Deliver the answer with citations, uncertainty, and unresolved questions.

Use the least complex research tool that can answer the question. Use search tools for discovery, page or PDF tools for evidence extraction, and paper-search tools for scholarly discovery. Record important tool limitations. If ordinary discovery or extraction fails, follow the optional Playwright MCP policy instead of silently retrying with increasingly broad tools.

## Source Handling

- Prefer primary sources, original papers, official documentation, and stable institutional sources.
- Use secondary sources for context and comparison, not as a substitute for an available primary source.
- Treat search-result snippets as discovery aids, never as evidence.
- Record each important source's URL or DOI, title, author, date, source type, and relevance.
- Record the date searched for information that may change over time.
- Report source gaps, access limitations, and conflicting evidence instead of filling them with guesses.

## Output Contract

Unless another format is requested, include:

- Research question and scope.
- Brief method and source coverage.
- Findings separated from interpretation.
- Important limitations and confidence.
- Citations close to the claims they support.
- Unresolved questions or useful next steps.

Preserve the user's meaning. Do not silently modify source files, bibliographies, configuration, or research notes. Return the result with a concise method or change log.
