import {
  type AfLiveClaimFacts,
  type AfLiveInitFacts,
  type AfLiveOutputExecution,
  type AfLiveOutputResult,
  type AfLiveRefineFacts,
  type AfLiveSchemaFacts,
  type AfLiveStatusFacts,
  type AfLiveVersionFacts,
  parseLiveClaimOutput,
  parseLiveInitOutput,
  parseLiveRefineOutput,
  parseLiveSchemaOutput,
  parseLiveStatusOutput,
  parseLiveVersionOutput,
} from "./af-live-output";
import {
  parseAfClaimOutput,
  parseAfInitOutput,
  parseAfRefineOutput,
  parseAfSchemaOutput,
  parseAfStatusOutput,
  parseAfVersionOutput,
} from "./af-output-schema";

/**
 * Explicit mode selection between the live AF parsers and the fixture-schema
 * test double. The two parser modules stay separate; this module only chooses
 * between them.
 *
 * `createProductionAfOutputParsers` is the only production entry point and it
 * always returns the live parsers, so no production caller can select fixture
 * mode. `createAfOutputParsers` resolves an explicit mode and fails closed
 * (`undefined`) for an absent, unknown, or mismatched mode; callers MUST treat
 * `undefined` as unavailable and never substitute a parser.
 */

export type AfParserMode = "live" | "fixture";

/** The six AF operations covered by a parser set. */
export type AfParserOperation = "version" | "schema" | "init" | "claim" | "refine" | "status";

export type AfOutputParserSet<
  TVersion = unknown,
  TSchema = unknown,
  TInit = unknown,
  TClaim = unknown,
  TRefine = unknown,
  TStatus = unknown,
> = Readonly<{
  version: (stdout: string, execution?: AfLiveOutputExecution) => AfLiveOutputResult<TVersion>;
  schema: (stdout: string, execution?: AfLiveOutputExecution) => AfLiveOutputResult<TSchema>;
  init: (stdout: string, execution?: AfLiveOutputExecution) => AfLiveOutputResult<TInit>;
  claim: (stdout: string, execution?: AfLiveOutputExecution) => AfLiveOutputResult<TClaim>;
  refine: (stdout: string, execution?: AfLiveOutputExecution) => AfLiveOutputResult<TRefine>;
  status: (stdout: string, execution?: AfLiveOutputExecution) => AfLiveOutputResult<TStatus>;
}>;

type LiveParserSet = AfOutputParserSet<
  AfLiveVersionFacts,
  AfLiveSchemaFacts,
  AfLiveInitFacts,
  AfLiveClaimFacts,
  AfLiveRefineFacts,
  AfLiveStatusFacts
>;

const LIVE_PARSERS: LiveParserSet = Object.freeze({
  version: parseLiveVersionOutput,
  schema: parseLiveSchemaOutput,
  init: parseLiveInitOutput,
  claim: parseLiveClaimOutput,
  refine: parseLiveRefineOutput,
  status: parseLiveStatusOutput,
});

/**
 * The fixture-schema test double; never returned by the production entry point.
 * The synthetic envelope has no claim or refine shape, so those two members are
 * explicitly closed test-only parsers that always fail closed (`unknown`)
 * instead of inventing fixture facts or extending the envelope.
 */
const FIXTURE_PARSERS: AfOutputParserSet = Object.freeze({
  version: parseAfVersionOutput,
  schema: parseAfSchemaOutput,
  init: parseAfInitOutput,
  claim: parseAfClaimOutput,
  refine: parseAfRefineOutput,
  status: parseAfStatusOutput,
});

/** Resolves only the exact `"live"` and `"fixture"` mode strings. */
export function resolveAfParserMode(value: unknown): AfParserMode | undefined {
  return value === "live" || value === "fixture" ? value : undefined;
}

/**
 * Selects the parser set for an explicit mode. An absent or mismatched mode
 * resolves `undefined`, which callers MUST treat as unavailable parsing.
 */
export function createAfOutputParsers(mode: unknown): AfOutputParserSet | undefined {
  switch (resolveAfParserMode(mode)) {
    case "live":
      return LIVE_PARSERS;
    case "fixture":
      return FIXTURE_PARSERS;
    default:
      return undefined;
  }
}

/**
 * The production entry point: it takes no parameters and always returns the
 * live parser set, so fixture mode is unreachable from production callers.
 */
export function createProductionAfOutputParsers(): LiveParserSet {
  return LIVE_PARSERS;
}
