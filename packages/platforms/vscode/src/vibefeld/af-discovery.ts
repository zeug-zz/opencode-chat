/**
 * Host-private AF executable discovery.
 *
 * The candidate list is deliberately assembled from host-owned roots and the
 * host PATH only. There is no executable, argv, or environment override in
 * this API; the seams below are infrastructure seams for deterministic tests.
 */

export type AfDiscoveryReason = "absent" | "ambiguous" | "not-executable" | "not-owned" | "unsupported-platform";

export type AfDiscoveryResult =
  | Readonly<{ state: "found"; executable: string }>
  | Readonly<{ state: "unavailable"; reason: AfDiscoveryReason }>;

export type AfDiscoveryStat = Readonly<{
  isFile: boolean;
  ownedByHost: boolean;
}>;

export type AfDiscoveryAccess = "executable" | "not-executable" | "denied";

export type AfDiscoveryOptions = Readonly<{
  platform: NodeJS.Platform;
  pathValue: string;
  candidateRoots: readonly string[];
  stat: (candidate: string) => AfDiscoveryStat | undefined;
  access: (candidate: string) => AfDiscoveryAccess;
}>;

/** Fixed order is intentional: approved roots precede host PATH entries. */
export const AF_DISCOVERY_ROOTS = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"] as const;

const executableName = "af";

const joinExecutable = (root: string): string =>
  root.endsWith("/") ? `${root}${executableName}` : `${root}/${executableName}`;

const candidatesInOrder = (options: AfDiscoveryOptions): readonly string[] => {
  const pathRoots = options.pathValue
    .split(":")
    .filter((root) => root.length > 0)
    .map(joinExecutable);
  return [...options.candidateRoots.map(joinExecutable), ...pathRoots].filter(
    (candidate, index, candidates) => candidates.indexOf(candidate) === index,
  );
};

/**
 * Resolve one host-owned AF executable, or return a bounded dormant result.
 * This function only inspects candidates; it never writes, spawns, or executes.
 */
export const discoverAfExecutable = (options: AfDiscoveryOptions): AfDiscoveryResult => {
  if (options.platform !== "darwin" && options.platform !== "linux") {
    return { state: "unavailable", reason: "unsupported-platform" };
  }

  let found: string | undefined;
  let sawNotExecutable = false;
  let sawNotOwned = false;

  for (const candidate of candidatesInOrder(options)) {
    const metadata = options.stat(candidate);
    if (!metadata) continue;
    if (!metadata.ownedByHost) {
      sawNotOwned = true;
      continue;
    }
    if (!metadata.isFile) {
      sawNotExecutable = true;
      continue;
    }
    const access = options.access(candidate);
    if (access === "denied") {
      sawNotOwned = true;
      continue;
    }
    if (access === "not-executable") {
      sawNotExecutable = true;
      continue;
    }
    if (found && found !== candidate) return { state: "unavailable", reason: "ambiguous" };
    found = candidate;
  }

  if (sawNotOwned) return { state: "unavailable", reason: "not-owned" };
  if (sawNotExecutable) return { state: "unavailable", reason: "not-executable" };
  if (!found) return { state: "unavailable", reason: "absent" };
  return { state: "found", executable: found };
};
