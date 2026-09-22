## Context

The manual reasoning-review path is already host-owned: `ChatViewProvider` validates the active session and completed assistant message, extracts bounded visible text, invokes an injected `IReasoningReviewController`, and publishes a session-scoped summary. The response-gate work is a separate private fixture seam and is not connected to the current `promptAsync` streaming path. The runtime, claim, and adversarial-review implementations in this worktree provide private seams and fixtures, while extension bootstrap still uses `UnavailableReasoningReviewController`.

Automatic routing therefore has to be an additive post-response observer/review request. It cannot honestly withhold the current OpenCode response, cannot depend on ordinary task delegation, and cannot claim that a review was available merely because routing code exists.

## Goals / Non-Goals

**Goals:**

- Define a deterministic, bounded automatic-selection policy with explicit enablement and a qualified evaluation input.
- Make qualification reproducible from aggregate reviewed-corpus metrics and prevent unmeasured routing from activating.
- Reuse the existing review controller, session-generation invalidation, bounded source packet, summary, and card paths.
- Give users a stable, localized explanation for an automatic selection without exposing source or provider data.
- Prove duplicate suppression, manual precedence, stale-session handling, unavailable fallback, and non-execution with focused tests.

**Non-Goals:**

- Wiring AF, a hidden child model, a new provider, a network service, or a real evaluation-corpus store.
- Making the current streaming path transactional or turning automatic review into a response-release gate.
- Automatically enabling routing in extension bootstrap, changing ordinary Chat/Write defaults, or adding a setting that appears functional while prerequisites are unavailable.
- Replacing claim/evidence status, adding a truth or proof status, or exposing review artifacts.

## Decisions

### 1. Keep the routing contract private, with only bounded summary metadata crossing the UI boundary

The platform owns routing inputs, evaluation evidence, work-mode exclusions, and lifecycle state. The shared core contract receives only an optional provider-neutral routing explanation on `ReasoningReviewSummary`, because the existing host-to-webview message already carries that summary and the card must explain automatic selection. No AF name, path, command, prompt, source packet, child payload, or evaluation case is represented in core.

**Alternative considered:** add a new protocol message and a webview-owned routing state. Rejected because routing authority belongs to the host and a separate message would allow rationale and summary state to diverge.

### 2. Require an explicit qualified evaluation attestation

`AutomaticRoutingEvaluation` contains only a version, bounded corpus identifier, case count, p95 latency, expected calibration error, false-challenge rate, and `qualified`. Qualification uses fixed release targets: at least 100 reviewed cases, p95 latency <= 2,000 ms, expected calibration error <= 0.10, and false-challenge rate <= 0.05. Validators reject non-finite, negative, over-limit, stale, or inconsistent values.

The implementation exposes an in-memory measurement/validation helper for tests and future evaluation tooling. It does not read files, call a service, persist cases, or treat a fixture as production evidence. Extension bootstrap supplies no qualified evaluation, so the production default remains disabled.

**Alternative considered:** let the router collect online metrics from user conversations. Rejected because that would retain unreviewed content and make activation depend on unbounded, privacy-sensitive telemetry.

### 3. Use conservative deterministic request signals and stable reason codes

The router receives bounded request/response classification signals from the host and applies a small allowlisted policy. It excludes lookup, translation, creative, coding/shell, worker, unsupported, incomplete, and empty responses. Eligible Scout-style argument/evidence/recommendation signals select only when at least two independent structural signals are present. The output is one of a fixed reason-code union (for example, `evidence_dependent`, `multi_step_argument`, or `high_impact_recommendation`) with a static explanation and bounded confidence bucket.

No raw text is copied into the decision or explanation. This makes routing auditable and testable while avoiding a second model call that would broaden authority.

**Alternative considered:** use an LLM classifier for every response. Rejected because it would add another delegated-model capability and create a new prompt-injection and latency boundary before the reviewed child-model contract exists.

### 4. Integrate at idle as a post-response review request, not at publication

`ChatViewProvider` records only bounded prompt metadata needed to classify the latest response and, after an idle event, asks the router whether the latest completed assistant message is eligible. A session/message/generation key set suppresses duplicate idle events. If selected, the provider reuses the existing bounded source extraction and controller invocation, then annotates the summary with `invocation: "automatic"` and the validated reason. Manual requests take precedence; all existing session/deletion/cancellation invalidation paths apply.

The extension constructor accepts an optional router and evaluation/settings object for fixture and future capability-gated integration. `extension.ts` deliberately does not supply a qualified evaluation or enable the router. No response-gate seam is called, and no response is delayed or rewritten.

**Alternative considered:** trigger from the webview after it receives messages. Rejected because the webview cannot verify the authoritative completed message, session generation, runtime capability, or duplicate lifecycle.

### 5. Reuse the existing card and locale contract

The card displays a localized automatic-review label and the static reason explanation only when `summary.invocation === "automatic"` and routing metadata is present. Manual summaries are unchanged. All locale dictionaries receive the same keys, and text is bounded at the render boundary as existing conclusion/challenge text is.

**Alternative considered:** add a separate automatic-review panel. Rejected because it duplicates session state and would make automatic/manual summaries look like different review systems.

### 6. Fail closed without broad fallback or capability escalation

A router failure, malformed decision, unavailable runtime, non-qualified evaluation, stale binding, controller failure, or unsafe metadata results in no automatic publication beyond the existing ordinary assistant response. The router never retries through a weaker sandbox, another agent, AF, a plugin, or a release gate. The unavailable/manual controller remains the fallback.

## Risks / Trade-offs

- **[Heuristic selection may miss or over-select arguments]** → Keep the policy conservative, require measured corpus qualification, exclude ordinary work, expose the stable reason, and leave routing disabled without a qualified attestation.
- **[The idle event can race message refresh or session changes]** → Re-fetch authoritative messages, bind work to session generation, suppress duplicates, and use the existing invalidation/cancellation guards before publication.
- **[Users could mistake automatic review for gating]** → Label it as post-response review, keep response-gate code out of the path, preserve the original response, and add negative tests for no release transaction.
- **[Optional core metadata could widen the provider boundary]** → Keep it opaque, bounded, optional, and limited to reason code/explanation; do not add SDK or `IAgent` methods.
- **[A fixture could be mistaken for measured evidence]** → Keep production bootstrap unqualified, distinguish fixture evaluation in tests, and require the explicit aggregate attestation before selection.

## Migration Plan

1. Land the private contract, evaluation validator/measurement helper, deterministic router, and negative tests without changing extension bootstrap.
2. Add optional host integration and card/locale rendering; verify manual summaries and default behavior remain unchanged.
3. Run focused core/platform/webview tests, Biome, build, full tests, strict OpenSpec validation, and `git diff --check`.
4. Future activation requires a separately reviewed evaluation artifact and runtime/controller capability. If qualification or runtime is withdrawn, omit the optional router/evaluation injection; ordinary Chat and Write continue unchanged.
5. Rollback is removing the optional router/evaluation injection and routing metadata rendering; the existing manual/unavailable path remains valid.
