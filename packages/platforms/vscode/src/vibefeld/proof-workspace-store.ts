import { randomUUID } from "node:crypto";
import { lstat, mkdir, realpath, rm, rmdir } from "node:fs/promises";
import path from "node:path";

const STORAGE_DIRECTORY = "vibefeld";
const REVIEWS_DIRECTORY = "reviews";
const MAX_COMPONENT_LENGTH = 64;
const ALLOCATION_ATTEMPTS = 8;

const HANDLE_BRAND: unique symbol = Symbol("vibefeld-proof-workspace-handle");

export type ProofWorkspaceHandle = Readonly<{
  readonly [HANDLE_BRAND]: "proof-workspace";
  readonly token: string;
}>;

export type ProofWorkspaceStoreOptions = Readonly<{
  globalStoragePath: string;
  repositoryPath: string;
  homePath: string;
  openCodeStatePath: string;
  idFactory?: () => string;
  fileSystem?: ProofWorkspaceFileSystem;
}>;

export type ProofWorkspaceFileSystem = Readonly<{
  lstat: typeof lstat;
  mkdir: typeof mkdir;
  realpath: typeof realpath;
  rm: typeof rm;
  rmdir: typeof rmdir;
}>;

export type ProofWorkspaceErrorCode =
  | "invalid-root"
  | "unsafe-path"
  | "symlink"
  | "containment"
  | "collision"
  | "unknown-handle";

export class ProofWorkspaceError extends Error {
  readonly code: ProofWorkspaceErrorCode;

  constructor(code: ProofWorkspaceErrorCode, message: string) {
    super(message);
    this.name = "ProofWorkspaceError";
    this.code = code;
  }
}

export type ProofWorkspaceCleanup = Readonly<{ ok: true }> | Readonly<{ ok: false; code: "cleanup-failure" }>;

type WorkspaceRecord = Readonly<{
  sessionPath: string;
  reviewPath: string;
  sessionRealPath: string;
  reviewRealPath: string;
}>;

const defaultFileSystem: ProofWorkspaceFileSystem = { lstat, mkdir, realpath, rm, rmdir };

const isPathWithin = (parent: string, child: string): boolean => {
  const relative = path.relative(parent, child);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

const pathsOverlap = (left: string, right: string): boolean =>
  left === right || isPathWithin(left, right) || isPathWithin(right, left);

const absolutePath = (value: string, code: ProofWorkspaceErrorCode = "invalid-root"): string => {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    throw new ProofWorkspaceError(code, "proof workspace path is invalid");
  }
  const resolved = path.resolve(value);
  if (!path.isAbsolute(resolved)) throw new ProofWorkspaceError(code, "proof workspace path is not absolute");
  return resolved;
};

const safeComponent = (value: string): boolean =>
  value.length > 0 &&
  value.length <= MAX_COMPONENT_LENGTH &&
  value !== "." &&
  value !== ".." &&
  !value.includes("/") &&
  !value.includes("\\") &&
  !value.includes("\0");

const isMissing = (error: unknown): boolean =>
  error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";

/**
 * A private, lazy owner for disposable AF review roots. It never writes a
 * payload itself; callers receive only a token and must use this store for
 * the internal path lookup needed by the process boundary.
 */
export class ProofWorkspaceStore {
  private readonly globalStoragePath: string;
  private readonly storagePath: string;
  private readonly reviewsPath: string;
  private readonly repositoryPath: string;
  private readonly homePath: string;
  private readonly openCodeStatePath: string;
  private readonly idFactory: () => string;
  private readonly fileSystem: ProofWorkspaceFileSystem;
  private readonly workspaces = new Map<string, WorkspaceRecord>();
  private rootsReady?: Promise<void>;

  constructor(options: ProofWorkspaceStoreOptions) {
    this.globalStoragePath = absolutePath(options.globalStoragePath);
    this.storagePath = path.join(this.globalStoragePath, STORAGE_DIRECTORY);
    this.reviewsPath = path.join(this.storagePath, REVIEWS_DIRECTORY);
    this.repositoryPath = absolutePath(options.repositoryPath);
    this.homePath = absolutePath(options.homePath);
    this.openCodeStatePath = absolutePath(options.openCodeStatePath);
    this.idFactory = options.idFactory ?? randomUUID;
    this.fileSystem = options.fileSystem ?? defaultFileSystem;

    for (const component of [STORAGE_DIRECTORY, REVIEWS_DIRECTORY]) {
      if (!safeComponent(component))
        throw new ProofWorkspaceError("unsafe-path", "proof workspace component is unsafe");
    }
  }

  /** Allocate one unique session root and one unique review root. */
  async allocate(): Promise<ProofWorkspaceHandle> {
    await this.ensureRoots();
    const reviewsRealPath = await this.checkedRealPath(this.reviewsPath);

    for (let attempt = 0; attempt < ALLOCATION_ATTEMPTS; attempt += 1) {
      const sessionToken = this.nextToken();
      const reviewToken = this.nextToken();
      const sessionName = `session-${sessionToken}`;
      const reviewName = `review-${reviewToken}`;
      const sessionPath = path.join(this.reviewsPath, sessionName);
      const reviewPath = path.join(sessionPath, reviewName);
      if (!safeComponent(sessionName) || !safeComponent(reviewName)) {
        throw new ProofWorkspaceError("unsafe-path", "proof workspace name is unsafe");
      }

      try {
        await this.fileSystem.mkdir(sessionPath, { recursive: false });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
        throw new ProofWorkspaceError("collision", "proof workspace allocation failed");
      }

      try {
        await this.fileSystem.mkdir(reviewPath, { recursive: false });
      } catch (error) {
        await this.removeEmptySession(sessionPath);
        if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
        throw new ProofWorkspaceError("collision", "proof workspace allocation failed");
      }

      try {
        const sessionRealPath = await this.checkedRealPath(sessionPath);
        const reviewRealPath = await this.checkedRealPath(reviewPath);
        this.assertContained(reviewsRealPath, sessionRealPath);
        this.assertContained(sessionRealPath, reviewRealPath);
        await this.assertSeparated(reviewRealPath);
        const token = `${sessionToken}.${reviewToken}`;
        const handle = { [HANDLE_BRAND]: "proof-workspace", token } as const;
        this.workspaces.set(token, { sessionPath, reviewPath, sessionRealPath, reviewRealPath });
        return handle;
      } catch (error) {
        await this.removeEmptySession(sessionPath);
        if (error instanceof ProofWorkspaceError) throw error;
        throw new ProofWorkspaceError("containment", "proof workspace containment could not be verified");
      }
    }
    throw new ProofWorkspaceError("collision", "proof workspace uniqueness could not be established");
  }

  /** Internal-only path lookup for the dedicated process boundary. */
  resolvePath(handle: ProofWorkspaceHandle): string {
    const record = this.recordFor(handle);
    return record.reviewPath;
  }

  /** Remove only a still-contained review root and its now-empty session root. */
  async cleanup(handle: ProofWorkspaceHandle): Promise<ProofWorkspaceCleanup> {
    const record = this.recordFor(handle);
    try {
      await this.assertRecordSafe(record);
      await this.fileSystem.rm(record.reviewPath, { recursive: true, force: false });
      await this.fileSystem.rmdir(record.sessionPath);
      this.workspaces.delete(handle.token);
      return { ok: true };
    } catch {
      return { ok: false, code: "cleanup-failure" };
    }
  }

  private nextToken(): string {
    const token = this.idFactory();
    if (!safeComponent(token)) throw new ProofWorkspaceError("unsafe-path", "proof workspace identifier is unsafe");
    return token;
  }

  private recordFor(handle: ProofWorkspaceHandle): WorkspaceRecord {
    if (handle?.[HANDLE_BRAND] !== "proof-workspace" || typeof handle.token !== "string") {
      throw new ProofWorkspaceError("unknown-handle", "proof workspace handle is not recognized");
    }
    const record = this.workspaces.get(handle.token);
    if (!record) throw new ProofWorkspaceError("unknown-handle", "proof workspace handle is not recognized");
    return record;
  }

  private async ensureRoots(): Promise<void> {
    this.rootsReady ??= this.prepareRoots();
    try {
      await this.rootsReady;
    } catch (error) {
      this.rootsReady = undefined;
      throw error;
    }
  }

  private async prepareRoots(): Promise<void> {
    await this.assertNoSymlinkAncestors(this.globalStoragePath);
    await this.fileSystem.mkdir(this.globalStoragePath, { recursive: true });
    await this.assertNoSymlinkAncestors(this.globalStoragePath);
    await this.fileSystem.mkdir(this.storagePath, { recursive: false }).catch((error: unknown) => {
      if (!isMissing(error) && (error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    });
    await this.assertNoSymlinkAncestors(this.storagePath);
    await this.fileSystem.mkdir(this.reviewsPath, { recursive: false }).catch((error: unknown) => {
      if (!isMissing(error) && (error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    });
    await this.assertNoSymlinkAncestors(this.reviewsPath);
    const globalRealPath = await this.checkedRealPath(this.globalStoragePath);
    const reviewsRealPath = await this.checkedRealPath(this.reviewsPath);
    this.assertContained(globalRealPath, reviewsRealPath);
    await this.assertSeparated(reviewsRealPath);
  }

  private async checkedRealPath(target: string): Promise<string> {
    await this.assertNoSymlinkAncestors(target);
    try {
      const resolved = await this.fileSystem.realpath(target);
      if (!path.isAbsolute(resolved))
        throw new ProofWorkspaceError("containment", "proof workspace real path is invalid");
      return path.normalize(resolved);
    } catch (error) {
      if (error instanceof ProofWorkspaceError) throw error;
      throw new ProofWorkspaceError("containment", "proof workspace real path is unavailable");
    }
  }

  private async assertNoSymlinkAncestors(target: string): Promise<void> {
    const resolved = absolutePath(target);
    const root = path.parse(resolved).root;
    let current = root;
    for (const component of path.relative(root, resolved).split(path.sep).filter(Boolean)) {
      current = path.join(current, component);
      try {
        const stats = await this.fileSystem.lstat(current);
        if (stats.isSymbolicLink()) throw new ProofWorkspaceError("symlink", "proof workspace path contains a symlink");
      } catch (error) {
        if (error instanceof ProofWorkspaceError) throw error;
        if (isMissing(error)) break;
        throw new ProofWorkspaceError("containment", "proof workspace ancestor could not be inspected");
      }
    }
  }

  private assertContained(parent: string, child: string): void {
    if (!isPathWithin(parent, child)) throw new ProofWorkspaceError("containment", "proof workspace escaped its owner");
  }

  private async assertSeparated(reviewPath: string): Promise<void> {
    for (const normalized of await Promise.all(
      [this.repositoryPath, this.openCodeStatePath].map((protectedPath) => this.checkedBoundaryRealPath(protectedPath)),
    )) {
      if (pathsOverlap(reviewPath, normalized))
        throw new ProofWorkspaceError("containment", "proof workspace overlaps a protected domain");
    }
    const home = await this.checkedBoundaryRealPath(this.homePath);
    // Global storage normally lives below the user's home directory. That is
    // permitted, but a review root may not become the home directory itself or
    // an ancestor that could contain it.
    if (reviewPath === home || isPathWithin(reviewPath, home))
      throw new ProofWorkspaceError("containment", "proof workspace overlaps the home directory");
  }

  private async checkedBoundaryRealPath(target: string): Promise<string> {
    await this.assertNoSymlinkAncestors(target);
    try {
      return path.normalize(await this.fileSystem.realpath(target));
    } catch (error) {
      if (isMissing(error)) return path.normalize(target);
      throw new ProofWorkspaceError("containment", "protected boundary could not be verified");
    }
  }

  private async assertRecordSafe(record: WorkspaceRecord): Promise<void> {
    const reviewsRealPath = await this.checkedRealPath(this.reviewsPath);
    const sessionRealPath = await this.checkedRealPath(record.sessionPath);
    const reviewRealPath = await this.checkedRealPath(record.reviewPath);
    this.assertContained(reviewsRealPath, sessionRealPath);
    this.assertContained(sessionRealPath, reviewRealPath);
    if (sessionRealPath !== record.sessionRealPath || reviewRealPath !== record.reviewRealPath) {
      throw new ProofWorkspaceError("containment", "proof workspace was renamed or redirected");
    }
    await this.assertSeparated(reviewRealPath);
  }

  private async removeEmptySession(sessionPath: string): Promise<void> {
    try {
      await this.fileSystem.rmdir(sessionPath);
    } catch {
      // Allocation failure is already fail-closed; never broaden cleanup into
      // recursive deletion of a path that was not successfully verified.
    }
  }
}

export const createProofWorkspaceStore = (options: ProofWorkspaceStoreOptions): ProofWorkspaceStore =>
  new ProofWorkspaceStore(options);
