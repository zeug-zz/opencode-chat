import { AF_LIVE_SCHEMA_SECTIONS, type AfLiveSchemaFacts, type AfLiveVersionFacts } from "./af-live-output";

/**
 * Format-pinned, version-tolerant AF compatibility classification.
 *
 * The classifier consumes host-private live facts only: the normalized flat
 * `af version --json` fields, bounded schema section facts, and host-derived
 * platform and architecture. It is pure: platform and architecture are inputs,
 * and it never reads host process state, the filesystem, or the network.
 * Fixture-envelope evidence (a nested `runtime`, `fixtureSchema` markers, or
 * fixture placeholder identity) is not live evidence and stays dormant
 * `unavailable`.
 *
 * `available` means compatibility was verified; it is not `ready` until the
 * dedicated policy reports ready. This function never allocates a proof
 * workspace and never implies policy readiness.
 */

const MAX_STRING_LENGTH = 256;
const SUPPORTED_PLATFORMS = ["darwin", "linux"] as const;
const SUPPORTED_ARCHITECTURES = ["arm64", "x64", "arm", "ia32"] as const;
/** The accepted bounded 0.1.x line; version, commit, build, Go, and policy drift never gate. */
const ACCEPTED_VERSION = /^0\.1\.\d{1,3}$/u;
/** A dotted-numeric version prefix; version-shaped values outside the accepted line are incompatible. */
const VERSION_SHAPE = /^\d+\.\d+\./u;
const REQUIRED_FORMAT = "1.1";

type LiveVersionField = "version" | "commit" | "buildDate" | "goVersion" | "format" | "policy";
const REQUIRED_FIELDS = ["version", "commit", "buildDate", "goVersion", "format", "policy"] as const;

/** Fixture-envelope keys and placeholder text are test-double evidence, never live facts. */
const FIXTURE_KEYS: ReadonlySet<string> = new Set([
  "fixtureSchema",
  "runtime",
  "workspaceFormat",
  "operatingSystem",
  "architecture",
]);
const FIXTURE_TEXT = /(?:af-runtime-fixture|fixture-workspace|missing-workspace|<fixture-|fixtureschema)/iu;

export type AfCompatibilityPlatform = (typeof SUPPORTED_PLATFORMS)[number];
export type AfCompatibilityArchitecture = (typeof SUPPORTED_ARCHITECTURES)[number];

type BoundedVersionFacts = Readonly<Record<string, unknown>>;
type BoundedSchemaFacts = Readonly<Record<string, unknown>>;

export type AfCompatibilityInput = Readonly<{
  platform: string;
  architecture: string;
  version: AfLiveVersionFacts | BoundedVersionFacts | null | undefined;
  schema: AfLiveSchemaFacts | BoundedSchemaFacts | null | undefined;
}>;

export type AfCompatibilityReason =
  | "unsupported-platform"
  | "unsupported-architecture"
  | "missing-version-facts"
  | "missing-schema-facts"
  | "malformed-version-facts"
  | "malformed-schema-facts"
  | "oversized-evidence"
  | "unsafe-evidence"
  | "unsupported-version"
  | "format-mismatch";

/** Host-private compatibility metadata; recorded, never used to gate by exact equality. */
export type AfCompatibilityMetadata = Readonly<{
  version: string;
  commit: string;
  format: string;
  policy: string;
}>;

export type AfCompatibilityResult =
  | Readonly<{ state: "available"; metadata: AfCompatibilityMetadata }>
  | Readonly<{ state: "incompatible"; reason: AfCompatibilityReason }>
  | Readonly<{ state: "unavailable"; reason: AfCompatibilityReason }>;

const unavailable = (reason: AfCompatibilityReason): AfCompatibilityResult => ({ state: "unavailable", reason });
const incompatible = (reason: AfCompatibilityReason): AfCompatibilityResult => ({ state: "incompatible", reason });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isBoundedString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= MAX_STRING_LENGTH;

const isNonNegativeSafeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const isSupportedPlatform = (value: string): value is AfCompatibilityPlatform =>
  SUPPORTED_PLATFORMS.includes(value as AfCompatibilityPlatform);

const isSupportedArchitecture = (value: string): value is AfCompatibilityArchitecture =>
  SUPPORTED_ARCHITECTURES.includes(value as AfCompatibilityArchitecture);

const hasOversizedValue = (value: unknown): boolean => {
  if (typeof value === "string") return value.length > MAX_STRING_LENGTH;
  if (Array.isArray(value)) return value.some(hasOversizedValue);
  if (isRecord(value))
    return Object.entries(value).some(([key, item]) => key.length > MAX_STRING_LENGTH || hasOversizedValue(item));
  return false;
};

const hasUnsafeValue = (value: unknown): boolean => {
  if (typeof value === "string")
    return (
      value.startsWith("/") ||
      /^[A-Za-z]:[\\/]/u.test(value) ||
      value.split(/[\\/]/u).includes("..") ||
      /[;&|`$\n\r]/u.test(value) ||
      /(?:prompt|source[-_ ]?packet|private[-_ ]?reasoning|chain[-_ ]?of[-_ ]?thought|secret|password|token|authorization|credential|api[-_ ]?key)/iu.test(
        value,
      )
    );
  if (Array.isArray(value)) return value.some(hasUnsafeValue);
  if (isRecord(value)) return Object.entries(value).some(([key, item]) => hasUnsafeValue(key) || hasUnsafeValue(item));
  return false;
};

/**
 * Fixture-envelope evidence is not live evidence: a nested `runtime`,
 * `fixtureSchema`/`workspaceFormat` markers, a captured OS/architecture field,
 * or a fixture placeholder value keeps the runtime dormant.
 */
const hasFixtureEvidence = (value: unknown): boolean => {
  if (typeof value === "string") return FIXTURE_TEXT.test(value);
  if (Array.isArray(value)) return value.some(hasFixtureEvidence);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(
    ([key, item]) => FIXTURE_KEYS.has(key) || hasFixtureEvidence(key) || hasFixtureEvidence(item),
  );
};

const readRequiredFields = (value: unknown): Readonly<Record<LiveVersionField, string>> | undefined => {
  if (!isRecord(value)) return undefined;
  const read = (field: LiveVersionField): string | undefined => {
    const item = value[field];
    return isBoundedString(item) ? item : undefined;
  };
  const [version, commit, buildDate, goVersion, format, policy] = REQUIRED_FIELDS.map(read);
  if (!version || !commit || !buildDate || !goVersion || !format || !policy) return undefined;
  return { version, commit, buildDate, goVersion, format, policy };
};

const isLiveSchemaFacts = (value: unknown): value is AfLiveSchemaFacts => {
  if (!isRecord(value) || !isNonNegativeSafeInteger(value.totalEntries)) return false;
  const sections = value.sections;
  if (!isRecord(sections)) return false;
  return AF_LIVE_SCHEMA_SECTIONS.every((section) => isNonNegativeSafeInteger(sections[section]));
};

/**
 * Classify compatibility using host-private normalized live evidence only.
 * Missing, malformed, oversized, unsafe, fixture-shaped, or schema-less
 * evidence is dormant `unavailable`; a version outside the bounded 0.1.x line
 * or a `format` other than `"1.1"` is dormant `incompatible`.
 */
export const classifyAfCompatibility = (input: AfCompatibilityInput): AfCompatibilityResult => {
  if (!isSupportedPlatform(input.platform)) return unavailable("unsupported-platform");
  if (!isSupportedArchitecture(input.architecture)) return unavailable("unsupported-architecture");
  if (!input.version) return unavailable("missing-version-facts");
  if (!input.schema) return unavailable("missing-schema-facts");
  if (hasOversizedValue(input.version) || hasOversizedValue(input.schema)) return unavailable("oversized-evidence");
  if (hasUnsafeValue(input.version) || hasUnsafeValue(input.schema)) return unavailable("unsafe-evidence");
  if (hasFixtureEvidence(input.version)) return unavailable("malformed-version-facts");
  if (hasFixtureEvidence(input.schema)) return unavailable("malformed-schema-facts");

  const fields = readRequiredFields(input.version);
  if (!fields) return unavailable("malformed-version-facts");
  if (!VERSION_SHAPE.test(fields.version)) return unavailable("malformed-version-facts");
  if (!ACCEPTED_VERSION.test(fields.version)) return incompatible("unsupported-version");
  if (fields.format !== REQUIRED_FORMAT) return incompatible("format-mismatch");
  if (!isLiveSchemaFacts(input.schema)) return unavailable("malformed-schema-facts");

  return {
    state: "available",
    metadata: {
      version: fields.version,
      commit: fields.commit,
      format: fields.format,
      policy: fields.policy,
    },
  };
};
