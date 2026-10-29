/**
 * @opencode-chat/agent-opencode - V2→Domain Type Mappers
 *
 * Converts types from @opencode/client to @opencode-chat/core domain types.
 * Each mapper is a pure function with no side effects.
 */

import * as path from "node:path";
import type {
  AgentInfo as V2AgentInfo,
  IntegrationInfo as V2IntegrationInfo,
  ModelInfo as V2ModelInfo,
  ProviderInfo as V2ProviderInfo,
  SessionInfo as V2SessionInfo,
  SkillInfo as V2SkillInfo,
} from "@opencode/client";

import type {
  AgentEvent,
  AgentInfo,
  AllProvidersData,
  AppConfig,
  AppPaths,
  ChatMessage,
  ChatMessageWithParts,
  ChatSession,
  FileDiff,
  FilePart,
  McpServerLifecycle,
  McpStatus,
  MessagePart,
  Permission,
  ProviderInfo,
  QuestionRequest,
  SkillInfo,
  TextPart,
  TodoItem,
  ToolPart,
} from "@opencode-chat/core";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireFiniteNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Invalid V2 session ${field}`);
  return value;
}

/** Explicitly maps the pinned V2 SessionInfo wire contract into the UI domain. */
export function mapV2Session(
  value: V2SessionInfo | unknown,
  expected?: {
    sessionID?: string;
    directory?: string;
    fork?: { sessionID: string; boundaryType: "before" | "through"; messageID?: string };
  },
): ChatSession {
  if (!isRecord(value)) throw new Error("Invalid V2 session response");
  const knownFields = new Set([
    "id",
    "parentID",
    "fork",
    "projectID",
    "agent",
    "model",
    "cost",
    "tokens",
    "outcome",
    "time",
    "title",
    "subpath",
    "metadata",
    "permissions",
    "revert",
    "location",
  ]);
  if (Object.keys(value).some((field) => !knownFields.has(field))) throw new Error("Unknown V2 session response field");
  const id = value.id;
  const projectID = value.projectID;
  const location = value.location;
  const time = value.time;
  const tokens = value.tokens;
  if (typeof id !== "string" || id.length === 0) throw new Error("Invalid V2 session id");
  if (expected?.sessionID !== undefined && id !== expected.sessionID) {
    throw new Error("V2 session response ID did not match the requested session.");
  }
  if (typeof projectID !== "string" || projectID.length === 0) throw new Error("Invalid V2 session projectID");
  if (!isRecord(location) || typeof location.directory !== "string" || location.directory.length === 0) {
    throw new Error("Invalid V2 session location");
  }
  if (expected?.directory !== undefined && location.directory !== expected.directory) {
    throw new Error("V2 session response location did not match the requested workspace.");
  }
  if (!isRecord(time)) throw new Error("Invalid V2 session time");
  if (!isRecord(tokens) || !isRecord(tokens.cache)) throw new Error("Invalid V2 session tokens");
  if (value.title !== undefined && typeof value.title !== "string") throw new Error("Invalid V2 session title");
  if (value.parentID !== undefined && (typeof value.parentID !== "string" || value.parentID.length === 0)) {
    throw new Error("Invalid V2 session parentID");
  }
  if (value.fork !== undefined) {
    if (
      !isRecord(value.fork) ||
      Object.keys(value.fork).some((field) => field !== "sessionID" && field !== "boundary") ||
      typeof value.fork.sessionID !== "string" ||
      value.fork.sessionID.length === 0 ||
      !isRecord(value.fork.boundary) ||
      Object.keys(value.fork.boundary).some((field) => field !== "type" && field !== "messageID") ||
      (value.fork.boundary.type !== "before" && value.fork.boundary.type !== "through") ||
      typeof value.fork.boundary.messageID !== "string" ||
      value.fork.boundary.messageID.length === 0
    ) {
      throw new Error("Invalid V2 session fork provenance");
    }
  }
  if (expected?.fork) {
    if (
      !isRecord(value.fork) ||
      !isRecord(value.fork.boundary) ||
      value.fork.sessionID !== expected.fork.sessionID ||
      value.fork.boundary.type !== expected.fork.boundaryType ||
      (expected.fork.messageID !== undefined && value.fork.boundary.messageID !== expected.fork.messageID)
    ) {
      throw new Error("V2 fork response did not match the requested fork provenance.");
    }
  }
  const created = requireFiniteNumber(time.created, "time.created");
  const updated = requireFiniteNumber(time.updated, "time.updated");
  for (const field of ["idle", "viewed", "archived"] as const) {
    if (time[field] !== undefined) requireFiniteNumber(time[field], `time.${field}`);
  }
  const input = requireFiniteNumber(tokens.input, "tokens.input");
  const output = requireFiniteNumber(tokens.output, "tokens.output");
  const reasoning = requireFiniteNumber(tokens.reasoning, "tokens.reasoning");
  const cacheRead = requireFiniteNumber(tokens.cache.read, "tokens.cache.read");
  const cacheWrite = requireFiniteNumber(tokens.cache.write, "tokens.cache.write");
  return {
    id,
    title: typeof value.title === "string" && value.title.length > 0 ? value.title : "Untitled",
    time: { created, updated },
    projectID,
    directory: location.directory,
    tokens: { input, output, reasoning, cache: { read: cacheRead, write: cacheWrite } },
    ...(typeof value.parentID === "string" ? { parentID: value.parentID } : {}),
    ...(value.revert !== undefined ? { revert: value.revert } : {}),
  };
}

function requireV2MessageID(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= V2_EVENT_ID_LENGTH_LIMIT;
}

function requireV2MessageTime(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid V2 message ${field}.`);
  }
  return value;
}

function requireV2MessageString(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`Invalid V2 message ${field}.`);
  return value;
}

function requireV2MessageRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`Invalid V2 message ${field}.`);
  return value;
}

function containsControlCharacters(value: string): boolean {
  return [...value].some((character) => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127);
}

function mapV2FileMention(value: unknown): { start: number; end: number; text: string } | undefined {
  if (value === undefined) return undefined;
  const mention = requireV2MessageRecord(value, "file mention");
  if (
    typeof mention.start !== "number" ||
    !Number.isSafeInteger(mention.start) ||
    mention.start < 0 ||
    typeof mention.end !== "number" ||
    !Number.isSafeInteger(mention.end) ||
    mention.end < mention.start ||
    typeof mention.text !== "string"
  ) {
    throw new Error("Invalid V2 message file mention.");
  }
  return { start: mention.start, end: mention.end, text: mention.text };
}

function requireV2Mime(value: unknown, field: string): string {
  const mime = requireV2MessageString(value, field);
  if (!/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/.test(mime)) {
    throw new Error(`Invalid V2 message ${field}.`);
  }
  return mime;
}

function requireV2Base64(value: unknown): string {
  const data = requireV2MessageString(value, "file attachment data");
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) {
    throw new Error("Invalid V2 message file attachment data.");
  }
  if (Buffer.from(data, "base64").toString("base64") !== data) {
    throw new Error("Invalid V2 message file attachment data.");
  }
  return data;
}

function fallbackAttachmentName(uri: string): string {
  if (/^data:/i.test(uri)) return "Attachment";
  try {
    const segment = new URL(uri).pathname.split("/").filter(Boolean).at(-1);
    if (segment) return decodeURIComponent(segment) || "Attachment";
  } catch {
    // A non-hierarchical URI has no useful basename; keep a neutral label.
  }
  return "Attachment";
}

function mapV2FileAttachment(value: unknown, messageID: string, sessionID: string, index: number): FilePart {
  const file = requireV2MessageRecord(value, "file attachment");
  const source = requireV2MessageRecord(file.source, "file attachment source");
  const mime = requireV2Mime(file.mime, "file attachment MIME type");
  const data = requireV2Base64(file.data);
  const name = file.name === undefined ? undefined : requireV2MessageString(file.name, "file attachment name");
  if (name !== undefined && name.length === 0) throw new Error("Invalid V2 message file attachment name.");
  const sourceURI = source.type === "uri" ? requireV2MessageString(source.uri, "file attachment URI") : undefined;
  const filename = name ?? (sourceURI === undefined ? "Attachment" : fallbackAttachmentName(sourceURI));
  const description =
    file.description === undefined
      ? undefined
      : requireV2MessageString(file.description, "file attachment description");
  const mention = mapV2FileMention(file.mention);
  let url: string;
  if (source.type === "uri") {
    if (sourceURI === undefined) throw new Error("Invalid V2 message file attachment URI.");
    url = sourceURI;
    if (!url || containsControlCharacters(url)) throw new Error("Invalid V2 message file attachment URI.");
    try {
      new URL(url);
    } catch {
      throw new Error("Invalid V2 message file attachment URI.");
    }
  } else if (source.type === "inline") {
    url = `data:${mime};base64,${data}`;
  } else {
    throw new Error("Invalid V2 message file attachment source type.");
  }
  return {
    id: `v2:file:${encodeURIComponent(messageID)}:${index}`,
    sessionID,
    messageID,
    type: "file",
    url,
    filename,
    mime,
    ...(description === undefined ? {} : { description }),
    ...(mention === undefined ? {} : { mention }),
  };
}

function mapV2UserMessage(message: Record<string, unknown>, sessionID: string): ChatMessageWithParts {
  const id = requireV2MessageID(message.id)
    ? message.id
    : (() => {
        throw new Error("Invalid V2 user message ID.");
      })();
  const time = requireV2MessageRecord(message.time, "user message time");
  const text = requireV2MessageString(message.text, "user message text");
  const info: ChatMessage = {
    id,
    sessionID,
    role: "user",
    time: { created: requireV2MessageTime(time.created, "time.created") },
  };
  const parts: MessagePart[] = [
    {
      id: `v2:text:${encodeURIComponent(id)}:0`,
      sessionID,
      messageID: id,
      type: "text",
      text,
    },
  ];
  const files = message.files === undefined ? [] : message.files;
  if (!Array.isArray(files)) throw new Error("Invalid V2 user message files.");
  for (const [index, file] of files.entries()) {
    parts.push(mapV2FileAttachment(file, id, sessionID, index));
  }
  const agents = message.agents === undefined ? [] : message.agents;
  if (!Array.isArray(agents)) throw new Error("Invalid V2 user message agents.");
  for (const [index, value] of agents.entries()) {
    const agent = requireV2MessageRecord(value, "user agent mention");
    const name = requireV2MessageString(agent.name, "user agent mention name");
    if (!name) throw new Error("Invalid V2 user agent mention name.");
    parts.push({
      id: `v2:agent:${encodeURIComponent(id)}:${index}`,
      sessionID,
      messageID: id,
      type: "agent",
      name,
    });
  }
  const skills = message.skills === undefined ? [] : message.skills;
  if (!Array.isArray(skills)) throw new Error("Invalid V2 user message skills.");
  for (const [index, value] of skills.entries()) {
    const skill = requireV2MessageRecord(value, "user skill mention");
    const skillID = requireV2MessageID(skill.id)
      ? skill.id
      : (() => {
          throw new Error("Invalid V2 user skill ID.");
        })();
    const name = requireV2MessageString(skill.name, "user skill mention name");
    if (!name) throw new Error("Invalid V2 user skill mention name.");
    parts.push({
      id: `v2:skill:${encodeURIComponent(id)}:${index}`,
      sessionID,
      messageID: id,
      type: "skill",
      skillID,
      name,
    });
  }
  return { info, parts };
}

function mapToolContent(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) throw new Error("Invalid V2 tool result content.");
  return value
    .map((entry) => {
      const item = requireV2MessageRecord(entry, "tool result content");
      if (item.type === "text") return requireV2MessageString(item.text, "tool result text");
      if (item.type !== "file") throw new Error("Unknown V2 tool result content type.");
      const uri = requireV2MessageString(item.uri, "tool result file URI");
      const mime = requireV2Mime(item.mime, "tool result file MIME type");
      if (!uri || containsControlCharacters(uri)) throw new Error("Invalid V2 tool result file URI.");
      try {
        new URL(uri);
      } catch {
        throw new Error("Invalid V2 tool result file URI.");
      }
      const name =
        item.name === undefined || item.name === null
          ? fallbackAttachmentName(uri)
          : requireV2MessageString(item.name, "tool result file name");
      if (!name) throw new Error("Invalid V2 tool result file name.");
      return /^data:/i.test(uri) ? `${name} (inline ${mime} result)` : `${name} — ${uri} (${mime})`;
    })
    .join("\n");
}

function mapV2AssistantMessage(message: Record<string, unknown>, sessionID: string): ChatMessageWithParts {
  const id = requireV2MessageID(message.id)
    ? message.id
    : (() => {
        throw new Error("Invalid V2 assistant message ID.");
      })();
  const time = requireV2MessageRecord(message.time, "assistant time");
  const model = requireV2MessageRecord(message.model, "assistant model");
  const modelID = requireV2MessageID(model.id)
    ? model.id
    : (() => {
        throw new Error("Invalid V2 assistant model ID.");
      })();
  const providerID = requireV2MessageID(model.providerID)
    ? model.providerID
    : (() => {
        throw new Error("Invalid V2 assistant provider ID.");
      })();
  const agent = requireV2MessageString(message.agent, "assistant agent");
  const contentItems = message.content;
  if (!agent || !Array.isArray(contentItems)) throw new Error("Invalid V2 assistant message.");
  const created = requireV2MessageTime(time.created, "time.created");
  const completed = time.completed === undefined ? undefined : requireV2MessageTime(time.completed, "time.completed");
  const cost = message.cost === undefined ? undefined : requireFiniteNumber(message.cost, "assistant cost");
  if (cost !== undefined && cost < 0) throw new Error("Invalid V2 assistant cost.");
  const tokens = message.tokens === undefined ? undefined : mapSnapshotTokens(message.tokens);
  const finishes = new Set(["stop", "length", "tool-calls", "content-filter", "error", "unknown"]);
  if (message.finish !== undefined && (typeof message.finish !== "string" || !finishes.has(message.finish)))
    throw new Error("Invalid V2 assistant finish value.");
  if (message.error !== undefined) {
    const error = requireV2MessageRecord(message.error, "assistant error");
    requireV2MessageString(error.type, "assistant error type");
    requireV2MessageString(error.message, "assistant error message");
  }
  const info: ChatMessage = {
    id,
    sessionID,
    role: "assistant",
    time: { created, ...(completed === undefined ? {} : { completed }) },
    agent,
    modelID,
    providerID,
    model: { providerID, modelID },
    ...(cost === undefined ? {} : { cost }),
    ...(tokens === undefined ? {} : { tokens }),
    ...(message.finish === undefined ? {} : { finish: message.finish }),
    ...(message.error === undefined ? {} : { error: { name: "OpenCodeError", message: "Assistant response failed." } }),
  };
  const parts: MessagePart[] = [];
  for (const [ordinal, contentValue] of contentItems.entries()) {
    const content = requireV2MessageRecord(contentValue, "assistant content");
    if (typeof content.type !== "string") throw new Error("Invalid V2 assistant content type.");
    if (content.type === "text") {
      parts.push({
        id: deriveV2EventPartID("text", id, ordinal),
        sessionID,
        messageID: id,
        type: "text",
        text: requireV2MessageString(content.text, "assistant text content"),
      });
    } else if (content.type === "reasoning") {
      const reasoningTime =
        content.time === undefined ? undefined : requireV2MessageRecord(content.time, "reasoning time");
      const start =
        reasoningTime === undefined ? undefined : requireV2MessageTime(reasoningTime.created, "reasoning.time.created");
      const end =
        reasoningTime?.completed === undefined
          ? undefined
          : requireV2MessageTime(reasoningTime.completed, "reasoning.time.completed");
      parts.push({
        id: deriveV2EventPartID("reasoning", id, ordinal),
        sessionID,
        messageID: id,
        type: "reasoning",
        text: requireV2MessageString(content.text, "assistant reasoning content"),
        ...(start === undefined ? {} : { time: { start, ...(end === undefined ? {} : { end }) } }),
      });
    } else if (content.type === "tool") {
      const toolID = requireV2MessageID(content.id)
        ? content.id
        : (() => {
            throw new Error("Invalid V2 tool ID.");
          })();
      const toolName = requireV2MessageString(content.name, "tool name");
      if (!toolName) throw new Error("Invalid V2 tool name.");
      const toolTime = requireV2MessageRecord(content.time, "tool time");
      const createdAt = requireV2MessageTime(toolTime.created, "tool time.created");
      const ranAt = toolTime.ran === undefined ? undefined : requireV2MessageTime(toolTime.ran, "tool time.ran");
      const completedAt =
        toolTime.completed === undefined ? undefined : requireV2MessageTime(toolTime.completed, "tool time.completed");
      const executed = content.executed;
      if (executed !== undefined && typeof executed !== "boolean") throw new Error("Invalid V2 tool executed flag.");
      const state = requireV2MessageRecord(content.state, "tool state");
      const stateMetadata =
        state.metadata === undefined ? undefined : requireV2MessageRecord(state.metadata, "tool metadata");
      if (state.status === "running" && stateMetadata === undefined)
        throw new Error("Missing V2 running tool metadata.");
      const base = {
        id: toolID,
        sessionID,
        messageID: id,
        type: "tool" as const,
        callID: toolID,
        tool: toolName,
      };
      const metadata = {
        ...(stateMetadata === undefined ? {} : { metadata: stateMetadata }),
        time: {
          created: createdAt,
          ...(ranAt === undefined ? {} : { ran: ranAt }),
          ...(completedAt === undefined ? {} : { completed: completedAt }),
        },
        ...(executed === undefined ? {} : { executed }),
      };
      if (state.status === "streaming") {
        parts.push({
          ...base,
          state: {
            status: "running",
            input: requireV2MessageString(state.input, "streaming tool input"),
            ...(stateMetadata === undefined ? {} : { metadata: stateMetadata }),
          },
          metadata,
        });
      } else if (state.status === "running") {
        parts.push({
          ...base,
          state: {
            status: "running",
            input: requireV2MessageRecord(state.input, "running tool input"),
            ...(stateMetadata === undefined ? {} : { metadata: stateMetadata }),
          },
          metadata,
        });
      } else if (state.status === "completed") {
        parts.push({
          ...base,
          state: {
            status: "completed",
            input: requireV2MessageRecord(state.input, "completed tool input"),
            output: mapToolContent(state.content),
            ...(stateMetadata === undefined ? {} : { metadata: stateMetadata }),
          },
          metadata,
        });
      } else if (state.status === "error") {
        const toolError = requireV2MessageRecord(state.error, "tool error");
        requireV2MessageString(toolError.type, "tool error type");
        requireV2MessageString(toolError.message, "tool error message");
        const partialOutput = state.content === undefined ? undefined : mapToolContent(state.content);
        parts.push({
          ...base,
          state: {
            status: "error",
            input: requireV2MessageRecord(state.input, "error tool input"),
            error: partialOutput === undefined ? "Tool execution failed." : `Tool execution failed.\n${partialOutput}`,
            ...(stateMetadata === undefined ? {} : { metadata: stateMetadata }),
          },
          metadata,
        });
      } else {
        throw new Error("Unknown V2 tool state.");
      }
    } else {
      throw new Error("Unknown V2 assistant content type.");
    }
  }
  return { info, parts };
}

function mapSnapshotTokens(value: unknown): NonNullable<ChatMessage["tokens"]> {
  const tokens = requireV2MessageRecord(value, "assistant tokens");
  const cache = requireV2MessageRecord(tokens.cache, "assistant cache tokens");
  const input = requireFiniteNumber(tokens.input, "assistant input tokens");
  const output = requireFiniteNumber(tokens.output, "assistant output tokens");
  const reasoning = requireFiniteNumber(tokens.reasoning, "assistant reasoning tokens");
  const read = requireFiniteNumber(cache.read, "assistant cache read tokens");
  const write = requireFiniteNumber(cache.write, "assistant cache write tokens");
  if ([input, output, reasoning, read, write].some((item) => item < 0))
    throw new Error("Invalid V2 assistant token usage.");
  return {
    input,
    output,
    reasoning,
    cache: { read, write },
  };
}

/** Maps only native user/assistant snapshots; control/context message variants have no ChatMessage representation. */
export function mapV2Messages(messages: unknown[], sessionID: string): ChatMessageWithParts[] {
  if (!requireV2MessageID(sessionID) || !Array.isArray(messages)) throw new Error("Invalid V2 messages response.");
  const mapped: ChatMessageWithParts[] = [];
  for (const message of messages) {
    if (!isRecord(message) || typeof message.type !== "string") throw new Error("Invalid V2 message record.");
    if (!requireV2MessageID(message.id)) throw new Error("Invalid V2 message identity.");
    if (message.type === "user") mapped.push(mapV2UserMessage(message, sessionID));
    else if (message.type === "assistant") mapped.push(mapV2AssistantMessage(message, sessionID));
    // Native system/synthetic/selection/compaction/skill/shell/idle records and
    // future unknown message variants have no domain representation; never leak
    // them as user text.
  }
  return mapped;
}

/** Maps the native prompt-admission envelope through the history user-message mapper. */
export function mapV2UserAdmission(
  value: unknown,
  expected: { sessionID: string; text: string; messageID?: string },
): ChatMessageWithParts {
  const invalidAdmission = () => new Error("Native V2 prompt did not return a valid user-admission response.");
  if (
    !isRecord(value) ||
    !requireV2MessageID(value.id) ||
    value.sessionID !== expected.sessionID ||
    value.type !== "user" ||
    (expected.messageID !== undefined && value.id !== expected.messageID) ||
    !isRecord(value.time) ||
    !isRecord(value.payload) ||
    value.payload.text !== expected.text ||
    (value.delivery !== "steer" && value.delivery !== "queue")
  ) {
    throw invalidAdmission();
  }

  try {
    return mapV2UserMessage(
      {
        id: value.id,
        time: value.time,
        text: value.payload.text,
        ...(value.payload.files === undefined ? {} : { files: value.payload.files }),
        ...(value.payload.agents === undefined ? {} : { agents: value.payload.agents }),
        ...(value.payload.skills === undefined ? {} : { skills: value.payload.skills }),
      },
      expected.sessionID,
    );
  } catch {
    throw invalidAdmission();
  }
}

// ============================================================
// Event
// ============================================================

function isEventRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type ActiveTextPart = { sessionID: string; messageID: string; ordinal: number; startedAt: number };
type ActiveReasoningPart = { sessionID: string; messageID: string; ordinal: number };
type ActiveToolPart = {
  sessionID: string;
  messageID: string;
  id: string;
  name: string;
  inputText?: string;
  part: ToolPart;
};
type V2EventMapperState = {
  activeAssistantHeaders: Map<string, ChatMessage>;
  activeTextParts: Map<string, ActiveTextPart>;
  activeReasoningParts: Map<string, ActiveReasoningPart>;
  activeToolParts: Map<string, ActiveToolPart>;
  questionForms: Map<string, QuestionRequest>;
  permissionRequests: Map<string, Permission>;
};

export type V2SessionLifecycleFrame = { kind: "created" | "updated"; sessionID: string };

const V2_SESSION_UPDATE_EVENTS = new Set([
  "session.renamed",
  "session.metadata.updated",
  "session.agent.selected",
  "session.model.selected",
  "session.usage.updated",
  "session.viewed",
]);

/** Identifies only native lifecycle frames whose partial payload requires an authoritative session read. */
export function getV2SessionLifecycleFrame(value: unknown): V2SessionLifecycleFrame | undefined {
  if (!isEventRecord(value) || !isEventRecord(value.data) || !requireEventID(value.data.sessionID)) return undefined;
  if (value.type === "session.created") return { kind: "created", sessionID: value.data.sessionID };
  if (typeof value.type === "string" && V2_SESSION_UPDATE_EVENTS.has(value.type)) {
    return { kind: "updated", sessionID: value.data.sessionID };
  }
  return undefined;
}

const V2_EVENT_ID_LENGTH_LIMIT = 512;
const V2_STEP_FINISHES = new Set(["stop", "length", "tool-calls", "content-filter", "error", "unknown"]);

function requireEventID(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= V2_EVENT_ID_LENGTH_LIMIT;
}

function requireEventOrdinal(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function requireEventTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function eventPartKey(sessionID: string, messageID: string, ordinal: number): string {
  return JSON.stringify([sessionID, messageID, ordinal]);
}

function eventToolKey(sessionID: string, messageID: string, id: string): string {
  return JSON.stringify([sessionID, messageID, id]);
}

function isPublicMetadata(value: unknown): value is Record<string, unknown> {
  const isJson = (item: unknown): boolean => {
    if (item === null || typeof item === "string" || typeof item === "boolean") return true;
    if (typeof item === "number") return Number.isFinite(item);
    if (Array.isArray(item)) return item.every(isJson);
    if (!isEventRecord(item)) return false;
    return Object.values(item).every(isJson);
  };
  return isEventRecord(value) && isJson(value);
}

/** Maps a native permission request without copying the enclosing SSE event. */
export function mapV2PermissionRequest(value: unknown): Extract<AgentEvent, { type: "permission.asked" }> | undefined {
  if (!isEventRecord(value)) return undefined;
  const id = value.id;
  const sessionID = value.sessionID;
  const permission = value.action;
  const patterns = value.resources;
  const always = value.save === undefined ? [] : value.save;
  const metadata = value.metadata === undefined ? {} : value.metadata;
  if (
    !requireEventID(id) ||
    !requireEventID(sessionID) ||
    !requireEventID(permission) ||
    !Array.isArray(patterns) ||
    !patterns.every((item) => typeof item === "string") ||
    !Array.isArray(always) ||
    !always.every((item) => typeof item === "string") ||
    !isPublicMetadata(metadata)
  )
    return undefined;
  let tool: { messageID: string; callID: string } | undefined;
  if (value.source !== undefined) {
    if (
      !isEventRecord(value.source) ||
      value.source.type !== "tool" ||
      !requireEventID(value.source.messageID) ||
      !requireEventID(value.source.id)
    )
      return undefined;
    tool = { messageID: value.source.messageID, callID: value.source.id };
  }
  const request: Permission = {
    id,
    sessionID,
    permission,
    patterns,
    always,
    metadata,
    ...(tool ? { tool } : {}),
  };
  return { type: "permission.asked", properties: request };
}

/** Stable domain identity shared by streamed events and later snapshot mapping. */
export function deriveV2EventPartID(kind: "text" | "reasoning", assistantMessageID: string, ordinal: number): string {
  return `v2:${kind}:${encodeURIComponent(assistantMessageID)}:${ordinal}`;
}

function nativeTokens(value: unknown): ChatMessage["tokens"] | undefined {
  if (!isEventRecord(value) || !isEventRecord(value.cache)) return undefined;
  const fields = [value.input, value.output, value.reasoning, value.cache.read, value.cache.write];
  if (fields.some((field) => typeof field !== "number" || !Number.isFinite(field) || field < 0)) return undefined;
  return {
    input: value.input as number,
    output: value.output as number,
    reasoning: value.reasoning as number,
    cache: { read: value.cache.read as number, write: value.cache.write as number },
  };
}

function clearAssistantEventState(state: V2EventMapperState, sessionID: string, messageID?: string): void {
  if (messageID === undefined || state.activeAssistantHeaders.get(sessionID)?.id === messageID) {
    state.activeAssistantHeaders.delete(sessionID);
  }
  for (const [key, part] of state.activeTextParts) {
    if (part.sessionID === sessionID && (messageID === undefined || part.messageID === messageID)) {
      state.activeTextParts.delete(key);
    }
  }
  for (const [key, part] of state.activeReasoningParts) {
    if (part.sessionID === sessionID && (messageID === undefined || part.messageID === messageID)) {
      state.activeReasoningParts.delete(key);
    }
  }
  for (const [key, part] of state.activeToolParts) {
    if (part.sessionID === sessionID && (messageID === undefined || part.messageID === messageID)) {
      state.activeToolParts.delete(key);
    }
  }
}

function mapV2QuestionForm(value: unknown): QuestionRequest | undefined {
  if (
    !isEventRecord(value) ||
    !requireEventID(value.id) ||
    !requireEventID(value.sessionID) ||
    typeof value.title !== "string" ||
    !isEventRecord(value.metadata) ||
    value.metadata.kind !== "question" ||
    !isEventRecord(value.metadata.tool) ||
    !requireEventID(value.metadata.tool.messageID) ||
    !requireEventID(value.metadata.tool.id) ||
    !Array.isArray(value.fields) ||
    value.fields.length === 0
  )
    return undefined;
  const questions: QuestionRequest["questions"] = [];
  for (const [index, field] of value.fields.entries()) {
    const key = `q${index}`;
    if (
      !isEventRecord(field) ||
      field.key !== key ||
      (field.type !== "string" && field.type !== "multiselect") ||
      typeof field.title !== "string" ||
      typeof field.description !== "string" ||
      (field.custom !== undefined && typeof field.custom !== "boolean") ||
      !Array.isArray(field.options)
    )
      return undefined;
    const options = [];
    for (const option of field.options) {
      if (
        !isEventRecord(option) ||
        typeof option.value !== "string" ||
        option.value !== option.label ||
        typeof option.label !== "string" ||
        typeof option.description !== "string"
      )
        return undefined;
      options.push({ label: option.label, description: option.description });
    }
    questions.push({
      question: field.description,
      header: field.title,
      options,
      ...(field.type === "multiselect" ? { multiple: true } : {}),
      custom: field.custom === true,
    });
  }
  return {
    id: value.id,
    sessionID: value.sessionID,
    questions,
    tool: { messageID: value.metadata.tool.messageID, callID: value.metadata.tool.id },
  };
}

function mapV2EventWithState(value: unknown, state: V2EventMapperState): AgentEvent[] {
  if (!isEventRecord(value) || typeof value.type !== "string" || !isEventRecord(value.data)) return [];
  const data = value.data;
  if (value.type === "session.deleted") {
    if (!requireEventID(data.sessionID)) return [];
    clearAssistantEventState(state, data.sessionID);
    for (const [id, request] of state.questionForms) {
      if (request.sessionID === data.sessionID) state.questionForms.delete(id);
    }
    for (const [id, request] of state.permissionRequests) {
      if (request.sessionID === data.sessionID) state.permissionRequests.delete(id);
    }
    return [{ type: "session.deleted", properties: { info: { id: data.sessionID } } }];
  }
  if (value.type === "form.created") {
    const request = mapV2QuestionForm(data.form);
    if (!request || state.questionForms.has(request.id)) return [];
    state.questionForms.set(request.id, request);
    return [{ type: "question.asked", properties: request }];
  }
  if (value.type === "form.replied" || value.type === "form.cancelled") {
    if (!requireEventID(data.id) || !requireEventID(data.sessionID)) return [];
    const request = state.questionForms.get(data.id);
    if (!request || request.sessionID !== data.sessionID) return [];
    if (value.type === "form.replied") {
      if (!isEventRecord(data.answer)) return [];
      for (const [index, question] of request.questions.entries()) {
        const answer = data.answer[`q${index}`];
        if (answer === undefined) continue;
        if (
          question.multiple
            ? !Array.isArray(answer) || !answer.every((item) => typeof item === "string")
            : typeof answer !== "string"
        )
          return [];
        const selected = Array.isArray(answer) ? answer : [answer];
        if (selected.some((item) => !question.custom && !question.options.some((option) => option.label === item)))
          return [];
      }
      if (
        Object.keys(data.answer).some(
          (key) => !/^q(?:0|[1-9]\d*)$/.test(key) || Number(key.slice(1)) >= request.questions.length,
        )
      )
        return [];
    }
    state.questionForms.delete(data.id);
    return [
      {
        type: value.type === "form.replied" ? "question.replied" : "question.rejected",
        properties: { sessionID: request.sessionID, requestID: request.id },
      },
    ];
  }
  const sessionID = data.sessionID;
  if (!requireEventID(sessionID)) {
    if (value.type === "server.connected" && Object.keys(data).length === 0) {
      return [{ type: "server.connected", properties: {} }];
    }
    return [];
  }

  switch (value.type) {
    case "session.execution.started":
      return [{ type: "session.status", properties: { sessionID, status: { type: "busy" } } }];
    case "session.execution.succeeded":
    case "session.execution.interrupted": {
      clearAssistantEventState(state, sessionID);
      return [{ type: "session.status", properties: { sessionID, status: { type: "idle" } } }];
    }
    case "session.execution.failed":
      clearAssistantEventState(state, sessionID);
      return [
        { type: "session.error", properties: { sessionID, error: "OpenCode session execution failed." } },
        { type: "session.status", properties: { sessionID, status: { type: "idle" } } },
      ];
    case "session.status": {
      if (!isEventRecord(data.status) || (data.status.type !== "busy" && data.status.type !== "idle")) return [];
      return [{ type: "session.status", properties: { sessionID, status: { type: data.status.type } } }];
    }
    case "session.compaction.ended":
      return [{ type: "session.compacted", properties: { sessionID } }];
    case "permission.asked": {
      const mapped = mapV2PermissionRequest(data);
      if (!mapped || state.permissionRequests.has(mapped.properties.id)) return [];
      state.permissionRequests.set(mapped.properties.id, mapped.properties);
      return [mapped];
    }
    case "permission.replied": {
      const requestID = data.requestID;
      const reply = data.reply;
      if (!requireEventID(requestID) || (reply !== "once" && reply !== "always" && reply !== "reject")) return [];
      if (state.permissionRequests.get(requestID)?.sessionID === sessionID) state.permissionRequests.delete(requestID);
      return [{ type: "permission.replied", properties: { sessionID, requestID, reply } }];
    }
    case "session.step.started": {
      const assistantMessageID = data.assistantMessageID;
      const model = data.model;
      if (
        !requireEventID(assistantMessageID) ||
        !requireEventID(data.agent) ||
        !isEventRecord(model) ||
        !requireEventID(model.providerID) ||
        !requireEventID(model.id) ||
        !requireEventTimestamp(data.started) ||
        !requireEventTimestamp(value.created)
      ) {
        return [];
      }
      clearAssistantEventState(state, sessionID);
      // Native ModelRef names its operational model ID `id`; the domain calls it `modelID`.
      const info: ChatMessage = {
        id: assistantMessageID,
        sessionID,
        role: "assistant",
        time: { created: data.started },
        modelID: model.id,
        providerID: model.providerID,
        model: { providerID: model.providerID, modelID: model.id },
        agent: data.agent,
      };
      state.activeAssistantHeaders.set(sessionID, info);
      return [{ type: "message.updated", properties: { sessionID, info } }];
    }
    case "session.text.started": {
      const assistantMessageID = data.assistantMessageID;
      const ordinal = data.ordinal;
      const startedAt = value.created;
      const header = state.activeAssistantHeaders.get(sessionID);
      if (
        !requireEventID(assistantMessageID) ||
        !requireEventOrdinal(ordinal) ||
        !requireEventTimestamp(startedAt) ||
        header?.id !== assistantMessageID
      ) {
        return [];
      }
      const id = deriveV2EventPartID("text", assistantMessageID, ordinal);
      state.activeTextParts.set(eventPartKey(sessionID, assistantMessageID, ordinal), {
        sessionID,
        messageID: assistantMessageID,
        ordinal,
        startedAt,
      });
      const part: TextPart = {
        id,
        sessionID,
        messageID: assistantMessageID,
        type: "text",
        text: "",
        time: { start: startedAt },
      };
      return [{ type: "message.part.updated", properties: { sessionID, part } }];
    }
    case "session.text.delta": {
      const assistantMessageID = data.assistantMessageID;
      const ordinal = data.ordinal;
      if (
        !requireEventID(assistantMessageID) ||
        !requireEventOrdinal(ordinal) ||
        typeof data.delta !== "string" ||
        !requireEventTimestamp(value.created) ||
        state.activeAssistantHeaders.get(sessionID)?.id !== assistantMessageID ||
        !state.activeTextParts.has(eventPartKey(sessionID, assistantMessageID, ordinal))
      ) {
        return [];
      }
      return [
        {
          type: "message.part.delta",
          properties: {
            sessionID,
            messageID: assistantMessageID,
            partID: deriveV2EventPartID("text", assistantMessageID, ordinal),
            field: "text",
            delta: data.delta,
          },
        },
      ];
    }
    case "session.text.ended": {
      const assistantMessageID = data.assistantMessageID;
      const ordinal = data.ordinal;
      if (
        !requireEventID(assistantMessageID) ||
        !requireEventOrdinal(ordinal) ||
        typeof data.text !== "string" ||
        !requireEventTimestamp(value.created) ||
        state.activeAssistantHeaders.get(sessionID)?.id !== assistantMessageID
      ) {
        return [];
      }
      const key = eventPartKey(sessionID, assistantMessageID, ordinal);
      const active = state.activeTextParts.get(key);
      if (!active) return [];
      state.activeTextParts.delete(key);
      const part: TextPart = {
        id: deriveV2EventPartID("text", assistantMessageID, ordinal),
        sessionID,
        messageID: assistantMessageID,
        type: "text",
        text: data.text,
        time: { start: active.startedAt, end: value.created },
      };
      return [{ type: "message.part.updated", properties: { sessionID, part } }];
    }
    case "session.reasoning.started": {
      const assistantMessageID = data.assistantMessageID;
      const ordinal = data.ordinal;
      if (
        !requireEventID(assistantMessageID) ||
        !requireEventOrdinal(ordinal) ||
        !requireEventTimestamp(value.created) ||
        state.activeAssistantHeaders.get(sessionID)?.id !== assistantMessageID
      ) {
        return [];
      }
      const reasoningID = deriveV2EventPartID("reasoning", assistantMessageID, ordinal);
      state.activeReasoningParts.set(reasoningID, { sessionID, messageID: assistantMessageID, ordinal });
      return [{ type: "session.next.reasoning.started", properties: { sessionID, assistantMessageID, reasoningID } }];
    }
    case "session.reasoning.delta": {
      const assistantMessageID = data.assistantMessageID;
      const ordinal = data.ordinal;
      if (
        !requireEventID(assistantMessageID) ||
        !requireEventOrdinal(ordinal) ||
        typeof data.delta !== "string" ||
        !requireEventTimestamp(value.created) ||
        state.activeAssistantHeaders.get(sessionID)?.id !== assistantMessageID
      ) {
        return [];
      }
      const reasoningID = deriveV2EventPartID("reasoning", assistantMessageID, ordinal);
      if (!state.activeReasoningParts.has(reasoningID)) return [];
      return [
        {
          type: "session.next.reasoning.delta",
          properties: { sessionID, assistantMessageID, reasoningID, delta: data.delta },
        },
      ];
    }
    case "session.reasoning.ended": {
      const assistantMessageID = data.assistantMessageID;
      const ordinal = data.ordinal;
      if (
        !requireEventID(assistantMessageID) ||
        !requireEventOrdinal(ordinal) ||
        typeof data.text !== "string" ||
        !requireEventTimestamp(value.created) ||
        state.activeAssistantHeaders.get(sessionID)?.id !== assistantMessageID
      ) {
        return [];
      }
      const reasoningID = deriveV2EventPartID("reasoning", assistantMessageID, ordinal);
      if (!state.activeReasoningParts.delete(reasoningID)) return [];
      return [
        {
          type: "session.next.reasoning.ended",
          properties: { sessionID, assistantMessageID, reasoningID, text: data.text },
        },
      ];
    }
    case "session.tool.input.started": {
      const { assistantMessageID, id, name } = data;
      if (
        !requireEventID(assistantMessageID) ||
        !requireEventID(id) ||
        !requireEventID(name) ||
        !requireEventID(value.id) ||
        !requireEventTimestamp(value.created) ||
        state.activeAssistantHeaders.get(sessionID)?.id !== assistantMessageID
      )
        return [];
      const tool: ToolPart = {
        id,
        callID: id,
        sessionID,
        messageID: assistantMessageID,
        type: "tool",
        tool: name,
        state: { status: "pending" },
      };
      state.activeToolParts.set(eventToolKey(sessionID, assistantMessageID, id), {
        sessionID,
        messageID: assistantMessageID,
        id,
        name,
        inputText: "",
        part: tool,
      });
      return [{ type: "message.part.updated", properties: { sessionID, part: tool } }];
    }
    case "session.tool.input.delta": {
      const { assistantMessageID, id, delta } = data;
      if (
        !requireEventID(assistantMessageID) ||
        !requireEventID(id) ||
        typeof delta !== "string" ||
        !requireEventID(value.id) ||
        !requireEventTimestamp(value.created) ||
        state.activeAssistantHeaders.get(sessionID)?.id !== assistantMessageID
      )
        return [];
      const active = state.activeToolParts.get(eventToolKey(sessionID, assistantMessageID, id));
      if (!active || active.inputText === undefined || active.part.state.status !== "pending") return [];
      active.inputText += delta;
      return [];
    }
    case "session.tool.input.ended": {
      const { assistantMessageID, id, text } = data;
      if (
        !requireEventID(assistantMessageID) ||
        !requireEventID(id) ||
        typeof text !== "string" ||
        !requireEventID(value.id) ||
        !requireEventTimestamp(value.created) ||
        state.activeAssistantHeaders.get(sessionID)?.id !== assistantMessageID
      )
        return [];
      const active = state.activeToolParts.get(eventToolKey(sessionID, assistantMessageID, id));
      if (active?.part.state.status !== "pending") return [];
      active.inputText = text;
      return [];
    }
    case "session.tool.called": {
      const { assistantMessageID, id, input, executed } = data;
      if (
        !requireEventID(assistantMessageID) ||
        !requireEventID(id) ||
        !isEventRecord(input) ||
        typeof executed !== "boolean" ||
        !requireEventID(value.id) ||
        !requireEventTimestamp(value.created) ||
        state.activeAssistantHeaders.get(sessionID)?.id !== assistantMessageID
      )
        return [];
      const active = state.activeToolParts.get(eventToolKey(sessionID, assistantMessageID, id));
      if (!active) return [];
      active.inputText = undefined;
      active.part = {
        ...active.part,
        state: { status: "running", input },
        metadata: { executed },
      };
      return [{ type: "message.part.updated", properties: { sessionID, part: active.part } }];
    }
    case "session.tool.progress": {
      const { assistantMessageID, id, metadata } = data;
      if (
        !requireEventID(assistantMessageID) ||
        !requireEventID(id) ||
        !isPublicMetadata(metadata) ||
        !requireEventID(value.id) ||
        !requireEventTimestamp(value.created) ||
        state.activeAssistantHeaders.get(sessionID)?.id !== assistantMessageID
      )
        return [];
      const active = state.activeToolParts.get(eventToolKey(sessionID, assistantMessageID, id));
      if (active?.part.state.status !== "running" || typeof active.part.state.input === "string") return [];
      active.part = {
        ...active.part,
        state: { ...active.part.state, metadata },
        metadata: {
          ...(isEventRecord(active.part.metadata) ? active.part.metadata : {}),
          metadata,
        },
      };
      return [{ type: "message.part.updated", properties: { sessionID, part: active.part } }];
    }
    case "session.tool.success":
    case "session.tool.failed": {
      const { assistantMessageID, id, executed, metadata, content } = data;
      if (
        !requireEventID(assistantMessageID) ||
        !requireEventID(id) ||
        typeof executed !== "boolean" ||
        !requireEventID(value.id) ||
        (metadata !== undefined && !isPublicMetadata(metadata)) ||
        !requireEventTimestamp(value.created) ||
        state.activeAssistantHeaders.get(sessionID)?.id !== assistantMessageID
      )
        return [];
      const active = state.activeToolParts.get(eventToolKey(sessionID, assistantMessageID, id));
      if (active?.part.state.status !== "running" || typeof active.part.state.input === "string") return [];
      const isTodoWrite = active.part.tool === "todowrite";
      let todoUpdate: AgentEvent | undefined;
      if (value.type === "session.tool.success" && isTodoWrite && isEventRecord(metadata) && "todos" in metadata) {
        try {
          todoUpdate = {
            type: "todo.updated",
            properties: { sessionID, todos: mapNativeTodoList(metadata.todos, id) },
          };
        } catch {
          // Invalid todo metadata must not hide the terminal ToolPart update.
        }
      }
      let output: string | undefined;
      if (content !== undefined) {
        try {
          output = mapToolContent(content);
        } catch {
          return [];
        }
      }
      const part: ToolPart = {
        ...active.part,
        metadata: { executed, ...(metadata === undefined ? {} : { metadata }) },
        state:
          value.type === "session.tool.success"
            ? {
                status: "completed",
                input: active.part.state.input,
                output: output ?? "",
                ...(metadata === undefined ? {} : { metadata }),
              }
            : {
                status: "error",
                input: active.part.state.input,
                error: output ? `Tool execution failed.\n${output}` : "Tool execution failed.",
                ...(metadata === undefined ? {} : { metadata }),
              },
      };
      state.activeToolParts.delete(eventToolKey(sessionID, assistantMessageID, id));
      return [{ type: "message.part.updated", properties: { sessionID, part } }, ...(todoUpdate ? [todoUpdate] : [])];
    }
    case "session.step.ended": {
      const assistantMessageID = data.assistantMessageID;
      const header = state.activeAssistantHeaders.get(sessionID);
      const tokens = nativeTokens(data.tokens);
      if (
        !requireEventID(assistantMessageID) ||
        !requireEventTimestamp(value.created) ||
        typeof data.cost !== "number" ||
        !Number.isFinite(data.cost) ||
        data.cost < 0 ||
        !tokens ||
        typeof data.finish !== "string" ||
        !V2_STEP_FINISHES.has(data.finish) ||
        header?.id !== assistantMessageID
      ) {
        return [];
      }
      const info: ChatMessage = {
        ...header,
        time: { ...header.time, completed: value.created },
        cost: data.cost,
        tokens,
        finish: data.finish,
      };
      clearAssistantEventState(state, sessionID, assistantMessageID);
      return [
        { type: "message.updated", properties: { sessionID, info } },
        { type: "session.next.step.ended", properties: { sessionID, tokens } },
      ];
    }
    case "session.step.failed": {
      const assistantMessageID = data.assistantMessageID;
      const header = state.activeAssistantHeaders.get(sessionID);
      if (
        !requireEventID(assistantMessageID) ||
        !requireEventTimestamp(value.created) ||
        header?.id !== assistantMessageID
      ) {
        return [];
      }
      const tokens = nativeTokens(data.tokens);
      const cost =
        typeof data.cost === "number" && Number.isFinite(data.cost) && data.cost >= 0 ? data.cost : undefined;
      const info: ChatMessage = {
        ...header,
        time: { ...header.time, completed: value.created },
        error: { name: "OpenCodeError", message: "Assistant step failed." },
        ...(tokens ? { tokens } : {}),
        ...(cost !== undefined ? { cost } : {}),
        ...(typeof data.finish === "string" && V2_STEP_FINISHES.has(data.finish) ? { finish: data.finish } : {}),
      };
      clearAssistantEventState(state, sessionID, assistantMessageID);
      return [
        { type: "message.updated", properties: { sessionID, info } },
        ...(tokens ? [{ type: "session.next.step.ended" as const, properties: { sessionID, tokens } }] : []),
      ];
    }
    // session.idle is not a second completion signal; execution terminal events
    // own the busy-to-idle transition consumed by Scribe's UI.
    default:
      return [];
  }
}

/** Creates isolated minimal stream state for assistant headers and active text/reasoning parts. */
export type V2EventMapper = ((value: unknown) => AgentEvent[]) & {
  hydrateQuestionForms(forms: readonly unknown[]): Extract<AgentEvent, { type: "question.asked" }>[];
  hydratePermissionRequests(requests: readonly unknown[]): Extract<AgentEvent, { type: "permission.asked" }>[];
  hydratePendingInteractions(
    forms: readonly unknown[],
    requests: readonly unknown[],
  ): {
    questions: Extract<AgentEvent, { type: "question.asked" }>[];
    permissions: Extract<AgentEvent, { type: "permission.asked" }>[];
  };
};

export function createV2EventMapper(): V2EventMapper {
  const state: V2EventMapperState = {
    activeAssistantHeaders: new Map(),
    activeTextParts: new Map(),
    activeReasoningParts: new Map(),
    activeToolParts: new Map(),
    questionForms: new Map(),
    permissionRequests: new Map(),
  };
  const mapper = ((value: unknown) => mapV2EventWithState(value, state)) as V2EventMapper;
  mapper.hydrateQuestionForms = (forms) => {
    const staged: QuestionRequest[] = [];
    const seen = new Set<string>();
    for (const form of forms) {
      const request = mapV2QuestionForm(form);
      if (!request) {
        if (isEventRecord(form) && isEventRecord(form.metadata) && form.metadata.kind === "question") {
          throw new Error("Invalid native question-form snapshot item.");
        }
        continue;
      }
      if (seen.has(request.id)) throw new Error("Duplicate native question-form snapshot identity.");
      seen.add(request.id);
      staged.push(request);
    }
    for (const request of staged) {
      const existing = state.questionForms.get(request.id);
      if (existing && JSON.stringify(existing) !== JSON.stringify(request)) {
        throw new Error("Conflicting native question-form snapshot identity.");
      }
    }
    const events: Extract<AgentEvent, { type: "question.asked" }>[] = [];
    for (const request of staged) {
      const existing = state.questionForms.get(request.id);
      if (existing) {
        continue;
      }
      state.questionForms.set(request.id, request);
      events.push({ type: "question.asked", properties: request });
    }
    return events;
  };
  mapper.hydratePermissionRequests = (requests) => {
    const staged: Extract<AgentEvent, { type: "permission.asked" }>[] = [];
    const seen = new Set<string>();
    for (const value of requests) {
      const mapped = mapV2PermissionRequest(value);
      if (!mapped) throw new Error("Invalid native permission-request snapshot item.");
      if (seen.has(mapped.properties.id)) throw new Error("Duplicate native permission-request snapshot identity.");
      seen.add(mapped.properties.id);
      staged.push(mapped);
    }
    const events: Extract<AgentEvent, { type: "permission.asked" }>[] = [];
    for (const mapped of staged) {
      const { id, sessionID } = mapped.properties;
      const existingRequest = state.permissionRequests.get(id);
      if (existingRequest !== undefined) {
        continue;
      }
      state.permissionRequests.set(id, mapped.properties);
      events.push(mapped);
    }
    return events;
  };
  mapper.hydratePendingInteractions = (forms, requests) => {
    const questions: QuestionRequest[] = [];
    const permissions: Extract<AgentEvent, { type: "permission.asked" }>[] = [];
    const questionIDs = new Set<string>();
    const permissionIDs = new Set<string>();
    for (const form of forms) {
      const request = mapV2QuestionForm(form);
      if (!request) {
        if (isEventRecord(form) && isEventRecord(form.metadata) && form.metadata.kind === "question") {
          throw new Error("Invalid native question-form snapshot item.");
        }
        continue;
      }
      if (questionIDs.has(request.id)) throw new Error("Duplicate native question-form snapshot identity.");
      questionIDs.add(request.id);
      const existing = state.questionForms.get(request.id);
      if (existing && JSON.stringify(existing) !== JSON.stringify(request)) {
        throw new Error("Conflicting native question-form snapshot identity.");
      }
      questions.push(request);
    }
    for (const value of requests) {
      const mapped = mapV2PermissionRequest(value);
      if (!mapped) throw new Error("Invalid native permission-request snapshot item.");
      const request = mapped.properties;
      if (permissionIDs.has(request.id)) throw new Error("Duplicate native permission-request snapshot identity.");
      permissionIDs.add(request.id);
      const existing = state.permissionRequests.get(request.id);
      if (existing && JSON.stringify(existing) !== JSON.stringify(request)) {
        throw new Error("Conflicting native permission-request snapshot identity.");
      }
      permissions.push(mapped);
    }
    const newQuestions = questions.filter(({ id }) => !state.questionForms.has(id));
    const newPermissions = permissions.filter(({ properties: { id } }) => !state.permissionRequests.has(id));
    for (const request of newQuestions) state.questionForms.set(request.id, request);
    for (const { properties } of newPermissions) state.permissionRequests.set(properties.id, properties);
    return {
      questions: newQuestions.map((properties) => ({ type: "question.asked", properties })),
      permissions: newPermissions,
    };
  };
  return mapper;
}

export function mapV2Event(value: unknown): AgentEvent[] {
  return mapV2EventWithState(value, {
    activeAssistantHeaders: new Map(),
    activeTextParts: new Map(),
    activeReasoningParts: new Map(),
    activeToolParts: new Map(),
    questionForms: new Map(),
    permissionRequests: new Map(),
  });
}

// ============================================================
// Provider
// ============================================================

function requireCatalogRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Invalid V2 ${label} catalog record.`);
  }
  return value as Record<string, unknown>;
}

function requireCatalogString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Invalid V2 ${label} catalog field.`);
  return value;
}

function requireCatalogNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Invalid V2 ${label} catalog field.`);
  return value;
}

/** Maps only provider/model fields shared by the pinned V2 and domain contracts. */
export function mapProviders(
  providers: V2ProviderInfo[],
  models: V2ModelInfo[],
  integrations: V2IntegrationInfo[] = [],
): ProviderInfo[] {
  const byProvider = new Map<string, ProviderInfo>();
  const integrationsByID = integrationIndex(integrations);
  for (const value of providers as unknown[]) {
    const provider = requireCatalogRecord(value, "provider");
    const id = requireCatalogString(provider.id, "provider.id");
    const name = requireCatalogString(provider.name, "provider.name");
    if (provider.activation !== "auto" && provider.activation !== "enabled" && provider.activation !== "disabled") {
      throw new Error("Invalid V2 provider activation catalog field.");
    }
    if (byProvider.has(id)) throw new Error("Duplicate V2 provider catalog ID.");
    if (provider.integrationID !== undefined && typeof provider.integrationID !== "string") {
      throw new Error("Invalid V2 provider integration ID catalog field.");
    }
    const integrationID = provider.integrationID ?? id;
    const integration = integrationsByID.get(integrationID);
    byProvider.set(id, {
      id,
      name,
      env: integration ? mapIntegrationEnvironmentNames(integration) : [],
      ...(typeof provider.api === "string" ? { api: provider.api } : {}),
      ...(typeof provider.package === "string" ? { npm: provider.package } : {}),
      models: {},
    });
  }
  for (const value of models as unknown[]) {
    const model = requireCatalogRecord(value, "model");
    const providerID = requireCatalogString(model.providerID, "model.providerID");
    const provider = byProvider.get(providerID);
    if (!provider) throw new Error("V2 model catalog references an unknown provider.");
    const id = requireCatalogString(model.id, "model.id");
    const name = requireCatalogString(model.name, "model.name");
    const limit = requireCatalogRecord(model.limit, "model.limit");
    if (Object.hasOwn(provider.models, id)) throw new Error("Duplicate V2 model catalog ID.");
    const variants: Record<string, Record<string, unknown>> = {};
    if (model.variants !== undefined) {
      if (!Array.isArray(model.variants)) throw new Error("Invalid V2 model variants catalog field.");
      for (const item of model.variants) {
        const variant = requireCatalogRecord(item, "model.variant");
        const variantID = requireCatalogString(variant.id, "model.variant.id");
        if (Object.hasOwn(variants, variantID)) throw new Error("Duplicate V2 model variant ID.");
        variants[variantID] = {};
      }
    }
    provider.models[id] = {
      id,
      name,
      limit: {
        context: requireCatalogNumber(limit.context, "model.limit.context"),
        output: requireCatalogNumber(limit.output, "model.limit.output"),
      },
      status: mapModelStatus(model.status, model.enabled),
      ...(model.status === "alpha" || model.status === "beta" ? { experimental: true } : {}),
      ...(model.capabilities && typeof model.capabilities === "object"
        ? mapModelCapabilities(model.capabilities)
        : (() => {
            throw new Error("Invalid V2 model capabilities catalog field.");
          })()),
      ...mapModelCost(model.cost),
      ...(model.variants !== undefined ? { variants } : {}),
    };
  }
  return [...byProvider.values()];
}

function integrationIndex(integrations: V2IntegrationInfo[]): Map<string, Record<string, unknown>> {
  const byID = new Map<string, Record<string, unknown>>();
  for (const value of integrations as unknown[]) {
    const integration = requireCatalogRecord(value, "integration");
    const id = requireCatalogString(integration.id, "integration.id");
    if (byID.has(id)) throw new Error("Duplicate V2 integration catalog ID.");
    byID.set(id, integration);
  }
  return byID;
}

function mapIntegrationEnvironmentNames(integration: Record<string, unknown>): string[] {
  if (!Array.isArray(integration.methods)) throw new Error("Invalid V2 integration methods catalog field.");
  const names = new Set<string>();
  for (const value of integration.methods) {
    const method = requireCatalogRecord(value, "integration method");
    if (method.type !== "env") continue;
    if (!Array.isArray(method.names)) throw new Error("Invalid V2 integration environment names catalog field.");
    for (const value of method.names) {
      if (typeof value !== "string" || value.length > 128 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
        throw new Error("Invalid V2 integration environment name catalog field.");
      }
      names.add(value);
    }
  }
  return [...names];
}

function mapModelStatus(status: unknown, enabled: unknown): string {
  if (enabled === false) return "disabled";
  if (enabled === true && (status === "alpha" || status === "beta" || status === "deprecated" || status === "active")) {
    return status;
  }
  throw new Error("Unknown V2 model status catalog value.");
}

function mapModelCapabilities(
  value: unknown,
): Pick<NonNullable<ProviderInfo["models"][string]>, "attachment" | "reasoning" | "temperature" | "tool_call"> {
  const capabilities = requireCatalogRecord(value, "model.capabilities");
  if (
    !Array.isArray(capabilities.input) ||
    !Array.isArray(capabilities.output) ||
    typeof capabilities.tools !== "boolean"
  ) {
    throw new Error("Invalid V2 model capabilities catalog fields.");
  }
  const input = capabilities.input;
  const output = capabilities.output;
  if (input.some((item) => typeof item !== "string") || output.some((item) => typeof item !== "string")) {
    throw new Error("Invalid V2 model modality catalog field.");
  }
  if (capabilities.temperature !== undefined && typeof capabilities.temperature !== "boolean") {
    throw new Error("Invalid V2 model temperature capability catalog field.");
  }
  return {
    attachment: input.some((item) => item !== "text"),
    reasoning: output.includes("reasoning"),
    tool_call: capabilities.tools,
    ...(typeof capabilities.temperature === "boolean" ? { temperature: capabilities.temperature } : {}),
  };
}

function mapModelCost(value: unknown): Pick<NonNullable<ProviderInfo["models"][string]>, "cost"> {
  if (!Array.isArray(value)) throw new Error("Invalid V2 model cost catalog field.");
  const defaults = value.filter((entry) => {
    const cost = requireCatalogRecord(entry, "model.cost");
    return cost.tier === undefined;
  });
  if (defaults.length > 1) throw new Error("Duplicate default V2 model cost tier.");
  if (defaults.length === 0) return {};
  const cost = requireCatalogRecord(defaults[0], "model.cost");
  const cache = requireCatalogRecord(cost.cache, "model.cost.cache");
  return {
    cost: {
      input: requireCatalogNumber(cost.input, "model.cost.input"),
      output: requireCatalogNumber(cost.output, "model.cost.output"),
      cache_read: requireCatalogNumber(cache.read, "model.cost.cache.read"),
      cache_write: requireCatalogNumber(cache.write, "model.cost.cache.write"),
    },
  };
}

/** Mirrors the pinned provider snapshot's configured availability rule, not network health. */
export function mapConnectedProviderIDs(providers: V2ProviderInfo[], integrations: V2IntegrationInfo[]): string[] {
  const byID = integrationIndex(integrations);
  return providers.flatMap((provider) => {
    const record = requireCatalogRecord(provider, "provider");
    const id = requireCatalogString(record.id, "provider.id");
    const activation = record.activation;
    if (activation !== "auto" && activation !== "enabled" && activation !== "disabled") {
      throw new Error("Invalid V2 provider activation catalog field.");
    }
    if (activation === "disabled") return [];
    if (record.integrationID !== undefined && typeof record.integrationID !== "string") {
      throw new Error("Invalid V2 provider integration ID catalog field.");
    }
    const integrationID = (record.integrationID as string | undefined) ?? id;
    const integration = byID.get(integrationID);
    if (activation === "enabled") return [id];
    if (integration) {
      if (!Array.isArray(integration.connections)) {
        throw new Error("Invalid V2 integration connections catalog field.");
      }
      if (integration.connections.length > 0) return [id];
    }
    if (record.integrationID === undefined && !integration) return [id];
    return [];
  });
}

export function mapDefaultModel(value: V2ModelInfo | null): Record<string, string> {
  if (value === null) return {};
  const model = requireCatalogRecord(value, "default model");
  const providerID = requireCatalogString(model.providerID, "default model.providerID");
  const modelID = requireCatalogString(model.id, "default model.id");
  return { [providerID]: modelID };
}

// ============================================================
// FileDiff
// ============================================================

const INVALID_V2_DIFF = "Invalid or unsupported OpenCode V2 session diff.";

function failV2Diff(): never {
  throw new Error(INVALID_V2_DIFF);
}

/**
 * Reconstructs full file contents only from a complete native unified diff. Binary or
 * non-reconstructable (capped/partial/ambiguous) patches of a well-formed entry yield a
 * `contentUnavailable` marker with empty contents; corrupt patches throw an opaque error.
 */
export function mapFileDiff(value: unknown): FileDiff {
  if (!isRecord(value)) return failV2Diff();
  const { file, patch, additions, deletions, status } = value;
  if (
    typeof file !== "string" ||
    file.length === 0 ||
    typeof patch !== "string" ||
    typeof additions !== "number" ||
    !Number.isSafeInteger(additions) ||
    additions < 0 ||
    typeof deletions !== "number" ||
    !Number.isSafeInteger(deletions) ||
    deletions < 0 ||
    (status !== "added" && status !== "deleted" && status !== "modified")
  )
    return failV2Diff();

  const marker = (kind: "binary" | "unavailable"): FileDiff => ({
    file,
    before: "",
    after: "",
    additions,
    deletions,
    contentUnavailable: kind,
  });
  // Well-formed envelope from here on. Throw (opaque) only for a corrupt patch; return a marker when the
  // native patch is intact or deliberately omitted but cannot reconstruct full contents.
  if (/^(?:Binary files .* differ|GIT binary patch|\\ Binary files)/m.test(patch)) return marker("binary");
  // Native vcs/patch.ts replaces capped/unreadable patches with an empty one.
  if (patch === "") return marker("unavailable");
  if (!patch.endsWith("\n")) return failV2Diff();
  const lines = patch.split("\n");
  lines.pop();
  const gitPatch = lines[0]?.startsWith("diff --git ") === true;
  const formatterPatch =
    lines[0]?.startsWith("Index: ") === true && lines[0].length > "Index: ".length && /^={3,}$/.test(lines[1] ?? "");
  if (!gitPatch && !formatterPatch) return failV2Diff();
  const hunks = lines.flatMap((line, index) => {
    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?:.*)$/.exec(line);
    return match
      ? [
          {
            index,
            oldStart: Number(match[1]),
            oldCount: match[2] === undefined ? 1 : Number(match[2]),
            newStart: Number(match[3]),
            newCount: match[4] === undefined ? 1 : Number(match[4]),
          },
        ]
      : [];
  });
  const before: string[] = [];
  const after: string[] = [];
  const beforeEnds: boolean[] = [];
  const afterEnds: boolean[] = [];
  let added = 0;
  let removed = 0;
  let previousPrefix: string | undefined;
  let beforeMarked = false;
  let afterMarked = false;
  if (hunks.length === 0) {
    const emptyAdded =
      status === "added" &&
      additions === 0 &&
      deletions === 0 &&
      lines.some((line) => line.startsWith("new file mode "));
    const emptyDeleted =
      status === "deleted" &&
      additions === 0 &&
      deletions === 0 &&
      lines.some((line) => line.startsWith("deleted file mode "));
    if (patch.includes("@@")) return failV2Diff();
    // No hunk and no reconstructable empty file: formatter-empty (also used for capped content),
    // modified mode-only, or metadata-only without the matching mode line.
    if (!gitPatch || (!emptyAdded && !emptyDeleted)) return marker("unavailable");
  } else {
    const hunk = hunks[0];
    const oldHeader = lines.findIndex((line) => line.startsWith("--- "));
    const newHeader = lines.findIndex((line) => line.startsWith("+++ "));
    if (
      !hunk ||
      hunk.index !== lines.findIndex((line) => line.startsWith("@@ ")) ||
      oldHeader < 1 ||
      newHeader <= oldHeader ||
      newHeader >= hunk.index
    )
      return failV2Diff();
    if (hunks.length !== 1) {
      // Several hunks mean the patch is not a single full-file hunk: contents are not reconstructable.
      // Only an internally consistent patch is "unrepresentable"; mismatched rows/counts are corrupt.
      let oldRows = 0;
      let newRows = 0;
      let plus = 0;
      let minus = 0;
      for (const [n, h] of hunks.entries()) {
        let oldSeen = 0;
        let newSeen = 0;
        for (const line of lines.slice(h.index + 1, hunks[n + 1]?.index ?? lines.length)) {
          if (line === "\\ No newline at end of file") continue;
          const prefix = line[0];
          if (prefix !== " " && prefix !== "-" && prefix !== "+") return failV2Diff();
          if (prefix !== "+") oldSeen++;
          if (prefix !== "-") newSeen++;
          if (prefix === "+") plus++;
          if (prefix === "-") minus++;
        }
        if (oldSeen !== h.oldCount || newSeen !== h.newCount) return failV2Diff();
        oldRows += oldSeen;
        newRows += newSeen;
      }
      if (plus !== additions || minus !== deletions || (status === "added" && oldRows !== 0)) return failV2Diff();
      if (status === "deleted" && newRows !== 0) return failV2Diff();
      return marker("unavailable");
    }
    if (
      formatterPatch &&
      (oldHeader !== 2 || newHeader !== 3 || lines[oldHeader]?.slice(4) !== lines[newHeader]?.slice(4))
    ) {
      return failV2Diff();
    }
    const oldZero = hunk.oldCount === 0;
    const newZero = hunk.newCount === 0;
    const partialStart = hunk.oldStart !== (oldZero ? 0 : 1) || hunk.newStart !== (newZero ? 0 : 1);
    if (
      (status === "added" && !oldZero) ||
      (status === "deleted" && !newZero) ||
      (status === "modified" && oldZero && newZero)
    )
      return failV2Diff();
    if (
      gitPatch &&
      ((status === "added" && lines[oldHeader] !== "--- /dev/null") ||
        (status === "deleted" && lines[newHeader] !== "+++ /dev/null"))
    )
      return failV2Diff();
    for (const line of lines.slice(hunk.index + 1)) {
      if (line === "\\ No newline at end of file") {
        if (!previousPrefix) return failV2Diff();
        if (previousPrefix !== "+") {
          if (beforeMarked || beforeEnds.length === 0) return failV2Diff();
          beforeEnds[beforeEnds.length - 1] = false;
          beforeMarked = true;
        }
        if (previousPrefix !== "-") {
          if (afterMarked || afterEnds.length === 0) return failV2Diff();
          afterEnds[afterEnds.length - 1] = false;
          afterMarked = true;
        }
        previousPrefix = undefined;
        continue;
      }
      const prefix = line[0];
      if (prefix === " " || prefix === "-" || prefix === "+") {
        if ((prefix !== "+" && beforeMarked) || (prefix !== "-" && afterMarked)) return failV2Diff();
        const content = line.slice(1);
        if (prefix !== "+") {
          before.push(content);
          beforeEnds.push(true);
        }
        if (prefix !== "-") {
          after.push(content);
          afterEnds.push(true);
        }
        if (prefix === "+") added++;
        if (prefix === "-") removed++;
        previousPrefix = prefix;
        continue;
      }
      return failV2Diff();
    }
    if (before.length !== hunk.oldCount || after.length !== hunk.newCount) return failV2Diff();
    if (added !== additions || removed !== deletions) return failV2Diff();
    if (
      (status === "added" && (before.length !== 0 || after.length !== additions)) ||
      (status === "deleted" && (after.length !== 0 || before.length !== deletions)) ||
      (status === "modified" && before.length === 0 && after.length === 0)
    )
      return failV2Diff();
    // Counts and counters are consistent, but the hunk does not begin at the file start: partial content.
    if (partialStart) return marker("unavailable");
  }
  if (added !== additions || removed !== deletions) return failV2Diff();
  const content = (rows: string[], endings: boolean[]) =>
    rows.length === 0 ? "" : rows.join("\n") + (endings.at(-1) ? "\n" : "");
  return { file, before: content(before, beforeEnds), after: content(after, afterEnds), additions, deletions };
}

export function mapFileDiffs(value: unknown): FileDiff[] {
  if (!Array.isArray(value)) return failV2Diff();
  return value.map(mapFileDiff);
}

// ============================================================
// Todo
// ============================================================

/** Maps the native todowrite list from its canonical state.metadata.todos field. */
export function mapNativeTodoList(value: unknown, callID: unknown): TodoItem[] {
  if (!requireV2MessageID(callID) || !Array.isArray(value)) throw new Error("Invalid native todo metadata.");
  return value.map((item, index) => {
    if (
      !isRecord(item) ||
      typeof item.content !== "string" ||
      (item.status !== "pending" &&
        item.status !== "in_progress" &&
        item.status !== "completed" &&
        item.status !== "cancelled")
    ) {
      throw new Error("Invalid native todo metadata.");
    }
    return { id: `${callID}:${index}`, content: item.content, status: item.status, priority: "" };
  });
}

/** Projects the latest completed native todowrite metadata from raw chronological history. */
export function mapLatestNativeTodos(messages: unknown[]): TodoItem[] {
  if (!Array.isArray(messages)) throw new Error("Invalid native todo history.");
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex];
    if (!isRecord(message) || !Array.isArray(message.parts)) throw new Error("Invalid native todo history.");
    for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = message.parts[partIndex];
      if (!isRecord(part) || part.type !== "tool" || part.tool !== "todowrite") continue;
      if (!isRecord(part.state) || part.state.status !== "completed") continue;
      if (!isRecord(part.state.metadata) || !("todos" in part.state.metadata)) {
        throw new Error("Invalid native todo metadata.");
      }
      return mapNativeTodoList(part.state.metadata.todos, part.callID);
    }
  }
  return [];
}

// ============================================================
// Agent
// ============================================================

export function mapAgents(agents: V2AgentInfo[]): AgentInfo[] {
  const result: AgentInfo[] = [];
  for (const value of agents as unknown[]) {
    const agent = requireCatalogRecord(value, "agent");
    const id = requireCatalogString(agent.id, "agent.id");
    requireCatalogString(agent.name, "agent.name");
    const mode = agent.mode;
    if (mode !== "subagent" && mode !== "primary" && mode !== "all") {
      throw new Error("Invalid V2 agent mode catalog field.");
    }
    if (agent.hidden === true) continue;
    if (agent.hidden !== false) throw new Error("Invalid V2 agent hidden catalog field.");
    result.push({
      // The domain's name is passed back to session.switchAgent and must be the wire ID.
      name: id,
      mode,
      ...(typeof agent.description === "string" ? { description: agent.description } : {}),
      ...(typeof agent.color === "string" ? { color: agent.color } : {}),
    });
  }
  return result;
}

export function mapSkills(skills: V2SkillInfo[]): SkillInfo[] {
  return (skills as unknown[]).map((value) => {
    const skill = requireCatalogRecord(value, "skill");
    return {
      name: requireCatalogString(skill.name, "skill.name"),
      location: requireCatalogString(skill.path, "skill.path"),
      ...(typeof skill.description === "string" ? { description: skill.description } : {}),
    };
  });
}

// ============================================================
// Config
// ============================================================

export function mapConfig(value: unknown): AppConfig {
  if (!Array.isArray(value)) throw new Error("Invalid OpenCode V2 config entries.");
  const entries = value.map((entry) => {
    if (!isPlainJsonObject(entry) || Object.getOwnPropertySymbols(entry).length > 0) {
      throw new Error("Invalid OpenCode V2 config entry.");
    }
    const type = ownDataValue(entry, "type");
    const entryPath = ownDataValue(entry, "path");
    if (type === "directory") {
      if (Object.keys(entry).some((key) => key !== "type" && key !== "path")) {
        throw new Error("Invalid OpenCode V2 config entry.");
      }
      return { type: "directory", path: requireConfigPath(entryPath) };
    }
    if (type !== "document") throw new Error("Invalid OpenCode V2 config entry.");
    if (Object.keys(entry).some((key) => key !== "type" && key !== "path" && key !== "info")) {
      throw new Error("Invalid OpenCode V2 config entry.");
    }
    if (entryPath !== undefined) requireConfigPath(entryPath);
    const info = ownDataValue(entry, "info");
    if (!isPlainJsonObject(info)) throw new Error("Invalid OpenCode V2 config document.");
    return {
      type: "document",
      ...(entryPath === undefined ? {} : { path: entryPath as string }),
      info: cloneJsonObject(info),
    };
  });
  return { entries };
}

function ownDataValue(record: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor && !("value" in descriptor)) throw new Error("Invalid OpenCode V2 config entry.");
  return descriptor?.value;
}

function requireConfigPath(value: unknown): string {
  if (typeof value !== "string" || !path.isAbsolute(value)) throw new Error("Invalid OpenCode V2 config path.");
  return value;
}

function isPlainJsonObject(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  );
}

function cloneJsonObject(value: Record<string, unknown>): Record<string, unknown> {
  const ancestors = new WeakSet<object>();
  const clone = (item: unknown): unknown => {
    if (item === null || typeof item === "string" || typeof item === "boolean") return item;
    if (typeof item === "number" && Number.isFinite(item)) return item;
    if (Array.isArray(item)) {
      if (ancestors.has(item)) throw new Error("Invalid OpenCode V2 config document.");
      if (Object.getPrototypeOf(item) !== Array.prototype || Object.getOwnPropertySymbols(item).length > 0) {
        throw new Error("Invalid OpenCode V2 config document.");
      }
      ancestors.add(item);
      try {
        const result: unknown[] = [];
        for (let index = 0; index < item.length; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
          if (!descriptor || !("value" in descriptor)) throw new Error("Invalid OpenCode V2 config document.");
          result.push(clone(descriptor.value));
        }
        if (Object.keys(item).some((key) => key !== "length" && !/^(0|[1-9]\d*)$/.test(key))) {
          throw new Error("Invalid OpenCode V2 config document.");
        }
        return result;
      } finally {
        ancestors.delete(item);
      }
    }
    if (!isPlainJsonObject(item) || Object.getOwnPropertySymbols(item).length > 0) {
      throw new Error("Invalid OpenCode V2 config document.");
    }
    if (ancestors.has(item)) throw new Error("Invalid OpenCode V2 config document.");
    ancestors.add(item);
    try {
      const result: Record<string, unknown> = {};
      for (const key of Object.keys(item)) {
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (!descriptor || !("value" in descriptor)) throw new Error("Invalid OpenCode V2 config document.");
        Object.defineProperty(result, key, {
          value: clone(descriptor.value),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      return result;
    } finally {
      ancestors.delete(item);
    }
  };
  return clone(value) as Record<string, unknown>;
}

// ============================================================
// Path
// ============================================================

// ============================================================
// MCP Status
// ============================================================

export function mapMcpStatus(value: unknown): McpStatus {
  if (!Array.isArray(value)) throw new Error("Invalid V2 MCP status response");
  const result: McpStatus = {};
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.name !== "string" || !isCatalogString(entry.name)) {
      throw new Error("Invalid V2 MCP server status entry");
    }
    if (Object.hasOwn(result, entry.name)) throw new Error("Duplicate V2 MCP server name");
    if (!isRecord(entry.status) || typeof entry.status.status !== "string") {
      throw new Error("Invalid V2 MCP server status entry");
    }
    const native = entry.status.status;
    if (native === "connected" || native === "disabled") {
      result[entry.name] = { connected: native === "connected", status: native };
    } else if (native === "failed") {
      // Reduce native diagnostics to a fixed category; never expose their contents.
      const nativeError = typeof entry.status.error === "string" ? entry.status.error : "";
      const error = /network|connect|dns|tls|http|fetch|socket|timeout/i.test(nativeError)
        ? "Network request failed."
        : /write|mkdir|rename|unlink|read-only/i.test(nativeError)
          ? "Write operation failed."
          : /read|open|stat|readdir/i.test(nativeError)
            ? "Read operation failed."
            : /permission denied|eperm|eacces|operation not permitted/i.test(nativeError)
              ? "Permission denied."
              : "MCP server failed.";
      result[entry.name] = { connected: false, status: "failed", error };
    } else if (native === "needs_auth") {
      result[entry.name] = {
        connected: false,
        status: "needs_auth",
        error: "Authentication required.",
      };
    } else if (native === "pending") {
      result[entry.name] = { connected: false, status: "unknown", error: "MCP server is pending." };
    } else {
      throw new Error("Unsupported V2 MCP server status variant");
    }
  }
  return result;
}

function isCatalogString(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 256 &&
    !Array.from(value).some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 0x1f || code === 0x7f;
    })
  );
}

// ============================================================
// AllProvidersData
// ============================================================
