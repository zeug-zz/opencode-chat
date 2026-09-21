import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  AUTOMATIC_ROUTING_EVALUATION_TARGETS,
  type AutomaticRoutingMeasurementCase,
} from "./automatic-routing-evaluation";
import type { QualificationRecorderStore } from "./qualification-recorder";

const STORAGE_DIRECTORY = "vibefeld";
const FILE_NAME = "qualification.json";
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_CASES = AUTOMATIC_ROUTING_EVALUATION_TARGETS.maximumCaseCount;

export type QualificationStoreFileSystem = Readonly<{
  existsSync: typeof existsSync;
  lstatSync: typeof lstatSync;
  mkdirSync: typeof mkdirSync;
  readFileSync: typeof readFileSync;
  realpathSync: typeof realpathSync;
  writeFileSync: typeof writeFileSync;
}>;

export type QualificationFileStoreOptions = Readonly<{
  globalStoragePath: string;
  fileSystem?: QualificationStoreFileSystem;
}>;

const defaultFileSystem: QualificationStoreFileSystem = {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
};

const isWithin = (parent: string, child: string): boolean => {
  const relative = path.relative(parent, child);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

function isBoundedCase(value: unknown): value is AutomaticRoutingMeasurementCase {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 5) return false;
  if (
    typeof record.latencyMs !== "number" ||
    !Number.isFinite(record.latencyMs) ||
    record.latencyMs < 0 ||
    record.latencyMs > 86_400_000 ||
    typeof record.confidence !== "number" ||
    !Number.isFinite(record.confidence) ||
    record.confidence < 0 ||
    record.confidence > 1 ||
    typeof record.correct !== "boolean" ||
    typeof record.challenged !== "boolean" ||
    typeof record.falseChallenge !== "boolean"
  )
    return false;
  return !(record.falseChallenge && !record.challenged);
}

function absoluteStoragePath(value: string): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) return undefined;
  const resolved = path.resolve(value);
  return path.isAbsolute(resolved) ? resolved : undefined;
}

/**
 * Host-private, aggregate-only retention. The store is intentionally inert
 * when VS Code has not supplied a global storage directory.
 */
export function createQualificationFileStore(options: QualificationFileStoreOptions): QualificationRecorderStore {
  const fileSystem = options.fileSystem ?? defaultFileSystem;
  const globalStoragePath = absoluteStoragePath(options.globalStoragePath);
  const filePath = globalStoragePath ? path.join(globalStoragePath, STORAGE_DIRECTORY, FILE_NAME) : undefined;

  const safeFilePath = (): string | undefined => {
    if (!globalStoragePath || !filePath || !isWithin(globalStoragePath, filePath)) return undefined;
    try {
      if (!fileSystem.existsSync(globalStoragePath) || fileSystem.lstatSync(globalStoragePath).isSymbolicLink())
        return undefined;
      const realRoot = fileSystem.realpathSync(globalStoragePath);
      if (!isWithin(realRoot, path.resolve(filePath))) return undefined;
      return filePath;
    } catch {
      return undefined;
    }
  };

  return {
    load: () => {
      const target = safeFilePath();
      if (!target) return [];
      try {
        const content = fileSystem.readFileSync(target, "utf8");
        if (Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES) return [];
        const parsed: unknown = JSON.parse(content);
        if (!Array.isArray(parsed)) return [];
        return Object.freeze(parsed.filter(isBoundedCase).slice(0, MAX_CASES));
      } catch {
        return [];
      }
    },
    save: (cases) => {
      const target = safeFilePath();
      if (!target) return;
      try {
        const directory = path.dirname(target);
        if (fileSystem.existsSync(directory) && fileSystem.lstatSync(directory).isSymbolicLink()) return;
        if (fileSystem.existsSync(target) && fileSystem.lstatSync(target).isSymbolicLink()) return;
        fileSystem.mkdirSync(directory, { recursive: true });
        const realRoot = fileSystem.realpathSync(globalStoragePath as string);
        const realDirectory = fileSystem.realpathSync(directory);
        if (!isWithin(realRoot, realDirectory)) return;
        const bounded = cases.filter(isBoundedCase).slice(0, MAX_CASES);
        const content = JSON.stringify(bounded);
        if (Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES) return;
        fileSystem.writeFileSync(target, content, { encoding: "utf8" });
      } catch {
        // Retention is best effort and must never affect Chat or review flow.
      }
    },
  };
}
