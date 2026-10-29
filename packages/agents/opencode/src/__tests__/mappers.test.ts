/**
 * mappers.ts のユニットテスト。
 * 各 mapper 関数が SDK 型からドメイン型に正しく変換することを検証する。
 */

import type {
  PermissionAsked,
  PermissionReplied,
  SessionDeleted,
  SessionInboxUser,
  SessionMessageAssistant,
  SessionMessageInfo,
  SessionMessageUser,
  V2Event,
} from "@opencode/client";
import { describe, expect, it, vi } from "vitest";
import {
  createV2EventMapper,
  deriveV2EventPartID,
  getV2SessionLifecycleFrame,
  mapAgents,
  mapConfig,
  mapConnectedProviderIDs,
  mapDefaultModel,
  mapFileDiff,
  mapFileDiffs,
  mapLatestNativeTodos,
  mapMcpStatus,
  mapNativeTodoList,
  mapProviders,
  mapV2Event,
  mapV2Messages,
  mapV2Session,
  mapV2UserAdmission,
} from "../mappers";

function nativeV2Frame<T extends V2Event>(frame: T): T {
  return frame;
}

function durableEventFields(id: string, created: number, seq: number) {
  return { id, created, durable: { aggregateID: "project-1", seq, version: 1 as const } };
}

// ============================================================
// Session mappers
// ============================================================

describe("mapV2Session", () => {
  const session = {
    id: "ses_v2",
    projectID: "project_v2",
    title: "V2 session",
    parentID: "parent_v2",
    time: { created: 10, updated: 20 },
    tokens: { input: 1, output: 2, reasoning: 3, cache: { read: 4, write: 5 } },
    location: { directory: "/workspace" },
  };

  it("explicitly maps V2 identity, timing, project, location, and token usage", () => {
    expect(mapV2Session(session)).toEqual({
      id: "ses_v2",
      title: "V2 session",
      parentID: "parent_v2",
      time: { created: 10, updated: 20 },
      projectID: "project_v2",
      directory: "/workspace",
      tokens: { input: 1, output: 2, reasoning: 3, cache: { read: 4, write: 5 } },
    });
  });

  it("provides the domain title for an omitted optional native title", () => {
    expect(mapV2Session({ ...session, title: undefined }).title).toBe("Untitled");
  });

  it("rejects a response bound to a different session or workspace", () => {
    expect(() => mapV2Session(session, { sessionID: "other" })).toThrow("ID did not match");
    expect(() => mapV2Session(session, { directory: "/other" })).toThrow("location did not match");
  });

  it("validates native fork provenance without projecting it or synthesizing parent identity", () => {
    const nativeFork = {
      ...session,
      id: "forked",
      parentID: undefined,
      fork: { sessionID: "ses_v2", boundary: { type: "before", messageID: "msg-1" } },
    };
    expect(
      mapV2Session(nativeFork, {
        fork: { sessionID: "ses_v2", boundaryType: "before", messageID: "msg-1" },
      }),
    ).toMatchObject({ id: "forked" });
    expect(mapV2Session(nativeFork).parentID).toBeUndefined();
    expect(() => mapV2Session(nativeFork, { fork: { sessionID: "other", boundaryType: "before" } })).toThrow(
      "fork provenance",
    );
    expect(() =>
      mapV2Session({ ...nativeFork, fork: { sessionID: "ses_v2", boundary: { type: "after", messageID: "msg-1" } } }),
    ).toThrow("Invalid V2 session fork provenance");
  });

  it.each([
    { ...session, id: "" },
    { ...session, time: { created: Number.NaN, updated: 20 } },
    { ...session, location: {} },
    { ...session, tokens: { ...session.tokens, cache: null } },
    { ...session, unrecognizedWireField: true },
  ])("rejects malformed required session fields or unknown response variants", (invalid) => {
    expect(() => mapV2Session(invalid)).toThrow();
  });
});

// ============================================================
// Message + Parts mappers
// ============================================================

describe("mapV2Messages", () => {
  const user = {
    id: "user-1",
    type: "user",
    time: { created: 100 },
    text: "Review the attached file",
    files: [
      {
        data: "bm90IHJlYWQ=",
        mime: "text/plain",
        source: { type: "uri", uri: "file:///workspace/note.txt" },
        name: "note.txt",
        description: "Reference note",
        mention: { start: 0, end: 12, text: "@note.txt" },
      },
      { data: "aW5saW5l", mime: "text/plain", source: { type: "inline" } },
    ],
    agents: [{ name: "scout" }],
    skills: [{ id: "skill-id", name: "research", text: "skill context" }],
  } satisfies SessionMessageUser;

  const assistant = {
    id: "assistant-1",
    type: "assistant",
    time: { created: 101, completed: 111 },
    agent: "scout",
    model: { id: "model-v2-id", providerID: "provider-1" },
    cost: 0.25,
    tokens: { input: 2, output: 3, reasoning: 1, cache: { read: 4, write: 5 } },
    finish: "tool-calls",
    content: [
      { type: "text", text: "Finding sources" },
      { type: "reasoning", text: "private reasoning", time: { created: 102, completed: 103 } },
      {
        type: "tool",
        id: "native-call-1",
        name: "execute",
        executed: true,
        time: { created: 104, ran: 105, completed: 110 },
        native: { progress: "searched", privateToken: "do-not-copy" },
        state: {
          status: "completed",
          input: { query: "topic" },
          content: [
            { type: "text", text: "Source found" },
            { type: "file", uri: "file:///workspace/result.txt", mime: "text/plain", name: "result.txt" },
          ],
          metadata: { progress: "done" },
        },
      },
      {
        type: "tool",
        id: "native-call-2",
        name: "search",
        time: { created: 106 },
        state: {
          status: "error",
          input: { query: "failed" },
          error: { type: "Error", message: "secret raw provider detail" },
          content: [{ type: "text", text: "Partial public output" }],
        },
      },
      {
        type: "tool",
        id: "native-call-3",
        name: "search",
        time: { created: 112 },
        state: { status: "streaming", input: '{"query":' },
      },
      {
        type: "tool",
        id: "native-call-4",
        name: "execute",
        time: { created: 113, ran: 114 },
        state: { status: "running", input: { code: "return 1" }, metadata: { progress: "working" } },
      },
    ],
  } satisfies SessionMessageAssistant;

  it("maps native user text, URI attachments, and agent/skill mentions with stable identity", () => {
    const [mapped] = mapV2Messages([user], "session-1");
    expect(mapped.info).toEqual({ id: "user-1", sessionID: "session-1", role: "user", time: { created: 100 } });
    expect(mapped.parts).toEqual([
      {
        id: "v2:text:user-1:0",
        sessionID: "session-1",
        messageID: "user-1",
        type: "text",
        text: "Review the attached file",
      },
      {
        id: "v2:file:user-1:0",
        sessionID: "session-1",
        messageID: "user-1",
        type: "file",
        url: "file:///workspace/note.txt",
        filename: "note.txt",
        mime: "text/plain",
        description: "Reference note",
        mention: { start: 0, end: 12, text: "@note.txt" },
      },
      {
        id: "v2:file:user-1:1",
        sessionID: "session-1",
        messageID: "user-1",
        type: "file",
        url: "data:text/plain;base64,aW5saW5l",
        filename: "Attachment",
        mime: "text/plain",
      },
      { id: "v2:agent:user-1:0", sessionID: "session-1", messageID: "user-1", type: "agent", name: "scout" },
      {
        id: "v2:skill:user-1:0",
        sessionID: "session-1",
        messageID: "user-1",
        type: "skill",
        skillID: "skill-id",
        name: "research",
      },
    ]);
    expect(mapped.parts.filter((part) => part.type === "skill")).toHaveLength(1);
    expect(mapped.parts.filter((part) => part.type === "agent")).toHaveLength(1);
  });

  it("maps assistant snapshots, stream-compatible text/reasoning IDs, and existing tool states", () => {
    const [mapped] = mapV2Messages([assistant], "session-1");
    expect(mapped.info).toMatchObject({
      id: "assistant-1",
      sessionID: "session-1",
      role: "assistant",
      modelID: "model-v2-id",
      providerID: "provider-1",
      cost: 0.25,
      finish: "tool-calls",
      time: { created: 101, completed: 111 },
    });
    expect(mapped.parts[0]).toEqual({
      id: deriveV2EventPartID("text", "assistant-1", 0),
      sessionID: "session-1",
      messageID: "assistant-1",
      type: "text",
      text: "Finding sources",
    });
    expect(mapped.parts[1]).toEqual({
      id: deriveV2EventPartID("reasoning", "assistant-1", 1),
      sessionID: "session-1",
      messageID: "assistant-1",
      type: "reasoning",
      text: "private reasoning",
      time: { start: 102, end: 103 },
    });
    expect(mapped.parts[2]).toMatchObject({
      id: "native-call-1",
      callID: "native-call-1",
      tool: "execute",
      state: { status: "completed", input: { query: "topic" } },
      metadata: {
        time: { created: 104, ran: 105, completed: 110 },
        executed: true,
        metadata: { progress: "done" },
      },
    });
    expect(mapped.parts[2]).toMatchObject({
      state: { output: expect.stringContaining("file:///workspace/result.txt") },
    });
    expect(mapped.parts[3]).toMatchObject({
      state: { status: "error", error: "Tool execution failed.\nPartial public output" },
    });
    expect(mapped.parts[4]).toMatchObject({ state: { status: "running", input: '{"query":' } });
    expect(mapped.parts[5]).toMatchObject({
      state: { status: "running", input: { code: "return 1" }, metadata: { progress: "working" } },
    });
    expect(JSON.stringify(mapped)).not.toContain("secret raw provider detail");
    expect(JSON.stringify(mapped)).not.toContain("privateToken");
  });

  it("omits native control/context messages instead of presenting them as user text", () => {
    const system = {
      id: "system-1",
      type: "system",
      time: { created: 1 },
      text: "private system context",
    } satisfies SessionMessageInfo;
    expect(mapV2Messages([system], "session-1")).toEqual([]);
  });

  it("rejects malformed user/assistant snapshots and invalid requested session IDs", () => {
    expect(() => mapV2Messages([{ ...user, id: "" }], "session-1")).toThrow("Invalid V2 message identity");
    expect(() => mapV2Messages([user], "")).toThrow("Invalid V2 messages response");
    expect(() =>
      mapV2Messages(
        [{ ...user, files: [{ data: "%%%", mime: "text/plain", source: { type: "inline" } }] }],
        "session-1",
      ),
    ).toThrow("Invalid V2 message file attachment data");
    expect(() => mapV2Messages([{ ...assistant, content: [null] }], "session-1")).toThrow(
      "Invalid V2 message assistant content",
    );
    expect(() => mapV2Messages([{ ...assistant, tokens: { ...assistant.tokens, cache: null } }], "session-1")).toThrow(
      "Invalid V2 message assistant cache tokens",
    );
    expect(() => mapV2Messages([{ ...assistant, cost: Number.NaN }], "session-1")).toThrow(
      "Invalid V2 session assistant cost",
    );
    expect(() => mapV2Messages([{ ...assistant, content: [{ type: "other" }] }], "session-1")).toThrow(
      "Unknown V2 assistant content type",
    );
    expect(() =>
      mapV2Messages(
        [
          {
            ...assistant,
            content: [
              { type: "tool", id: "unknown", name: "tool", time: { created: 1 }, state: { status: "waiting" } },
            ],
          },
        ],
        "session-1",
      ),
    ).toThrow("Unknown V2 tool state");
    expect(() =>
      mapV2Messages(
        [
          {
            ...assistant,
            content: [{ type: "tool", id: "broken", name: "execute", time: { created: 1 }, state: null }],
          },
        ],
        "session-1",
      ),
    ).toThrow("Invalid V2 message tool state");
  });
});

describe("mapV2UserAdmission", () => {
  const historyUser = {
    id: "user-1",
    type: "user",
    time: { created: 100 },
    text: "Review the attached file",
    files: [
      {
        data: "bm90IHJlYWQ=",
        mime: "text/plain",
        source: { type: "uri", uri: "file:///workspace/note.txt" },
        name: "note.txt",
        description: "Reference note",
        mention: { start: 0, end: 12, text: "@note.txt" },
      },
      { data: "aW5saW5l", mime: "text/plain", source: { type: "inline" } },
    ],
    agents: [{ name: "scout" }],
    skills: [{ id: "skill-id", name: "research", text: "skill context" }],
  } satisfies SessionMessageUser;
  const admission = {
    id: historyUser.id,
    sessionID: "session-1",
    time: historyUser.time,
    type: historyUser.type,
    payload: {
      text: historyUser.text,
      files: historyUser.files,
      agents: historyUser.agents,
      skills: historyUser.skills,
    },
    delivery: "steer",
  } satisfies SessionInboxUser;

  it("maps the exact native admission shape through stable history user-part IDs", () => {
    const historyMessage = mapV2Messages([historyUser], "session-1")[0];
    expect(mapV2UserAdmission(admission, { sessionID: "session-1", text: historyUser.text })).toEqual(historyMessage);
  });

  it.each([
    { ...admission, sessionID: "foreign-session" },
    { ...admission, type: "assistant" },
    { ...admission, delivery: "unknown" },
    { ...admission, payload: { ...admission.payload, text: "different prompt" } },
    {
      ...admission,
      payload: { ...admission.payload, files: [{ ...historyUser.files![0], mime: "bad" }] },
    },
  ])("rejects malformed, foreign, or mismatched prompt admission", (invalid) => {
    expect(() => mapV2UserAdmission(invalid, { sessionID: "session-1", text: historyUser.text })).toThrow(
      "valid user-admission response",
    );
  });

  it("binds assist admission IDs to the exact native message ID", () => {
    expect(() =>
      mapV2UserAdmission(admission, { sessionID: "session-1", text: historyUser.text, messageID: "other-message" }),
    ).toThrow("valid user-admission response");
  });
});

// ============================================================
// Event mapper
// ============================================================

describe("mapV2Event", () => {
  it("maps native deletion to minimal identity and ignores malformed/unknown lifecycle frames", () => {
    const deleted = nativeV2Frame<SessionDeleted>({
      ...durableEventFields("evt-delete", 1, 1),
      durable: { aggregateID: "project-1", seq: 1, version: 2 },
      type: "session.deleted",
      data: { sessionID: "sess-deleted" },
    });
    expect(mapV2Event(deleted)).toEqual([{ type: "session.deleted", properties: { info: { id: "sess-deleted" } } }]);
    expect(getV2SessionLifecycleFrame({ type: "session.created", data: { sessionID: "sess-1" } })).toEqual({
      kind: "created",
      sessionID: "sess-1",
    });
    expect(
      getV2SessionLifecycleFrame({ type: "session.renamed", data: { sessionID: "sess-1", title: "Title" } }),
    ).toEqual({
      kind: "updated",
      sessionID: "sess-1",
    });
    expect(getV2SessionLifecycleFrame({ type: "session.unknown", data: { sessionID: "sess-1" } })).toBeUndefined();
    expect(getV2SessionLifecycleFrame({ type: "session.created", data: { sessionID: "" } })).toBeUndefined();
    expect(mapV2Event({ type: "session.deleted", data: { id: "sess-1" } })).toEqual([]);
  });

  it("clears only the deleted session's assistant, tool, and question mapper state", () => {
    const map = createV2EventMapper();
    const startSession = (sessionID: string) => {
      map({
        ...durableEventFields(`step-${sessionID}`, 1, 1),
        type: "session.step.started",
        data: {
          sessionID,
          assistantMessageID: `assistant-${sessionID}`,
          agent: "scout",
          model: { id: "model", providerID: "provider" },
          started: 1,
        },
      });
      map({
        ...durableEventFields(`text-${sessionID}`, 1, 2),
        type: "session.text.started",
        data: { sessionID, assistantMessageID: `assistant-${sessionID}`, ordinal: 0 },
      });
      map({
        ...durableEventFields(`tool-${sessionID}`, 2, 3),
        type: "session.tool.input.started",
        data: { sessionID, assistantMessageID: `assistant-${sessionID}`, id: `call-${sessionID}`, name: "search" },
      });
      map({
        ...durableEventFields(`called-${sessionID}`, 3, 4),
        type: "session.tool.called",
        data: {
          sessionID,
          assistantMessageID: `assistant-${sessionID}`,
          id: `call-${sessionID}`,
          input: { query: "test" },
          executed: true,
        },
      });
      map({
        type: "form.created",
        data: {
          form: {
            id: `form-${sessionID}`,
            sessionID,
            title: "Question",
            metadata: { kind: "question", tool: { messageID: `assistant-${sessionID}`, id: `call-${sessionID}` } },
            fields: [{ key: "q0", type: "string", title: "Pick", description: "Choice", options: [], custom: true }],
          },
        },
      });
    };
    startSession("sess-1");
    startSession("sess-2");
    expect(map({ type: "session.deleted", data: { sessionID: "sess-1" } })).toEqual([
      { type: "session.deleted", properties: { info: { id: "sess-1" } } },
    ]);
    expect(
      map({
        id: "late-text-1",
        created: 4,
        type: "session.text.delta",
        data: { sessionID: "sess-1", assistantMessageID: "assistant-sess-1", ordinal: 0, delta: "late" },
      }),
    ).toEqual([]);
    expect(
      map({
        id: "late-tool-1",
        created: 4,
        type: "session.tool.progress",
        data: { sessionID: "sess-1", assistantMessageID: "assistant-sess-1", id: "call-sess-1", metadata: {} },
      }),
    ).toEqual([]);
    expect(
      map({ type: "form.replied", data: { id: "form-sess-1", sessionID: "sess-1", answer: { q0: "answer" } } }),
    ).toEqual([]);
    expect(
      map({
        id: "late-text-2",
        created: 4,
        type: "session.text.delta",
        data: { sessionID: "sess-2", assistantMessageID: "assistant-sess-2", ordinal: 0, delta: "kept" },
      }),
    ).toHaveLength(1);
    expect(
      map({
        id: "late-tool-2",
        created: 4,
        type: "session.tool.progress",
        data: { sessionID: "sess-2", assistantMessageID: "assistant-sess-2", id: "call-sess-2", metadata: {} },
      }),
    ).toHaveLength(1);
    expect(
      map({ type: "form.replied", data: { id: "form-sess-2", sessionID: "sess-2", answer: { q0: "answer" } } }),
    ).toEqual([{ type: "question.replied", properties: { sessionID: "sess-2", requestID: "form-sess-2" } }]);
  });

  it("maps only native question forms and preserves tool identity and ordered field semantics", () => {
    const mapper = createV2EventMapper();
    const created = {
      id: "event-1",
      created: 1,
      type: "form.created",
      data: {
        form: {
          id: "form-1",
          sessionID: "sess-1",
          title: "Question",
          metadata: { kind: "question", tool: { messageID: "msg-1", id: "call-1" } },
          fields: [
            {
              key: "q0",
              type: "string",
              title: "Header",
              description: "Question text",
              options: [{ value: "A", label: "A", description: "Alpha" }],
              custom: true,
            },
            {
              key: "q1",
              type: "multiselect",
              title: "Multi",
              description: "Choose",
              options: [{ value: "B", label: "B", description: "Beta" }],
              custom: true,
            },
          ],
        },
      },
    };
    expect(mapper(created)).toEqual([
      {
        type: "question.asked",
        properties: {
          id: "form-1",
          sessionID: "sess-1",
          tool: { messageID: "msg-1", callID: "call-1" },
          questions: [
            {
              header: "Header",
              question: "Question text",
              options: [{ label: "A", description: "Alpha" }],
              custom: true,
            },
            {
              header: "Multi",
              question: "Choose",
              options: [{ label: "B", description: "Beta" }],
              multiple: true,
              custom: true,
            },
          ],
        },
      },
    ]);
    expect(
      mapper({
        type: "form.created",
        data: { form: { ...created.data.form, id: "oauth", metadata: { kind: "oauth" } } },
      }),
    ).toEqual([]);
    expect(
      mapper({ type: "form.replied", data: { id: "form-1", sessionID: "sess-1", answer: { q0: "A", q1: ["B"] } } }),
    ).toEqual([{ type: "question.replied", properties: { sessionID: "sess-1", requestID: "form-1" } }]);
    expect(mapper({ type: "form.cancelled", data: { id: "form-1", sessionID: "sess-1" } })).toEqual([]);
    const cancelledMapper = createV2EventMapper();
    cancelledMapper(created);
    expect(cancelledMapper({ type: "form.cancelled", data: { id: "form-1", sessionID: "sess-1" } })).toEqual([
      { type: "question.rejected", properties: { sessionID: "sess-1", requestID: "form-1" } },
    ]);
  });

  it("rejects malformed question fields and ignores orphan, foreign, or invalid answers", () => {
    const mapper = createV2EventMapper();
    const form = {
      id: "form-1",
      sessionID: "sess-1",
      title: "Question",
      metadata: { kind: "question", tool: { messageID: "msg", id: "call" } },
      fields: [
        {
          key: "q1",
          type: "string",
          title: "Header",
          description: "Question",
          options: [{ value: "different", label: "Label", description: "Choice" }],
          custom: true,
        },
      ],
    };
    expect(mapper({ type: "form.created", data: { form } })).toEqual([]);
    expect(mapper({ type: "form.replied", data: { id: "form-1", sessionID: "sess-1", answer: {} } })).toEqual([]);
    expect(mapper({ type: "form.cancelled", data: { id: "unknown", sessionID: "sess-1" } })).toEqual([]);
  });

  it("prevalidates question hydration and rejects duplicate IDs without partial state", () => {
    const mapper = createV2EventMapper();
    const form = {
      id: "form-hydrated",
      sessionID: "sess-1",
      title: "Question",
      metadata: { kind: "question", tool: { messageID: "msg-1", id: "call-1" } },
      fields: [{ key: "q0", type: "string", title: "Header", description: "Choose", options: [] }],
    };
    expect(() => mapper.hydrateQuestionForms([form, { ...form, sessionID: "sess-2" }])).toThrow();
    expect(() => mapper.hydrateQuestionForms([form, { ...form, id: "malformed", fields: [{ key: "q1" }] }])).toThrow();
    expect(mapper({ type: "form.created", data: { form } })).toHaveLength(1);
    expect(mapper({ type: "form.created", data: { form } })).toEqual([]);
  });

  it("hydrates questions and permissions atomically and rejects malformed or conflicting permissions", () => {
    const mapper = createV2EventMapper();
    const form = {
      id: "atomic-form",
      sessionID: "sess-1",
      title: "Question",
      metadata: { kind: "question", tool: { messageID: "msg-1", id: "call-1" } },
      fields: [{ key: "q0", type: "string", title: "Header", description: "Choose", options: [] }],
    };
    const permission = { id: "atomic-permission", sessionID: "sess-1", action: "edit", resources: [], save: [] };
    expect(() => mapper.hydratePendingInteractions([form], [{ ...permission, resources: "invalid" }])).toThrow();
    expect(mapper({ type: "form.created", data: { form } })).toHaveLength(1);
    expect(() => mapper.hydratePendingInteractions([], [permission, { ...permission, sessionID: "sess-2" }])).toThrow();
    expect(mapper({ type: "permission.asked", data: permission })).toHaveLength(1);
  });

  it("maps long native permission resource strings without treating them as IDs", () => {
    const longResource = `/${"nested/".repeat(100)}resource.txt`;
    const mapper = createV2EventMapper();
    expect(
      mapper({
        type: "permission.asked",
        data: { id: "permission-long-resource", sessionID: "sess-1", action: "edit", resources: [longResource] },
      }),
    ).toMatchObject([{ type: "permission.asked", properties: { patterns: [longResource], always: [] } }]);
  });

  it("accepts every valid native question field without a Scribe-only count cap", () => {
    const mapper = createV2EventMapper();
    const fields = Array.from({ length: 33 }, (_, index) => ({
      key: `q${index}`,
      type: "string",
      title: `Header ${index}`,
      description: `Question ${index}`,
      options: [],
      custom: true,
    }));
    const events = mapper({
      type: "form.created",
      data: {
        form: {
          id: "form-large",
          sessionID: "session-large",
          title: "Questions",
          metadata: { kind: "question", tool: { messageID: "message-large", id: "call-large" } },
          fields,
        },
      },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("question.asked");
    if (events[0]?.type === "question.asked") expect(events[0].properties.questions).toHaveLength(33);
  });

  it("rejects malformed optional custom flags and overlong question/tool IDs", () => {
    const mapper = createV2EventMapper();
    const form = {
      id: "form-1",
      sessionID: "sess-1",
      title: "Questions",
      metadata: { kind: "question", tool: { messageID: "msg", id: "call" } },
      fields: [{ key: "q0", type: "string", title: "Header", description: "Question", options: [], custom: "true" }],
    };
    expect(mapper({ type: "form.created", data: { form } })).toEqual([]);
    expect(
      mapper({
        type: "form.created",
        data: {
          form: {
            ...form,
            metadata: { ...form.metadata, tool: { messageID: "msg", id: "x".repeat(513) } },
            fields: [{ ...form.fields[0], custom: true }],
          },
        },
      }),
    ).toEqual([]);
  });

  it("maps native permission asks/replies with session and tool identity, preserving public confirmation metadata", () => {
    const asked = {
      id: "permission-event",
      created: 10,
      type: "permission.asked",
      data: {
        id: "permission-request",
        sessionID: "session-permission",
        action: "hindsight_retain",
        resources: ["session-summary"],
        save: [],
        metadata: { summary: "bounded public confirmation value" },
        source: { type: "tool", messageID: "assistant-message", id: "tool-call" },
      },
    } satisfies PermissionAsked;
    const replied = {
      id: "permission-reply-event",
      created: 11,
      type: "permission.replied",
      data: { sessionID: "session-permission", requestID: "permission-request", reply: "once" },
    } satisfies PermissionReplied;

    expect(mapV2Event(asked)).toEqual([
      {
        type: "permission.asked",
        properties: {
          id: "permission-request",
          sessionID: "session-permission",
          permission: "hindsight_retain",
          patterns: ["session-summary"],
          always: [],
          metadata: { summary: "bounded public confirmation value" },
          tool: { messageID: "assistant-message", callID: "tool-call" },
        },
      },
    ]);
    expect(mapV2Event(replied)).toEqual([
      {
        type: "permission.replied",
        properties: { sessionID: "session-permission", requestID: "permission-request", reply: "once" },
      },
    ]);
  });

  it("ignores malformed permission frames without exposing unrelated envelope metadata", () => {
    const valid = {
      id: "permission-event",
      created: 10,
      type: "permission.asked",
      metadata: { providerState: "must not escape", credential: "not copied" },
      data: {
        id: "permission-request",
        sessionID: "session-permission",
        action: "edit",
        resources: ["file"],
      },
    } satisfies PermissionAsked;
    expect(mapV2Event(valid)).toEqual([
      {
        type: "permission.asked",
        properties: {
          id: "permission-request",
          sessionID: "session-permission",
          permission: "edit",
          patterns: ["file"],
          always: [],
          metadata: {},
        },
      },
    ]);
    for (const data of [
      { ...valid.data, id: "" },
      { ...valid.data, resources: ["ok", 1] },
      { ...valid.data, save: "always" },
      { ...valid.data, metadata: [] },
      { ...valid.data, source: { type: "tool", messageID: "m", id: "" } },
    ]) {
      expect(mapV2Event({ ...valid, data })).toEqual([]);
    }
    expect(
      mapV2Event({
        id: "permission-reply-event",
        created: 11,
        type: "permission.replied",
        data: { sessionID: "session-permission", requestID: "permission-request", reply: "legacy-reply" },
      }),
    ).toEqual([]);
  });

  it("maps native execution lifecycle, status, and compaction frames", () => {
    expect(
      mapV2Event(
        nativeV2Frame({
          ...durableEventFields("execution-started", 1, 1),
          type: "session.execution.started",
          data: { sessionID: "s1" },
        }),
      ),
    ).toEqual([{ type: "session.status", properties: { sessionID: "s1", status: { type: "busy" } } }]);
    expect(
      mapV2Event(
        nativeV2Frame({
          ...durableEventFields("execution-succeeded", 2, 2),
          type: "session.execution.succeeded",
          data: { sessionID: "s1" },
        }),
      ),
    ).toEqual([{ type: "session.status", properties: { sessionID: "s1", status: { type: "idle" } } }]);
    expect(
      mapV2Event(
        nativeV2Frame({
          ...durableEventFields("execution-interrupted", 3, 3),
          type: "session.execution.interrupted",
          data: { sessionID: "s1", reason: "user" },
        }),
      ),
    ).toEqual([{ type: "session.status", properties: { sessionID: "s1", status: { type: "idle" } } }]);
    expect(
      mapV2Event(
        nativeV2Frame({
          id: "status-event",
          created: 4,
          type: "session.status",
          data: { sessionID: "s1", status: { type: "busy" } },
        }),
      ),
    ).toEqual([{ type: "session.status", properties: { sessionID: "s1", status: { type: "busy" } } }]);
    expect(
      mapV2Event(
        nativeV2Frame({
          ...durableEventFields("compaction-ended", 5, 4),
          type: "session.compaction.ended",
          data: { sessionID: "s1", reason: "manual", text: "private", recent: "private" },
        }),
      ),
    ).toEqual([{ type: "session.compacted", properties: { sessionID: "s1" } }]);
  });

  it("redacts native execution failures and emits error plus idle", () => {
    const mapped = mapV2Event(
      nativeV2Frame({
        ...durableEventFields("execution-failed", 1, 1),
        type: "session.execution.failed",
        data: { sessionID: "s1", error: { type: "ProviderError", message: "raw model response" } },
      }),
    );
    expect(mapped).toEqual([
      { type: "session.error", properties: { sessionID: "s1", error: "OpenCode session execution failed." } },
      { type: "session.status", properties: { sessionID: "s1", status: { type: "idle" } } },
    ]);
    expect(JSON.stringify(mapped)).not.toContain("raw model response");
  });

  it("recognizes server.connected only with a native empty data frame", () => {
    expect(mapV2Event(nativeV2Frame({ id: "server-connected", type: "server.connected", data: {} }))).toEqual([
      { type: "server.connected", properties: {} },
    ]);
    expect(mapV2Event({ type: "server.connected" } as never)).toEqual([]);
  });

  it("translates assistant headers, text and reasoning streams, and step completion with stable IDs", () => {
    const map = createV2EventMapper();
    const sessionID = "session-1";
    const assistantMessageID = "assistant-message-1";
    const textPartID = deriveV2EventPartID("text", assistantMessageID, 0);
    const reasoningID = deriveV2EventPartID("reasoning", assistantMessageID, 1);

    expect(
      map(
        nativeV2Frame({
          ...durableEventFields("step-started", 100, 10),
          metadata: { secret: "must not escape" },
          type: "session.step.started",
          data: {
            sessionID,
            assistantMessageID,
            agent: "scribe-agent",
            model: { id: "model-1", providerID: "provider-1" },
            started: 95,
          },
        }),
      ),
    ).toEqual([
      {
        type: "message.updated",
        properties: {
          sessionID,
          info: {
            id: assistantMessageID,
            sessionID,
            role: "assistant",
            time: { created: 95 },
            modelID: "model-1",
            providerID: "provider-1",
            model: { providerID: "provider-1", modelID: "model-1" },
            agent: "scribe-agent",
          },
        },
      },
    ]);

    expect(
      map(
        nativeV2Frame({
          ...durableEventFields("text-started", 101, 11),
          type: "session.text.started",
          data: { sessionID, assistantMessageID, ordinal: 0 },
        }),
      ),
    ).toEqual([
      {
        type: "message.part.updated",
        properties: {
          sessionID,
          part: {
            id: textPartID,
            sessionID,
            messageID: assistantMessageID,
            type: "text",
            text: "",
            time: { start: 101 },
          },
        },
      },
    ]);
    expect(
      map(
        nativeV2Frame({
          id: "text-delta",
          type: "session.text.delta",
          created: 102,
          data: { sessionID, assistantMessageID, ordinal: 0, delta: "latest " },
        }),
      ),
    ).toEqual([
      {
        type: "message.part.delta",
        properties: { sessionID, messageID: assistantMessageID, partID: textPartID, field: "text", delta: "latest " },
      },
    ]);
    expect(
      map(
        nativeV2Frame({
          ...durableEventFields("text-ended", 103, 12),
          type: "session.text.ended",
          data: { sessionID, assistantMessageID, ordinal: 0, text: "latest complete" },
        }),
      ),
    ).toEqual([
      {
        type: "message.part.updated",
        properties: {
          sessionID,
          part: {
            id: textPartID,
            sessionID,
            messageID: assistantMessageID,
            type: "text",
            text: "latest complete",
            time: { start: 101, end: 103 },
          },
        },
      },
    ]);

    expect(
      map(
        nativeV2Frame({
          ...durableEventFields("reasoning-started", 104, 13),
          type: "session.reasoning.started",
          data: { sessionID, assistantMessageID, ordinal: 1 },
        }),
      ),
    ).toEqual([{ type: "session.next.reasoning.started", properties: { sessionID, assistantMessageID, reasoningID } }]);
    expect(
      map(
        nativeV2Frame({
          id: "reasoning-delta",
          type: "session.reasoning.delta",
          created: 105,
          data: { sessionID, assistantMessageID, ordinal: 1, delta: "private thought" },
        }),
      ),
    ).toEqual([
      {
        type: "session.next.reasoning.delta",
        properties: { sessionID, assistantMessageID, reasoningID, delta: "private thought" },
      },
    ]);
    expect(
      map(
        nativeV2Frame({
          ...durableEventFields("reasoning-ended", 106, 14),
          type: "session.reasoning.ended",
          data: { sessionID, assistantMessageID, ordinal: 1, text: "private thought complete" },
        }),
      ),
    ).toEqual([
      {
        type: "session.next.reasoning.ended",
        properties: { sessionID, assistantMessageID, reasoningID, text: "private thought complete" },
      },
    ]);

    const tokens = { input: 11, output: 12, reasoning: 13, cache: { read: 14, write: 15 } };
    expect(
      map(
        nativeV2Frame({
          ...durableEventFields("step-ended", 110, 15),
          type: "session.step.ended",
          data: { sessionID, assistantMessageID, finish: "stop", cost: 0.25, tokens, rawFinish: "private" },
        }),
      ),
    ).toEqual([
      {
        type: "message.updated",
        properties: {
          sessionID,
          info: {
            id: assistantMessageID,
            sessionID,
            role: "assistant",
            time: { created: 95, completed: 110 },
            modelID: "model-1",
            providerID: "provider-1",
            model: { providerID: "provider-1", modelID: "model-1" },
            agent: "scribe-agent",
            cost: 0.25,
            tokens,
            finish: "stop",
          },
        },
      },
      { type: "session.next.step.ended", properties: { sessionID, tokens } },
    ]);
    expect(map({ type: "session.step.ended", created: 111, data: { sessionID, assistantMessageID } })).toEqual([]);
  });

  it("rejects the legacy modelID alias and invalid text ordinals, IDs, deltas, and timestamps", () => {
    const map = createV2EventMapper();
    const invalidHeader = {
      ...durableEventFields("legacy-model-header", 100, 1),
      type: "session.step.started",
      data: {
        sessionID: "session-1",
        assistantMessageID: "assistant-1",
        agent: "agent-1",
        model: { providerID: "provider-1", modelID: "model-1" },
        started: 99,
      },
    };
    expect(map(invalidHeader)).toEqual([]);
    expect(
      map(
        nativeV2Frame({
          ...durableEventFields("native-model-header", 101, 2),
          type: "session.step.started",
          data: {
            sessionID: "session-1",
            assistantMessageID: "assistant-1",
            agent: "agent-1",
            model: { id: "model-1", providerID: "provider-1" },
            started: 99,
          },
        }),
      ),
    ).toHaveLength(1);
    for (const ordinal of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        map({
          type: "session.text.started",
          created: 101,
          data: { sessionID: "session-1", assistantMessageID: "assistant-1", ordinal },
        }),
      ).toEqual([]);
    }
    expect(
      map({
        type: "session.text.started",
        created: Number.POSITIVE_INFINITY,
        data: { sessionID: "session-1", assistantMessageID: "assistant-1", ordinal: 0 },
      }),
    ).toEqual([]);
    expect(
      map({
        type: "session.text.delta",
        created: 102,
        data: { sessionID: "session-1", assistantMessageID: "assistant-1", ordinal: 0, delta: 3 },
      }),
    ).toEqual([]);
    expect(
      map({
        type: "session.text.ended",
        created: 103,
        data: { sessionID: "session-1", assistantMessageID: "assistant-1", ordinal: 0, text: "orphan" },
      }),
    ).toEqual([]);
  });

  it("maps a failed step to a bounded opaque assistant message error", () => {
    const map = createV2EventMapper();
    map(
      nativeV2Frame({
        ...durableEventFields("failure-step-start", 100, 1),
        type: "session.step.started",
        data: {
          sessionID: "session-1",
          assistantMessageID: "assistant-1",
          agent: "agent-1",
          model: { id: "model-1", providerID: "provider-1" },
          started: 99,
        },
      }),
    );
    const events = map(
      nativeV2Frame({
        ...durableEventFields("failure-step-end", 101, 2),
        type: "session.step.failed",
        data: {
          sessionID: "session-1",
          assistantMessageID: "assistant-1",
          error: { type: "ProviderError", message: "secret provider error" },
        },
      }),
    );
    expect(events).toEqual([
      {
        type: "message.updated",
        properties: {
          sessionID: "session-1",
          info: {
            id: "assistant-1",
            sessionID: "session-1",
            role: "assistant",
            time: { created: 99, completed: 101 },
            modelID: "model-1",
            providerID: "provider-1",
            model: { providerID: "provider-1", modelID: "model-1" },
            agent: "agent-1",
            error: { name: "OpenCodeError", message: "Assistant step failed." },
          },
        },
      },
    ]);
    expect(JSON.stringify(events)).not.toContain("secret provider error");
  });

  it("publishes a todo update only once from successful native todowrite metadata", () => {
    const map = createV2EventMapper();
    const sessionID = "todo-session";
    const assistantMessageID = "todo-message";
    const step = (id: string, seq: number) =>
      nativeV2Frame({
        ...durableEventFields(id, seq, seq),
        type: "session.step.started",
        data: { sessionID, assistantMessageID, agent: "build", model: { id: "m", providerID: "p" }, started: 1 },
      });
    const started = (id: string, name: string, seq: number) =>
      nativeV2Frame({
        ...durableEventFields(`start-${id}`, seq, seq),
        type: "session.tool.input.started",
        data: { sessionID, assistantMessageID, id, name },
      });
    const called = (id: string, seq: number) =>
      nativeV2Frame({
        ...durableEventFields(`called-${id}`, seq, seq),
        type: "session.tool.called",
        data: { sessionID, assistantMessageID, id, input: {}, executed: true },
      });
    const success = (id: string, metadata: { todos: Array<{ content: string; status: string }> }, seq: number) =>
      nativeV2Frame({
        ...durableEventFields(`success-${id}`, seq, seq),
        durable: { aggregateID: "project-1", seq, version: 2 as const },
        type: "session.tool.success",
        data: { sessionID, assistantMessageID, id, content: [{ type: "text", text: "" }], metadata, executed: true },
      });
    map(step("todo-step", 1));
    const todos = (["pending", "in_progress", "completed", "cancelled"] as const).map((status, index) => ({
      content: `Unicode task 🧭 ${index}`,
      status,
    }));

    map(started("todo-call", "todowrite", 2));
    map(called("todo-call", 3));
    const completed = map(success("todo-call", { todos }, 4));
    expect(completed).toHaveLength(2);
    expect(completed[0]?.type).toBe("message.part.updated");
    expect(completed[1]).toEqual({
      type: "todo.updated",
      properties: {
        sessionID,
        todos: todos.map((todo, index) => ({ ...todo, id: `todo-call:${index}`, priority: "" })),
      },
    });
    expect(map(success("todo-call", { todos: [] }, 5))).toEqual([]);

    map(started("todo-clear", "todowrite", 6));
    map(called("todo-clear", 7));
    expect(map(success("todo-clear", { todos: [] }, 8))[1]).toEqual({
      type: "todo.updated",
      properties: { sessionID, todos: [] },
    });

    map(started("todo-invalid", "todowrite", 9));
    map(called("todo-invalid", 10));
    const malformed = map(success("todo-invalid", { todos: [{ content: "bad", status: "unknown" }] }, 11));
    expect(malformed).toHaveLength(1);
    expect(malformed[0]?.type).toBe("message.part.updated");
    expect(malformed.some((event) => event.type === "todo.updated")).toBe(false);

    map(started("same-name", "my-todowrite", 12));
    map(called("same-name", 13));
    expect(map(success("same-name", { todos }, 14))).toHaveLength(1);
  });

  it("maps native tool input, execution progress, success, and partial failure with snapshot identity", () => {
    const map = createV2EventMapper();
    const sessionID = "tool-session";
    const assistantMessageID = "tool-message";
    const start = (id: string, seq: number) =>
      map(
        nativeV2Frame({
          ...durableEventFields(`tool-start-${id}`, seq, seq),
          type: "session.tool.input.started",
          data: { sessionID, assistantMessageID, id, name: id === "call-success" ? "execute" : "search" },
        }),
      );
    map(
      nativeV2Frame({
        ...durableEventFields("tool-step-start", 1, 1),
        type: "session.step.started",
        data: { sessionID, assistantMessageID, agent: "scout", model: { id: "m", providerID: "p" }, started: 1 },
      }),
    );
    expect(start("call-success", 2)[0]).toMatchObject({
      type: "message.part.updated",
      properties: { part: { id: "call-success", callID: "call-success", state: { status: "pending" } } },
    });
    map(
      nativeV2Frame({
        id: "tool-input-delta",
        created: 3,
        type: "session.tool.input.delta",
        data: { sessionID, assistantMessageID, id: "call-success", delta: '{"q":' },
      }),
    );
    expect(
      map(
        nativeV2Frame({
          ...durableEventFields("tool-called", 4, 3),
          type: "session.tool.called",
          data: { sessionID, assistantMessageID, id: "call-success", input: { q: "topic" }, executed: true },
        }),
      )[0],
    ).toMatchObject({
      type: "message.part.updated",
      properties: { part: { state: { status: "running", input: { q: "topic" } } } },
    });
    expect(
      map(
        nativeV2Frame({
          id: "tool-progress",
          created: 5,
          type: "session.tool.progress",
          data: {
            sessionID,
            assistantMessageID,
            id: "call-success",
            metadata: { phase: "searching", toolCalls: ["search"] },
          },
        }),
      )[0],
    ).toMatchObject({
      type: "message.part.updated",
      properties: {
        part: {
          state: { status: "running", metadata: { phase: "searching", toolCalls: ["search"] } },
          metadata: { executed: true, metadata: { phase: "searching", toolCalls: ["search"] } },
        },
      },
    });
    expect(
      map(
        nativeV2Frame({
          id: "tool-progress-repeat",
          created: 5.5,
          type: "session.tool.progress",
          data: {
            sessionID,
            assistantMessageID,
            id: "call-success",
            metadata: { phase: "complete", toolCalls: ["search", "summarize"] },
          },
        }),
      )[0],
    ).toMatchObject({
      properties: {
        part: {
          state: { status: "running", metadata: { phase: "complete", toolCalls: ["search", "summarize"] } },
          metadata: { executed: true, metadata: { phase: "complete", toolCalls: ["search", "summarize"] } },
        },
      },
    });
    expect(
      map(
        nativeV2Frame({
          ...durableEventFields("tool-success", 6, 4),
          durable: { aggregateID: "project-1", seq: 4, version: 2 as const },
          type: "session.tool.success",
          data: {
            sessionID,
            assistantMessageID,
            id: "call-success",
            content: [{ type: "text", text: "Found" }],
            metadata: { count: 1 },
            executed: true,
          },
        }),
      )[0],
    ).toMatchObject({
      type: "message.part.updated",
      properties: {
        part: {
          id: "call-success",
          state: { status: "completed", output: "Found", metadata: { count: 1 } },
          metadata: { executed: true, metadata: { count: 1 } },
        },
      },
    });

    start("call-failed", 7);
    map(
      nativeV2Frame({
        ...durableEventFields("tool-called-failed", 8, 5),
        type: "session.tool.called",
        data: { sessionID, assistantMessageID, id: "call-failed", input: { query: "bad" }, executed: false },
      }),
    );
    const failedProgress = map(
      nativeV2Frame({
        id: "failed-tool-progress",
        created: 8.5,
        type: "session.tool.progress",
        data: { sessionID, assistantMessageID, id: "call-failed", metadata: { toolCalls: ["execute"] } },
      }),
    );
    expect(failedProgress[0]).toMatchObject({
      properties: { part: { metadata: { executed: false, metadata: { toolCalls: ["execute"] } } } },
    });
    expect(
      map(
        nativeV2Frame({
          id: "failed-tool-progress-repeat",
          created: 8.75,
          type: "session.tool.progress",
          data: { sessionID, assistantMessageID, id: "call-failed", metadata: { toolCalls: ["execute", "search"] } },
        }),
      )[0],
    ).toMatchObject({
      properties: {
        part: { metadata: { executed: false, metadata: { toolCalls: ["execute", "search"] } } },
      },
    });
    const failed = map(
      nativeV2Frame({
        ...durableEventFields("tool-failed", 9, 6),
        durable: { aggregateID: "project-1", seq: 6, version: 2 as const },
        type: "session.tool.failed",
        data: {
          sessionID,
          assistantMessageID,
          id: "call-failed",
          error: { type: "Opaque", message: "private error" },
          content: [{ type: "text", text: "Partial result" }],
          executed: false,
        },
      }),
    );
    expect(failed[0]).toMatchObject({
      properties: {
        part: {
          state: { status: "error", error: "Tool execution failed.\nPartial result" },
          metadata: { executed: false },
        },
      },
    });
    expect(JSON.stringify(failed)).not.toContain("private error");
  });

  it("ignores malformed/orphan tool frames and clears scoped tool state on terminal events", () => {
    const map = createV2EventMapper();
    const frame = (type: string, data: Record<string, unknown>, id = type, created = 1) => ({
      id,
      created,
      type,
      data,
    });
    const started = frame("session.step.started", {
      sessionID: "s1",
      assistantMessageID: "m1",
      agent: "a",
      model: { id: "model", providerID: "provider" },
      started: 1,
    });
    map(started);
    expect(
      map(
        frame("session.tool.progress", {
          sessionID: "s1",
          assistantMessageID: "m1",
          id: "orphan",
          metadata: { x: true },
        }),
      ),
    ).toEqual([]);
    map(
      frame("session.tool.input.started", { sessionID: "s1", assistantMessageID: "m1", id: "valid", name: "execute" }),
    );
    expect(
      map(
        frame(
          "session.tool.input.delta",
          { sessionID: "s1", assistantMessageID: "m1", id: "valid", delta: "secret partial" },
          "bad",
          Number.NaN,
        ),
      ),
    ).toEqual([]);
    map(frame("session.execution.succeeded", { sessionID: "s1" }));
    expect(
      map(
        frame("session.tool.called", {
          sessionID: "s1",
          assistantMessageID: "m1",
          id: "valid",
          input: {},
          executed: true,
        }),
      ),
    ).toEqual([]);
  });

  it("starts with clean assistant state for each fresh event subscription", () => {
    const firstStreamMapper = createV2EventMapper();
    firstStreamMapper(
      nativeV2Frame({
        ...durableEventFields("first-stream-start", 100, 1),
        type: "session.step.started",
        data: {
          sessionID: "session-1",
          assistantMessageID: "assistant-1",
          agent: "agent-1",
          model: { id: "model-1", providerID: "provider-1" },
          started: 99,
        },
      }),
    );
    const nextStreamMapper = createV2EventMapper();
    expect(
      nextStreamMapper({
        type: "session.text.started",
        created: 101,
        data: { sessionID: "session-1", assistantMessageID: "assistant-1", ordinal: 0 },
      }),
    ).toEqual([]);
  });

  it("ignores malformed, unknown, non-lifecycle, and duplicate-completion source frames", () => {
    for (const event of [
      null,
      "not-an-event",
      undefined,
      {},
      { type: "session.execution.started" },
      { type: "session.status", data: { sessionID: "s1", status: { type: "retry" } } },
      { type: "session.idle", data: { sessionID: "s1" } },
      { type: "message.updated", data: { sessionID: "s1" } },
      { type: "unknown.event", data: { sessionID: "s1" } },
    ]) {
      expect(() => mapV2Event(event as never)).not.toThrow();
      expect(mapV2Event(event as never)).toEqual([]);
    }
  });
});

// ============================================================
// Provider mapper
// ============================================================

describe("mapProviders", () => {
  it("maps native providers and their model identity without fabricating costs", () => {
    const providers = [
      { id: "p1", name: "Provider 1", activation: "enabled", package: "provider-one", integrationID: "i1" },
      { id: "p2", name: "Provider 2", activation: "auto", package: "provider-two" },
    ];
    const models = [
      {
        id: "m1",
        providerID: "p1",
        modelID: "m1",
        name: "Model 1",
        limit: { context: 100, output: 20 },
        capabilities: { input: ["text", "image"], output: ["text", "reasoning"], tools: true, temperature: true },
        cost: [
          { tier: { type: "context", size: 1000 }, input: 90, output: 90, cache: { read: 90, write: 90 } },
          { input: 1, output: 2, cache: { read: 3, write: 4 } },
        ],
        enabled: true,
        status: "active",
        variants: [],
      },
    ];
    const integrations = [
      {
        id: "i1",
        name: "Integration",
        methods: [{ id: "env", type: "env", names: ["API_KEY", "API_KEY", "REGION"] }],
        connections: [],
      },
    ];
    const result = mapProviders(providers as never, models as never, integrations as never);
    expect(result).toEqual([
      {
        id: "p1",
        name: "Provider 1",
        env: ["API_KEY", "REGION"],
        npm: "provider-one",
        models: {
          m1: {
            id: "m1",
            name: "Model 1",
            limit: { context: 100, output: 20 },
            status: "active",
            attachment: true,
            reasoning: true,
            temperature: true,
            tool_call: true,
            cost: { input: 1, output: 2, cache_read: 3, cache_write: 4 },
            variants: {},
          },
        },
      },
      { id: "p2", name: "Provider 2", env: [], npm: "provider-two", models: {} },
    ]);
  });

  it("rejects malformed and orphaned native model metadata", () => {
    const providers = [{ id: "p1", name: "Provider 1", activation: "enabled", package: "provider-one" }];
    expect(() =>
      mapProviders(
        providers as never,
        [
          {
            id: "m1",
            providerID: "missing-provider",
            modelID: "m1",
            name: "Model",
            limit: { context: 10, output: 2 },
          },
        ] as never,
      ),
    ).toThrow("unknown provider");
    expect(() =>
      mapProviders(
        providers as never,
        [
          {
            id: "m1",
            providerID: "p1",
            modelID: "m1",
            name: "Model",
            limit: { context: "unknown", output: 2 },
            capabilities: { input: ["text"], output: ["text"], tools: false },
            cost: [],
          },
        ] as never,
      ),
    ).toThrow("model.limit.context");
  });

  it("rejects duplicate integrations and unsafe environment-name metadata", () => {
    const providers = [{ id: "p1", name: "Provider", activation: "enabled", package: "x", integrationID: "i1" }];
    const duplicateIntegrations = [
      { id: "i1", name: "One", methods: [], connections: [] },
      { id: "i1", name: "Two", methods: [], connections: [] },
    ];
    expect(() => mapProviders(providers as never, [] as never, duplicateIntegrations as never)).toThrow(
      "Duplicate V2 integration catalog ID",
    );
    const malformedEnv = [
      {
        id: "i1",
        name: "Integration",
        methods: [{ id: "env", type: "env", names: ["API_KEY=secret"] }],
        connections: [],
      },
    ];
    expect(() => mapProviders(providers as never, [] as never, malformedEnv as never)).toThrow(
      "Invalid V2 integration environment name",
    );
  });

  it("maps disabled models to disabled even when the status enum is new", () => {
    const provider = [{ id: "p1", name: "Provider", activation: "enabled", package: "x" }];
    const model = [
      {
        id: "m1",
        providerID: "p1",
        modelID: "m1",
        name: "Model",
        limit: { context: 10, output: 2 },
        capabilities: { input: ["text"], output: ["text"], tools: false },
        cost: [],
        enabled: false,
        status: "future-status",
        variants: [],
      },
    ];
    expect(mapProviders(provider as never, model as never)[0]?.models.m1?.status).toBe("disabled");
  });

  it("keys models by the unique native id even when upstream modelIDs collide", () => {
    const provider = [{ id: "p1", name: "Provider", activation: "enabled", package: "x" }];
    const modelFor = (id: string) => ({
      id,
      providerID: "p1",
      modelID: "deepseek-flash-latest",
      name: id,
      limit: { context: 10, output: 2 },
      capabilities: { input: ["text"], output: ["text"], tools: false },
      cost: [],
      enabled: true,
      status: "active",
      variants: [],
    });
    const models = [modelFor("deepseek-flash-latest"), modelFor("deepseek-flash-latest-priority")];
    const [mapped] = mapProviders(provider as never, models as never);
    expect(Object.keys(mapped?.models ?? {})).toEqual(["deepseek-flash-latest", "deepseek-flash-latest-priority"]);
    expect(mapped?.models["deepseek-flash-latest-priority"]).toMatchObject({
      id: "deepseek-flash-latest-priority",
      name: "deepseek-flash-latest-priority",
    });
  });

  it("still rejects duplicate native model ids within one provider", () => {
    const provider = [{ id: "p1", name: "Provider", activation: "enabled", package: "x" }];
    const modelFor = (name: string) => ({
      id: "m1",
      providerID: "p1",
      modelID: `upstream-${name}`,
      name,
      limit: { context: 10, output: 2 },
      capabilities: { input: ["text"], output: ["text"], tools: false },
      cost: [],
      enabled: true,
      status: "active",
      variants: [],
    });
    expect(() => mapProviders(provider as never, [modelFor("a"), modelFor("b")] as never)).toThrow(
      "Duplicate V2 model catalog ID.",
    );
  });

  it("uses the native default model id rather than the upstream modelID", () => {
    expect(
      mapDefaultModel({
        id: "deepseek-flash-latest-priority",
        providerID: "fireworks",
        modelID: "deepseek-flash-latest",
      } as never),
    ).toEqual({ fireworks: "deepseek-flash-latest-priority" });
    expect(mapDefaultModel(null)).toEqual({});
  });

  it("maps configured availability using activation and connection presence, not reauth health", () => {
    const providers = [
      { id: "disabled", name: "Disabled", activation: "disabled", package: "x" },
      { id: "enabled", name: "Enabled", activation: "enabled", package: "x", integrationID: "enabled-auth" },
      { id: "auto-connected", name: "Auto", activation: "auto", package: "x", integrationID: "credential" },
      { id: "auto-needs-auth", name: "Needs auth", activation: "auto", package: "x", integrationID: "env" },
      { id: "anonymous", name: "Anonymous", activation: "auto", package: "x" },
    ];
    const integrations = [
      {
        id: "enabled-auth",
        name: "Enabled",
        methods: [],
        connections: [{ type: "credential", id: "redacted", label: "Key", method: "key" }],
      },
      {
        id: "credential",
        name: "Credential",
        methods: [],
        connections: [{ type: "credential", id: "redacted", label: "Key", method: "key" }],
      },
      {
        id: "env",
        name: "Environment",
        methods: [],
        connections: [{ type: "env", name: "API_KEY", status: { status: "needs_auth", message: "redacted" } }],
      },
    ];
    expect(mapConnectedProviderIDs(providers as never, integrations as never)).toEqual([
      "enabled",
      "auto-connected",
      "auto-needs-auth",
      "anonymous",
    ]);
  });
});

// ============================================================
// FileDiff mapper
// ============================================================

describe("mapFileDiff", () => {
  it("reconstructs complete added and deleted file contents from native patches", () => {
    expect(
      mapFileDiff({
        file: "new file.ts",
        patch:
          "diff --git a/new file.ts b/new file.ts\nnew file mode 100644\n--- /dev/null\n+++ b/new file.ts\n@@ -0,0 +1,2 @@\n+α\n+β\n",
        additions: 2,
        deletions: 0,
        status: "added",
      }),
    ).toEqual({ file: "new file.ts", before: "", after: "α\nβ\n", additions: 2, deletions: 0 });
    expect(
      mapFileDiff({
        file: "old file.ts",
        patch:
          "diff --git a/old file.ts b/old file.ts\ndeleted file mode 100644\n--- a/old file.ts\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-old\n-file\n",
        additions: 0,
        deletions: 2,
        status: "deleted",
      }),
    ).toEqual({ file: "old file.ts", before: "old\nfile\n", after: "", additions: 0, deletions: 2 });
  });

  it("reconstructs complete formatter-style added, deleted, and modified file patches", () => {
    const addedPatch =
      "Index: 文/新.txt\n===================================================================\n--- 文/新.txt\n+++ 文/新.txt\n@@ -0,0 +1 @@\n+雪\n\\ No newline at end of file\n";
    expect(mapFileDiff({ file: "文/新.txt", patch: addedPatch, additions: 1, deletions: 0, status: "added" })).toEqual({
      file: "文/新.txt",
      before: "",
      after: "雪",
      additions: 1,
      deletions: 0,
    });
    const deletedPatch =
      "Index: 文/旧.txt\n===================================================================\n--- 文/旧.txt\n+++ 文/旧.txt\n@@ -1 +0,0 @@\n-旧\n\\ No newline at end of file\n";
    expect(
      mapFileDiff({ file: "文/旧.txt", patch: deletedPatch, additions: 0, deletions: 1, status: "deleted" }),
    ).toEqual({
      file: "文/旧.txt",
      before: "旧",
      after: "",
      additions: 0,
      deletions: 1,
    });
    const modifiedPatch =
      "Index: 文/同.txt\n===================================================================\n--- 文/同.txt\n+++ 文/同.txt\n@@ -1 +1 @@\n-前\n+後\n";
    expect(
      mapFileDiff({ file: "文/同.txt", patch: modifiedPatch, additions: 1, deletions: 1, status: "modified" }),
    ).toEqual({
      file: "文/同.txt",
      before: "前\n",
      after: "後\n",
      additions: 1,
      deletions: 1,
    });
  });

  it("preserves CRLF payload, marker-looking text, and no-final-newline state", () => {
    const patch =
      "diff --git a/雪 +.txt b/雪 +.txt\n--- a/雪 +.txt\n+++ b/雪 +.txt\n@@ -1 +1 @@\n-+minus\r\n\\ No newline at end of file\n+ space\r\n\\ No newline at end of file\n";
    expect(mapFileDiff({ file: "雪 +.txt", patch, additions: 1, deletions: 1, status: "modified" })).toEqual({
      file: "雪 +.txt",
      before: "+minus\r",
      after: " space\r",
      additions: 1,
      deletions: 1,
    });
  });

  it("supports an empty added or deleted file", () => {
    const addedPatch = "diff --git a/empty b/empty\nnew file mode 100644\nindex 0000000..e69de29\n";
    expect(mapFileDiff({ file: "empty", patch: addedPatch, additions: 0, deletions: 0, status: "added" })).toEqual({
      file: "empty",
      before: "",
      after: "",
      additions: 0,
      deletions: 0,
    });
    const deletedPatch = "diff --git a/empty b/empty\ndeleted file mode 100644\nindex e69de29..0000000\n";
    expect(mapFileDiff({ file: "empty", patch: deletedPatch, additions: 0, deletions: 0, status: "deleted" })).toEqual({
      file: "empty",
      before: "",
      after: "",
      additions: 0,
      deletions: 0,
    });
  });

  it("marks ambiguous no-hunk formatter patches for empty added or deleted files as unavailable", () => {
    const patch =
      "Index: empty\n===================================================================\n--- empty\n+++ empty\n";
    for (const status of ["added", "deleted"] as const) {
      expect(mapFileDiff({ file: "empty", patch, additions: 0, deletions: 0, status })).toEqual({
        file: "empty",
        before: "",
        after: "",
        additions: 0,
        deletions: 0,
        contentUnavailable: "unavailable",
      });
    }
  });

  it("allows an existing file to become empty or an empty existing file to gain content", () => {
    expect(
      mapFileDiff({
        file: "existing",
        patch: "diff --git a/existing b/existing\n--- a/existing\n+++ b/existing\n@@ -1 +0,0 @@\n-old\n",
        additions: 0,
        deletions: 1,
        status: "modified",
      }),
    ).toEqual({ file: "existing", before: "old\n", after: "", additions: 0, deletions: 1 });
    expect(
      mapFileDiff({
        file: "existing",
        patch: "diff --git a/existing b/existing\n--- a/existing\n+++ b/existing\n@@ -0,0 +1 @@\n+new\n",
        additions: 1,
        deletions: 0,
        status: "modified",
      }),
    ).toEqual({ file: "existing", before: "", after: "new\n", additions: 1, deletions: 0 });
  });

  it("rejects invalid no-newline markers, interior blank lines, and unterminated patches", () => {
    const head = "diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1 +1 @@\n";
    for (const item of [
      { patch: `${head}\\ No newline at end of file\n-old\n+new\n`, additions: 1, deletions: 1 },
      {
        patch: `${head}-old\n\\ No newline at end of file\n\\ No newline at end of file\n+new\n`,
        additions: 1,
        deletions: 1,
      },
      {
        patch: `${head.replace("@@ -1 +1 @@", "@@ -1 +1,2 @@")}-old\n+new\n\\ No newline at end of file\n+later\n`,
        additions: 2,
        deletions: 1,
      },
      { patch: `${head}-old\n\n+new\n`, additions: 1, deletions: 1 },
      { patch: `${head}-old\n+new`, additions: 1, deletions: 1 },
    ]) {
      expect(() => mapFileDiff({ file: "f", ...item, status: "modified" })).toThrow(
        "Invalid or unsupported OpenCode V2 session diff.",
      );
    }
  });

  it("rejects malformed fields, contradictory counts, partial rows, and non-string patches opaquely", () => {
    const valid = {
      file: "src/a.ts",
      patch: "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new\n",
      additions: 1,
      deletions: 1,
      status: "modified",
    };
    for (const value of [
      { ...valid, file: "" },
      { ...valid, additions: -1 },
      { ...valid, additions: 2 },
      { ...valid, status: "renamed" },
      { ...valid, patch: valid.patch.replace("+new\n", "") },
      { ...valid, patch: 7 },
    ]) {
      expect(() => mapFileDiff(value)).toThrow("Invalid or unsupported OpenCode V2 session diff.");
    }
  });
});

describe("mapFileDiff unavailable content", () => {
  const SECRET = "SECRET-PATCH-TEXT";
  const unavailable = (kind: "binary" | "unavailable", additions = 0, deletions = 0) => ({
    file: "f",
    before: "",
    after: "",
    additions,
    deletions,
    contentUnavailable: kind,
  });

  it("marks binary patches without reconstructing content", () => {
    for (const patch of [
      "diff --git a/f b/f\nBinary files a/f and b/f differ\n",
      "diff --git a/f b/f\nGIT binary patch\nliteral 4\n",
    ]) {
      expect(mapFileDiff({ file: "f", patch, additions: 0, deletions: 0, status: "modified" })).toEqual(
        unavailable("binary"),
      );
    }
  });

  it("marks capped, formatter-empty, mode-only, and partial/multi-hunk patches as unavailable", () => {
    const head = "diff --git a/f b/f\n--- a/f\n+++ b/f\n";
    const cases = [
      { patch: "", additions: 3, deletions: 1, status: "modified" },
      {
        patch: "Index: f\n===================================================================\n--- f\n+++ f\n",
        additions: 0,
        deletions: 0,
        status: "added",
      },
      {
        patch: "diff --git a/f b/f\nold mode 100644\nnew mode 100755\n",
        additions: 0,
        deletions: 0,
        status: "modified",
      },
      { patch: `${head}@@ -1 +1 @@\n-a\n+b\n@@ -9 +9 @@\n-c\n+d\n`, additions: 2, deletions: 2, status: "modified" },
      { patch: `${head}@@ -5 +5 @@\n-a\n+b\n`, additions: 1, deletions: 1, status: "modified" },
    ] as const;
    for (const c of cases) {
      expect(mapFileDiff({ file: "f", ...c })).toEqual(unavailable("unavailable", c.additions, c.deletions));
    }
  });

  it("still throws opaquely for corrupt patches without leaking patch text", () => {
    const head = `diff --git a/f b/f\n--- a/f\n+++ b/f\n`;
    const base = { file: "f", additions: 1, deletions: 1, status: "modified" };
    for (const patch of [
      `${head}@@ -1 +1 @@\n-${SECRET}\n`, // rows short of header counts
      `${head}@@ -1 +1 @@\n-a\n+b\n@@ -9 +9 @@\n-c\n`, // multi-hunk row/count mismatch
      `${head}@@ -1 +1 @@\n-a\n+b`, // unterminated, non-empty
      `${head}@@ nonsense ${SECRET}\n`, // @@ without a parseable hunk
      `not a patch ${SECRET}\n`,
    ]) {
      let message = "";
      try {
        mapFileDiff({ ...base, patch });
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message).toBe("Invalid or unsupported OpenCode V2 session diff.");
    }
    expect(() => mapFileDiff({ ...base, patch: 5 })).toThrow("Invalid or unsupported OpenCode V2 session diff.");
    expect(() => mapFileDiff({ ...base, file: "", patch: "" })).toThrow(
      "Invalid or unsupported OpenCode V2 session diff.",
    );
    expect(() => mapFileDiff({ ...base, patch: "", additions: -1 })).toThrow(
      "Invalid or unsupported OpenCode V2 session diff.",
    );
  });

  it("keeps good entries intact in a mixed list", () => {
    const good = {
      file: "a.ts",
      patch: "diff --git a/a.ts b/a.ts\nnew file mode 100644\n--- /dev/null\n+++ b/a.ts\n@@ -0,0 +1 @@\n+new\n",
      additions: 1,
      deletions: 0,
      status: "added",
    };
    const bin = {
      file: "doc.pdf",
      patch: "diff --git a/doc.pdf b/doc.pdf\nBinary files differ\n",
      additions: 0,
      deletions: 0,
      status: "modified",
    };
    expect(mapFileDiffs([good, { ...bin, patch: "Binary files a and b differ\n" }, good])).toEqual([
      { file: "a.ts", before: "", after: "new\n", additions: 1, deletions: 0 },
      { file: "doc.pdf", before: "", after: "", additions: 0, deletions: 0, contentUnavailable: "binary" },
      { file: "a.ts", before: "", after: "new\n", additions: 1, deletions: 0 },
    ]);
    expect(() => mapFileDiffs([good, null])).toThrow("Invalid or unsupported OpenCode V2 session diff.");
  });
});

describe("mapFileDiffs", () => {
  it("maps native arrays and rejects non-array results", () => {
    const diffs = [
      {
        file: "a.ts",
        patch: "diff --git a/a.ts b/a.ts\nnew file mode 100644\n--- /dev/null\n+++ b/a.ts\n@@ -0,0 +1 @@\n+new\n",
        additions: 1,
        deletions: 0,
        status: "added",
      },
    ];
    expect(mapFileDiffs(diffs)).toEqual([{ file: "a.ts", before: "", after: "new\n", additions: 1, deletions: 0 }]);
    expect(() => mapFileDiffs({})).toThrow("Invalid or unsupported OpenCode V2 session diff.");
  });

  it("should return empty array for empty input", () => {
    expect(mapFileDiffs([])).toEqual([]);
  });
});

// ============================================================
// Todo mapper
// ============================================================

describe("mapLatestNativeTodos", () => {
  const write = (callID: string, todos: unknown, status = "completed") => ({
    type: "tool",
    tool: "todowrite",
    callID,
    state: { status, metadata: todos === undefined ? undefined : { todos } },
  });

  it("maps exact native statuses, Unicode/empty content, and view-only IDs without invented priority", () => {
    const todos = ["pending", "in_progress", "completed", "cancelled"].map((status) => ({
      content: `作業 ${status}`,
      status,
    }));
    expect(mapLatestNativeTodos([{ parts: [write("native-call", todos)] }])).toEqual(
      todos.map((todo, index) => ({ id: `native-call:${index}`, ...todo, priority: "" })),
    );
    expect(mapLatestNativeTodos([{ parts: [write("call", [{ content: "", status: "pending" }])] }])[0]?.content).toBe(
      "",
    );
  });

  it("uses the newest completed write in chronological part order; an empty write clears", () => {
    const old = write("old", undefined);
    const newest = write("new", [{ content: "new", status: "completed" }]);
    expect(mapLatestNativeTodos([{ parts: [old] }, { parts: [newest] }])[0]?.id).toBe("new:0");
    expect(mapLatestNativeTodos([{ parts: [newest, write("clear", [])] }])).toEqual([]);
  });

  it("ignores running and failed writes but rejects malformed newest completed metadata opaquely", () => {
    const previous = write("previous", [{ content: "kept", status: "pending" }]);
    expect(
      mapLatestNativeTodos([
        {
          parts: [
            write("previous", [{ content: "kept", status: "pending" }]),
            write("running", null, "running"),
            write("failed", null, "error"),
          ],
        },
      ])[0]?.id,
    ).toBe("previous:0");
    expect(() =>
      mapLatestNativeTodos([{ parts: [previous, write("bad", [{ content: "x", status: "unknown" }])] }]),
    ).toThrow("Invalid native todo metadata.");
  });

  it("rejects invalid call IDs before constructing domain IDs", () => {
    expect(() => mapNativeTodoList([{ content: "x", status: "pending" }], "")).toThrow("Invalid native todo metadata.");
  });
});

// ============================================================
// Agent mapper
// ============================================================

describe("mapAgents", () => {
  it("maps supported native agent fields only", () => {
    const agents = [
      { id: "a1", name: "scout", mode: "all", hidden: false, request: {}, permissions: {} },
      {
        id: "a2",
        name: "worker",
        mode: "subagent",
        hidden: false,
        description: "Read-only",
        request: {},
        permissions: {},
      },
    ];
    const result = mapAgents(agents as never);
    expect(result).toEqual([
      { name: "a1", mode: "all" },
      { name: "a2", mode: "subagent", description: "Read-only" },
    ]);
  });

  it("maps the operational native agent id and omits hidden entries", () => {
    expect(
      mapAgents([
        { id: "scout", name: "Chat Scout", mode: "primary", hidden: false, request: {}, permissions: {} },
        { id: "review-internal", name: "Review UI Name", mode: "primary", hidden: true, request: {}, permissions: {} },
      ] as never),
    ).toEqual([{ name: "scout", mode: "primary" }]);
  });

  it("rejects an unknown native agent mode instead of inventing a domain mode", () => {
    expect(() =>
      mapAgents([
        { id: "a1", name: "agent", mode: "future-mode", hidden: false, request: {}, permissions: {} },
      ] as never),
    ).toThrow("Invalid V2 agent mode");
  });
});

// ============================================================
// Config mapper
// ============================================================

describe("mapConfig", () => {
  it("preserves ordered source variants and clones opaque complete JSON settings", () => {
    const info = {
      mcp: { local: { command: ["node", "server.js"], enabled: true } },
      plugins: ["one"],
      nested: { values: [1, null, false] },
    };
    const result = mapConfig([
      { type: "directory", path: "/global" },
      { type: "document", path: "/global/opencode.json", info },
      { type: "document", info: { model: "process-overlay" } },
    ]);
    expect(result).toEqual({
      entries: [
        { type: "directory", path: "/global" },
        { type: "document", path: "/global/opencode.json", info },
        { type: "document", info: { model: "process-overlay" } },
      ],
    });
    ((result.entries as unknown[])[1] as { info: typeof info }).info.mcp.local.command.push("changed");
    expect(info.mcp.local.command).toEqual(["node", "server.js"]);
  });

  it("maps empty entries", () => {
    expect(mapConfig([])).toEqual({ entries: [] });
  });

  it.each([
    null,
    {},
    [{ type: "unknown" }],
    [{ type: "directory" }],
    [{ type: "directory", path: "relative" }],
    [{ type: "document", info: [] }],
  ])("rejects malformed or unknown entries safely", (input) => expect(() => mapConfig(input)).toThrow());

  it("rejects non-JSON values and accessors without invoking them", () => {
    const getter = vi.fn(() => "bad");
    const info = Object.defineProperty({}, "secret", { enumerable: true, get: getter });
    expect(() => mapConfig([{ type: "document", info }])).toThrow("Invalid OpenCode V2 config document.");
    expect(getter).not.toHaveBeenCalled();
    expect(() => mapConfig([{ type: "document", info: { value: Number.NaN } }])).toThrow();
  });

  it.each(["nested object", "array"])("rejects a %s cycle with a fixed non-leaking error", (kind) => {
    const cycle: Record<string, unknown> = { secret: "do-not-leak" };
    if (kind === "nested object") cycle.nested = { parent: cycle };
    else cycle.values = [cycle];
    expect(() => mapConfig([{ type: "document", info: cycle }])).toThrow("Invalid OpenCode V2 config document.");
    try {
      mapConfig([{ type: "document", info: cycle }]);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("Invalid OpenCode V2 config document.");
      expect((error as Error).message).not.toContain("do-not-leak");
    }
  });

  it("clones shared noncyclic objects independently", () => {
    const shared = { value: 1 };
    const result = mapConfig([{ type: "document", info: { first: shared, second: shared } }]);
    const copied = ((result.entries as unknown[])[0] as { info: { first: object; second: object } }).info;
    expect(copied.first).toEqual({ value: 1 });
    expect(copied.second).toEqual({ value: 1 });
    expect(copied.first).not.toBe(copied.second);
  });

  it("copies prototype-like JSON keys as inert own data", () => {
    const info = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}');
    const result = mapConfig([{ type: "document", info }]);
    const copied = ((result.entries as unknown[])[0] as { info: Record<string, unknown> }).info;
    expect(Object.hasOwn(copied, "__proto__")).toBe(true);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });
});

// ============================================================
// Path mapper
// ============================================================

// ============================================================
// MCP Status mapper
// ============================================================

describe("mapMcpStatus", () => {
  it("maps every pinned native status without leaking native diagnostics", () => {
    const result = mapMcpStatus([
      { name: "connected server", status: { status: "connected" } },
      { name: "pending-server", status: { status: "pending" } },
      { name: "disabled-server", status: { status: "disabled" } },
      { name: "failed-server", status: { status: "failed", error: "token=secret" } },
      { name: "auth-server", status: { status: "needs_auth", error: "secret URL" } },
    ]);
    expect(result).toEqual({
      "connected server": { connected: true, status: "connected" },
      "pending-server": { connected: false, status: "unknown", error: "MCP server is pending." },
      "disabled-server": { connected: false, status: "disabled" },
      "failed-server": { connected: false, status: "failed", error: "MCP server failed." },
      "auth-server": { connected: false, status: "needs_auth", error: "Authentication required." },
    });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("preserves an empty native catalog", () => {
    const result = mapMcpStatus([]);
    expect(result).toEqual({});
  });

  it.each([
    null,
    {},
    [{ name: "", status: { status: "connected" } }],
    [{ name: "bad\nname", status: { status: "connected" } }],
    [{ name: "server", status: { status: "future" } }],
    [{ name: "server" }],
  ])("rejects malformed native status response %#", (fixture) => {
    expect(() => mapMcpStatus(fixture)).toThrow();
  });

  it("rejects duplicate native server names instead of overwriting", () => {
    expect(() =>
      mapMcpStatus([
        { name: "duplicate", status: { status: "connected" } },
        { name: "duplicate", status: { status: "disabled" } },
      ]),
    ).toThrow("Duplicate V2 MCP server name");
  });

  it("should normalize connected native entry", () => {
    const result = mapMcpStatus([{ name: "server-1", status: { status: "connected" } }]);
    expect(result["server-1"]).toEqual({
      connected: true,
      status: "connected",
    });
  });
});

// ============================================================
// AllProvidersData mapper
// ============================================================
