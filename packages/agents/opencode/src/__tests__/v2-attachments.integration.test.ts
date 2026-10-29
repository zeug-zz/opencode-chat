import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inflateSync } from "node:zlib";
import { afterEach, expect, it } from "vitest";
import { OpenCodeAgent } from "../opencode-agent.js";
import {
  assertIsolatedEnvironment,
  assertOwnedPath,
  createV2TestIsolation,
  evaluateStaticPrelaunchGate,
  inspectAmbientConfigSources,
  type V2TestIsolation,
} from "./v2-test-isolation.js";

const projectRoot = fileURLToPath(new URL("../../../../../", import.meta.url));
const executable = process.env.OPENCODE_CHAT_V2_SPIKE_EXECUTABLE;
const enabled =
  process.env.OPENCODE_CHAT_RUN_V2_ADAPTER === "1" &&
  executable === "/opt/homebrew/Cellar/opencode-v2/2.2.0/bin/opencode";
const expectedHash = "0614b30fd17c27258b16cd6ea9ab03e1160fa9897e4cefd2d9a5d86f71a0af11";
const sourceCommit = "1097e2668b1e08ad63bdf0b1c4860b9bc01e420c";
const timeoutMs = 60_000;
const cleanupMs = 5_000;
const apiLimit = 30;
const modelLimit = 1;
const maxRequestBytes = 64 * 1024;
const textContent = "Native attachment fixture — naïve line\nsecond line\n";
const imageBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=",
  "base64",
);
const corruptImageBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/pZsAAAAASUVORK5CYII=";
const textRelative = "folder with space/naïve #1?%.txt";
const imageRelative = "tiny image.png";
const answerText = "attachment fixture verified answer";
const checksList = [
  "dedicatedVitestFork",
  "resultManifestMode0600",
  "ambientStaticGateClear",
  "executableAndInstalledClientPinned",
  "nativeServerVersionAndPID",
  "fixtureFilesMode0600",
  "fixtureConfigIsOwnedAndImageTextCapable",
  "ownedSessionCreated",
  "promptAdmissionSawExactFileURIsAndControlText",
  "singleModelRequestHadExactNativeTextAndImage",
  "nativeHistoryContainsBothExactFileAttachments",
  "mappedHistoryRoundTripsBothAttachmentsAndControlText",
  "liveUserPublishedBeforeHistoryRead",
  "liveUserMatchesReloadedHistory",
  "sessionBusyThenIdleAndKnownAnswer",
  "missingFileRejectedBeforeModelAndHistoryMutation",
  "boundsRespected",
] as const;
type Check = (typeof checksList)[number];
type LiveUserParityDiagnostics = {
  counts: {
    liveHeaders: number;
    nativeUsers: number;
    mappedUsers: number;
    liveParts: number;
    mappedParts: number;
  };
  matches: {
    liveHeaderPresent: boolean;
    singleNativeUser: boolean;
    admissionMessageID: boolean;
    createdTimestamp: boolean;
    liveHeaderCount: boolean;
    mappedMessageID: boolean;
    partCount: boolean;
    partTypes: boolean;
    partIDs: boolean;
    copyableText: boolean;
    attachmentURLs: boolean;
    attachmentNames: boolean;
    attachmentMimes: boolean;
  };
};
type Result = {
  schemaVersion: 1;
  runId: string;
  status: "RUNNING" | "PASS" | "FAIL" | "BLOCKED";
  qualification: "NATIVE_TEXT_IMAGE_ATTACHMENT_NOT_HOST_UI";
  expectedServer: "2.2.0";
  clientPackage: "@opencode/client@2.1.0";
  sourceCommit: string;
  sourceCommitMeaning: "inspected-release-tag";
  executablePath: string | null;
  executableSha256: string | null;
  observedVersion: string | null;
  ownedPID: number | null;
  fixtureRoot: string | null;
  fixtureFiles: string[];
  statePath: string | null;
  databasePath: string | null;
  resultPath: string;
  bounds: {
    overallMs: number;
    apiRequests: number;
    modelRequests: number;
    sessions: number;
    children: number;
    promptAttempts: number;
    maxRequestBytes: number;
    files: number;
    cleanupMs: number;
    sourcePolls: number;
    sourcePollIntervalMs: number;
  };
  counts: {
    apiRequests: number;
    modelRequests: number;
    sessions: number;
    promptAttempts: number;
    maxRequestBytes: number;
    sourcePolls: number;
  };
  checks: Record<Check, boolean>;
  liveUserParity?: LiveUserParityDiagnostics;
  cleanup: {
    agentCleanup: boolean;
    processGroupGone: boolean;
    fixtureClosed: boolean;
    isolationRemoved: boolean;
    stateAbsent: boolean;
    databaseAbsent: boolean;
    environmentRestored: boolean;
    fetchRestored: boolean;
  };
  preTeardown?: {
    status: Result["status"];
    counts: Result["counts"];
    checks: Record<Check, boolean>;
    liveUserParity?: LiveUserParityDiagnostics;
    failureCode?: string;
  };
  failureCode?: string;
  firstPromptHTTPStatus?: number | null;
  firstPromptNativeProblemType?: "InvalidRequestError" | "ConflictError" | "SessionNotFoundError" | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pngCRC32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) === 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function validTinyPNG(bytes: Buffer): boolean {
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return false;
  let offset = 8;
  const imageData: Buffer[] = [];
  let width = 0;
  let height = 0;
  let colorType = -1;
  let bitDepth = -1;
  let ended = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > bytes.length) return false;
    const kind = bytes.toString("ascii", offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (pngCRC32(bytes.subarray(offset + 4, offset + 8 + length)) !== bytes.readUInt32BE(offset + 8 + length))
      return false;
    if (kind === "IHDR") {
      if (length !== 13) return false;
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8]!;
      colorType = data[9]!;
    }
    if (kind === "IDAT") imageData.push(data);
    if (kind === "IEND") {
      if (length !== 0 || chunkEnd !== bytes.length) return false;
      ended = true;
      break;
    }
    offset = chunkEnd;
  }
  if (!ended || width !== 1 || height !== 1 || colorType !== 4 || bitDepth !== 8 || imageData.length === 0)
    return false;
  const row = inflateSync(Buffer.concat(imageData));
  return row.length === 3 && row[0] === 1 && row[1] === 0xff && row[2] === 0xff;
}

function ownedPathURL(url: string, name: string, expectedPath: string): boolean {
  try {
    return (
      new URL(url).href === pathToFileURL(expectedPath).href &&
      decodeURIComponent(new URL(url).pathname.split("/").at(-1) ?? "") === name
    );
  } catch {
    return false;
  }
}

function nativeHistoryAttachments(
  value: unknown,
  expectations: readonly { uri: string; name: string; mime: string; data: Buffer }[],
): { ok: boolean; imageDataURL?: string } {
  if (
    !isRecord(value) ||
    Object.keys(value).sort().join(",") !== "cursor,data" ||
    !Array.isArray(value.data) ||
    !isRecord(value.cursor)
  )
    return { ok: false };
  const cursor = value.cursor;
  if (
    Object.keys(cursor).some((key) => key !== "previous" && key !== "next") ||
    Object.values(cursor).some((token) => typeof token !== "string" || token.length === 0 || token.length > 512)
  )
    return { ok: false };
  const users = value.data.filter((message) => isRecord(message) && message.type === "user");
  if (users.length !== 1 || !isRecord(users[0])) return { ok: false };
  const user = users[0];
  if (!Array.isArray(user.files)) return { ok: false };
  const files = user.files;
  if (
    !/^msg_[A-Za-z0-9_-]+$/u.test(String(user.id)) ||
    !isRecord(user.time) ||
    typeof user.time.created !== "number" ||
    user.text !== "Keep this control text exactly." ||
    files.length !== expectations.length ||
    expectations.length !== 2
  )
    return { ok: false };
  const filesValid = expectations.every((expected, index) => {
    const file = files[index];
    if (
      !isRecord(file) ||
      file.name !== expected.name ||
      file.mime !== expected.mime ||
      !isRecord(file.source) ||
      file.source.type !== "uri" ||
      file.source.uri !== expected.uri ||
      typeof file.data !== "string"
    )
      return false;
    return file.data === expected.data.toString("base64") && Buffer.from(file.data, "base64").equals(expected.data);
  });
  const image = files[1];
  if (!filesValid || !isRecord(image) || typeof image.data !== "string") return { ok: false };
  return { ok: true, imageDataURL: `data:${image.mime};base64,${image.data}` };
}

function attachmentRoute(
  method: string,
  pathname: string,
  search: string,
  sessionID: string,
): "prompt" | "history" | undefined {
  const prompt = /^\/api\/session\/([^/]+)\/prompt$/u.exec(pathname);
  const history = /^\/api\/session\/([^/]+)\/message$/u.exec(pathname);
  const match = prompt ?? history;
  if (!match?.[1]) return undefined;
  let routeID: string;
  try {
    routeID = decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
  if (routeID !== sessionID) return undefined;
  if (prompt && method === "POST" && search === "") return "prompt";
  if (history && method === "GET" && search === "?order=asc") return "history";
  return undefined;
}

function textAndImageRequest(value: unknown, expectedImageData: string, expectedImagePath: string): boolean {
  if (!isRecord(value) || !Array.isArray(value.messages)) return false;
  const users = value.messages.filter((message) => isRecord(message) && message.role === "user");
  if (users.length !== 1 || !isRecord(users[0]) || !Array.isArray(users[0].content)) return false;
  const content = users[0].content;
  const expectedParts = [
    { type: "text", text: "Keep this control text exactly." },
    { type: "text", text: `\n\nAttached file: ${textRelative.split("/").at(-1)}\n\n${textContent}` },
    { type: "text", text: `Attached file: ${expectedImagePath}` },
    { type: "image_url", image_url: { url: expectedImageData } },
  ];
  return (
    content.length === expectedParts.length &&
    content.every((part, index) => JSON.stringify(part) === JSON.stringify(expectedParts[index]))
  );
}

function safeFailureCode(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  const known = new Set([
    "dedicated_fork_required",
    "executable_required",
    "executable_unavailable",
    "ambient_gate_blocked",
    "pinned_executable_mismatch",
    "client_version_mismatch",
    "native_version_mismatch",
    "api_request_limit",
    "model_request_limit",
    "model_body_too_large",
    "overall_deadline",
    "first_attachment_prompt_rejected",
    "prompt_admission_mismatch",
    "model_contract_mismatch",
    "native_history_mismatch",
    "attachment_contract_mismatch",
    "missing_file_was_admitted",
    "fixture_config_mismatch",
    "source_poll_timeout",
    "fixture_operation_failed",
  ]);
  return typeof code === "string" && known.has(code) ? code : "fixture_operation_failed";
}

async function bounded<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error(), { code: "cleanup_timeout" })), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function response(text: string): string {
  const chunk = (delta: Record<string, unknown>, finish_reason: string | null = null) =>
    `data: ${JSON.stringify({ id: "attachment-fixture", object: "chat.completion.chunk", created: 0, model: "fixture-model", choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
  return `${chunk({ role: "assistant" })}${chunk({ content: text })}${chunk({}, "stop")}data: [DONE]\n\n`;
}

function groupExists(pid: number): boolean {
  try {
    process.kill(process.platform === "win32" ? pid : -pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function groupGone(pid: number): Promise<{ gone: boolean; graceful: boolean }> {
  const deadline = Date.now() + cleanupMs;
  while (groupExists(pid) && Date.now() < deadline) await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  if (!groupExists(pid)) return { gone: true, graceful: true };
  try {
    process.kill(process.platform === "win32" ? pid : -pid, "SIGTERM");
  } catch {
    /* checked below */
  }
  const reapDeadline = Date.now() + 1_000;
  while (groupExists(pid) && Date.now() < reapDeadline)
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  if (groupExists(pid)) {
    try {
      process.kill(process.platform === "win32" ? pid : -pid, "SIGKILL");
    } catch {
      /* checked below */
    }
  }
  const finalDeadline = Date.now() + 1_000;
  while (groupExists(pid) && Date.now() < finalDeadline)
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  return { gone: !groupExists(pid), graceful: false };
}

const owners = new Set<V2TestIsolation>();
afterEach(async () => {
  for (const owner of owners) {
    await owner.dispose();
    owners.delete(owner);
  }
});

it("matches only exact native admission/history routes and attachment payloads", () => {
  const uri = pathToFileURL("/owned/folder with space/naïve #1?%.txt").href;
  expect(ownedPathURL(uri, "naïve #1?%.txt", "/owned/folder with space/naïve #1?%.txt")).toBe(true);
  expect(ownedPathURL(uri, "wrong.txt", "/owned/folder with space/naïve #1?%.txt")).toBe(false);
  expect(ownedPathURL(uri, "naïve #1?%.txt", "/owned/other.txt")).toBe(false);
  expect(attachmentRoute("POST", "/api/session/ses_owned/prompt", "", "ses_owned")).toBe("prompt");
  expect(attachmentRoute("POST", "/api/session/ses_owned/prompt_async", "", "ses_owned")).toBeUndefined();
  expect(attachmentRoute("GET", "/api/session/ses_owned/message", "?order=asc", "ses_owned")).toBe("history");
  expect(attachmentRoute("GET", "/api/session/ses_owned/message", "", "ses_owned")).toBeUndefined();
  expect(attachmentRoute("POST", "/api/session/ses_foreign/prompt", "", "ses_owned")).toBeUndefined();
  expect(attachmentRoute("POST", "/api/session/ses_owned/prompt", "?other=1", "ses_owned")).toBeUndefined();
  const expectations = [
    { uri, name: "naïve #1?%.txt", mime: "text/plain", data: Buffer.from(textContent) },
    { uri: "file:///owned/tiny%20image.png", name: "tiny image.png", mime: "image/png", data: imageBytes },
  ];
  const nativePage = (
    files = expectations.map((file) => ({
      data: file.data.toString("base64"),
      mime: file.mime,
      name: file.name,
      source: { type: "uri", uri: file.uri },
    })),
    text = "Keep this control text exactly.",
  ) => ({
    data: [{ type: "user", id: "msg_fixture", time: { created: 1 }, text, files }],
    cursor: {
      previous: Buffer.from(JSON.stringify({ id: "msg_fixture", order: "asc", direction: "previous" })).toString(
        "base64url",
      ),
      next: Buffer.from(JSON.stringify({ id: "msg_fixture", order: "asc", direction: "next" })).toString("base64url"),
    },
  });
  const validNative = nativeHistoryAttachments(nativePage(), expectations);
  expect(validNative.ok).toBe(true);
  expect(validNative.imageDataURL).toBe(`data:image/png;base64,${imageBytes.toString("base64")}`);
  expect(nativeHistoryAttachments({ ...nativePage(), cursor: { previous: "opaque-cursor" } }, expectations).ok).toBe(
    true,
  );
  expect(nativeHistoryAttachments({ ...nativePage(), cursor: { previous: "" } }, expectations).ok).toBe(false);
  expect(nativeHistoryAttachments({ ...nativePage(), cursor: { previous: 7 } }, expectations).ok).toBe(false);
  expect(
    nativeHistoryAttachments({ ...nativePage(), cursor: { previous: "valid", unknown: "x" } }, expectations).ok,
  ).toBe(false);
  expect(nativeHistoryAttachments({ data: { data: nativePage().data, cursor: {} } }, expectations).ok).toBe(false);
  expect(nativeHistoryAttachments({ data: nativePage().data }, expectations).ok).toBe(false);
  expect(
    nativeHistoryAttachments(
      {
        ...nativePage(),
        data: [
          ...nativePage().data,
          { type: "user", id: "msg_foreign", time: { created: 2 }, text: "foreign", files: [] },
        ],
      },
      expectations,
    ).ok,
  ).toBe(false);
  expect(
    nativeHistoryAttachments(
      nativePage(
        expectations.map((file) => ({
          data: file.data.toString("base64"),
          mime: file.mime,
          name: file.name,
          source: { type: "uri", uri: "file:///foreign/file" },
        })),
      ),
      expectations,
    ).ok,
  ).toBe(false);
  expect(
    nativeHistoryAttachments(
      nativePage(
        expectations.map((file, index) => ({
          data: file.data.toString("base64"),
          mime: index === 0 ? "application/octet-stream" : file.mime,
          name: file.name,
          source: { type: "uri", uri: file.uri },
        })),
      ),
      expectations,
    ).ok,
  ).toBe(false);
  expect(
    nativeHistoryAttachments(
      nativePage(
        expectations.map((file, index) => ({
          data: file.data.toString("base64"),
          mime: file.mime,
          name: index === 0 ? "wrong.txt" : file.name,
          source: { type: "uri", uri: file.uri },
        })),
      ),
      expectations,
    ).ok,
  ).toBe(false);
  expect(
    nativeHistoryAttachments(
      nativePage(
        expectations.map((file, index) => ({
          data: index === 1 ? Buffer.from("wrong").toString("base64") : file.data.toString("base64"),
          mime: file.mime,
          name: file.name,
          source: { type: "uri", uri: file.uri },
        })),
      ),
      expectations,
    ).ok,
  ).toBe(false);
  expect(
    nativeHistoryAttachments(
      nativePage(
        expectations.slice(0, 1).map((file) => ({
          data: file.data.toString("base64"),
          mime: file.mime,
          name: file.name,
          source: { type: "uri", uri: file.uri },
        })),
      ),
      expectations,
    ).ok,
  ).toBe(false);
  const nativeImageData = `data:image/png;base64,${imageBytes.toString("base64")}`;
  const validContent = [
    { type: "text", text: "Keep this control text exactly." },
    { type: "text", text: `\n\nAttached file: naïve #1?%.txt\n\n${textContent}` },
    { type: "text", text: "Attached file: /owned/tiny image.png" },
    { type: "image_url", image_url: { url: nativeImageData } },
  ];
  const validRequest = {
    messages: [
      { role: "system", content: "fixture system" },
      {
        role: "user",
        content: validContent,
      },
    ],
  };
  expect(textAndImageRequest(validRequest, nativeImageData, "/owned/tiny image.png")).toBe(true);
  expect(
    textAndImageRequest(
      { messages: [...validRequest.messages, { role: "user", content: [] }] },
      nativeImageData,
      "/owned/tiny image.png",
    ),
  ).toBe(false);
  expect(
    textAndImageRequest(
      { messages: [{ role: "user", content: validContent.slice(1) }] },
      nativeImageData,
      "/owned/tiny image.png",
    ),
  ).toBe(false);
  expect(
    textAndImageRequest(
      {
        messages: [
          {
            role: "user",
            content: [
              ...validContent.slice(0, 3),
              {
                type: "image_url",
                image_url: { url: `data:image/png;base64,${Buffer.from("wrong").toString("base64")}` },
              },
            ],
          },
        ],
      },
      nativeImageData,
      "/owned/tiny image.png",
    ),
  ).toBe(false);
  expect(
    textAndImageRequest(
      {
        messages: [
          {
            role: "user",
            content: [{ ...validContent[0]!, text: "changed" }, ...validContent.slice(1)],
          },
        ],
      },
      nativeImageData,
      "/owned/tiny image.png",
    ),
  ).toBe(false);
  expect(
    textAndImageRequest(
      {
        messages: [
          {
            role: "user",
            content: [
              ...validContent.slice(0, 2),
              { type: "text", text: "Attached file: /wrong.png" },
              ...validContent.slice(3),
            ],
          },
        ],
      },
      nativeImageData,
      "/owned/tiny image.png",
    ),
  ).toBe(false);
});

it("validates the actual tiny PNG fixture and rejects its previous bad IDAT CRC", () => {
  expect(validTinyPNG(imageBytes)).toBe(true);
  expect(validTinyPNG(Buffer.from(corruptImageBase64, "base64"))).toBe(false);
  expect(imageBytes.readUInt32BE(16)).toBe(1);
  expect(imageBytes.readUInt32BE(20)).toBe(1);
});

it.skipIf(!enabled)(
  "round-trips native text and image attachments through the production adapter",
  async () => {
    const started = Date.now();
    const runId = randomUUID();
    const base = resolve(projectRoot, "tmp/scribe-v2-migration/attachments");
    await mkdir(base, { recursive: true });
    await assertOwnedPath(projectRoot, base);
    const runRoot = join(base, runId);
    await mkdir(runRoot, { recursive: false });
    const resultPath = join(runRoot, "result.json");
    const checks = Object.fromEntries(checksList.map((name) => [name, false])) as Record<Check, boolean>;
    const result: Result = {
      schemaVersion: 1,
      runId,
      status: "RUNNING",
      qualification: "NATIVE_TEXT_IMAGE_ATTACHMENT_NOT_HOST_UI",
      expectedServer: "2.2.0",
      clientPackage: "@opencode/client@2.1.0",
      sourceCommit,
      sourceCommitMeaning: "inspected-release-tag",
      executablePath: executable && isAbsolute(executable) ? resolve(executable) : null,
      executableSha256: null,
      observedVersion: null,
      ownedPID: null,
      fixtureRoot: null,
      fixtureFiles: [],
      statePath: null,
      databasePath: null,
      resultPath: relative(projectRoot, resultPath),
      bounds: {
        overallMs: timeoutMs,
        apiRequests: apiLimit,
        modelRequests: modelLimit,
        sessions: 1,
        children: 1,
        promptAttempts: 2,
        maxRequestBytes,
        files: 2,
        cleanupMs,
        sourcePolls: 8,
        sourcePollIntervalMs: 250,
      },
      counts: { apiRequests: 0, modelRequests: 0, sessions: 0, promptAttempts: 0, maxRequestBytes: 0, sourcePolls: 0 },
      firstPromptHTTPStatus: null,
      firstPromptNativeProblemType: null,
      checks,
      cleanup: {
        agentCleanup: false,
        processGroupGone: false,
        fixtureClosed: false,
        isolationRemoved: false,
        stateAbsent: false,
        databaseAbsent: false,
        environmentRestored: false,
        fetchRestored: false,
      },
    };
    const persist = () => writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
    const originalFetch = globalThis.fetch;
    const originalEnvironment = { ...process.env };
    const deadline = started + timeoutMs;
    const abort = new AbortController();
    const deadlineTimer = setTimeout(
      () => abort.abort(Object.assign(new Error(), { code: "overall_deadline" })),
      timeoutMs,
    );
    let isolation: V2TestIsolation | undefined;
    let agent: OpenCodeAgent | undefined;
    let fixture: Server | undefined;
    let envReplaced = false;
    let pid: number | undefined;
    let sessionID: string | undefined;
    let sourceOrigin: string | undefined;
    let mockOrigin: string | undefined;
    let sourceHistoryEnvelope: unknown;
    let admission: unknown;
    let busy = false;
    let idle = false;
    const liveUserHeaders: Array<{ id: string; created: number }> = [];
    const liveUserParts: Array<{
      id: string;
      messageID: string;
      type: string;
      text?: string;
      url?: string;
      filename?: string;
      mime?: string;
    }> = [];
    let modelVerified = false;
    let imageDataURL: string | undefined;
    let textURI: string | undefined;
    let imageURI: string | undefined;
    let textPath: string | undefined;
    let imagePath: string | undefined;
    let nativeHistoryValid = false;
    let runtimeFailureCode: string | undefined;
    let promptRouteObserved = false;
    let historyRouteObserved = false;
    const failModelRequest = (responseStream: import("node:http").ServerResponse, code: string, status = 500) => {
      runtimeFailureCode = code;
      result.failureCode = code;
      abort.abort(Object.assign(new Error(), { code }));
      responseStream.writeHead(status).end();
    };
    try {
      await persist();
      checks.resultManifestMode0600 = (await stat(resultPath)).mode % 0o1000 === 0o600;
      if (!checks.resultManifestMode0600) throw Object.assign(new Error(), { code: "fixture_operation_failed" });
      const fork = process as NodeJS.Process & { send?: (...args: unknown[]) => unknown; connected?: boolean };
      checks.dedicatedVitestFork = typeof fork.send === "function" && fork.connected === true;
      if (!checks.dedicatedVitestFork) throw Object.assign(new Error(), { code: "dedicated_fork_required" });
      if (!executable || !isAbsolute(executable)) throw Object.assign(new Error(), { code: "executable_required" });
      try {
        await access(executable);
      } catch {
        throw Object.assign(new Error(), { code: "executable_unavailable" });
      }
      const exeReal = await realpath(executable);
      result.executableSha256 = createHash("sha256")
        .update(await readFile(exeReal))
        .digest("hex");
      if (exeReal !== resolve(executable) || result.executableSha256 !== expectedHash)
        throw Object.assign(new Error(), { code: "pinned_executable_mismatch" });
      const clientMeta = JSON.parse(
        await readFile(
          join(projectRoot, "packages/agents/opencode/node_modules/@opencode/client/package.json"),
          "utf8",
        ),
      ) as { name?: unknown; version?: unknown };
      checks.executableAndInstalledClientPinned =
        clientMeta.name === "@opencode/client" && clientMeta.version === "2.1.0";
      if (!checks.executableAndInstalledClientPinned)
        throw Object.assign(new Error(), { code: "client_version_mismatch" });
      isolation = await createV2TestIsolation(runRoot);
      owners.add(isolation);
      result.fixtureRoot = relative(projectRoot, isolation.root);
      result.statePath = relative(projectRoot, isolation.paths.state);
      result.databasePath = relative(projectRoot, isolation.paths.database);
      await assertOwnedPath(runRoot, isolation.root);
      await assertIsolatedEnvironment(isolation.environment, isolation.paths);
      const gate = evaluateStaticPrelaunchGate(
        isolation.environment,
        isolation.paths,
        await inspectAmbientConfigSources(),
      );
      checks.ambientStaticGateClear = gate.status === "READY_FOR_DISPOSABLE_SPIKE";
      if (!checks.ambientStaticGateClear) throw Object.assign(new Error(), { code: "ambient_gate_blocked" });
      textPath = join(isolation.paths.cwd, textRelative);
      imagePath = join(isolation.paths.cwd, imageRelative);
      await mkdir(join(isolation.paths.cwd, "folder with space"), { recursive: true, mode: 0o700 });
      await writeFile(textPath, textContent, { flag: "wx", mode: 0o600 });
      await writeFile(imagePath, imageBytes, { flag: "wx", mode: 0o600 });
      result.fixtureFiles = [relative(projectRoot, textPath), relative(projectRoot, imagePath)];
      checks.fixtureFilesMode0600 =
        (await stat(textPath)).mode % 0o1000 === 0o600 && (await stat(imagePath)).mode % 0o1000 === 0o600;
      if (!checks.fixtureFilesMode0600) throw Object.assign(new Error(), { code: "fixture_operation_failed" });
      textURI = pathToFileURL(textPath).href;
      imageURI = pathToFileURL(imagePath).href;

      fixture = createServer((request, responseStream) => {
        void (async () => {
          if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
            responseStream.writeHead(404).end();
            return;
          }
          result.counts.modelRequests += 1;
          if (result.counts.modelRequests > modelLimit) {
            failModelRequest(responseStream, "model_request_limit", 429);
            return;
          }
          const chunks: Buffer[] = [];
          let bytes = 0;
          for await (const chunk of request) {
            bytes += Buffer.byteLength(chunk);
            result.counts.maxRequestBytes = Math.max(result.counts.maxRequestBytes, bytes);
            if (bytes > maxRequestBytes) {
              failModelRequest(responseStream, "model_body_too_large", 413);
              return;
            }
            chunks.push(Buffer.from(chunk));
          }
          const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          const messages = isRecord(body) && Array.isArray(body.messages) ? body.messages : [];
          const users = messages.filter((message) => isRecord(message) && message.role === "user");
          if (
            !isRecord(body) ||
            body.model !== "fixture-model" ||
            users.length !== 1 ||
            !checks.fixtureConfigIsOwnedAndImageTextCapable ||
            !checks.promptAdmissionSawExactFileURIsAndControlText
          ) {
            failModelRequest(
              responseStream,
              !checks.fixtureConfigIsOwnedAndImageTextCapable
                ? "fixture_config_mismatch"
                : !checks.promptAdmissionSawExactFileURIsAndControlText
                  ? "prompt_admission_mismatch"
                  : "model_contract_mismatch",
            );
            return;
          }
          const userContent = { messages };
          const content = isRecord(users[0]) ? users[0].content : undefined;
          const image = Array.isArray(content)
            ? content.find((part) => isRecord(part) && part.type === "image_url")
            : undefined;
          imageDataURL =
            isRecord(image) && isRecord(image.image_url) && typeof image.image_url.url === "string"
              ? image.image_url.url
              : undefined;
          if (agent && sessionID && textURI && imageURI && imagePath) {
            await agent.getMessages(sessionID);
            const observedHistory = nativeHistoryAttachments(sourceHistoryEnvelope, [
              { uri: textURI, name: "naïve #1?%.txt", mime: "text/plain", data: Buffer.from(textContent) },
              { uri: imageURI, name: "tiny image.png", mime: "image/png", data: imageBytes },
            ]);
            nativeHistoryValid = observedHistory.ok && observedHistory.imageDataURL === imageDataURL;
          }
          checks.nativeHistoryContainsBothExactFileAttachments = nativeHistoryValid && historyRouteObserved;
          if (!checks.nativeHistoryContainsBothExactFileAttachments) {
            failModelRequest(responseStream, "native_history_mismatch");
            return;
          }
          modelVerified =
            nativeHistoryValid &&
            imagePath !== undefined &&
            imageDataURL !== undefined &&
            textAndImageRequest(userContent, `data:image/png;base64,${imageBytes.toString("base64")}`, imagePath);
          if (!modelVerified) {
            failModelRequest(responseStream, "attachment_contract_mismatch");
            return;
          }
          checks.singleModelRequestHadExactNativeTextAndImage = result.counts.modelRequests === 1 && modelVerified;
          responseStream.writeHead(200, { "content-type": "text/event-stream" }).end(response(answerText));
        })().catch(() => {
          if (!responseStream.headersSent) failModelRequest(responseStream, "fixture_operation_failed");
          else {
            runtimeFailureCode = "fixture_operation_failed";
            result.failureCode = runtimeFailureCode;
            abort.abort(Object.assign(new Error(), { code: runtimeFailureCode }));
            responseStream.destroy();
          }
        });
      });
      const port = await new Promise<number>((resolvePort, reject) => {
        fixture?.once("error", reject);
        fixture?.listen(0, "127.0.0.1", () => {
          const address = fixture?.address();
          if (!address || typeof address === "string") reject(new Error("fixture_bind_failed"));
          else resolvePort(address.port);
        });
      });
      mockOrigin = `http://127.0.0.1:${port}`;
      const ownedConfigPath = join(isolation.paths.config, "opencode", "opencode.json");
      const fixtureConfigValue = {
        model: "fixture-provider/fixture-model",
        providers: {
          "fixture-provider": {
            name: "Local attachment fixture",
            package: "@opencode/ai/providers/openai-compatible",
            settings: { baseURL: `${mockOrigin}/v1` },
            models: { "fixture-model": { name: "Fixture model", capabilities: { input: ["text", "image"] } } },
          },
        },
        enabledProviders: ["fixture-provider"],
        plugins: [],
        mcp: {},
      };
      await writeFile(ownedConfigPath, JSON.stringify(fixtureConfigValue), { mode: 0o600 });
      const configuredProvider = fixtureConfigValue.providers["fixture-provider"];
      checks.fixtureConfigIsOwnedAndImageTextCapable =
        (await stat(ownedConfigPath)).mode % 0o1000 === 0o600 &&
        fixtureConfigValue.enabledProviders.length === 1 &&
        fixtureConfigValue.enabledProviders[0] === "fixture-provider" &&
        fixtureConfigValue.plugins.length === 0 &&
        Object.keys(fixtureConfigValue.mcp).length === 0 &&
        configuredProvider.models["fixture-model"].capabilities.input.join(",") === "text,image";
      const nativeFetch = originalFetch.bind(globalThis);
      globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : String(input);
        const parsed = new URL(url);
        if (parsed.pathname.startsWith("/api/")) {
          if (
            !/^https?:$/.test(parsed.protocol) ||
            !["127.0.0.1", "localhost", "[::1]", "::1"].includes(parsed.hostname)
          )
            throw new Error("non_loopback_api_request");
          sourceOrigin ??= parsed.origin;
          if (parsed.origin !== sourceOrigin) throw new Error("foreign_api_request");
          result.counts.apiRequests += 1;
          if (result.counts.apiRequests > apiLimit) throw Object.assign(new Error(), { code: "api_request_limit" });
        } else if (parsed.origin !== mockOrigin) throw new Error("foreign_fetch_blocked");
        const remaining = Math.max(1, deadline - Date.now());
        const signals = [
          abort.signal,
          AbortSignal.timeout(remaining),
          ...(input instanceof Request ? [input.signal] : []),
          ...(init?.signal ? [init.signal] : []),
        ];
        const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
        const route = sessionID ? attachmentRoute(method, parsed.pathname, parsed.search, sessionID) : undefined;
        if (route === "prompt" && sessionID && result.counts.promptAttempts === 1 && !promptRouteObserved) {
          promptRouteObserved = true;
          const request = input instanceof Request ? input.clone() : undefined;
          const raw = request ? await request.text() : typeof init?.body === "string" ? init.body : "";
          try {
            admission = JSON.parse(raw);
          } catch {
            admission = undefined;
          }
          const requestAdmission = isRecord(admission) ? admission : undefined;
          const files = requestAdmission && Array.isArray(requestAdmission.files) ? requestAdmission.files : [];
          checks.promptAdmissionSawExactFileURIsAndControlText =
            requestAdmission?.text === "Keep this control text exactly." &&
            files.length === 2 &&
            isRecord(files[0]) &&
            files[0].uri === textURI &&
            files[0].name === "naïve #1?%.txt" &&
            isRecord(files[1]) &&
            files[1].uri === imageURI &&
            files[1].name === "tiny image.png";
        }
        const responseValue = await nativeFetch(input, { ...init, signal: AbortSignal.any(signals) });
        if (route === "prompt" && result.counts.promptAttempts === 1 && !responseValue.ok) {
          result.firstPromptHTTPStatus = responseValue.status;
          const problem: unknown = await responseValue
            .clone()
            .json()
            .catch(() => undefined);
          const tag = isRecord(problem) ? problem._tag : undefined;
          if (tag === "InvalidRequestError" || tag === "ConflictError" || tag === "SessionNotFoundError")
            result.firstPromptNativeProblemType = tag;
        }
        if (parsed.pathname === "/api/info" && responseValue.ok) {
          const info: unknown = await responseValue
            .clone()
            .json()
            .catch(() => undefined);
          if (isRecord(info) && typeof info.version === "string" && typeof info.pid === "number") {
            result.observedVersion = info.version;
            pid = info.pid;
            result.ownedPID = info.pid;
          }
        }
        if (route === "history" && sessionID && responseValue.ok) {
          historyRouteObserved = true;
          const historyResponse = responseValue.clone();
          sourceHistoryEnvelope = await historyResponse.json().catch(() => undefined);
        }
        return responseValue;
      }) as typeof fetch;
      envReplaced = true;
      for (const key of Object.keys(process.env)) delete process.env[key];
      Object.assign(process.env, isolation.environment);
      agent = new OpenCodeAgent({
        workspacePath: isolation.paths.cwd,
        hostPaths: { config: join(isolation.paths.config, "opencode"), state: isolation.paths.state },
        backend: "sdk",
        sandbox: {
          mode: "off",
          enabled: false,
          allowNetwork: true,
          filesystemPolicy: { readWritePaths: [isolation.paths.cwd], readOnlyPaths: [] },
        },
        executable: { path: resolve(executable) },
      });
      agent.onEvent((event) => {
        if (event.type === "session.status" && event.properties.sessionID === sessionID) {
          if (event.properties.status.type === "busy") busy = true;
          if (event.properties.status.type === "idle" && busy) idle = true;
        } else if (
          event.type === "message.updated" &&
          event.properties.sessionID === sessionID &&
          event.properties.info.role === "user"
        ) {
          liveUserHeaders.push({ id: event.properties.info.id, created: event.properties.info.time.created });
        } else if (event.type === "message.part.updated" && event.properties.sessionID === sessionID) {
          const part = event.properties.part;
          if (part.type === "text" || part.type === "file") {
            liveUserParts.push({
              id: part.id,
              messageID: part.messageID,
              type: part.type,
              ...(part.type === "text"
                ? { text: part.text }
                : { url: part.url, filename: part.filename, mime: part.mime }),
            });
          }
        }
      });
      await assertIsolatedEnvironment(isolation.environment, isolation.paths);
      const freshConnectGate = evaluateStaticPrelaunchGate(
        isolation.environment,
        isolation.paths,
        await inspectAmbientConfigSources(),
      );
      checks.ambientStaticGateClear =
        checks.ambientStaticGateClear && freshConnectGate.status === "READY_FOR_DISPOSABLE_SPIKE";
      if (!checks.ambientStaticGateClear) throw Object.assign(new Error(), { code: "ambient_gate_blocked" });
      await agent.connect();
      const nativePath = await agent.getPath();
      checks.nativeServerVersionAndPID =
        result.observedVersion === "2.2.0" && pid !== undefined && nativePath.directory === isolation.paths.cwd;
      if (!checks.nativeServerVersionAndPID) throw Object.assign(new Error(), { code: "native_version_mismatch" });
      const created = await agent.createSession("native attachment fixture");
      sessionID = created.id;
      result.counts.sessions = 1;
      checks.ownedSessionCreated = sessionID.length > 0;
      result.counts.promptAttempts = 1;
      try {
        await agent.sendMessage(sessionID, "Keep this control text exactly.", {
          files: [
            { filePath: textRelative, fileName: "naïve #1?%.txt" },
            { filePath: imagePath, fileName: "tiny image.png" },
          ],
        });
      } catch {
        result.failureCode = "first_attachment_prompt_rejected";
        throw Object.assign(new Error(), { code: "first_attachment_prompt_rejected" });
      }
      if (!checks.promptAdmissionSawExactFileURIsAndControlText)
        throw Object.assign(new Error(), { code: "prompt_admission_mismatch" });
      const liveHeader = liveUserHeaders.length === 1 ? liveUserHeaders[0] : undefined;
      const liveParts = liveUserParts.filter((part) => part.messageID === liveHeader?.id);
      checks.liveUserPublishedBeforeHistoryRead =
        liveHeader !== undefined &&
        liveParts.filter((part) => part.type === "text" && part.text === "Keep this control text exactly.").length ===
          1 &&
        liveParts.filter((part) => part.type === "file").length === 2 &&
        liveParts[1]?.url === textURI &&
        liveParts[1]?.filename === "naïve #1?%.txt" &&
        liveParts[1]?.mime === "text/plain" &&
        liveParts[2]?.url === imageURI &&
        liveParts[2]?.filename === "tiny image.png" &&
        liveParts[2]?.mime === "image/png";
      if (!checks.liveUserPublishedBeforeHistoryRead)
        throw Object.assign(new Error(), { code: "attachment_contract_mismatch" });
      let messages: Awaited<ReturnType<OpenCodeAgent["getMessages"]>> = [];
      let completed = false;
      while (result.counts.sourcePolls < 8 && Date.now() < deadline && !abort.signal.aborted && !runtimeFailureCode) {
        result.counts.sourcePolls += 1;
        messages = await agent.getMessages(sessionID);
        completed =
          busy &&
          idle &&
          modelVerified &&
          messages.some(
            (message) =>
              message.info.role === "assistant" &&
              typeof message.info.time.completed === "number" &&
              message.parts.some((part) => part.type === "text" && part.text === answerText),
          );
        if (completed) break;
        if (result.counts.sourcePolls < 8) await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
      }
      if (!completed) throw Object.assign(new Error(), { code: runtimeFailureCode ?? "source_poll_timeout" });
      const user = messages.filter((message) => message.info.role === "user");
      const fileParts = user.flatMap((message) => message.parts.filter((part) => part.type === "file"));
      const nativeHistory = nativeHistoryAttachments(sourceHistoryEnvelope, [
        { uri: textURI, name: "naïve #1?%.txt", mime: "text/plain", data: Buffer.from(textContent) },
        { uri: imageURI, name: "tiny image.png", mime: "image/png", data: imageBytes },
      ]);
      checks.nativeHistoryContainsBothExactFileAttachments = nativeHistory.ok && historyRouteObserved;
      checks.mappedHistoryRoundTripsBothAttachmentsAndControlText =
        nativeHistory.ok &&
        nativeHistory.imageDataURL === imageDataURL &&
        user.length === 1 &&
        user[0]!.parts.some((part) => part.type === "text" && part.text === "Keep this control text exactly.") &&
        fileParts.length === 2 &&
        fileParts[0]!.type === "file" &&
        fileParts[0]!.url === textURI &&
        fileParts[0]!.filename === "naïve #1?%.txt" &&
        fileParts[0]!.mime === "text/plain" &&
        fileParts[1]!.type === "file" &&
        fileParts[1]!.url === imageURI &&
        fileParts[1]!.filename === "tiny image.png" &&
        fileParts[1]!.mime === "image/png";
      const nativeUsers =
        isRecord(sourceHistoryEnvelope) && Array.isArray(sourceHistoryEnvelope.data)
          ? sourceHistoryEnvelope.data.filter((message) => isRecord(message) && message.type === "user")
          : [];
      const nativeUser = nativeUsers.length === 1 ? nativeUsers[0] : undefined;
      const mappedUser = user.length === 1 ? user[0] : undefined;
      const mappedUserParts = mappedUser?.parts.filter((part) => part.type === "text" || part.type === "file") ?? [];
      const nativeCreated = isRecord(nativeUser) && isRecord(nativeUser.time) ? nativeUser.time.created : undefined;
      const parityMatches: LiveUserParityDiagnostics["matches"] = {
        liveHeaderPresent: liveHeader !== undefined,
        singleNativeUser: nativeUser !== undefined,
        admissionMessageID: liveHeader !== undefined && nativeUser !== undefined && liveHeader.id === nativeUser.id,
        createdTimestamp: liveHeader !== undefined && liveHeader.created === nativeCreated,
        liveHeaderCount: liveUserHeaders.length === user.length,
        mappedMessageID: liveHeader !== undefined && mappedUser !== undefined && mappedUser.info.id === liveHeader.id,
        partCount: liveParts.length === mappedUserParts.length,
        partTypes:
          liveParts.length === mappedUserParts.length &&
          liveParts.every((part, index) => mappedUserParts[index]?.type === part.type),
        partIDs:
          liveParts.length === mappedUserParts.length &&
          liveParts.every((part, index) => mappedUserParts[index]?.id === part.id),
        copyableText:
          liveParts.length === mappedUserParts.length &&
          liveParts.every((part, index) => {
            const mapped = mappedUserParts[index];
            return mapped?.type === "text" && part.type === "text" ? mapped.text === part.text : true;
          }) &&
          liveParts.some((part) => part.type === "text") &&
          mappedUserParts.some((part) => part.type === "text"),
        attachmentURLs:
          liveParts.length === mappedUserParts.length &&
          liveParts.every((part, index) => {
            const mapped = mappedUserParts[index];
            return mapped?.type === "file" && part.type === "file" ? mapped.url === part.url : true;
          }),
        attachmentNames:
          liveParts.length === mappedUserParts.length &&
          liveParts.every((part, index) => {
            const mapped = mappedUserParts[index];
            return mapped?.type === "file" && part.type === "file" ? mapped.filename === part.filename : true;
          }),
        attachmentMimes:
          liveParts.length === mappedUserParts.length &&
          liveParts.every((part, index) => {
            const mapped = mappedUserParts[index];
            return mapped?.type === "file" && part.type === "file" ? mapped.mime === part.mime : true;
          }),
      };
      result.liveUserParity = {
        counts: {
          liveHeaders: Math.min(liveUserHeaders.length, 64),
          nativeUsers: Math.min(nativeUsers.length, 64),
          mappedUsers: Math.min(user.length, 64),
          liveParts: Math.min(liveParts.length, 64),
          mappedParts: Math.min(mappedUserParts.length, 64),
        },
        matches: parityMatches,
      };
      // Native admission carries its inbox-created time; projected history is authoritative after promotion.
      // Preserve message/part identity, but allow the same native message to acquire its history timestamp.
      checks.liveUserMatchesReloadedHistory =
        parityMatches.liveHeaderPresent &&
        parityMatches.singleNativeUser &&
        parityMatches.admissionMessageID &&
        parityMatches.liveHeaderCount &&
        parityMatches.mappedMessageID &&
        parityMatches.partCount &&
        Object.entries(parityMatches)
          .filter(([name]) => name !== "createdTimestamp")
          .every(([, matches]) => matches);
      checks.singleModelRequestHadExactNativeTextAndImage =
        result.counts.modelRequests === 1 &&
        modelVerified &&
        imageDataURL !== undefined &&
        nativeHistory.imageDataURL === imageDataURL;
      checks.sessionBusyThenIdleAndKnownAnswer =
        busy &&
        idle &&
        completed &&
        messages.some(
          (message) =>
            message.info.role === "assistant" &&
            typeof message.info.time.completed === "number" &&
            message.parts.some((part) => part.type === "text" && part.text === answerText),
        );
      if (
        !checks.mappedHistoryRoundTripsBothAttachmentsAndControlText ||
        !checks.liveUserMatchesReloadedHistory ||
        !checks.sessionBusyThenIdleAndKnownAnswer
      )
        throw Object.assign(new Error(), { code: "attachment_contract_mismatch" });
      const beforeMissing = JSON.stringify(await agent.getMessages(sessionID));
      const nativeBeforeMissing = JSON.stringify(sourceHistoryEnvelope);
      let missingRejected = false;
      result.counts.promptAttempts = 2;
      try {
        await agent.sendMessage(sessionID, "This must not be admitted.", {
          files: [{ filePath: "missing attachment.txt", fileName: "missing attachment.txt" }],
        });
      } catch {
        missingRejected = true;
      }
      const sessionBarrier = await agent.getSession(sessionID);
      const afterMissing = await agent.getMessages(sessionID);
      checks.missingFileRejectedBeforeModelAndHistoryMutation =
        missingRejected &&
        sessionBarrier.id === sessionID &&
        result.counts.modelRequests === 1 &&
        JSON.stringify(afterMissing) === beforeMissing &&
        JSON.stringify(sourceHistoryEnvelope) === nativeBeforeMissing;
      if (!checks.missingFileRejectedBeforeModelAndHistoryMutation)
        throw Object.assign(new Error(), { code: "missing_file_was_admitted" });
      checks.boundsRespected =
        result.counts.apiRequests <= apiLimit &&
        result.counts.modelRequests === 1 &&
        result.counts.sessions === 1 &&
        result.counts.promptAttempts === 2 &&
        result.counts.maxRequestBytes <= maxRequestBytes &&
        result.counts.sourcePolls <= 8 &&
        Date.now() <= deadline;
      result.status = Object.values(checks).every(Boolean) ? "RUNNING" : "FAIL";
    } catch (error) {
      result.failureCode = runtimeFailureCode ?? result.failureCode ?? safeFailureCode(error);
      result.status = [
        "dedicated_fork_required",
        "executable_required",
        "executable_unavailable",
        "ambient_gate_blocked",
        "pinned_executable_mismatch",
        "client_version_mismatch",
        "native_version_mismatch",
      ].includes(result.failureCode)
        ? "BLOCKED"
        : "FAIL";
    } finally {
      result.preTeardown = {
        status: result.status,
        counts: { ...result.counts },
        checks: { ...checks },
        ...(result.liveUserParity ? { liveUserParity: result.liveUserParity } : {}),
        ...(result.failureCode ? { failureCode: result.failureCode } : {}),
      };
      await persist().catch(() => {
        result.status = "FAIL";
        result.failureCode = "fixture_operation_failed";
      });
      if (agent) {
        try {
          agent.disconnect();
          const cleanup = (agent as unknown as { cleanupPromise?: Promise<void> }).cleanupPromise;
          if (cleanup) {
            await bounded(cleanup, cleanupMs);
            result.cleanup.agentCleanup = true;
          }
        } catch {
          result.cleanup.agentCleanup = false;
        }
      }
      const processGroup = pid === undefined ? { gone: false, graceful: false } : await groupGone(pid);
      result.cleanup.processGroupGone = processGroup.gone && processGroup.graceful;
      if (fixture) {
        try {
          fixture.closeAllConnections();
          await bounded(new Promise<void>((resolveClose) => fixture?.close(() => resolveClose())), 1_000);
          result.cleanup.fixtureClosed = true;
        } catch {
          result.cleanup.fixtureClosed = false;
        }
      }
      globalThis.fetch = originalFetch;
      result.cleanup.fetchRestored = globalThis.fetch === originalFetch;
      if (isolation) {
        try {
          await isolation.dispose();
          owners.delete(isolation);
          result.cleanup.isolationRemoved = true;
        } catch {
          result.cleanup.isolationRemoved = false;
        }
        const absent = async (path: string) => {
          try {
            await access(path);
            return false;
          } catch (error) {
            return (error as NodeJS.ErrnoException).code === "ENOENT";
          }
        };
        result.cleanup.stateAbsent = await absent(isolation.paths.state);
        result.cleanup.databaseAbsent = await absent(isolation.paths.database);
      }
      if (envReplaced) {
        for (const key of Object.keys(process.env)) delete process.env[key];
        Object.assign(process.env, originalEnvironment);
        result.cleanup.environmentRestored =
          Object.keys(process.env).length === Object.keys(originalEnvironment).length &&
          Object.entries(originalEnvironment).every(([key, value]) => process.env[key] === value);
      }
      clearTimeout(deadlineTimer);
      result.status =
        result.status === "RUNNING" &&
        Object.values(checks).every(Boolean) &&
        Object.values(result.cleanup).every(Boolean)
          ? "PASS"
          : result.status === "BLOCKED"
            ? "BLOCKED"
            : "FAIL";
      if (result.status !== "PASS" && !result.failureCode) result.failureCode = "fixture_operation_failed";
      await persist();
    }
    const persisted = JSON.parse(await readFile(resultPath, "utf8")) as Result;
    expect(persisted.status).toBe("PASS");
    expect(Object.keys(persisted.checks).sort()).toEqual([...checksList].sort());
    expect(Object.values(persisted.checks).every(Boolean)).toBe(true);
    expect(persisted.counts).toMatchObject({ modelRequests: 1, sessions: 1, promptAttempts: 2 });
    expect(persisted.bounds).toMatchObject({
      overallMs: 60_000,
      apiRequests: 30,
      modelRequests: 1,
      sessions: 1,
      children: 1,
      promptAttempts: 2,
      maxRequestBytes: 64 * 1024,
      files: 2,
      sourcePolls: 8,
      sourcePollIntervalMs: 250,
    });
    expect(persisted.executableSha256).toBe(expectedHash);
  },
  timeoutMs + cleanupMs + 5_000,
);
