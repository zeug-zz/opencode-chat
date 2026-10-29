import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { createServer, type Server, type ServerResponse } from "node:http";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentEvent, ChatMessageWithParts } from "@opencode-chat/core";
import { afterEach, describe, expect, it } from "vitest";
import { OpenCodeAgent } from "../opencode-agent.js";
import {
  assertIsolatedEnvironment,
  assertOwnedPath,
  createV2TestIsolation,
  evaluateStaticPrelaunchGate,
  inspectAmbientConfigSources,
  type V2TestIsolation,
} from "./v2-test-isolation.js";

const PROJECT_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));
const RUN_ENABLED = process.env.OPENCODE_CHAT_RUN_V2_ADAPTER === "1";
const EXECUTABLE_INPUT = process.env.OPENCODE_CHAT_V2_SPIKE_EXECUTABLE;
const EXPECTED_VERSION = "2.2.0";
const OVERALL_TIMEOUT_MS = 90_000;
// Fixture headroom for bounded readiness/history polling variance between runs; not a product limit.
const MAX_API_REQUESTS = 80;
const MAX_MODEL_REQUESTS = 4;
const MAX_SESSIONS = 1;
const FIXTURE_ANSWER = "fixture reconnect answer";
const BRIEF_A = "fixture reasoning <brief> & A";
const BRIEF_B = "fixture reasoning <brief> & B";
const FIRST_CONTROL = "fixture first control";
const STALL_CONTROL = "fixture stall control";
const THIRD_CONTROL = "fixture queued control";
const FOURTH_CONTROL = "fixture removal control";
const OWNER_RUNS = new Set<V2TestIsolation>();
const ORIGINAL_FETCH = globalThis.fetch;

type Status = "RUNNING" | "PASS" | "FAIL" | "BLOCKED";
type Manifest = {
  schemaVersion: 1;
  runId: string;
  status: Status;
  qualification: "PRODUCTION_ADAPTER_PRIVATE_SERVER_NATIVE_HTTP_FIXTURE";
  expectedVersion: string;
  observedVersion?: string;
  sourceCommit: "bb25a2f4a3f3f04d7c344bec0c0574ea3510b3b1";
  sourceCommitMeaning: "inspected-release-tag";
  executableSha256: string | null;
  executablePath: string | null;
  clientPackage: "@opencode/client@2.1.0";
  checks: Record<string, boolean>;
  counts: { apiRequests: number; modelRequests: number; sessions: number };
  apiOperations: Record<string, number>;
  promptAdmissions: number;
  snapshotReadsAfterReconnect: number;
  nativeSessionOutcomes: Array<"succeeded" | "failed" | "interrupted">;
  nativeSessionObservationCounts: {
    pathMatched: number;
    bodyDataRecord: number;
    dataIDMatched: number;
    outcomePresent: number;
    outcomeValidEnum: number;
  };
  terminalObservationPolls: number;
  automaticRecovery: {
    injectedTransportDrops: number;
    eventRequestsBeforeDrop: number;
    eventRequestsAfterDrop: number;
    serverConnectedMarkersAfterDrop: number;
    snapshotReadsAfterMarker: number;
    sameOwnedChildPID: boolean | null;
  };
  duplicateFrameInjection: {
    textDelta: Omit<InjectedDuplicate, "fingerprint"> | null;
    terminal: Omit<InjectedDuplicate, "fingerprint"> | null;
    distinctTextDeltaFrames: number;
    textDeltaFramesWithoutID: number;
    distinctIdleFrames: number;
    idleFramesWithoutID: number;
    listenerFailureDiagnostics: number;
  };
  terminalDelivery: TerminalDeliveryDiagnostics;
  bounds: { maxApiRequests: number; maxModelRequests: number; maxSessions: number; overallMs: number };
  fixtureRoot: string | null;
  statePath: string | null;
  evidencePath: string;
  cleanup: { agentDisconnected: boolean; ownedProcessGroupReaped: boolean | null; fixtureStateRemoved: boolean | null };
  failureCode?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type NativeSessionOutcome = "succeeded" | "failed" | "interrupted";

type SessionInfoObservation = {
  dataRecord: boolean;
  dataIDMatched: boolean;
  outcomePresent: boolean;
  outcome?: NativeSessionOutcome;
};

type PromptContextRoute = "list" | "put" | "remove" | "wait" | "other";

function nativeInstructionRoute(
  method: string,
  pathname: string,
): { kind: "list" | "put" | "remove"; sessionID: string; key?: string } | undefined {
  const match = /^\/api\/experimental\/session\/([^/]+)\/instructions\/entries(?:\/([^/]+))?$/u.exec(pathname);
  if (!match) return undefined;
  let sessionID: string;
  let key: string | undefined;
  try {
    sessionID = decodeURIComponent(match[1]);
    key = match[2] === undefined ? undefined : decodeURIComponent(match[2]);
  } catch {
    return undefined;
  }
  if (method === "GET" && key === undefined) return { kind: "list", sessionID };
  if (method === "PUT" && key !== undefined) return { kind: "put", sessionID, key };
  if (method === "DELETE" && key !== undefined) return { kind: "remove", sessionID, key };
  return undefined;
}

function observeOwnedApiOrigin(
  responseURL: string,
  requestURL: string,
  status: number,
  body: unknown,
  expectedVersion: string,
): { origin: string; pid: number; version: string } | undefined {
  if (status < 200 || status >= 300 || !isRecord(body)) return undefined;
  if (
    body.version !== expectedVersion ||
    typeof body.pid !== "number" ||
    !Number.isSafeInteger(body.pid) ||
    body.pid <= 0
  )
    return undefined;
  try {
    const url = new URL(responseURL);
    const requested = new URL(requestURL);
    if (
      url.protocol !== "http:" ||
      url.username !== "" ||
      url.password !== "" ||
      !["127.0.0.1", "localhost", "[::1]", "::1"].includes(url.hostname) ||
      !url.port ||
      url.pathname !== "/api/info" ||
      url.search !== "" ||
      url.hash !== "" ||
      requested.pathname !== "/api/info" ||
      requested.origin !== url.origin ||
      requested.protocol !== "http:"
    )
      return undefined;
    return { origin: url.origin, pid: body.pid, version: body.version };
  } catch {
    return undefined;
  }
}

function isOwnedInstructionObserverResponse(responseURL: string, origin: string, pathname: string): boolean {
  try {
    const response = new URL(responseURL);
    return (
      response.origin === origin && response.pathname === pathname && response.search === "" && response.hash === ""
    );
  } catch {
    return false;
  }
}

function observePromptContextRoute(method: string, pathname: string): PromptContextRoute {
  const route = nativeInstructionRoute(method, pathname);
  if (route?.kind === "list") return "list";
  if (route?.kind === "put" && route.key === "scribe.prompt-context") return "put";
  if (route?.kind === "remove" && route.key === "scribe.prompt-context") return "remove";
  if (method === "POST" && /^\/api\/experimental\/session\/[^/]+\/wait$/u.test(pathname)) return "wait";
  return "other";
}

function contentText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.flatMap((part) => (isRecord(part) && typeof part.text === "string" ? [part.text] : [])).join("\n");
}

function observePromptAdmission(body: unknown): string | undefined {
  return isRecord(body) && typeof body.text === "string" ? body.text : undefined;
}

function observeFixtureRequestBody(body: unknown): { messages: Array<{ role: string; content: string }> } | undefined {
  if (!isRecord(body) || !Array.isArray(body.messages)) return undefined;
  const messages = body.messages.flatMap((message) => {
    if (!isRecord(message) || typeof message.role !== "string") return [];
    return [{ role: message.role, content: contentText(message.content) }];
  });
  return { messages };
}

function escapeXmlText(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function expectedSystemUpdate(brief: string | undefined): string {
  const narration =
    brief === undefined
      ? 'The context under "scribe.prompt-context" no longer applies. Disregard it.'
      : `The context under "scribe.prompt-context" changed and supersedes the previous value:\n<context key="scribe.prompt-context">\n${brief}\n</context>`;
  return `<system-update>\n${escapeXmlText(narration)}\n</system-update>`;
}

function removeExpectedTrailingUpdate(content: string, expected: string): string | undefined {
  if (content === expected) return "";
  const suffix = `\n${expected}`;
  if (content.endsWith(suffix)) return content.slice(0, -suffix.length);
}

function observePromptContextStages(requests: Array<ReturnType<typeof observeFixtureRequestBody> | undefined>) {
  const controls = [FIRST_CONTROL, STALL_CONTROL, THIRD_CONTROL, FOURTH_CONTROL];
  const initialA = `<context key="scribe.prompt-context">\n${BRIEF_A}\n</context>`;
  const initialB = `<context key="scribe.prompt-context">\n${BRIEF_B}\n</context>`;
  const supersession = expectedSystemUpdate(BRIEF_B);
  const removal = expectedSystemUpdate(undefined);
  const stages = requests.map((request, index) => {
    const messages = request?.messages ?? [];
    const allowedUpdates = index === 2 ? [supersession] : index === 3 ? [supersession, removal] : [];
    const tokens = messages.flatMap((message) => {
      if (message.role !== "user") return [];
      let content = message.content;
      const trailingUpdates: string[] = [];
      for (const allowedUpdate of [...allowedUpdates].reverse()) {
        const stripped = removeExpectedTrailingUpdate(content, allowedUpdate);
        if (stripped !== undefined) {
          content = stripped;
          trailingUpdates.unshift(allowedUpdate);
        }
      }
      return [...(content === "" ? [] : [content]), ...trailingUpdates];
    });
    const allowedUpdateCounts = allowedUpdates.map(
      (allowedUpdate) =>
        messages.filter((message) => message.role === "user" && message.content.includes(allowedUpdate)).length,
    );
    const allExpectedUpdateOccurrences = messages.reduce(
      (count, message) => count + (message.content.match(/<system-update>/gu)?.length ?? 0),
      0,
    );
    const systemContextIndex = messages.findIndex(
      (message) => message.role === "system" && message.content.includes(initialA),
    );
    const expectedTokens = [...controls.slice(0, index + 1)];
    if (index >= 2) expectedTokens.splice(2, 0, supersession);
    if (index === 3) expectedTokens.splice(expectedTokens.length - 1, 0, removal);
    return {
      messages,
      tokens,
      systemContextIndex,
      updatePlacementValid:
        allExpectedUpdateOccurrences === allowedUpdateCounts.reduce((sum, count) => sum + count, 0) &&
        messages
          .filter(
            (message) => message.role === "user" && allowedUpdates.some((update) => message.content.includes(update)),
          )
          .every((message) => {
            let remaining = message.content;
            for (const update of [...allowedUpdates].reverse()) {
              remaining = removeExpectedTrailingUpdate(remaining, update) ?? remaining;
            }
            return remaining !== message.content;
          }) &&
        allowedUpdateCounts.every((count) => count === 1) &&
        systemContextIndex >= 0 &&
        messages.filter((message) => message.role === "system").every((message) => !message.content.includes(initialB)),
      expectedTokens,
    };
  });
  const hasExpectedChronology = (index: number) =>
    stages[index].updatePlacementValid && stages[index].tokens.join("\n") === stages[index].expectedTokens.join("\n");
  return {
    allRequestsKeepInitialSystemBriefA: stages.every((stage) => stage.systemContextIndex >= 0),
    noRequestReplacesSystemBaselineWithB: stages.every((stage) =>
      stage.messages
        .filter((message) => message.role === "system")
        .every((message) => !message.content.includes(BRIEF_B)),
    ),
    firstAndSecondControlsExact: hasExpectedChronology(0) && hasExpectedChronology(1),
    thirdHasSupersessionBetweenStallAndThirdControl: hasExpectedChronology(2),
    fourthHasBThenRemovalBetweenThirdAndFourthControl: hasExpectedChronology(3),
    realControlsOnceInOrder: stages.every(
      (stage) =>
        stage.tokens.filter((token) => controls.includes(token)).join("\n") ===
        stage.expectedTokens.filter((token) => controls.includes(token)).join("\n"),
    ),
    exactCurrentControlIsLast: stages.every((stage) => stage.tokens.at(-1) === stage.expectedTokens.at(-1)),
    noBriefWasPastedIntoRealUserControls: stages.every((stage) =>
      stage.tokens.every(
        (token) =>
          token === supersession || token === removal || (!token.includes(BRIEF_A) && !token.includes(BRIEF_B)),
      ),
    ),
    wrappersOnlyAtExpectedStage: stages.every((stage) => stage.updatePlacementValid),
  };
}

describe("normal prompt-context native route observation", () => {
  it("accepts only fixed user controls in native prompt admissions", () => {
    expect(observePromptAdmission({ text: FIRST_CONTROL })).toBe(FIRST_CONTROL);
    expect(observePromptAdmission({ text: `${FIRST_CONTROL}\n${BRIEF_A}` })).not.toBe(FIRST_CONTROL);
    expect(observePromptAdmission({ text: expectedSystemUpdate(BRIEF_B) })).not.toBe(THIRD_CONTROL);
    expect(observePromptAdmission({ text: 1 })).toBeUndefined();
  });

  it.each([
    ["GET", "/api/experimental/session/s1/instructions/entries", "list"],
    ["PUT", "/api/experimental/session/s1/instructions/entries/scribe.prompt-context", "put"],
    ["DELETE", "/api/experimental/session/s1/instructions/entries/scribe.prompt-context", "remove"],
    ["POST", "/api/experimental/session/s1/wait", "wait"],
    ["PUT", "/api/experimental/session/s1/instructions/entries/user.reference", "other"],
    ["GET", "/api/session/s1/instructions/entries", "other"],
    ["PUT", "/api/experimental/session/s1/instructions/entries/", "other"],
    ["GET", "/api/experimental/session/s1/instructions/entries/%", "other"],
    ["PUT", "/api/experimental/session/s1/instructions/entries/user.reference", "other"],
  ] as const)("classifies only exact native route shapes (%s %s)", (method, path, expected) => {
    expect(observePromptContextRoute(method, path)).toBe(expected);
  });

  it("rejects malformed route encodings and role-negative keys", () => {
    expect(nativeInstructionRoute("GET", "/api/experimental/session/s1/instructions/entries/%")).toBeUndefined();
    expect(nativeInstructionRoute("PUT", "/api/experimental/session/s1/instructions/entries/user.reference")).toEqual({
      kind: "put",
      sessionID: "s1",
      key: "user.reference",
    });
    expect(
      nativeInstructionRoute("DELETE", "/api/experimental/session/s1/instructions/entries/scribe.prompt-context"),
    ).toEqual({ kind: "remove", sessionID: "s1", key: "scribe.prompt-context" });
  });

  it("binds authenticated observation only to successful owned loopback info responses", () => {
    const info = { version: EXPECTED_VERSION, pid: 123 };
    const ownedInfoURL = "http://127.0.0.1:43123/api/info";
    expect(observeOwnedApiOrigin(ownedInfoURL, ownedInfoURL, 200, info, EXPECTED_VERSION)).toEqual({
      origin: "http://127.0.0.1:43123",
      pid: 123,
      version: EXPECTED_VERSION,
    });
    expect(observeOwnedApiOrigin(ownedInfoURL, ownedInfoURL, 500, info, EXPECTED_VERSION)).toBeUndefined();
    expect(
      observeOwnedApiOrigin(
        "http://example.test:43123/api/info",
        "http://example.test:43123/api/info",
        200,
        info,
        EXPECTED_VERSION,
      ),
    ).toBeUndefined();
    expect(
      observeOwnedApiOrigin("http://127.0.0.1:43123/v1/chat/completions", ownedInfoURL, 200, info, EXPECTED_VERSION),
    ).toBeUndefined();
    expect(
      observeOwnedApiOrigin("http://127.0.0.1:43124/api/info", ownedInfoURL, 200, info, EXPECTED_VERSION),
    ).toBeUndefined();
    expect(
      observeOwnedApiOrigin(
        "http://user:pass@127.0.0.1:43123/api/info",
        "http://user:pass@127.0.0.1:43123/api/info",
        200,
        info,
        EXPECTED_VERSION,
      ),
    ).toBeUndefined();
    expect(
      observeOwnedApiOrigin(
        "https://127.0.0.1:43123/api/info",
        "https://127.0.0.1:43123/api/info",
        200,
        info,
        EXPECTED_VERSION,
      ),
    ).toBeUndefined();
    expect(
      observeOwnedApiOrigin(ownedInfoURL, ownedInfoURL, 200, { ...info, version: "other" }, EXPECTED_VERSION),
    ).toBeUndefined();
    expect(
      observeOwnedApiOrigin(ownedInfoURL, ownedInfoURL, 200, { version: EXPECTED_VERSION }, EXPECTED_VERSION),
    ).toBeUndefined();
    const instructionListURL = "http://127.0.0.1:43123/api/experimental/session/s1/instructions/entries";
    expect(
      isOwnedInstructionObserverResponse(
        instructionListURL,
        "http://127.0.0.1:43123",
        new URL(instructionListURL).pathname,
      ),
    ).toBe(true);
    expect(
      isOwnedInstructionObserverResponse(
        "http://127.0.0.1:43124/api/experimental/session/s1/instructions/entries",
        "http://127.0.0.1:43123",
        new URL(instructionListURL).pathname,
      ),
    ).toBe(false);
    expect(
      isOwnedInstructionObserverResponse(
        "http://127.0.0.1:43123/api/session/s1/instructions/entries",
        "http://127.0.0.1:43123",
        new URL(instructionListURL).pathname,
      ),
    ).toBe(false);
  });

  it("retains only structurally valid model messages in memory for assertions", () => {
    expect(
      observeFixtureRequestBody({
        messages: [
          { role: "system", content: "brief-A" },
          { role: "user", content: "control" },
        ],
      }),
    ).toEqual({
      messages: [
        { role: "system", content: "brief-A" },
        { role: "user", content: "control" },
      ],
    });
    expect(observeFixtureRequestBody({ messages: [{ role: 1, content: "bad" }, null] })).toEqual({ messages: [] });
    expect(observeFixtureRequestBody({ messages: "bad" })).toBeUndefined();
  });

  it("asserts the four prompt-context stages and rejects guessed or reordered narration", () => {
    const observed = (messages: Array<{ role: string; content: string }>) => ({ messages });
    const initialA = `<context key="scribe.prompt-context">\n${BRIEF_A}\n</context>`;
    const initialB = `<context key="scribe.prompt-context">\n${BRIEF_B}\n</context>`;
    type Message = { role: string; content: string };
    const base: Message[][] = [
      [
        { role: "system", content: initialA },
        { role: "user", content: FIRST_CONTROL },
      ],
      [
        { role: "system", content: initialA },
        { role: "user", content: FIRST_CONTROL },
        { role: "user", content: STALL_CONTROL },
      ],
      [
        { role: "system", content: initialA },
        { role: "user", content: FIRST_CONTROL },
        { role: "user", content: `${STALL_CONTROL}\n${expectedSystemUpdate(BRIEF_B)}` },
        { role: "user", content: THIRD_CONTROL },
      ],
      [
        { role: "system", content: initialA },
        { role: "user", content: FIRST_CONTROL },
        { role: "user", content: `${STALL_CONTROL}\n${expectedSystemUpdate(BRIEF_B)}` },
        {
          role: "user",
          content: `${THIRD_CONTROL}\n${expectedSystemUpdate(undefined)}`,
        },
        { role: "user", content: FOURTH_CONTROL },
      ],
    ];
    const check = (stages: Message[][]) => observePromptContextStages(stages.map(observed));
    const clone = () => base.map((stage) => stage.map((message) => ({ ...message })));
    const valid = check(clone());
    expect(Object.values(valid).every(Boolean)).toBe(true);

    const separate = clone();
    separate[2] = [
      { role: "system", content: initialA },
      { role: "user", content: FIRST_CONTROL },
      { role: "user", content: STALL_CONTROL },
      { role: "user", content: expectedSystemUpdate(BRIEF_B) },
      { role: "user", content: THIRD_CONTROL },
    ];
    expect(Object.values(check(separate)).every(Boolean)).toBe(true);

    const negatives: Array<(stages: Message[][]) => void> = [
      (stages) => {
        stages[3] = stages[3].filter((message) => message.role !== "system");
      },
      (stages) => {
        stages[3][0].content = initialB;
      },
      (stages) => {
        stages[2][2].content = `${STALL_CONTROL}\n${expectedSystemUpdate(BRIEF_B).replace("&lt;context", "<context")}`;
      },
      (stages) => {
        stages[2][2].role = "assistant";
      },
      (stages) => {
        stages[1].push({ role: "user", content: expectedSystemUpdate(BRIEF_B) });
      },
      (stages) => {
        stages[2][2].content = `${STALL_CONTROL}\n<system-update>unrecognized update</system-update>`;
      },
      (stages) => {
        stages[2][2].content += `\n${expectedSystemUpdate(BRIEF_B)}`;
      },
      (stages) => {
        [stages[3][3], stages[3][4]] = [stages[3][4], stages[3][3]];
      },
      (stages) => {
        stages[3][3].content = `${THIRD_CONTROL}\n${expectedSystemUpdate(undefined)}\n${expectedSystemUpdate(BRIEF_B)}`;
      },
      (stages) => {
        stages[2][2].content = `${expectedSystemUpdate(BRIEF_B)}\n${STALL_CONTROL}`;
      },
      (stages) => {
        stages[2][3].content = `${THIRD_CONTROL}\n${expectedSystemUpdate(BRIEF_B)}`;
      },
      (stages) => {
        stages[2].push({ role: "user", content: BRIEF_A });
      },
      (stages) => {
        stages[2][3].content += ` ${BRIEF_B}`;
      },
      (stages) => {
        stages[2] = stages[2].filter((message) => message.content !== THIRD_CONTROL);
      },
      (stages) => {
        stages[2][3].content = `${THIRD_CONTROL}!`;
      },
      (stages) => {
        stages[2].push({ role: "user", content: THIRD_CONTROL });
      },
      (stages) => {
        stages[2].splice(1, 2, stages[2][2], stages[2][1]);
      },
    ];
    for (const mutate of negatives) {
      const stages = clone();
      mutate(stages);
      expect(Object.values(check(stages)).every(Boolean)).toBe(false);
    }
  });
});

function observeOwnedSessionInfo(response: unknown, expectedSessionID: string): SessionInfoObservation {
  if (!isRecord(response) || !isRecord(response.data)) {
    return { dataRecord: false, dataIDMatched: false, outcomePresent: false };
  }
  const data = response.data;
  const dataIDMatched = data.id === expectedSessionID;
  const outcomePresent = Object.hasOwn(data, "outcome");
  const outcome = data.outcome;
  const validOutcome =
    outcome === "succeeded" || outcome === "failed" || outcome === "interrupted" ? outcome : undefined;
  return {
    dataRecord: true,
    dataIDMatched,
    outcomePresent,
    ...(dataIDMatched && validOutcome ? { outcome: validOutcome } : {}),
  };
}

describe("native session GET outcome observation", () => {
  it("accepts only an allowlisted outcome from the owned session data envelope", () => {
    expect(
      observeOwnedSessionInfo({ data: { id: "fixture-session", outcome: "interrupted" } }, "fixture-session"),
    ).toEqual({ dataRecord: true, dataIDMatched: true, outcomePresent: true, outcome: "interrupted" });
  });

  it("rejects a plain session record rather than guessing a response shape", () => {
    expect(observeOwnedSessionInfo({ id: "fixture-session", outcome: "interrupted" }, "fixture-session")).toEqual({
      dataRecord: false,
      dataIDMatched: false,
      outcomePresent: false,
    });
  });

  it("does not retain outcomes when the enveloped session identity differs", () => {
    expect(
      observeOwnedSessionInfo({ data: { id: "foreign-session", outcome: "interrupted" } }, "fixture-session"),
    ).toEqual({ dataRecord: true, dataIDMatched: false, outcomePresent: true });
  });

  it("rejects missing or unknown outcomes in the native envelope", () => {
    expect(observeOwnedSessionInfo({ data: { id: "fixture-session" } }, "fixture-session")).toEqual({
      dataRecord: true,
      dataIDMatched: true,
      outcomePresent: false,
    });
    expect(observeOwnedSessionInfo({ data: { id: "fixture-session", outcome: "running" } }, "fixture-session")).toEqual(
      { dataRecord: true, dataIDMatched: true, outcomePresent: true },
    );
  });
});

type DuplicateKind = "textDelta" | "terminal";

type NativeFrame = {
  type: string;
  id?: string;
  sessionID?: string;
  delta?: string;
  status?: "busy" | "idle";
};

type InjectedDuplicate = {
  type: string;
  hasNativeEventID: boolean;
  frameBytes: number;
  fingerprint: string;
  emitted: number;
  readByAdapter: number;
  alteredRejected: number;
};

type DuplicateLedger = {
  /** Closes everything once the terminal checks have been evaluated. */
  closed: boolean;
  /**
   * Set at the terminal snapshot: idle frames teed afterwards are counted for diagnostics only
   * and are excluded from `idleFrameIDs`, so the ledger side of the check is fixed at the snapshot.
   */
  idleFrozen: boolean;
  /** Closes text-delta selection and counting at the explicit resubscribe; the terminal stays open. */
  deltaWindowClosed: boolean;
  injected: Partial<Record<DuplicateKind, InjectedDuplicate>>;
  distinctTextDeltaIDs: Set<string>;
  textDeltaFramesWithoutID: number;
  idleFrameIDs: Set<string>;
  idleFramesWithoutID: number;
  /** Idle frame IDs seen by the tee before / after the explicit resubscribe (`deltaWindowClosed`). */
  idleFrameIDsPreResubscribe: Set<string>;
  idleFrameIDsPostResubscribe: Set<string>;
  /** Idle frame IDs seen by the tee after the terminal checks were evaluated (`closed`). */
  idleFrameIDsAfterClose: Set<string>;
  /** Counted idle frame ID -> number of the /api/event connection that carried it (1-based). */
  idleFrameStreams: Map<string, number>;
  /**
   * Set at the explicit resubscribe: connections numbered up to this value are retired (the
   * adapter bumped its stream generation and drops anything still in flight on them). Unset
   * means no connection has been retired yet.
   */
  retiredStreamCeiling: number | undefined;
};

const MAX_FIXTURE_NATIVE_EVENT_ID_LENGTH = 1024;

function newDuplicateLedger(): DuplicateLedger {
  return {
    closed: false,
    idleFrozen: false,
    deltaWindowClosed: false,
    injected: {},
    distinctTextDeltaIDs: new Set(),
    textDeltaFramesWithoutID: 0,
    idleFrameIDs: new Set(),
    idleFramesWithoutID: 0,
    idleFrameIDsPreResubscribe: new Set(),
    idleFrameIDsPostResubscribe: new Set(),
    idleFrameIDsAfterClose: new Set(),
    idleFrameStreams: new Map(),
    retiredStreamCeiling: undefined,
  };
}

/** Counted idle frames split by whether their connection was retired by the explicit resubscribe. */
function idleFramesByStreamState(ledger: DuplicateLedger): { retired: number; current: number } {
  const ceiling = ledger.retiredStreamCeiling;
  let retired = 0;
  for (const stream of ledger.idleFrameStreams.values()) if (ceiling !== undefined && stream <= ceiling) retired += 1;
  return { retired, current: ledger.idleFrameStreams.size - retired };
}

function frameFingerprint(block: string): string {
  return createHash("sha256").update(block).digest("hex");
}

/** Parses one LF-delimited SSE block the way the generated client does (`data:` lines joined, JSON). */
function observeNativeSseFrame(block: string): NativeFrame | undefined {
  if (block.includes("\r")) return undefined;
  const data = block
    .split("\n")
    .flatMap((line) => (line.startsWith("data:") ? [line.slice(5).trimStart()] : []))
    .join("\n");
  if (data === "") return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || typeof parsed.type !== "string") return undefined;
  const payload = isRecord(parsed.data) ? parsed.data : {};
  const frame: NativeFrame = { type: parsed.type };
  if (typeof parsed.id === "string" && parsed.id.length > 0 && parsed.id.length <= MAX_FIXTURE_NATIVE_EVENT_ID_LENGTH) {
    frame.id = parsed.id;
  }
  if (typeof payload.sessionID === "string") frame.sessionID = payload.sessionID;
  if (parsed.type === "session.text.delta" && typeof payload.delta === "string") frame.delta = payload.delta;
  if (
    parsed.type === "session.execution.succeeded" ||
    parsed.type === "session.execution.interrupted" ||
    parsed.type === "session.execution.failed"
  ) {
    frame.status = "idle";
  } else if (parsed.type === "session.execution.started") {
    frame.status = "busy";
  } else if (
    parsed.type === "session.status" &&
    isRecord(payload.status) &&
    (payload.status.type === "busy" || payload.status.type === "idle")
  ) {
    frame.status = payload.status.type;
  }
  return frame;
}

/**
 * Records the observed native frame and decides whether to re-deliver exactly this
 * already-sent block once. At most one text-delta frame (the first non-empty delta of the
 * owned session) and one terminal frame (the first execution.succeeded or .interrupted after
 * it, on whichever /api/event stream carries it) are chosen. The native server publishes one
 * terminal frame per busy period, and a prompt admitted while the session is busy joins that
 * period, so the terminal frame may only arrive after a later turn is aborted.
 */
function planNativeFrameDuplicate(
  ledger: DuplicateLedger,
  block: string,
  ownedSessionID: string | undefined,
  streamNumber = 1,
): DuplicateKind | undefined {
  if (ownedSessionID === undefined) return undefined;
  const frame = observeNativeSseFrame(block);
  if (!frame || frame.sessionID !== ownedSessionID) return undefined;
  if (ledger.closed) {
    // Diagnostic only: a terminal frame after evaluation cannot affect the checks.
    if (frame.status === "idle" && frame.id) ledger.idleFrameIDsAfterClose.add(frame.id);
    return undefined;
  }
  if (frame.status === "idle") {
    if (ledger.idleFrozen) {
      if (frame.id) ledger.idleFrameIDsAfterClose.add(frame.id);
      return undefined;
    }
    if (frame.id) {
      ledger.idleFrameIDs.add(frame.id);
      if (!ledger.idleFrameStreams.has(frame.id)) ledger.idleFrameStreams.set(frame.id, streamNumber);
      (ledger.deltaWindowClosed ? ledger.idleFrameIDsPostResubscribe : ledger.idleFrameIDsPreResubscribe).add(frame.id);
    } else ledger.idleFramesWithoutID += 1;
  }
  const choose = (kind: DuplicateKind): DuplicateKind => {
    ledger.injected[kind] = {
      type: frame.type,
      hasNativeEventID: frame.id !== undefined,
      frameBytes: Buffer.byteLength(block),
      fingerprint: frameFingerprint(block),
      emitted: 0,
      readByAdapter: 0,
      alteredRejected: 0,
    };
    return kind;
  };
  if (
    frame.type === "session.text.delta" &&
    frame.delta !== undefined &&
    frame.delta !== "" &&
    !ledger.deltaWindowClosed
  ) {
    if (frame.id) ledger.distinctTextDeltaIDs.add(frame.id);
    else ledger.textDeltaFramesWithoutID += 1;
    if (!ledger.injected.textDelta) return choose("textDelta");
  }
  if (
    (frame.type === "session.execution.succeeded" || frame.type === "session.execution.interrupted") &&
    ledger.injected.textDelta &&
    !ledger.injected.terminal
  ) {
    return choose("terminal");
  }
  return undefined;
}

/** Accepts a re-delivery only when it is byte-identical to the frame the native server sent. */
function recordDuplicateRedelivery(ledger: DuplicateLedger, kind: DuplicateKind, redelivered: string): boolean {
  const injected = ledger.injected[kind];
  if (!injected) return false;
  if (frameFingerprint(redelivered) !== injected.fingerprint) {
    injected.alteredRejected += 1;
    return false;
  }
  injected.emitted += 1;
  return true;
}

function recordDuplicateRead(ledger: DuplicateLedger, kind: DuplicateKind): void {
  const injected = ledger.injected[kind];
  if (injected) injected.readByAdapter += 1;
}

/**
 * Byte-exact SSE tee: every complete `\n\n`-terminated block is forwarded unchanged and, when
 * selected, followed once by an identical copy. Chunk boundaries may differ from the source;
 * block bytes never do. "Read" is recorded when the consumer next requests data after a
 * chunk containing a duplicate was enqueued.
 */
function duplicateSseBlocks(
  source: ReadableStream<Uint8Array>,
  decide: (block: string) => DuplicateKind | undefined,
  hooks: {
    redelivered: (kind: DuplicateKind, copy: string) => boolean;
    read: (kind: DuplicateKind) => void;
  },
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let pending = "";
  let awaitingRead: DuplicateKind[] = [];
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      for (const kind of awaitingRead) hooks.read(kind);
      awaitingRead = [];
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) {
            pending += decoder.decode();
            if (pending !== "") controller.enqueue(encoder.encode(pending));
            pending = "";
            controller.close();
            return;
          }
          pending += decoder.decode(next.value, { stream: true });
          let out = "";
          let boundary = pending.indexOf("\n\n");
          while (boundary >= 0) {
            const frame = pending.slice(0, boundary + 2);
            pending = pending.slice(boundary + 2);
            out += frame;
            const kind = decide(frame.slice(0, -2));
            if (kind && hooks.redelivered(kind, frame.slice(0, -2))) {
              out += frame;
              awaitingRead.push(kind);
            }
            boundary = pending.indexOf("\n\n");
          }
          if (out !== "") {
            controller.enqueue(encoder.encode(out));
            return;
          }
        }
      } catch (error) {
        controller.error(error);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

function findIdenticalDuplicatePartUpdates(events: AgentEvent[]): number {
  const seen = new Set<string>();
  let duplicates = 0;
  for (const event of events) {
    if (event.type !== "message.part.updated") continue;
    const key = JSON.stringify(event.properties);
    if (seen.has(key)) duplicates += 1;
    else seen.add(key);
  }
  return duplicates;
}

/** Named checks over the domain output produced after the duplicate frames were re-delivered. */
function evaluateDuplicateDelivery(input: {
  ledger: DuplicateLedger;
  events: AgentEvent[];
  history: ChatMessageWithParts[];
  sessionID: string;
  answer: string;
  /** Events for the terminal-frame check; defaults to `events` (the delta window). */
  terminalEvents?: AgentEvent[];
  /** Index into `terminalEvents` of the first event after the explicit resubscribe (the stream generation bump); default 0. */
  resubscribeIndex?: number;
  /** Whether the native active snapshot served to the post-resubscribe hydration listed the session as running. */
  snapshotRunning?: boolean;
}): Record<string, boolean> {
  const { ledger, events, history, sessionID, answer } = input;
  const terminalEvents = input.terminalEvents ?? events;
  const resubscribeIndex = input.resubscribeIndex ?? 0;
  const idleBefore = countOwnedIdle(terminalEvents.slice(0, resubscribeIndex), sessionID);
  const idleAfter = countOwnedIdle(terminalEvents.slice(resubscribeIndex), sessionID);
  const idleFrames = idleFramesByStreamState(ledger);
  const idleDropped = idleFrames.retired - idleBefore;
  const hydratedStatus = hydratedStatusAfterResubscribe(terminalEvents, sessionID, resubscribeIndex);
  const text = ledger.injected.textDelta;
  const terminal = ledger.injected.terminal;
  const deltas = events.flatMap((event) =>
    event.type === "message.part.delta" && event.properties.sessionID === sessionID ? [event.properties] : [],
  );
  const answerMessages = history.filter(
    ({ info, parts }) =>
      info.role === "assistant" && parts.some((part) => part.type === "text" && part.text === answer),
  );
  const answerParts = answerMessages.flatMap(({ parts }) =>
    parts.filter((part) => part.type === "text" && part.text === answer),
  );
  const messageIDs = history.map(({ info }) => info.id);
  const partIDs = history.flatMap(({ parts }) => parts.map((part) => part.id));
  const deltaPartIDs = new Set(deltas.map((delta) => delta.partID));
  const deltaMessageIDs = new Set(deltas.map((delta) => delta.messageID));
  const injectedExactlyOnce = (injected: InjectedDuplicate | undefined) =>
    injected !== undefined && injected.emitted === 1 && injected.readByAdapter === 1 && injected.alteredRejected === 0;
  return {
    duplicateTextDeltaFrameInjectedOnceAndReadByAdapter:
      injectedExactlyOnce(text) && text?.type === "session.text.delta",
    duplicateTerminalFrameInjectedOnceAndReadByAdapter:
      injectedExactlyOnce(terminal) &&
      (terminal?.type === "session.execution.succeeded" || terminal?.type === "session.execution.interrupted"),
    duplicatedFramesCarriedNativeEventIDs:
      text?.hasNativeEventID === true &&
      terminal?.hasNativeEventID === true &&
      ledger.textDeltaFramesWithoutID === 0 &&
      ledger.idleFramesWithoutID === 0,
    duplicateTextDeltaMappedOncePerDistinctNativeFrame:
      ledger.distinctTextDeltaIDs.size >= 1 && deltas.length === ledger.distinctTextDeltaIDs.size,
    duplicateDomainDeltasConcatenateToAnswerExactlyOnce: deltas.map((delta) => delta.delta).join("") === answer,
    duplicateFinalAssistantTextAppearsOnceInNativeHistory: answerMessages.length === 1 && answerParts.length === 1,
    duplicateDeltasTargetTheNativeHistoryMessageAndPart:
      answerMessages.length === 1 &&
      deltaPartIDs.size === 1 &&
      deltaMessageIDs.size === 1 &&
      deltaMessageIDs.has(answerMessages[0].info.id) &&
      answerParts.length === 1 &&
      deltaPartIDs.has(answerParts[0].id),
    duplicateNoDuplicateMessageOrPartIDsInHistory:
      new Set(messageIDs).size === messageIDs.length && new Set(partIDs).size === partIDs.length,
    duplicateNoIdenticalPartUpdateEvents: findIdenticalDuplicatePartUpdates(events) === 0,
    // Exactly-once per distinct frame on the stream the adapter still owned after the bump; frames
    // on a retired stream may be mapped at most once before the bump (accounted for below).
    duplicateTerminalAppliedOncePerDistinctNativeFrame:
      ledger.idleFrameIDs.size >= 1 && idleAfter === idleFrames.current && idleBefore <= idleFrames.retired,
    // (i) A retired stream's frames never produce a domain idle after the generation bump.
    retiredStreamFramesProducedNoDomainIdleAfterBump: idleAfter <= idleFrames.current,
    // (ii) A retired-stream frame the adapter dropped is superseded by an authoritative hydration
    // status that matches the native active snapshot for the session.
    retiredStreamDropCoveredByAuthoritativeHydration:
      idleDropped >= 0 &&
      (idleDropped === 0 ||
        (input.snapshotRunning !== undefined && hydratedStatus === (input.snapshotRunning ? "busy" : "idle"))),
  };
}

/** First owned status event after the first `server.connected` marker at or after the resubscribe (the hydration status). */
function hydratedStatusAfterResubscribe(
  events: AgentEvent[],
  sessionID: string,
  resubscribeIndex: number,
): "busy" | "idle" | "none" {
  const marker = events.findIndex((event, index) => index >= resubscribeIndex && event.type === "server.connected");
  if (marker < 0) return "none";
  for (const event of events.slice(marker + 1)) {
    if (event.type === "session.status" && event.properties.sessionID === sessionID) {
      return event.properties.status.type === "idle" ? "idle" : "busy";
    }
  }
  return "none";
}

type TerminalDeliveryDiagnostics = {
  /** Domain `session.status` idle events for the owned session, whole run / split at the explicit resubscribe. */
  domainIdleTotal: number;
  domainIdleBeforeResubscribe: number;
  domainIdleAfterResubscribe: number;
  /** After-resubscribe idle events inside the contiguous status/interaction run that follows a `server.connected` marker (hydration-shaped). */
  domainIdleHydrationShaped: number;
  /** Tee-observed distinct idle frames: before resubscribe, after resubscribe, and after evaluation. */
  ledgerIdleFramesBeforeResubscribe: number;
  ledgerIdleFramesAfterResubscribe: number;
  ledgerIdleFramesAfterEvaluation: number;
  /** Ledger minus domain idle per side of the resubscribe (positive: a frame not delivered to the adapter yet or ever). */
  idleDeficitBeforeResubscribe: number;
  idleDeficitAfterResubscribe: number;
  /** Timing ordering of the abort-terminal wait; null until the runtime records it. */
  domainIdleSeenAfterAbortAtIdleWaitEnd: boolean | null;
  domainIdleSeenAfterAbortAtEvaluation: boolean | null;
  nativeInterruptedOutcomeSeenBeforeDomainIdle: boolean | null;
  ledgerIdleFramesAtIdleWaitEnd: number | null;
  /** Terminal settle: how long the domain idle count took to reach the frozen ledger count, and whether it did. */
  settleWaitedMsBucket: SettleWaitBucket | null;
  settleReachedLedgerCount: boolean | null;
  /** Tee-observed idle frames by connection: retired by the explicit resubscribe vs still current. */
  ledgerIdleFramesRetiredStream: number;
  ledgerIdleFramesCurrentStream: number;
  /** Retired-stream idle frames minus domain idles mapped before the bump: frames the adapter dropped as stale. */
  idleFramesDroppedOnRetiredStream: number;
  /** Terminal window start in the captured stream, and domain idles captured before it / after its end. */
  terminalWindowStartIndex: number;
  domainIdleBeforeTerminalWindow: number;
  domainIdleAfterTerminalWindow: number;
  /** Hydration status the adapter emitted after the post-resubscribe marker vs the native active snapshot served to it. */
  hydratedStatusAfterResubscribe: "busy" | "idle" | "none";
  activeSnapshotRunning: boolean | null;
  hydrationMatchedActiveSnapshot: boolean | null;
};

type SettleWaitBucket = "0" | "<=100" | "<=500" | ">500";

const TERMINAL_SETTLE_MAX_MS = 1_500;
const TERMINAL_SETTLE_STEP_MS = 25;

function settleWaitBucket(waitedMs: number): SettleWaitBucket {
  if (waitedMs <= 0) return "0";
  if (waitedMs <= 100) return "<=100";
  return waitedMs <= 500 ? "<=500" : ">500";
}

function countOwnedIdle(events: AgentEvent[], sessionID: string): number {
  return events.filter(
    (event) =>
      event.type === "session.status" &&
      event.properties.sessionID === sessionID &&
      event.properties.status.type === "idle",
  ).length;
}

/**
 * A native terminal frame is teed by the proxy before the adapter maps it, so the tee can be
 * ahead of the domain stream at evaluation. Freeze the ledger's idle IDs (frames teed later are
 * excluded from the ledger and, being teed after the freeze, cannot have been mapped before it),
 * then wait a bounded time for the domain side to reach that count. The wait never relaxes the
 * check: the caller still requires domain idle === frozen count, so a count that is still short
 * at the deadline, or above the frozen count, fails. `terminalEvents` is sliced synchronously
 * after the wait. Issues no API or model request.
 */
async function settleTerminalIdle(input: {
  ledger: DuplicateLedger;
  readEvents: () => AgentEvent[];
  sessionID: string;
  deadline: number;
  /** Domain events before this index predate the stream generation bump and are not awaited; default 0. */
  fromIndex?: number;
  maxWaitMs?: number;
  stepMs?: number;
}): Promise<{ target: number; waitedMs: number; reached: boolean; terminalEvents: AgentEvent[] }> {
  const { ledger, readEvents, sessionID } = input;
  const fromIndex = input.fromIndex ?? 0;
  ledger.idleFrozen = true;
  // Only frames on a still-current stream can still be mapped; a retired stream's frame that was
  // in flight at the bump is dropped by the adapter and must not be awaited.
  const target = idleFramesByStreamState(ledger).current;
  const start = Date.now();
  const until = Math.min(input.deadline, start + (input.maxWaitMs ?? TERMINAL_SETTLE_MAX_MS));
  while (countOwnedIdle(readEvents().slice(fromIndex), sessionID) < target && Date.now() < until) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, input.stepMs ?? TERMINAL_SETTLE_STEP_MS));
  }
  const terminalEvents = readEvents().slice();
  return {
    target,
    waitedMs: Date.now() - start,
    reached: countOwnedIdle(terminalEvents.slice(fromIndex), sessionID) >= target,
    terminalEvents,
  };
}

/** Bounded counts and booleans only; never frame, event, or identifier content. */
function summarizeTerminalDelivery(input: {
  ledger: DuplicateLedger;
  terminalEvents: AgentEvent[];
  sessionID: string;
  /** Index into `terminalEvents` of the first event after the explicit resubscribe. */
  resubscribeIndex: number;
  /** Full captured domain stream (a superset of `terminalEvents`) for the outside-the-window idle counts. */
  capturedEvents?: AgentEvent[];
  /** Start of the terminal window within the captured stream; default 0. */
  windowStartIndex?: number;
  /** Whether the native active snapshot served to the post-resubscribe hydration listed the session as running. */
  snapshotRunning?: boolean;
  timing?: {
    domainIdleSeenAfterAbortAtIdleWaitEnd: boolean;
    domainIdleSeenAfterAbortAtEvaluation: boolean;
    nativeInterruptedOutcomeSeenBeforeDomainIdle: boolean;
    ledgerIdleFramesAtIdleWaitEnd: number;
    settleWaitedMs: number;
    settleReachedLedgerCount: boolean;
  };
}): TerminalDeliveryDiagnostics {
  const { ledger, terminalEvents, sessionID, resubscribeIndex } = input;
  const isOwnedIdle = (event: AgentEvent) =>
    event.type === "session.status" &&
    event.properties.sessionID === sessionID &&
    event.properties.status.type === "idle";
  let before = 0;
  let after = 0;
  let hydrationShaped = 0;
  let inHydrationRun = false;
  terminalEvents.forEach((event, index) => {
    if (event.type === "server.connected") {
      inHydrationRun = true;
      return;
    }
    const hydrationKind =
      event.type === "question.asked" || event.type === "permission.asked" || event.type === "session.status";
    if (!hydrationKind) inHydrationRun = false;
    if (!isOwnedIdle(event)) return;
    if (index < resubscribeIndex) before += 1;
    else {
      after += 1;
      if (inHydrationRun) hydrationShaped += 1;
    }
  });
  const ledgerBefore = ledger.idleFrameIDsPreResubscribe.size;
  const ledgerAfter = ledger.idleFrameIDsPostResubscribe.size;
  const streams = idleFramesByStreamState(ledger);
  const windowStart = input.windowStartIndex ?? 0;
  const captured = input.capturedEvents ?? terminalEvents;
  const hydrated = hydratedStatusAfterResubscribe(terminalEvents, sessionID, resubscribeIndex);
  const snapshotRunning = input.snapshotRunning ?? null;
  return {
    ledgerIdleFramesRetiredStream: streams.retired,
    ledgerIdleFramesCurrentStream: streams.current,
    idleFramesDroppedOnRetiredStream: streams.retired - before,
    terminalWindowStartIndex: windowStart,
    domainIdleBeforeTerminalWindow: captured.slice(0, windowStart).filter(isOwnedIdle).length,
    domainIdleAfterTerminalWindow: captured.slice(windowStart + terminalEvents.length).filter(isOwnedIdle).length,
    hydratedStatusAfterResubscribe: hydrated,
    activeSnapshotRunning: snapshotRunning,
    hydrationMatchedActiveSnapshot: snapshotRunning === null ? null : hydrated === (snapshotRunning ? "busy" : "idle"),
    domainIdleTotal: before + after,
    domainIdleBeforeResubscribe: before,
    domainIdleAfterResubscribe: after,
    domainIdleHydrationShaped: hydrationShaped,
    ledgerIdleFramesBeforeResubscribe: ledgerBefore,
    ledgerIdleFramesAfterResubscribe: ledgerAfter,
    ledgerIdleFramesAfterEvaluation: ledger.idleFrameIDsAfterClose.size,
    idleDeficitBeforeResubscribe: ledgerBefore - before,
    idleDeficitAfterResubscribe: ledgerAfter - after,
    domainIdleSeenAfterAbortAtIdleWaitEnd: input.timing?.domainIdleSeenAfterAbortAtIdleWaitEnd ?? null,
    domainIdleSeenAfterAbortAtEvaluation: input.timing?.domainIdleSeenAfterAbortAtEvaluation ?? null,
    nativeInterruptedOutcomeSeenBeforeDomainIdle: input.timing?.nativeInterruptedOutcomeSeenBeforeDomainIdle ?? null,
    ledgerIdleFramesAtIdleWaitEnd: input.timing?.ledgerIdleFramesAtIdleWaitEnd ?? null,
    settleWaitedMsBucket: input.timing ? settleWaitBucket(input.timing.settleWaitedMs) : null,
    settleReachedLedgerCount: input.timing?.settleReachedLedgerCount ?? null,
  };
}

describe("duplicate native SSE frame injection classifier", () => {
  const SESSION = "ses_fixture";
  const frame = (type: string, id: string | undefined, data: Record<string, unknown>) =>
    `data: ${JSON.stringify({ ...(id === undefined ? {} : { id }), type, created: 1, data })}`;
  const delta = (id: string | undefined, text = "hello", sessionID = SESSION) =>
    frame("session.text.delta", id, { sessionID, delta: text, ordinal: 0, assistantMessageID: "msg_1" });
  const succeeded = (id: string | undefined, sessionID = SESSION) =>
    frame("session.execution.succeeded", id, { sessionID });

  it("parses frames the way the client does and rejects non-frames", () => {
    expect(observeNativeSseFrame(delta("evt_1"))).toEqual({
      type: "session.text.delta",
      id: "evt_1",
      sessionID: SESSION,
      delta: "hello",
    });
    expect(observeNativeSseFrame(succeeded("evt_2"))?.status).toBe("idle");
    expect(observeNativeSseFrame(delta(undefined))?.id).toBeUndefined();
    expect(observeNativeSseFrame(delta("x".repeat(MAX_FIXTURE_NATIVE_EVENT_ID_LENGTH + 1)))?.id).toBeUndefined();
    expect(observeNativeSseFrame(": keepalive")).toBeUndefined();
    expect(observeNativeSseFrame("data: {not json")).toBeUndefined();
    expect(observeNativeSseFrame(`${delta("evt_1")}\r`)).toBeUndefined();
  });

  it("selects exactly one text delta then one later terminal frame of the owned session", () => {
    const ledger = newDuplicateLedger();
    expect(planNativeFrameDuplicate(ledger, succeeded("evt_0"), SESSION)).toBeUndefined();
    expect(planNativeFrameDuplicate(ledger, delta("evt_1", "a", "foreign"), SESSION)).toBeUndefined();
    expect(planNativeFrameDuplicate(ledger, delta("evt_1", ""), SESSION)).toBeUndefined();
    expect(planNativeFrameDuplicate(ledger, delta("evt_1"), SESSION)).toBe("textDelta");
    expect(planNativeFrameDuplicate(ledger, delta("evt_2"), SESSION)).toBeUndefined();
    expect(planNativeFrameDuplicate(ledger, succeeded("evt_3"), SESSION)).toBe("terminal");
    expect(planNativeFrameDuplicate(ledger, succeeded("evt_4"), SESSION)).toBeUndefined();
    expect([...ledger.distinctTextDeltaIDs]).toEqual(["evt_1", "evt_2"]);
    expect(ledger.injected.textDelta?.hasNativeEventID).toBe(true);
  });

  it("injects nothing when closed, session unknown, or no owned frames appear", () => {
    const ledger = newDuplicateLedger();
    expect(planNativeFrameDuplicate(ledger, delta("evt_1"), undefined)).toBeUndefined();
    ledger.closed = true;
    expect(planNativeFrameDuplicate(ledger, delta("evt_1"), SESSION)).toBeUndefined();
    expect(ledger.injected).toEqual({});
    const checks = evaluateDuplicateDelivery({ ledger, events: [], history: [], sessionID: SESSION, answer: "hello" });
    expect(checks.duplicateTextDeltaFrameInjectedOnceAndReadByAdapter).toBe(false);
    expect(checks.duplicateTerminalFrameInjectedOnceAndReadByAdapter).toBe(false);
    expect(checks.duplicateTextDeltaMappedOncePerDistinctNativeFrame).toBe(false);
    expect(checks.duplicateFinalAssistantTextAppearsOnceInNativeHistory).toBe(false);
    expect(checks.duplicateTerminalAppliedOncePerDistinctNativeFrame).toBe(false);
  });

  it("selects an interrupted terminal that arrives only after a later turn, not a foreign one", () => {
    const ledger = newDuplicateLedger();
    const started = frame("session.execution.started", "evt_0", { sessionID: SESSION });
    const interrupted = (id: string, sessionID = SESSION) =>
      frame("session.execution.interrupted", id, { sessionID, reason: "abort" });
    expect(planNativeFrameDuplicate(ledger, started, SESSION)).toBeUndefined();
    expect(planNativeFrameDuplicate(ledger, delta("evt_1"), SESSION)).toBe("textDelta");
    // Stalled second prompt joins the busy period: no terminal frame, only later deltas/none.
    ledger.deltaWindowClosed = true;
    expect(planNativeFrameDuplicate(ledger, delta("evt_9", "late"), SESSION)).toBeUndefined();
    expect([...ledger.distinctTextDeltaIDs]).toEqual(["evt_1"]);
    expect(planNativeFrameDuplicate(ledger, interrupted("evt_5", "foreign"), SESSION)).toBeUndefined();
    expect(
      planNativeFrameDuplicate(ledger, frame("session.execution.failed", "evt_6", { sessionID: SESSION }), SESSION),
    ).toBeUndefined();
    expect(planNativeFrameDuplicate(ledger, interrupted("evt_7"), SESSION)).toBe("terminal");
    expect(ledger.injected.terminal?.type).toBe("session.execution.interrupted");
    expect([...ledger.idleFrameIDs]).toEqual(["evt_6", "evt_7"]);
  });

  it("records frames without a native id as a design-gap signal rather than an injection pass", () => {
    const ledger = newDuplicateLedger();
    expect(planNativeFrameDuplicate(ledger, delta(undefined), SESSION)).toBe("textDelta");
    expect(planNativeFrameDuplicate(ledger, succeeded(undefined), SESSION)).toBe("terminal");
    expect(ledger.injected.textDelta?.hasNativeEventID).toBe(false);
    expect(ledger.textDeltaFramesWithoutID).toBe(1);
    expect(ledger.idleFramesWithoutID).toBe(1);
  });

  it("rejects an altered or unselected re-delivery at the observer", () => {
    const ledger = newDuplicateLedger();
    const original = delta("evt_1");
    expect(planNativeFrameDuplicate(ledger, original, SESSION)).toBe("textDelta");
    expect(recordDuplicateRedelivery(ledger, "textDelta", original.replace("hello", "hellO"))).toBe(false);
    expect(recordDuplicateRedelivery(ledger, "terminal", original)).toBe(false);
    expect(ledger.injected.textDelta).toMatchObject({ emitted: 0, alteredRejected: 1 });
    expect(recordDuplicateRedelivery(ledger, "textDelta", original)).toBe(true);
    expect(ledger.injected.textDelta).toMatchObject({ emitted: 1, alteredRejected: 1 });
  });

  async function drain(stream: ReadableStream<Uint8Array>): Promise<string> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let out = "";
    while (true) {
      const next = await reader.read();
      if (next.done) return out + decoder.decode();
      out += decoder.decode(next.value, { stream: true });
    }
  }

  function sourceOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
    return new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    });
  }

  it("repeats only the selected blocks byte-for-byte across arbitrary chunking and multibyte splits", async () => {
    const ledger = newDuplicateLedger();
    const connected = 'data: {"type":"server.connected","data":{}}\n\n';
    const selected = `${delta("evt_1", "héllo ✓")}\n\n`;
    const terminal = `${succeeded("evt_2")}\n\n`;
    const wire = new TextEncoder().encode(`${connected}${selected}: keepalive\n\n${terminal}`);
    const chunks: Uint8Array[] = [];
    for (let offset = 0; offset < wire.length; offset += 7) chunks.push(wire.slice(offset, offset + 7));
    const output = await drain(
      duplicateSseBlocks(sourceOf(chunks), (block) => planNativeFrameDuplicate(ledger, block, SESSION), {
        redelivered: (kind, copy) => recordDuplicateRedelivery(ledger, kind, copy),
        read: (kind) => recordDuplicateRead(ledger, kind),
      }),
    );
    expect(output).toBe(`${connected}${selected}${selected}: keepalive\n\n${terminal}${terminal}`);
    expect(ledger.injected.textDelta).toMatchObject({ emitted: 1, alteredRejected: 0 });
    expect(ledger.injected.terminal).toMatchObject({ emitted: 1, alteredRejected: 0 });
  });

  it("passes the stream through unchanged when no frame is selected and propagates source errors", async () => {
    const wire = ": a\n\n: b\n\n";
    const passthrough = await drain(
      duplicateSseBlocks(sourceOf([new TextEncoder().encode(wire)]), () => undefined, {
        redelivered: () => false,
        read: () => undefined,
      }),
    );
    expect(passthrough).toBe(wire);
    const failing = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error("transport drop"));
      },
    });
    await expect(
      drain(duplicateSseBlocks(failing, () => undefined, { redelivered: () => false, read: () => undefined })),
    ).rejects.toThrow("transport drop");
  });

  describe("domain evaluation", () => {
    const answer = "fixture reconnect answer";
    const idle: AgentEvent = {
      type: "session.status",
      properties: { sessionID: SESSION, status: { type: "idle" } },
    };
    const deltaEvent = (text: string): AgentEvent => ({
      type: "message.part.delta",
      properties: { sessionID: SESSION, messageID: "msg_a", partID: "prt_a", field: "text", delta: text },
    });
    const history = [
      { info: { id: "msg_u", role: "user" }, parts: [{ id: "prt_u", type: "text", text: "q" }] },
      { info: { id: "msg_a", role: "assistant" }, parts: [{ id: "prt_a", type: "text", text: answer }] },
    ] as unknown as ChatMessageWithParts[];
    const ledger = () => {
      const value = newDuplicateLedger();
      planNativeFrameDuplicate(value, delta("evt_1", answer), SESSION);
      planNativeFrameDuplicate(value, succeeded("evt_2"), SESSION);
      recordDuplicateRedelivery(value, "textDelta", delta("evt_1", answer));
      recordDuplicateRedelivery(value, "terminal", succeeded("evt_2"));
      recordDuplicateRead(value, "textDelta");
      recordDuplicateRead(value, "terminal");
      return value;
    };
    const run = (events: AgentEvent[], messages = history, value = ledger()) =>
      evaluateDuplicateDelivery({ ledger: value, events, history: messages, sessionID: SESSION, answer });

    it("passes when the duplicates were applied exactly once", () => {
      const checks = run([deltaEvent(answer), idle]);
      expect(Object.keys(checks).length).toBeGreaterThanOrEqual(9);
      expect(Object.entries(checks).filter(([, ok]) => !ok)).toEqual([]);
    });

    it("summarizes terminal delivery as bounded counts split at the resubscribe", () => {
      const value = newDuplicateLedger();
      const interrupted = (id: string) => frame("session.execution.interrupted", id, { sessionID: SESSION });
      planNativeFrameDuplicate(value, succeeded("evt_a"), SESSION);
      value.deltaWindowClosed = true;
      planNativeFrameDuplicate(value, interrupted("evt_b"), SESSION);
      planNativeFrameDuplicate(value, interrupted("evt_b"), SESSION);
      value.closed = true;
      planNativeFrameDuplicate(value, interrupted("evt_c"), SESSION);
      planNativeFrameDuplicate(value, succeeded("evt_d", "foreign"), SESSION);
      const marker: AgentEvent = { type: "server.connected", properties: {} };
      const busy: AgentEvent = {
        type: "session.status",
        properties: { sessionID: SESSION, status: { type: "busy" } },
      };
      const summary = summarizeTerminalDelivery({
        ledger: value,
        // Pre-resubscribe: one idle; post: marker, hydration busy, then one hydration-shaped idle and one separated idle.
        terminalEvents: [idle, marker, busy, idle, deltaEvent("x"), idle],
        sessionID: SESSION,
        resubscribeIndex: 1,
      });
      expect(summary).toEqual({
        domainIdleTotal: 3,
        domainIdleBeforeResubscribe: 1,
        domainIdleAfterResubscribe: 2,
        domainIdleHydrationShaped: 1,
        ledgerIdleFramesBeforeResubscribe: 1,
        ledgerIdleFramesAfterResubscribe: 1,
        ledgerIdleFramesAfterEvaluation: 1,
        idleDeficitBeforeResubscribe: 0,
        idleDeficitAfterResubscribe: -1,
        domainIdleSeenAfterAbortAtIdleWaitEnd: null,
        domainIdleSeenAfterAbortAtEvaluation: null,
        nativeInterruptedOutcomeSeenBeforeDomainIdle: null,
        ledgerIdleFramesAtIdleWaitEnd: null,
        settleWaitedMsBucket: null,
        settleReachedLedgerCount: null,
        ledgerIdleFramesRetiredStream: 0,
        ledgerIdleFramesCurrentStream: 2,
        idleFramesDroppedOnRetiredStream: -1,
        terminalWindowStartIndex: 0,
        domainIdleBeforeTerminalWindow: 0,
        domainIdleAfterTerminalWindow: 0,
        hydratedStatusAfterResubscribe: "busy",
        activeSnapshotRunning: null,
        hydrationMatchedActiveSnapshot: null,
      });
      // The strict check is unchanged: ledger frames (2) differ from domain idle events (3).
      expect(value.idleFrameIDs.size).toBe(2);
      expect(
        evaluateDuplicateDelivery({
          ledger: value,
          events: [],
          terminalEvents: [idle, marker, busy, idle, deltaEvent("x"), idle],
          history: [],
          sessionID: SESSION,
          answer,
        }).duplicateTerminalAppliedOncePerDistinctNativeFrame,
      ).toBe(false);
    });

    describe("retired-stream attribution", () => {
      const interrupted = (id: string) => frame("session.execution.interrupted", id, { sessionID: SESSION });
      const marker: AgentEvent = { type: "server.connected", properties: {} };
      const busy: AgentEvent = {
        type: "session.status",
        properties: { sessionID: SESSION, status: { type: "busy" } },
      };
      /** Frame evt_1 on connection 1 (retired at the resubscribe), evt_2 on connection 3 (current). */
      const staleLedger = () => {
        const value = newDuplicateLedger();
        planNativeFrameDuplicate(value, succeeded("evt_1"), SESSION, 1);
        value.deltaWindowClosed = true;
        value.retiredStreamCeiling = 1;
        planNativeFrameDuplicate(value, interrupted("evt_2"), SESSION, 3);
        return value;
      };
      const verdict = (
        value: DuplicateLedger,
        terminalEvents: AgentEvent[],
        resubscribeIndex: number,
        snapshotRunning?: boolean,
      ) =>
        evaluateDuplicateDelivery({
          ledger: value,
          events: [],
          terminalEvents,
          resubscribeIndex,
          snapshotRunning,
          history: [],
          sessionID: SESSION,
          answer,
        });

      it("splits idle frames by whether their connection was retired", () => {
        expect(idleFramesByStreamState(staleLedger())).toEqual({ retired: 1, current: 1 });
        expect(idleFramesByStreamState(newDuplicateLedger())).toEqual({ retired: 0, current: 0 });
      });

      it("passes when a retired-stream frame was dropped and hydration matched the active snapshot", () => {
        // Pre-bump: nothing mapped (frame in flight on the retired stream). Post-bump: hydration busy, then the abort idle.
        const events = [marker, busy, idle];
        const checks = verdict(staleLedger(), events, 0, true);
        expect(checks.duplicateTerminalAppliedOncePerDistinctNativeFrame).toBe(true);
        expect(checks.retiredStreamFramesProducedNoDomainIdleAfterBump).toBe(true);
        expect(checks.retiredStreamDropCoveredByAuthoritativeHydration).toBe(true);
        const summary = summarizeTerminalDelivery({
          ledger: staleLedger(),
          terminalEvents: events,
          sessionID: SESSION,
          resubscribeIndex: 0,
          snapshotRunning: true,
        });
        expect(summary).toMatchObject({
          ledgerIdleFramesRetiredStream: 1,
          ledgerIdleFramesCurrentStream: 1,
          idleFramesDroppedOnRetiredStream: 1,
          hydratedStatusAfterResubscribe: "busy",
          activeSnapshotRunning: true,
          hydrationMatchedActiveSnapshot: true,
        });
      });

      it("passes when the retired-stream frame was mapped before the bump", () => {
        const checks = verdict(staleLedger(), [idle, marker, busy, idle], 1, true);
        expect(checks.duplicateTerminalAppliedOncePerDistinctNativeFrame).toBe(true);
        expect(checks.retiredStreamDropCoveredByAuthoritativeHydration).toBe(true);
      });

      it("fails when a dropped retired-stream frame is not covered by a matching hydration status", () => {
        const events = [marker, busy, idle];
        expect(verdict(staleLedger(), events, 0, false).retiredStreamDropCoveredByAuthoritativeHydration).toBe(false);
        expect(verdict(staleLedger(), events, 0).retiredStreamDropCoveredByAuthoritativeHydration).toBe(false);
        expect(verdict(staleLedger(), [idle], 0, true).retiredStreamDropCoveredByAuthoritativeHydration).toBe(false);
      });

      it("fails when a retired-stream frame produced a domain idle after the bump", () => {
        // Two post-bump idles for one current-stream frame: the retired frame leaked through.
        const checks = verdict(staleLedger(), [marker, busy, idle, idle], 0, true);
        expect(checks.retiredStreamFramesProducedNoDomainIdleAfterBump).toBe(false);
        expect(checks.duplicateTerminalAppliedOncePerDistinctNativeFrame).toBe(false);
      });

      it("fails when the current-stream frame is missing or a retired frame was mapped twice", () => {
        expect(verdict(staleLedger(), [marker, busy], 0, true).duplicateTerminalAppliedOncePerDistinctNativeFrame).toBe(
          false,
        );
        expect(
          verdict(staleLedger(), [idle, idle, marker, busy, idle], 2, true)
            .duplicateTerminalAppliedOncePerDistinctNativeFrame,
        ).toBe(false);
      });

      it("settles on current-stream frames only, never awaiting the retired one", async () => {
        const value = staleLedger();
        const result = await settleTerminalIdle({
          ledger: value,
          readEvents: () => [idle, marker, busy, idle],
          sessionID: SESSION,
          deadline: Date.now() + 5_000,
          fromIndex: 1,
          maxWaitMs: 40,
          stepMs: 5,
        });
        expect(result).toMatchObject({ target: 1, reached: true });
        const dropped = await settleTerminalIdle({
          ledger: staleLedger(),
          readEvents: () => [marker, busy],
          sessionID: SESSION,
          deadline: Date.now() + 5_000,
          fromIndex: 0,
          maxWaitMs: 20,
          stepMs: 5,
        });
        expect(dropped).toMatchObject({ target: 1, reached: false });
      });

      it("counts idles outside the terminal window in the full captured stream", () => {
        const summary = summarizeTerminalDelivery({
          ledger: newDuplicateLedger(),
          terminalEvents: [idle, busy],
          capturedEvents: [idle, idle, busy, idle, idle],
          windowStartIndex: 1,
          sessionID: SESSION,
          resubscribeIndex: 0,
        });
        expect(summary.terminalWindowStartIndex).toBe(1);
        expect(summary.domainIdleBeforeTerminalWindow).toBe(1);
        expect(summary.domainIdleAfterTerminalWindow).toBe(2);
      });
    });

    describe("terminal idle settle", () => {
      const interrupted = (id: string) => frame("session.execution.interrupted", id, { sessionID: SESSION });
      const settled = (value: DuplicateLedger, events: AgentEvent[], maxWaitMs = 200) =>
        settleTerminalIdle({
          ledger: value,
          readEvents: () => events,
          sessionID: SESSION,
          deadline: Date.now() + 5_000,
          maxWaitMs,
          stepMs: 5,
        });
      const verdict = (value: DuplicateLedger, terminalEvents: AgentEvent[]) =>
        evaluateDuplicateDelivery({
          ledger: value,
          events: [],
          terminalEvents,
          history: [],
          sessionID: SESSION,
          answer,
        }).duplicateTerminalAppliedOncePerDistinctNativeFrame;

      it("passes when the in-flight frame is mapped during the settle wait", async () => {
        const value = newDuplicateLedger();
        planNativeFrameDuplicate(value, succeeded("evt_1"), SESSION);
        planNativeFrameDuplicate(value, interrupted("evt_2"), SESSION);
        const events: AgentEvent[] = [idle];
        setTimeout(() => events.push(idle), 30);
        const result = await settled(value, events);
        expect(result).toMatchObject({ target: 2, reached: true });
        expect(result.waitedMs).toBeGreaterThan(0);
        expect(verdict(value, result.terminalEvents)).toBe(true);
      });

      it("excludes frames teed after the freeze from the ledger and settles at once when caught up", async () => {
        const value = newDuplicateLedger();
        planNativeFrameDuplicate(value, succeeded("evt_1"), SESSION);
        const events: AgentEvent[] = [idle];
        const result = await settled(value, events);
        expect(result).toMatchObject({ target: 1, reached: true });
        planNativeFrameDuplicate(value, interrupted("evt_2"), SESSION);
        expect([...value.idleFrameIDs]).toEqual(["evt_1"]);
        expect(value.idleFrameIDsAfterClose.size).toBe(1);
        expect(verdict(value, result.terminalEvents)).toBe(true);
      });

      it("fails when the awaited frame never arrives", async () => {
        const value = newDuplicateLedger();
        planNativeFrameDuplicate(value, succeeded("evt_1"), SESSION);
        planNativeFrameDuplicate(value, interrupted("evt_2"), SESSION);
        const result = await settled(value, [idle], 40);
        expect(result.reached).toBe(false);
        expect(verdict(value, result.terminalEvents)).toBe(false);
      });

      it("fails when the domain side has an extra idle", async () => {
        const value = newDuplicateLedger();
        planNativeFrameDuplicate(value, succeeded("evt_1"), SESSION);
        const result = await settled(value, [idle, idle]);
        expect(result.reached).toBe(true);
        expect(verdict(value, result.terminalEvents)).toBe(false);
      });

      it("buckets the waited time", () => {
        expect([0, 1, 100, 101, 500, 501].map(settleWaitBucket)).toEqual([
          "0",
          "<=100",
          "<=100",
          "<=500",
          "<=500",
          ">500",
        ]);
      });
    });

    it("judges deltas on their window and the late terminal on all events", () => {
      const value = newDuplicateLedger();
      planNativeFrameDuplicate(value, delta("evt_1", answer), SESSION);
      value.deltaWindowClosed = true;
      planNativeFrameDuplicate(value, frame("session.execution.interrupted", "evt_2", { sessionID: SESSION }), SESSION);
      recordDuplicateRedelivery(value, "textDelta", delta("evt_1", answer));
      recordDuplicateRedelivery(
        value,
        "terminal",
        frame("session.execution.interrupted", "evt_2", { sessionID: SESSION }),
      );
      recordDuplicateRead(value, "textDelta");
      recordDuplicateRead(value, "terminal");
      const windowEvents = [deltaEvent(answer)];
      const checks = evaluateDuplicateDelivery({
        ledger: value,
        events: windowEvents,
        terminalEvents: [...windowEvents, idle],
        history,
        sessionID: SESSION,
        answer,
      });
      expect(Object.entries(checks).filter(([, ok]) => !ok)).toEqual([]);
      const doubled = evaluateDuplicateDelivery({
        ledger: value,
        events: windowEvents,
        terminalEvents: [...windowEvents, idle, idle],
        history,
        sessionID: SESSION,
        answer,
      });
      expect(doubled.duplicateTerminalAppliedOncePerDistinctNativeFrame).toBe(false);
    });

    it("fails on duplicated domain text and a double-applied terminal frame", () => {
      expect(
        run([deltaEvent(answer), deltaEvent(answer), idle]).duplicateTextDeltaMappedOncePerDistinctNativeFrame,
      ).toBe(false);
      expect(
        run([deltaEvent(answer), deltaEvent(answer), idle]).duplicateDomainDeltasConcatenateToAnswerExactlyOnce,
      ).toBe(false);
      expect(run([deltaEvent(answer), idle, idle]).duplicateTerminalAppliedOncePerDistinctNativeFrame).toBe(false);
    });

    it("fails when the duplicate was never injected or never read", () => {
      const none = run([deltaEvent(answer), idle], history, newDuplicateLedger());
      expect(none.duplicateTextDeltaFrameInjectedOnceAndReadByAdapter).toBe(false);
      expect(none.duplicateTerminalFrameInjectedOnceAndReadByAdapter).toBe(false);
      const unread = ledger();
      if (unread.injected.terminal) unread.injected.terminal.readByAdapter = 0;
      expect(run([deltaEvent(answer), idle], history, unread).duplicateTerminalFrameInjectedOnceAndReadByAdapter).toBe(
        false,
      );
    });

    it("fails on duplicated history text or message/part IDs and identical part updates", () => {
      const doubled = [...history, history[1]];
      const checks = run([deltaEvent(answer), idle], doubled);
      expect(checks.duplicateFinalAssistantTextAppearsOnceInNativeHistory).toBe(false);
      expect(checks.duplicateNoDuplicateMessageOrPartIDsInHistory).toBe(false);
      const update: AgentEvent = {
        type: "message.part.updated",
        properties: { sessionID: SESSION, part: { id: "prt_a", type: "text", text: "" } },
      } as AgentEvent;
      expect(run([deltaEvent(answer), update, update, idle]).duplicateNoIdenticalPartUpdateEvents).toBe(false);
    });

    it("fails when native frames lacked ids", () => {
      const noID = newDuplicateLedger();
      planNativeFrameDuplicate(noID, delta(undefined, answer), SESSION);
      planNativeFrameDuplicate(noID, succeeded(undefined), SESSION);
      expect(run([deltaEvent(answer), idle], history, noID).duplicatedFramesCarriedNativeEventIDs).toBe(false);
    });
  });
});

async function absent(path: string): Promise<boolean> {
  try {
    await access(path);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT";
  }
}

function boundedPath(pathname: string): string {
  if (!pathname.startsWith("/api/")) return "/other";
  const segments = pathname.split("/").filter(Boolean);
  const root = segments[1] ?? "other";
  if (root === "session") {
    return `/api/session/:sessionID${segments[3] ? `/${segments[3]}` : ""}`;
  }
  return `/api/${root}`;
}

function hasAssistantText(messages: ChatMessageWithParts[], expected: string): boolean {
  return messages.some(
    ({ info, parts }) =>
      info.role === "assistant" && parts.some((part) => part.type === "text" && part.text === expected),
  );
}

function sameEnvironment(expected: NodeJS.ProcessEnv): boolean {
  const keys = new Set([...Object.keys(expected), ...Object.keys(process.env)]);
  return [...keys].every((key) => expected[key] === process.env[key]);
}

function listen(server: Server): Promise<number> {
  return new Promise((resolvePort, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") reject(new Error("fixture server did not bind TCP"));
      else resolvePort(address.port);
    });
  });
}

function deferred<T>() {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolveValue) => (resolvePromise = resolveValue));
  return { promise, resolve: resolvePromise };
}

function isProcessGroupGone(pid: number): boolean {
  try {
    process.kill(process.platform === "win32" ? pid : -pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}

async function waitFor(predicate: () => boolean | Promise<boolean>, deadline: number): Promise<boolean> {
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
  }
  return predicate();
}

afterEach(async () => {
  for (const isolation of OWNER_RUNS) await isolation.dispose();
  OWNER_RUNS.clear();
});

it.skipIf(!RUN_ENABLED)(
  "qualifies production OpenCodeAgent reconnect and abort against a disposable native HTTP mock",
  async () => {
    const forkProcess = process as NodeJS.Process & { send?: (...args: unknown[]) => unknown; connected?: boolean };
    const dedicatedFork = typeof forkProcess.send === "function" && forkProcess.connected === true;
    const projectRoot = await realpath(PROJECT_ROOT);
    const evidenceBase = resolve(projectRoot, "tmp/scribe-v2-migration/adapter");
    await mkdir(evidenceBase, { recursive: true });
    await assertOwnedPath(projectRoot, evidenceBase);
    const runId = randomUUID();
    const evidencePath = join(evidenceBase, runId, "result.json");
    await mkdir(dirname(evidencePath), { recursive: false });
    await assertOwnedPath(evidenceBase, dirname(evidencePath));

    const checks: Record<string, boolean> = {};
    const nativeSessionObservationCounts = {
      pathMatched: 0,
      bodyDataRecord: 0,
      dataIDMatched: 0,
      outcomePresent: 0,
      outcomeValidEnum: 0,
    };
    const automaticRecovery = {
      injectedTransportDrops: 0,
      eventRequestsBeforeDrop: 0,
      eventRequestsAfterDrop: 0,
      serverConnectedMarkersAfterDrop: 0,
      snapshotReadsAfterMarker: 0,
      sameOwnedChildPID: null as boolean | null,
    };
    const manifest: Manifest = {
      schemaVersion: 1,
      runId,
      status: "RUNNING",
      qualification: "PRODUCTION_ADAPTER_PRIVATE_SERVER_NATIVE_HTTP_FIXTURE",
      expectedVersion: EXPECTED_VERSION,
      sourceCommit: "bb25a2f4a3f3f04d7c344bec0c0574ea3510b3b1",
      sourceCommitMeaning: "inspected-release-tag",
      executableSha256: null,
      executablePath: EXECUTABLE_INPUT && isAbsolute(EXECUTABLE_INPUT) ? resolve(EXECUTABLE_INPUT) : null,
      clientPackage: "@opencode/client@2.1.0",
      checks,
      counts: { apiRequests: 0, modelRequests: 0, sessions: 0 },
      apiOperations: {},
      nativeSessionOutcomes: [],
      nativeSessionObservationCounts,
      terminalObservationPolls: 0,
      automaticRecovery,
      duplicateFrameInjection: {
        textDelta: null,
        terminal: null,
        distinctTextDeltaFrames: 0,
        textDeltaFramesWithoutID: 0,
        distinctIdleFrames: 0,
        idleFramesWithoutID: 0,
        listenerFailureDiagnostics: 0,
      },
      terminalDelivery: summarizeTerminalDelivery({
        ledger: newDuplicateLedger(),
        terminalEvents: [],
        sessionID: "",
        resubscribeIndex: 0,
      }),
      promptAdmissions: 0,
      snapshotReadsAfterReconnect: 0,
      bounds: {
        maxApiRequests: MAX_API_REQUESTS,
        maxModelRequests: MAX_MODEL_REQUESTS,
        maxSessions: MAX_SESSIONS,
        overallMs: OVERALL_TIMEOUT_MS,
      },
      fixtureRoot: null,
      statePath: null,
      evidencePath: relative(projectRoot, evidencePath),
      cleanup: { agentDisconnected: false, ownedProcessGroupReaped: null, fixtureStateRemoved: null },
    };
    const persist = async () => {
      const summarize = (injected: InjectedDuplicate | undefined) => {
        if (!injected) return null;
        const { fingerprint: _fingerprint, ...rest } = injected;
        return rest;
      };
      if (terminalDeliveryContext) {
        manifest.terminalDelivery = summarizeTerminalDelivery({
          ledger: duplicateLedger,
          terminalEvents: events.slice(0, terminalDeliveryContext.eventCount),
          capturedEvents: events,
          ...terminalDeliveryContext.input,
        });
      }
      manifest.duplicateFrameInjection = {
        textDelta: summarize(duplicateLedger.injected.textDelta),
        terminal: summarize(duplicateLedger.injected.terminal),
        distinctTextDeltaFrames: duplicateLedger.distinctTextDeltaIDs.size,
        textDeltaFramesWithoutID: duplicateLedger.textDeltaFramesWithoutID,
        distinctIdleFrames: duplicateLedger.idleFrameIDs.size,
        idleFramesWithoutID: duplicateLedger.idleFramesWithoutID,
        listenerFailureDiagnostics,
      };
      return writeFile(evidencePath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    };
    let isolation: V2TestIsolation | undefined;
    let agent: OpenCodeAgent | undefined;
    let fixture: Server | undefined;
    let fixtureClosed = false;
    let apiCount = 0;
    let modelCount = 0;
    let pendingNativeWaits = 0;
    const operationCounts = new Map<string, number>();
    const promptContextOperations = { list: 0, put: 0, remove: 0, wait: 0 };
    const requestOperations: Array<{ method: string; path: string }> = [];
    const nativeSessionOutcomes: Array<"succeeded" | "failed" | "interrupted"> = [];
    const eventFetches: Array<{
      dropController: AbortController;
      adapterSignal: AbortSignal | undefined;
      requestNumber: number;
    }> = [];
    let armedEventDropController: AbortController | undefined;
    let terminalObservationPolls = 0;
    const activeModelResponses = new Set<ServerResponse>();
    const modelRequests: Array<{
      stalled: boolean;
      observation?: ReturnType<typeof observeFixtureRequestBody>;
      closedAt?: number;
    }> = [];
    const promptAdmissionTexts: string[] = [];
    let ownedAuthHeaders: Headers | undefined;
    let ownedApiOrigin: string | undefined;
    let heldThirdWaitResponse: Response | undefined;
    let holdThirdWaitResponse = false;
    const releaseThirdWaitResponse = deferred<void>();
    const stalledStarted = deferred<void>();
    const allowStalledCompletion = deferred<void>();
    let privatePID: number | undefined;
    let observedVersion: string | undefined;
    let ownedSessionID: string | undefined;
    let terminalPollDeadline: number | undefined;
    let activeSnapshotRunningAfterResubscribe: boolean | undefined;
    let lateSentinelWriteAttempted = false;
    let awaitingReconnectMarker = false;
    let reconnectMarkerRequestIndex: number | undefined;
    let awaitingAutomaticRecoveryMarker = false;
    let automaticRecoveryMarkerRequestIndex: number | undefined;
    const events: AgentEvent[] = [];
    const duplicateLedger = newDuplicateLedger();
    let terminalDeliveryContext:
      | {
          eventCount: number;
          input: Omit<Parameters<typeof summarizeTerminalDelivery>[0], "ledger" | "terminalEvents">;
        }
      | undefined;
    const originalConsoleError = console.error;
    let listenerFailureDiagnostics = 0;
    const overall = new AbortController();
    const originalFetch = globalThis.fetch;
    const originalEnvironment = { ...process.env };
    let environmentReplaced = false;
    const deadline = Date.now() + OVERALL_TIMEOUT_MS;
    const timer = setTimeout(() => overall.abort(), OVERALL_TIMEOUT_MS);
    let status: Status = "RUNNING";
    let processReaped: boolean | null = null;
    try {
      await persist();
      checks.dedicatedVitestForkWithIpc = dedicatedFork;
      if (!dedicatedFork) {
        status = "BLOCKED";
        manifest.failureCode = "dedicated_vitest_fork_unproven";
        throw new Error("opt-in adapter qualification requires a dedicated Vitest fork with IPC");
      }
      if (!EXECUTABLE_INPUT || !isAbsolute(EXECUTABLE_INPUT)) {
        status = "BLOCKED";
        manifest.failureCode = "explicit_executable_missing_or_relative";
        throw new Error("blocked-input");
      }
      try {
        await access(EXECUTABLE_INPUT);
        manifest.executableSha256 = createHash("sha256")
          .update(await readFile(EXECUTABLE_INPUT))
          .digest("hex");
      } catch {
        status = "BLOCKED";
        manifest.failureCode = "explicit_executable_unavailable";
        throw new Error("blocked-input");
      }

      // Nest the existing owner-marked isolation fixture beneath this qualification run.
      isolation = await createV2TestIsolation(dirname(evidencePath));
      OWNER_RUNS.add(isolation);
      manifest.fixtureRoot = relative(projectRoot, isolation.root);
      manifest.statePath = relative(projectRoot, isolation.paths.state);
      checks.fixturePathsProjectLocal =
        manifest.fixtureRoot.startsWith("tmp/") && manifest.statePath.startsWith("tmp/");
      const { readdir } = await import("node:fs/promises");
      checks.fixtureCwdInitiallyEmpty = (await readdir(isolation.paths.cwd)).length === 0;
      await assertIsolatedEnvironment(isolation.environment, isolation.paths);
      checks.isolatedFixtureEnvironmentReady = true;
      const ambient = await inspectAmbientConfigSources();
      const preflight = evaluateStaticPrelaunchGate(isolation.environment, isolation.paths, ambient);
      checks.freshAmbientSystemManagedConfigGate = preflight.status === "READY_FOR_DISPOSABLE_SPIKE";
      if (!checks.freshAmbientSystemManagedConfigGate) {
        status = "BLOCKED";
        manifest.failureCode = "ambient_preflight_blocked";
        throw new Error("blocked-preflight");
      }

      fixture = createServer((request, response) => {
        if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
          response.writeHead(404).end();
          return;
        }
        modelCount += 1;
        if (modelCount > MAX_MODEL_REQUESTS) {
          response.writeHead(429).end();
          return;
        }
        let body = "";
        let bytes = 0;
        request.setEncoding("utf8");
        request.on("data", (chunk: string) => {
          bytes += Buffer.byteLength(chunk);
          if (bytes > 32_768) request.destroy();
          else body += chunk;
        });
        request.on("end", () => {
          if (bytes > 32_768) return;
          let parsed: unknown;
          try {
            parsed = JSON.parse(body);
          } catch {
            response.writeHead(400).end();
            return;
          }
          const modelObservation = observeFixtureRequestBody(parsed);
          const knownControls = [FOURTH_CONTROL, THIRD_CONTROL, STALL_CONTROL, FIRST_CONTROL];
          const latestControl = knownControls.find((control) =>
            modelObservation?.messages.some((message) => message.role === "user" && message.content === control),
          );
          const stalled = latestControl === STALL_CONTROL;
          const observation: {
            stalled: boolean;
            observation?: ReturnType<typeof observeFixtureRequestBody>;
            closedAt?: number;
          } = { stalled, observation: modelObservation };
          modelRequests.push(observation);
          if (stalled) {
            activeModelResponses.add(response);
            request.once("aborted", () => {
              observation.closedAt ??= Date.now();
              activeModelResponses.delete(response);
            });
            response.once("close", () => {
              observation.closedAt ??= Date.now();
              activeModelResponses.delete(response);
            });
            stalledStarted.resolve();
            void allowStalledCompletion.promise.then(() => {
              lateSentinelWriteAttempted = true;
              try {
                response.write(
                  `data: ${JSON.stringify({ id: "fixture-late", object: "chat.completion.chunk", created: 0, model: "fixture-model", choices: [{ index: 0, delta: { content: "late fixture text sentinel" }, finish_reason: null }] })}\n\n`,
                );
                response.end();
              } catch {
                // The test records only the attempted late fixture write, never response contents.
              }
            });
            return;
          }
          const headers = { "content-type": "text/event-stream", "cache-control": "no-cache" };
          response.writeHead(200, headers);
          response.write(
            `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 0, model: "fixture-model", choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] })}\n\n`,
          );
          response.write(
            `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 0, model: "fixture-model", choices: [{ index: 0, delta: { content: FIXTURE_ANSWER }, finish_reason: null }] })}\n\n`,
          );
          response.end(
            `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 0, model: "fixture-model", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
          );
        });
      });
      const mockPort = await listen(fixture);

      const config = join(isolation.paths.config, "opencode", "opencode.json");
      await writeFile(
        config,
        JSON.stringify({
          model: "fixture-provider/fixture-model",
          providers: {
            "fixture-provider": {
              name: "Disposable local fixture",
              package: "@opencode/ai/providers/openai-compatible",
              settings: { baseURL: `http://127.0.0.1:${mockPort}/v1` },
              models: { "fixture-model": { name: "Fixture model" } },
            },
          },
          agents: {
            "fixture-deny-all": {
              mode: "primary",
              description: "Fixture-only no-tools agent",
              permissions: [{ action: "*", resource: "*", effect: "deny" }],
            },
          },
          plugin: [],
          mcp: {},
        }),
        { mode: 0o600 },
      );

      const nativeFetch = globalThis.fetch.bind(globalThis);
      globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        if (overall.signal.aborted) throw new Error("adapter integration deadline exceeded");
        const url = input instanceof Request ? input.url : String(input);
        const parsedURL = new URL(url);
        const rawPath = parsedURL.pathname;
        const pathname = boundedPath(rawPath);
        const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
        const promptContextRoute = observePromptContextRoute(method, rawPath);
        if (
          method === "POST" &&
          ownedSessionID !== undefined &&
          rawPath === `/api/session/${encodeURIComponent(ownedSessionID)}/prompt`
        ) {
          try {
            const admission: unknown =
              typeof init?.body === "string"
                ? JSON.parse(init.body)
                : input instanceof Request
                  ? await input.clone().json()
                  : undefined;
            promptAdmissionTexts.push(observePromptAdmission(admission) ?? "");
          } catch {
            promptAdmissionTexts.push("");
          }
        }
        if (promptContextRoute !== "other") promptContextOperations[promptContextRoute] += 1;
        if (promptContextRoute === "wait") pendingNativeWaits += 1;
        apiCount += pathname.startsWith("/api/") ? 1 : 0;
        const operationKey = `${method} ${pathname}`;
        operationCounts.set(operationKey, (operationCounts.get(operationKey) ?? 0) + 1);
        if (pathname.startsWith("/api/")) requestOperations.push({ method, path: pathname });
        if (apiCount > MAX_API_REQUESTS) throw new Error("adapter API request budget exceeded");
        const signals = [overall.signal, ...(init?.signal ? [init.signal] : [])];
        let eventStreamNumber = 0;
        if (method === "GET" && rawPath === "/api/event") {
          const dropController = armedEventDropController ?? new AbortController();
          armedEventDropController = undefined;
          const adapterSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
          eventStreamNumber = eventFetches.length + 1;
          eventFetches.push({ dropController, adapterSignal, requestNumber: eventStreamNumber });
          signals.push(dropController.signal);
        }
        if (
          terminalPollDeadline !== undefined &&
          method === "GET" &&
          ownedSessionID &&
          rawPath === `/api/session/${encodeURIComponent(ownedSessionID)}`
        ) {
          signals.push(AbortSignal.timeout(Math.max(1, terminalPollDeadline - Date.now())));
        }
        const response = await nativeFetch(input, {
          ...init,
          signal: AbortSignal.any(signals),
        });
        if (promptContextRoute === "wait" && holdThirdWaitResponse) {
          holdThirdWaitResponse = false;
          heldThirdWaitResponse = response;
          await releaseThirdWaitResponse.promise;
        }
        if (promptContextRoute === "wait") pendingNativeWaits = Math.max(0, pendingNativeWaits - 1);
        if (pathname === "/api/info" && response.ok) {
          const copy = response.clone();
          const info: unknown = await copy.json();
          if (isRecord(info)) {
            if (typeof info.version === "string") observedVersion = info.version;
            if (typeof info.pid === "number") privatePID = info.pid;
            const ownedInfo = observeOwnedApiOrigin(response.url, url, response.status, info, EXPECTED_VERSION);
            if (ownedInfo && ownedInfo.pid === privatePID && ownedInfo.version === observedVersion) {
              ownedApiOrigin = ownedInfo.origin;
              const headers = new Headers(input instanceof Request ? input.headers : undefined);
              new Headers(init?.headers).forEach((value, key) => {
                headers.set(key, value);
              });
              if (headers.has("authorization")) ownedAuthHeaders = headers;
            }
          }
        }
        if (method === "GET" && ownedSessionID && rawPath === `/api/session/${encodeURIComponent(ownedSessionID)}`) {
          nativeSessionObservationCounts.pathMatched += 1;
          if (response.ok) {
            const sessionInfoResponse: unknown = await response
              .clone()
              .json()
              .catch(() => undefined);
            const observation = observeOwnedSessionInfo(sessionInfoResponse, ownedSessionID);
            if (observation.dataRecord) nativeSessionObservationCounts.bodyDataRecord += 1;
            if (observation.dataIDMatched) nativeSessionObservationCounts.dataIDMatched += 1;
            if (observation.outcomePresent) nativeSessionObservationCounts.outcomePresent += 1;
            if (observation.outcome) {
              nativeSessionObservationCounts.outcomeValidEnum += 1;
              nativeSessionOutcomes.push(observation.outcome);
            }
          }
        }
        if (
          method === "GET" &&
          rawPath === "/api/session/active" &&
          response.ok &&
          ownedSessionID &&
          duplicateLedger.retiredStreamCeiling !== undefined &&
          activeSnapshotRunningAfterResubscribe === undefined
        ) {
          // The first active snapshot after the explicit resubscribe is the one that hydration consumed.
          const body: unknown = await response
            .clone()
            .json()
            .catch(() => undefined);
          const active = isRecord(body) && isRecord(body.data) ? body.data : undefined;
          if (active && activeSnapshotRunningAfterResubscribe === undefined) {
            const entry = active[ownedSessionID];
            activeSnapshotRunningAfterResubscribe = isRecord(entry) && entry.type === "running";
          }
        }
        if (method === "GET" && rawPath === "/api/event" && response.ok && response.body) {
          // Observe the real native frames and re-deliver chosen already-sent blocks once, unchanged.
          return new Response(
            duplicateSseBlocks(
              response.body,
              (block) => planNativeFrameDuplicate(duplicateLedger, block, ownedSessionID, eventStreamNumber),
              {
                redelivered: (kind, copy) => recordDuplicateRedelivery(duplicateLedger, kind, copy),
                read: (kind) => recordDuplicateRead(duplicateLedger, kind),
              },
            ),
            { status: response.status, statusText: response.statusText, headers: response.headers },
          );
        }
        return response;
      }) as typeof fetch;
      console.error = (...args: unknown[]) => {
        if (typeof args[0] === "string" && args[0].startsWith("[opencode-chat] OpenCode event listener failed")) {
          listenerFailureDiagnostics += 1;
        }
        originalConsoleError(...args);
      };

      environmentReplaced = true;
      for (const key of Object.keys(process.env)) delete process.env[key];
      Object.assign(process.env, isolation.environment);
      const spawnGate = evaluateStaticPrelaunchGate(
        isolation.environment,
        isolation.paths,
        await inspectAmbientConfigSources(),
      );
      checks.freshGateImmediatelyBeforeAdapterConnect = spawnGate.status === "READY_FOR_DISPOSABLE_SPIKE";
      if (!checks.freshGateImmediatelyBeforeAdapterConnect) {
        status = "BLOCKED";
        manifest.failureCode = "spawn_ambient_preflight_blocked";
        throw new Error("blocked-preflight");
      }
      for (const path of Object.values(isolation.paths)) await assertOwnedPath(isolation.root, path);
      assertIsolatedEnvironment(isolation.environment, isolation.paths);
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
        executable: { path: resolve(EXECUTABLE_INPUT) },
      });
      const eventDisposable = agent.onEvent((event) => {
        events.push(event);
        if (awaitingReconnectMarker && event.type === "server.connected") {
          awaitingReconnectMarker = false;
          reconnectMarkerRequestIndex = requestOperations.length;
        }
        if (awaitingAutomaticRecoveryMarker && event.type === "server.connected") {
          awaitingAutomaticRecoveryMarker = false;
          automaticRecoveryMarkerRequestIndex = requestOperations.length;
          automaticRecovery.serverConnectedMarkersAfterDrop += 1;
        }
      });
      await agent.connect();
      checks.productionAdapterConnected = true;
      checks.exactVersionObserved = observedVersion === EXPECTED_VERSION;
      const paths = await agent.getPath();
      checks.getPathUsesExplicitHostPaths =
        paths.config === join(isolation.paths.config, "opencode") &&
        paths.state === isolation.paths.state &&
        paths.directory === isolation.paths.cwd;

      const session = await agent.createSession("fixture reconnect qualification");
      ownedSessionID = session.id;
      manifest.counts.sessions = 1;
      checks.singleFixtureSessionCreated = session.id.length > 0 && session.directory === isolation.paths.cwd;
      const authenticatedFixtureFetch = async (pathname: string, method: string, value?: unknown) => {
        if (!ownedApiOrigin || !ownedAuthHeaders) throw new Error("owned authentication context unavailable");
        const headers = new Headers(ownedAuthHeaders);
        if (method === "PUT") headers.set("content-type", "application/json");
        return globalThis.fetch(new URL(`/api${pathname}`, ownedApiOrigin), {
          method,
          headers,
          ...(value === undefined ? {} : { body: JSON.stringify(value) }),
          signal: overall.signal,
        });
      };
      const foreignPut = await authenticatedFixtureFetch(
        `/experimental/session/${encodeURIComponent(session.id)}/instructions/entries/user.reference`,
        "PUT",
        { value: "fixture foreign reference" },
      );
      checks.foreignInstructionSeeded = foreignPut.ok;
      await agent.sendMessage(session.id, FIRST_CONTROL, { primaryAgent: "fixture-deny-all", system: BRIEF_A });
      const firstAnswerVisible = await waitFor(
        () => events.some((event) => event.type === "message.part.delta" && event.properties.delta === FIXTURE_ANSWER),
        Math.min(deadline, Date.now() + 10_000),
      );
      checks.firstAnswerProducedDomainTextEvent = firstAnswerVisible;
      const firstMessages = await agent.getMessages(session.id);
      checks.nativeHistoryContainsFixtureAnswer = hasAssistantText(firstMessages, FIXTURE_ANSWER);
      checks.firstPromptProducedDomainEvents =
        events.some((event) => event.type === "session.status") &&
        events.some((event) => event.type === "message.part.delta" && event.properties.delta === FIXTURE_ANSWER);

      await agent.sendMessage(session.id, STALL_CONTROL, { primaryAgent: "fixture-deny-all", system: BRIEF_A });
      await Promise.race([
        stalledStarted.promise,
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("fixture model stall was not reached")),
            Math.min(10_000, Math.max(1, deadline - Date.now())),
          ),
        ),
      ]);
      checks.stalledModelRequestObserved = true;
      checks.promptAdmissionCountBeforeReconnectIsExactlyTwo =
        operationCounts.get("POST /api/session/:sessionID/prompt") === 2;
      const reconnectEventStart = events.length;
      duplicateLedger.deltaWindowClosed = true;
      // The synchronous part of resubscribeEvents() bumps the adapter's stream generation: every
      // connection opened so far is retired from this point.
      duplicateLedger.retiredStreamCeiling = eventFetches.length;
      const explicitEventFetchStart = eventFetches.length;
      const explicitDropController = new AbortController();
      armedEventDropController = explicitDropController;
      reconnectMarkerRequestIndex = undefined;
      awaitingReconnectMarker = true;
      await agent.resubscribeEvents();
      const hydrationObserved = await waitFor(
        () => {
          const sinceReconnect = events.slice(reconnectEventStart);
          const marker = sinceReconnect.findIndex((event) => event.type === "server.connected");
          if (marker < 0) return false;
          const busy = sinceReconnect.findIndex(
            (event, index) =>
              index > marker &&
              event.type === "session.status" &&
              event.properties.sessionID === session.id &&
              event.properties.status.type === "busy",
          );
          if (busy < 0) return false;
          const reads = requestOperations
            .slice(reconnectMarkerRequestIndex ?? requestOperations.length)
            .filter(
              (operation) =>
                operation.method === "GET" &&
                operation.path.startsWith("/api/") &&
                !["/api/event", "/api/info", "/api/location"].includes(operation.path),
            ).length;
          manifest.snapshotReadsAfterReconnect = reads;
          return reads >= 3;
        },
        Math.min(deadline, Date.now() + 5_000),
      );
      const afterReconnect = events.slice(reconnectEventStart);
      const newMarkerIndex = afterReconnect.findIndex((event) => event.type === "server.connected");
      const newBusyIndex = afterReconnect.findIndex(
        (event, index) =>
          index > newMarkerIndex &&
          event.type === "session.status" &&
          event.properties.sessionID === session.id &&
          event.properties.status.type === "busy",
      );
      checks.reconnectHasNewServerConnectedMarker = newMarkerIndex >= 0;
      checks.reconnectHydratedBusyAfterNewMarker = hydrationObserved && newBusyIndex > newMarkerIndex;
      checks.reconnectPerformedAuthoritativeSnapshotReads = manifest.snapshotReadsAfterReconnect >= 3;
      checks.promptAdmissionCountBeforeAbortIsExactlyTwo =
        operationCounts.get("POST /api/session/:sessionID/prompt") === 2;
      const reconnectHistory = await agent.getMessages(session.id);
      checks.reconnectPreservedHistory = hasAssistantText(reconnectHistory, FIXTURE_ANSWER);
      // Fault-inject one real native SSE fetch created by explicit resubscription.
      // The same fetch still carries the production adapter's own abort signal; only
      // this test-owned controller is aborted, so ClientError(Transport) must drive
      // the adapter's production one-shot automatic retry path.
      const droppedEventFetch = eventFetches
        .slice(explicitEventFetchStart)
        .find((eventFetch) => eventFetch.dropController === explicitDropController);
      if (armedEventDropController === explicitDropController) armedEventDropController = undefined;
      automaticRecovery.eventRequestsBeforeDrop = eventFetches.length;
      const automaticRecoveryEventStart = events.length;
      const automaticRecoveryEventFetchStart = eventFetches.length;
      const pidBeforeAutomaticRecovery = privatePID;
      automaticRecoveryMarkerRequestIndex = undefined;
      awaitingAutomaticRecoveryMarker = true;
      let adapterSignalStayedUnabortedAtInjection = false;
      if (droppedEventFetch) {
        droppedEventFetch.dropController.abort();
        adapterSignalStayedUnabortedAtInjection =
          droppedEventFetch.adapterSignal !== undefined && !droppedEventFetch.adapterSignal.aborted;
        automaticRecovery.injectedTransportDrops = 1;
      }
      const automaticRecoveryObserved = await waitFor(
        () => {
          const recoveredEvents = events.slice(automaticRecoveryEventStart);
          const marker = recoveredEvents.findIndex((event) => event.type === "server.connected");
          if (marker < 0) return false;
          const busy = recoveredEvents.findIndex(
            (event, index) =>
              index > marker &&
              event.type === "session.status" &&
              event.properties.sessionID === session.id &&
              event.properties.status.type === "busy",
          );
          const reads = requestOperations
            .slice(automaticRecoveryMarkerRequestIndex ?? requestOperations.length)
            .filter(
              (operation) =>
                operation.method === "GET" &&
                operation.path.startsWith("/api/") &&
                !["/api/event", "/api/info", "/api/location"].includes(operation.path),
            ).length;
          automaticRecovery.snapshotReadsAfterMarker = reads;
          return eventFetches.length > automaticRecoveryEventFetchStart && busy > marker && reads >= 3;
        },
        Math.min(deadline, Date.now() + 5_000),
      );
      automaticRecovery.eventRequestsAfterDrop = Math.max(0, eventFetches.length - automaticRecoveryEventFetchStart);
      automaticRecovery.sameOwnedChildPID =
        privatePID !== undefined &&
        privatePID === pidBeforeAutomaticRecovery &&
        !isProcessGroupGone(privatePID) &&
        operationCounts.get("GET /api/info") === 1;
      const autoRecoveredEvents = events.slice(automaticRecoveryEventStart);
      const automaticRecoveryMarker = autoRecoveredEvents.findIndex((event) => event.type === "server.connected");
      const automaticRecoveryBusy = autoRecoveredEvents.findIndex(
        (event, index) =>
          index > automaticRecoveryMarker &&
          event.type === "session.status" &&
          event.properties.sessionID === session.id &&
          event.properties.status.type === "busy",
      );
      checks.automaticRecoveryInjectedExactlyOneNativeEventTransportDrop =
        automaticRecovery.injectedTransportDrops === 1 && droppedEventFetch?.dropController.signal.aborted === true;
      checks.automaticRecoveryAdapterSignalStayedUnaborted = adapterSignalStayedUnabortedAtInjection;
      checks.automaticRecoveryOpenedNewNativeEventRequest =
        automaticRecoveryObserved && automaticRecovery.eventRequestsAfterDrop >= 1;
      checks.automaticRecoveryEmittedNewServerConnectedMarker = automaticRecoveryMarker >= 0;
      checks.automaticRecoveryHydratedOwnedSessionBusyAfterMarker = automaticRecoveryBusy > automaticRecoveryMarker;
      checks.automaticRecoveryReadAtLeastThreeSnapshotsAfterMarker = automaticRecovery.snapshotReadsAfterMarker >= 3;
      checks.automaticRecoveryStayedOnSameOwnedChildPID = automaticRecovery.sameOwnedChildPID;
      checks.automaticRecoveryPromptAdmissionsStillExactlyTwo =
        operationCounts.get("POST /api/session/:sessionID/prompt") === 2;
      checks.automaticRecoveryModelRequestsStillExactlyTwo = modelCount === 2;
      const recoveredHistory = await agent.getMessages(session.id);
      checks.automaticRecoveryPreservedHistory = hasAssistantText(recoveredHistory, FIXTURE_ANSWER);
      checks.automaticRecoveryModelRequestsStillExactlyTwo = modelCount === 2;

      const waitCountBeforeThird = promptContextOperations.wait;
      const thirdEventStart = events.length;
      holdThirdWaitResponse = true;
      let thirdPromptAdmitted = false;
      let thirdPromptFailure: { error: unknown } | undefined;
      const thirdPrompt = agent
        .sendMessage(session.id, THIRD_CONTROL, {
          primaryAgent: "fixture-deny-all",
          system: BRIEF_B,
        })
        .then(() => {
          thirdPromptAdmitted = true;
        })
        .catch((error: unknown) => {
          thirdPromptFailure = { error };
        });
      const thirdWaitPending = await waitFor(
        () => promptContextOperations.wait > waitCountBeforeThird && pendingNativeWaits > 0 && !thirdPromptAdmitted,
        Math.min(deadline, Date.now() + 5_000),
      );
      const heldPromptAdmissionsExactlyTwo =
        operationCounts.get("POST /api/session/:sessionID/prompt") === 2 && modelCount === 2;
      const heldReadbackResponse = await authenticatedFixtureFetch(
        `/experimental/session/${encodeURIComponent(session.id)}/instructions/entries`,
        "GET",
      );
      const heldReadback: unknown = await heldReadbackResponse.json().catch(() => undefined);
      const heldEntries = isRecord(heldReadback) && Array.isArray(heldReadback.data) ? heldReadback.data : [];
      const heldReserved = heldEntries.find((entry) => isRecord(entry) && entry.key === "scribe.prompt-context");
      const heldForeign = heldEntries.find((entry) => isRecord(entry) && entry.key === "user.reference");
      const activeStalledRequests = modelRequests.filter(
        (request) => request.stalled && request.closedAt === undefined,
      );
      const heldReadbackPath = `/api/experimental/session/${encodeURIComponent(session.id)}/instructions/entries`;
      checks.heldReadbackFromOwnedNativeOrigin =
        ownedApiOrigin !== undefined &&
        isOwnedInstructionObserverResponse(heldReadbackResponse.url, ownedApiOrigin, heldReadbackPath);
      checks.thirdPromptWaitedWhileSecondActive =
        thirdWaitPending &&
        heldReadbackResponse.ok &&
        !thirdPromptAdmitted &&
        heldThirdWaitResponse === undefined &&
        pendingNativeWaits === 1 &&
        promptContextOperations.put === 1 &&
        promptContextOperations.remove === 0 &&
        activeStalledRequests.length === 1 &&
        activeModelResponses.size === 1;
      checks.heldReadbackPreservedBriefAAndForeignEntry =
        isRecord(heldReserved) &&
        heldReserved.value === BRIEF_A &&
        isRecord(heldForeign) &&
        heldForeign.value === "fixture foreign reference";
      checks.promptAdmissionCountBeforeStopIsExactlyTwo = heldPromptAdmissionsExactlyTwo;
      checks.thirdPromptNotAdmittedBeforeStop = heldPromptAdmissionsExactlyTwo && !thirdPromptAdmitted;

      const abortOutcomeStart = nativeSessionOutcomes.length;
      const abortEventStart = events.length;
      await agent.abortSession(session.id);
      checks.adapterAbortReturned = true;
      const closed = await waitFor(
        () => modelRequests.some((request) => request.stalled && request.closedAt !== undefined),
        Math.min(deadline, Date.now() + 2_000),
      );
      checks.abortClosedFixtureConnection = closed;
      const terminalDeadline = Math.min(deadline, Date.now() + 3_000);
      terminalPollDeadline = terminalDeadline;
      const domainIdleAfterAbort = () =>
        events
          .slice(abortEventStart)
          .some(
            (event) =>
              event.type === "session.status" &&
              event.properties.sessionID === session.id &&
              event.properties.status.type === "idle",
          );
      await waitFor(domainIdleAfterAbort, Math.min(terminalDeadline, Date.now() + 400));
      const domainIdleSeenAfterAbortAtIdleWaitEnd = domainIdleAfterAbort();
      const ledgerIdleFramesAtIdleWaitEnd = duplicateLedger.idleFrameIDs.size;
      const availableApiRequests = Math.max(0, MAX_API_REQUESTS - apiCount);
      const terminalPollLimit = Math.min(20, availableApiRequests);
      while (
        terminalObservationPolls < terminalPollLimit &&
        Date.now() < terminalDeadline &&
        apiCount < MAX_API_REQUESTS
      ) {
        await agent.getSession(session.id);
        terminalObservationPolls += 1;
        if (nativeSessionOutcomes.slice(abortOutcomeStart).includes("interrupted")) break;
        const delayMs = Math.min(100, terminalDeadline - Date.now());
        if (delayMs > 0 && terminalObservationPolls < terminalPollLimit) {
          await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
        }
      }
      terminalPollDeadline = undefined;
      manifest.terminalObservationPolls = terminalObservationPolls;
      checks.terminalObservationPollingWithinBounds =
        terminalObservationPolls <= 20 && terminalObservationPolls <= availableApiRequests;
      checks.nativeSessionOutcomeInterrupted = nativeSessionOutcomes.slice(abortOutcomeStart).includes("interrupted");
      // The first terminal frame of the run is the abort's: the stalled prompt joined the first
      // turn's busy period. Deltas are judged on the pre-resubscribe window, terminal on the
      // settled snapshot (see settleTerminalIdle). Reuses the history read above; no extra API request.
      const settle = await settleTerminalIdle({
        ledger: duplicateLedger,
        readEvents: () => events,
        sessionID: session.id,
        deadline,
        fromIndex: reconnectEventStart,
      });
      const domainIdleSeenAfterAbortAtEvaluation = domainIdleAfterAbort();
      terminalDeliveryContext = {
        eventCount: settle.terminalEvents.length,
        input: {
          sessionID: session.id,
          resubscribeIndex: reconnectEventStart,
          snapshotRunning: activeSnapshotRunningAfterResubscribe,
          timing: {
            domainIdleSeenAfterAbortAtIdleWaitEnd,
            domainIdleSeenAfterAbortAtEvaluation,
            nativeInterruptedOutcomeSeenBeforeDomainIdle:
              checks.nativeSessionOutcomeInterrupted === true && !domainIdleSeenAfterAbortAtEvaluation,
            ledgerIdleFramesAtIdleWaitEnd,
            settleWaitedMs: settle.waitedMs,
            settleReachedLedgerCount: settle.reached,
          },
        },
      };
      duplicateLedger.closed = true;
      Object.assign(
        checks,
        evaluateDuplicateDelivery({
          ledger: duplicateLedger,
          events: events.slice(0, reconnectEventStart),
          terminalEvents: settle.terminalEvents,
          resubscribeIndex: reconnectEventStart,
          snapshotRunning: activeSnapshotRunningAfterResubscribe,
          history: reconnectHistory,
          sessionID: session.id,
          answer: FIXTURE_ANSWER,
        }),
      );
      checks.duplicateFrameNoListenerFailureDiagnostic = listenerFailureDiagnostics === 0;
      allowStalledCompletion.resolve();
      await new Promise((resolveTurn) => setImmediate(resolveTurn));
      const postAbortEvents = events.slice(reconnectEventStart);
      const postAbortHistory = await agent.getMessages(session.id);
      checks.lateFixtureTextAttempted = lateSentinelWriteAttempted;
      checks.noLateSentinelDomainText = !postAbortEvents.some(
        (event) => event.type === "message.part.delta" && event.properties.delta.includes("late fixture text sentinel"),
      );
      checks.noLateSentinelNativeHistory = !postAbortHistory.some((message) =>
        message.parts.some((part) => part.type === "text" && part.text.includes("late fixture text sentinel")),
      );
      checks.promptAdmissionCountBeforeQueuedWaitReleaseIsExactlyTwo =
        operationCounts.get("POST /api/session/:sessionID/prompt") === 2;
      checks.thirdWaitResponseHeldThroughAbortAndLateHistoryChecks =
        heldThirdWaitResponse !== undefined &&
        checks.nativeSessionOutcomeInterrupted &&
        checks.noLateSentinelNativeHistory;
      releaseThirdWaitResponse.resolve();
      heldThirdWaitResponse = undefined;
      await thirdPrompt;
      if (thirdPromptFailure) throw thirdPromptFailure.error;
      const thirdCompleted = await waitFor(
        () => {
          const output = events.slice(thirdEventStart);
          const answerIndex = output.findIndex(
            (event) => event.type === "message.part.delta" && event.properties.delta === FIXTURE_ANSWER,
          );
          const idleIndex = output.findIndex(
            (event, index) =>
              index > answerIndex &&
              event.type === "session.status" &&
              event.properties.sessionID === session.id &&
              event.properties.status.type === "idle",
          );
          return modelRequests.length >= 3 && answerIndex >= 0 && idleIndex > answerIndex;
        },
        Math.min(deadline, Date.now() + 10_000),
      );
      checks.thirdPromptAdmittedAndCompletedWithBriefB =
        thirdCompleted && operationCounts.get("POST /api/session/:sessionID/prompt") === 3;

      const fourthEventStart = events.length;
      await agent.sendMessage(session.id, FOURTH_CONTROL, { primaryAgent: "fixture-deny-all" });
      const fourthCompleted = await waitFor(
        () => {
          const output = events.slice(fourthEventStart);
          const answerIndex = output.findIndex(
            (event) => event.type === "message.part.delta" && event.properties.delta === FIXTURE_ANSWER,
          );
          const idleIndex = output.findIndex(
            (event, index) =>
              index > answerIndex &&
              event.type === "session.status" &&
              event.properties.sessionID === session.id &&
              event.properties.status.type === "idle",
          );
          return modelRequests.length >= 4 && answerIndex >= 0 && idleIndex > answerIndex;
        },
        Math.min(deadline, Date.now() + 10_000),
      );
      const finalReadbackResponse = await authenticatedFixtureFetch(
        `/experimental/session/${encodeURIComponent(session.id)}/instructions/entries`,
        "GET",
      );
      const finalReadback: unknown = await finalReadbackResponse.json().catch(() => undefined);
      const finalEntries = isRecord(finalReadback) && Array.isArray(finalReadback.data) ? finalReadback.data : [];
      const finalForeign = finalEntries.find((entry) => isRecord(entry) && entry.key === "user.reference");
      checks.fourthPromptOmittedContextAndCompleted =
        fourthCompleted && operationCounts.get("POST /api/session/:sessionID/prompt") === 4;
      checks.finalNativeRemovalPreservedForeignEntry =
        finalReadbackResponse.ok &&
        !finalEntries.some((entry) => isRecord(entry) && entry.key === "scribe.prompt-context") &&
        isRecord(finalForeign) &&
        finalForeign.value === "fixture foreign reference";
      checks.finalPromptAdmissionAndModelCountsExactlyFour =
        operationCounts.get("POST /api/session/:sessionID/prompt") === 4 && modelCount === 4;
      checks.promptAdmissionsContainOnlyExactControlsWithoutBrief =
        promptAdmissionTexts.length === 4 &&
        promptAdmissionTexts.every(
          (text, index) => text === [FIRST_CONTROL, STALL_CONTROL, THIRD_CONTROL, FOURTH_CONTROL][index],
        ) &&
        promptAdmissionTexts.every((text) => !text.includes(BRIEF_A) && !text.includes(BRIEF_B));
      const finalNativeHistory = await agent.getMessages(session.id);
      const assistantAnswers = finalNativeHistory.filter(
        ({ info, parts }) =>
          info.sessionID === session.id &&
          info.role === "assistant" &&
          typeof info.time.completed === "number" &&
          Number.isFinite(info.time.completed) &&
          info.finish === "stop" &&
          info.error === undefined &&
          parts.some((part) => part.type === "text" && part.text === FIXTURE_ANSWER),
      );
      const successfulAnswerMessages = assistantAnswers.filter(
        ({ parts }) => parts.filter((part) => part.type === "text" && part.text === FIXTURE_ANSWER).length === 1,
      );
      const historyControls = finalNativeHistory.flatMap(({ info, parts }) =>
        info.sessionID === session.id && info.role === "user"
          ? parts.flatMap((part) =>
              part.type === "text" && [FIRST_CONTROL, STALL_CONTROL, THIRD_CONTROL, FOURTH_CONTROL].includes(part.text)
                ? [part.text]
                : [],
            )
          : [],
      );
      checks.finalNativeHistoryHasThreeCompletedFixtureAnswersAndNoErrorSuccess =
        successfulAnswerMessages.length === 3 &&
        assistantAnswers.length === 3 &&
        new Set(assistantAnswers.map(({ info }) => info.id)).size === 3 &&
        checks.nativeSessionOutcomeInterrupted;
      checks.finalNativeHistoryHasEachRealControlOnceInOrder =
        [FIRST_CONTROL, STALL_CONTROL, THIRD_CONTROL, FOURTH_CONTROL].every(
          (control) => historyControls.filter((entry) => entry === control).length === 1,
        ) && historyControls.join("\n") === [FIRST_CONTROL, STALL_CONTROL, THIRD_CONTROL, FOURTH_CONTROL].join("\n");

      const requestObservations = modelRequests.map((request) => request.observation);
      const stages = observePromptContextStages(requestObservations);
      checks.allFourRequestsRetainInitialSystemBriefA = stages.allRequestsKeepInitialSystemBriefA;
      checks.noRequestReplacesSystemBaselineWithB = stages.noRequestReplacesSystemBaselineWithB;
      checks.firstAndSecondControlsExact = stages.firstAndSecondControlsExact;
      checks.thirdSupersessionBetweenStallAndThirdControl = stages.thirdHasSupersessionBetweenStallAndThirdControl;
      checks.fourthRemovalBetweenThirdAndFourthControl = stages.fourthHasBThenRemovalBetweenThirdAndFourthControl;
      checks.realControlsOnceInOrder = stages.realControlsOnceInOrder;
      checks.exactCurrentControlIsLast = stages.exactCurrentControlIsLast;
      checks.noBriefWasPastedIntoRealUserControls = stages.noBriefWasPastedIntoRealUserControls;
      checks.nativeSystemUpdateWrappersOnlyAtExpectedStages = stages.wrappersOnlyAtExpectedStage;
      checks.reservedContextMutationCountsAreExpected =
        promptContextOperations.put === 2 && promptContextOperations.remove === 1 && promptContextOperations.wait >= 3;
      eventDisposable.dispose();
      status = Object.values(checks).every(Boolean) ? "PASS" : "FAIL";
      manifest.counts = { apiRequests: apiCount, modelRequests: modelCount, sessions: 1 };
      manifest.apiOperations = Object.fromEntries(operationCounts);
      manifest.promptAdmissions = operationCounts.get("POST /api/session/:sessionID/prompt") ?? 0;
      manifest.nativeSessionOutcomes = [...nativeSessionOutcomes];
      manifest.nativeSessionObservationCounts = { ...nativeSessionObservationCounts };
      manifest.status = status === "PASS" ? "RUNNING" : status;
      await persist();
    } catch (error) {
      if (status !== "BLOCKED") status = "FAIL";
      manifest.failureCode ??= error instanceof Error ? error.name : "unexpected";
      manifest.counts = { apiRequests: apiCount, modelRequests: modelCount, sessions: manifest.counts.sessions };
      manifest.apiOperations = Object.fromEntries(operationCounts);
      manifest.promptAdmissions = operationCounts.get("POST /api/session/:sessionID/prompt") ?? 0;
      manifest.nativeSessionOutcomes = [...nativeSessionOutcomes];
      manifest.nativeSessionObservationCounts = { ...nativeSessionObservationCounts };
      manifest.status = status;
      await persist();
    } finally {
      clearTimeout(timer);
      terminalPollDeadline = undefined;
      overall.abort();
      allowStalledCompletion.resolve();
      releaseThirdWaitResponse.resolve();
      if (agent) {
        try {
          agent.disconnect();
          // `disconnect()` is void; await the existing lifecycle promise read-only in this worker.
          const cleanup = (agent as unknown as { cleanupPromise?: Promise<void> }).cleanupPromise;
          if (cleanup) {
            await cleanup;
            manifest.cleanup.agentDisconnected = true;
          } else {
            status = "FAIL";
            manifest.failureCode = "adapter_cleanup_promise_unavailable";
          }
        } catch {
          status = "FAIL";
          manifest.failureCode = "adapter_disconnect_failed";
        }
      }
      if (privatePID !== undefined) {
        processReaped = await waitFor(() => isProcessGroupGone(privatePID as number), Date.now() + 3_000);
        manifest.cleanup.ownedProcessGroupReaped = processReaped;
      }
      if (fixture) {
        for (const response of activeModelResponses) response.destroy();
        await new Promise<void>((resolveClose) => fixture?.close(() => resolveClose()));
        fixtureClosed = true;
      }
      if (isolation) {
        try {
          await isolation.dispose();
          manifest.cleanup.fixtureStateRemoved =
            (await absent(isolation.root)) && (await absent(isolation.paths.state));
        } catch {
          manifest.cleanup.fixtureStateRemoved = false;
        }
        OWNER_RUNS.delete(isolation);
      }
      if (environmentReplaced) {
        for (const key of Object.keys(process.env)) delete process.env[key];
        Object.assign(process.env, originalEnvironment);
      }
      const environmentRestored = sameEnvironment(originalEnvironment);
      console.error = originalConsoleError;
      globalThis.fetch = originalFetch;
      const fetchRestored = globalThis.fetch === originalFetch;
      checks.workerEnvironmentRestoredInFinally = environmentRestored;
      checks.fetchRestoredInFinally = fetchRestored;
      manifest.status = status;
      manifest.observedVersion = observedVersion;
      manifest.counts = { apiRequests: apiCount, modelRequests: modelCount, sessions: manifest.counts.sessions };
      manifest.apiOperations = Object.fromEntries(operationCounts);
      manifest.promptAdmissions = operationCounts.get("POST /api/session/:sessionID/prompt") ?? 0;
      manifest.nativeSessionOutcomes = [...nativeSessionOutcomes];
      manifest.nativeSessionObservationCounts = { ...nativeSessionObservationCounts };
      manifest.terminalObservationPolls = terminalObservationPolls;
      manifest.cleanup.ownedProcessGroupReaped ??= processReaped;
      if (!checks.requestBounds)
        checks.requestBounds =
          apiCount <= MAX_API_REQUESTS && modelCount <= MAX_MODEL_REQUESTS && manifest.counts.sessions <= MAX_SESSIONS;
      checks.fixtureServerClosed = fixtureClosed;
      checks.disconnectAndOwnedGroupCleanup =
        manifest.cleanup.agentDisconnected && manifest.cleanup.ownedProcessGroupReaped === true;
      checks.fixtureStateRemoved = manifest.cleanup.fixtureStateRemoved === true;
      if (
        status === "PASS" &&
        (!checks.requestBounds ||
          !checks.fixtureServerClosed ||
          !checks.disconnectAndOwnedGroupCleanup ||
          !checks.fixtureStateRemoved ||
          !checks.workerEnvironmentRestoredInFinally ||
          !checks.fetchRestoredInFinally)
      )
        manifest.status = "FAIL";
      await persist();
    }

    const persisted = JSON.parse(await readFile(evidencePath, "utf8")) as Manifest;
    expect(persisted.status).toBe("PASS");
    expect(persisted.sourceCommit).toBe("bb25a2f4a3f3f04d7c344bec0c0574ea3510b3b1");
    expect(persisted.sourceCommitMeaning).toBe("inspected-release-tag");
    expect(persisted.clientPackage).toBe("@opencode/client@2.1.0");
    expect(persisted.executableSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(persisted.counts.apiRequests).toBeLessThanOrEqual(MAX_API_REQUESTS);
    expect(persisted.counts.modelRequests).toBeLessThanOrEqual(MAX_MODEL_REQUESTS);
    expect(persisted.counts.sessions).toBeLessThanOrEqual(MAX_SESSIONS);
    expect(persisted.cleanup).toEqual({
      agentDisconnected: true,
      ownedProcessGroupReaped: true,
      fixtureStateRemoved: true,
    });
    expect(await realpath(dirname(evidencePath))).toBe(dirname(evidencePath));
  },
  OVERALL_TIMEOUT_MS + 5_000,
);
