---
name: citation-audit
description: Use when auditing whether citations and bibliographic metadata actually support the factual claims in a research artifact.
---

# Citation Audit

Audit the relationship between claims and citations rather than merely checking whether citations exist.

## Support Status

Use these labels:

- `supported`: backed by a cited or independently verified source.
- `plausible-uncited`: reasonable claim without explicit support in the current work.
- `speculative`: extension or hypothesis beyond established support.
- `unresolved`: source, metadata, or claim support could not be verified.

## Audit Procedure

1. Extract the factual and externally verifiable claims.
2. Locate the citation or source attached to each claim.
3. Check whether the source actually supports the wording and scope of the claim.
4. Verify bibliographic metadata, DOI values, URLs, page numbers, and citation keys when applicable.
5. Assess source quality, authority, recency, and relevance.
6. Assign a support status and identify overstatement or missing context.
7. Recommend a repair: add citation, qualify claim, replace source, split claim, or remove overreach.

## Audit Output

Use compact rows containing:

- Claim.
- Status.
- Source or citation key used, or `unresolved`.
- Support problem or limitation.
- Recommended next action.

Never fabricate authors, titles, dates, page numbers, DOI values, publishers, quotations, or citation keys.
