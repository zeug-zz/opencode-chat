import type { AgentEvent, AgentInfo, ChatSession, SkillInfo, TodoItem } from "@opencode-chat/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { EmptyState } from "./components/molecules/EmptyState";
import { FileChangesHeader } from "./components/molecules/FileChangesHeader";
import { TodoHeader } from "./components/molecules/TodoHeader";
import { ChatHeader } from "./components/organisms/ChatHeader";
import { InputArea } from "./components/organisms/InputArea";
import { MessagesArea } from "./components/organisms/MessagesArea";
import { PermissionQueue } from "./components/organisms/PermissionView";
import { SessionList } from "./components/organisms/SessionList";
import { AppContextProvider, type AppContextValue } from "./contexts/AppContext";
import { useFileChanges } from "./hooks/useFileChanges";
import { useLocale } from "./hooks/useLocale";
import { useMessages } from "./hooks/useMessages";
import { usePermissions } from "./hooks/usePermissions";
import { useProviders } from "./hooks/useProviders";
import { useQuestions } from "./hooks/useQuestions";
import { useSession } from "./hooks/useSession";
import { useSoundNotification } from "./hooks/useSoundNotification";
import { LocaleProvider } from "./locales";
import type { FileAttachment, HostToUIMessage, UIToHostMessage } from "./vscode-api";
import { postMessage } from "./vscode-api";

// re-export for consumers that import from App.tsx
export type { MessageWithParts } from "./hooks/useMessages";

function formatK(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return k % 1 === 0 ? `${k}K` : `${k.toFixed(1)}K`;
  }
  return String(n);
}

function formatContextMemory(tokens: number, limit?: number): string {
  if (!limit || limit <= 0) return formatK(tokens);
  return `${formatK(tokens)} (${Math.min(100, Math.round((tokens / limit) * 100))}%)`;
}

function isZeroContextText(text: string): boolean {
  return /^0(?:\.0+)?K?\s*(?:\(0%\))?$/.test(text.trim());
}

export function App() {
  const activeSessionRef = useRef<ChatSession | null>(null);
  const session = useSession(activeSessionRef);
  activeSessionRef.current = session.activeSession;

  const msg = useMessages(activeSessionRef);
  const prov = useProviders();
  const perm = usePermissions(activeSessionRef);
  const quest = useQuestions(activeSessionRef);
  const locale = useLocale();
  const fileChanges = useFileChanges(activeSessionRef);
  const sound = useSoundNotification(activeSessionRef);

  useEffect(() => {
    setContextMemory("");
    contextTokensRef.current.delete(session.activeSession?.id ?? "");
  }, [session.activeSession?.id]);

  // Extension Host → Webview メッセージでのみ更新される単純なステート
  const [openEditors, setOpenEditors] = useState<FileAttachment[]>([]);
  const [activeEditorFile, setActiveEditorFile] = useState<FileAttachment | null>(null);
  const [workspaceFiles, setWorkspaceFiles] = useState<FileAttachment[]>([]);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [childSessions, setChildSessions] = useState<ChatSession[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [selectedPrimaryAgent, setSelectedPrimaryAgent] = useState<string | null>(null);
  const [difitAvailable, setDifitAvailable] = useState(false);
  const [openCodePaths, setOpenCodePaths] = useState<{
    home?: string;
    config: string;
    state: string;
    directory: string;
  } | null>(null);

  const [contextMemory, setContextMemory] = useState<string>("");
  const awaitingCompactionContextRef = useRef<string | null>(null);
  const contextTokensRef = useRef<Map<string, number>>(new Map());

  const updateContextDisplay = useCallback(
    (tokens: number) => {
      if (tokens <= 0) return;
      const provider = prov.providers.find((p) => p.id === prov.selectedModel?.providerID);
      const model = provider?.models[prov.selectedModel?.modelID ?? ""];
      setContextMemory(formatContextMemory(tokens, model?.limit?.context));
    },
    [prov.providers, prov.selectedModel],
  );

  useEffect(() => {
    const sessionId = session.activeSession?.id;
    if (!sessionId) return;
    if (awaitingCompactionContextRef.current === sessionId) return;

    let total = 0;
    for (const message of msg.messages) {
      for (const part of message.parts) {
        if (part.type === "step-finish") {
          total += part.tokens?.input ?? 0;
        }
      }
    }

    if (total <= 0) return;
    contextTokensRef.current.set(sessionId, total);
    updateContextDisplay(total);
  }, [session.activeSession?.id, msg.messages, updateContextDisplay]);

  const handleOpenConfigFile = useCallback((filePath: string) => {
    postMessage({ type: "openConfigFile", filePath });
  }, []);

  const handleOpenTerminal = useCallback(() => {
    postMessage({ type: "openTerminal" });
  }, []);

  // SSE event handler — dispatches to domain-specific hooks
  // activeSessionRef を使うことで session.activeSession（オブジェクト参照）への依存を排除し、
  // handleEvent を安定した参照に保つ。これにより useEffect の不要な再登録を防ぐ。
  const handleEvent = useCallback(
    (event: AgentEvent) => {
      session.handleSessionEvent(event);
      msg.handleMessageEvent(event);
      perm.handlePermissionEvent(event);
      quest.handleQuestionEvent(event);
      fileChanges.handleFileChangeEvent(event);
      sound.handleSoundEvent(event);

      const currentSession = activeSessionRef.current;

      // file.edited イベント時にセッション差分を再取得する
      if (event.type === "file.edited" && currentSession && event.properties.sessionID === currentSession.id) {
        postMessage({ type: "getSessionDiff", sessionId: currentSession.id });
      }

      // todo.updated イベント時にアクティブセッションの Todo を更新する
      if (event.type === "todo.updated" && event.properties.sessionID === currentSession?.id) {
        setTodos(event.properties.todos as TodoItem[]);
      }

      // session.created イベント時にアクティブセッションの子セッションを再取得する
      // （サブエージェントが起動すると子セッションが作成されるため）
      if (event.type === "session.created" && currentSession) {
        postMessage({ type: "getChildSessions", sessionId: currentSession.id });
      }

      // --- コンテキストメモリ表示 ---
      const provider = prov.providers.find((p) => p.id === prov.selectedModel?.providerID);
      const model = provider?.models[prov.selectedModel?.modelID ?? ""];
      const contextLimit = model?.limit?.context;

      if (event.type === "session.next.compaction.started" && event.properties.sessionID === currentSession?.id) {
        awaitingCompactionContextRef.current = event.properties.sessionID;
        setContextMemory("");
      }

      if (event.type === "session.next.context.updated" && event.properties.sessionID === currentSession?.id) {
        awaitingCompactionContextRef.current = null;
        if (!isZeroContextText(event.properties.text)) {
          setContextMemory(event.properties.text);
        }
      }

      const awaitingCompactionContext =
        awaitingCompactionContextRef.current !== null && awaitingCompactionContextRef.current === currentSession?.id;

      if (
        !awaitingCompactionContext &&
        event.type === "message.part.updated" &&
        event.properties.sessionID === currentSession?.id &&
        event.properties.part.type === "step-finish"
      ) {
        const partTokens = event.properties.part.tokens;
        const partInput = partTokens?.input ?? 0;
        if (partInput > 0) {
          const prev = contextTokensRef.current.get(currentSession!.id) ?? 0;
          const total = prev + partInput;
          contextTokensRef.current.set(currentSession!.id, total);
          setContextMemory(formatContextMemory(total, contextLimit));
        }
      }

      if (event.type === "session.next.compaction.ended" && event.properties.sessionID === currentSession?.id) {
        postMessage({ type: "getMessages", sessionId: currentSession.id });
      }

      if (event.type === "session.compacted" && event.properties.sessionID === currentSession?.id) {
        postMessage({ type: "getMessages", sessionId: currentSession.id });
      }
    },
    [
      session.handleSessionEvent,
      msg.handleMessageEvent,
      perm.handlePermissionEvent,
      quest.handleQuestionEvent,
      fileChanges.handleFileChangeEvent,
      sound.handleSoundEvent,
      prov.selectedModel,
      prov.providers,
    ],
  );

  // Extension Host → Webview message listener
  useEffect(() => {
    const handler = (e: MessageEvent<HostToUIMessage>) => {
      const data = e.data;
      switch (data.type) {
        case "sessions":
          session.setSessions(data.sessions);
          break;
        case "messages":
          if (data.sessionId === session.activeSession?.id) {
            msg.setMessages(data.messages);
          }
          break;
        case "activeSession":
          session.setActiveSession(data.session);
          if (data.session) {
            postMessage({ type: "getMessages", sessionId: data.session.id });
            postMessage({ type: "getSessionDiff", sessionId: data.session.id });
            postMessage({ type: "getSessionTodos", sessionId: data.session.id });
            postMessage({ type: "getChildSessions", sessionId: data.session.id });
          } else {
            msg.setMessages([]);
            fileChanges.clearDiffs();
            setTodos([]);
            setChildSessions([]);
          }
          break;
        case "event":
          handleEvent(data.event);
          break;
        case "providers": {
          prov.setProviders(data.providers);
          prov.setAllProvidersData(data.allProviders);
          // サーバーのモデル設定を反映する（config.model → default の順でフォールバック）
          prov.setSelectedModel(() => {
            const modelStr =
              data.configModel || data.default.general || data.default.code || Object.values(data.default)[0];
            if (!modelStr) return null;
            const slashIndex = modelStr.indexOf("/");
            if (slashIndex < 0) return null;
            return {
              providerID: modelStr.slice(0, slashIndex),
              modelID: modelStr.slice(slashIndex + 1),
            };
          });
          break;
        }
        case "openEditors":
          setOpenEditors(data.files);
          break;
        case "activeEditor":
          setActiveEditorFile(data.file);
          break;
        case "workspaceFiles":
          setWorkspaceFiles(data.files);
          break;
        case "toolConfig":
          setOpenCodePaths(data.paths);
          break;
        case "locale":
          locale.setVscodeLanguage(data.vscodeLanguage);
          break;
        case "init":
          locale.setVscodeLanguage(data.locale);
          setOpenCodePaths(data.paths);
          break;
        case "modelUpdated": {
          const slashIndex = data.model.indexOf("/");
          if (slashIndex >= 0) {
            prov.setSelectedModel({
              providerID: data.model.slice(0, slashIndex),
              modelID: data.model.slice(slashIndex + 1),
            });
          }
          break;
        }
        case "sessionDiff": {
          if (data.sessionId === session.activeSession?.id) {
            fileChanges.setDiffs(data.diffs);
          }
          break;
        }
        case "sessionTodos": {
          if (data.sessionId === session.activeSession?.id) {
            setTodos(data.todos);
          }
          break;
        }
        case "childSessions": {
          if (data.sessionId === session.activeSession?.id) {
            setChildSessions(data.children);
          }
          break;
        }
        case "agents": {
          setAgents(data.agents);
          // 初回: まだプライマリエージェントが未選択なら plan を優先し、無ければ最初の primary/all にフォールバックする
          setSelectedPrimaryAgent((prev) => {
            if (prev) return prev;
            const isPrimaryOrAll = (a: AgentInfo) => a.mode === "primary" || a.mode === "all";
            const plan = data.agents.find((a) => isPrimaryOrAll(a) && a.name === "plan");
            if (plan) return plan.name;
            const first = data.agents.find(isPrimaryOrAll);
            return first?.name ?? null;
          });
          break;
        }
        case "skills": {
          setSkills(data.skills);
          break;
        }
        case "difitAvailable": {
          setDifitAvailable(data.available);
          break;
        }
      }
    };
    window.addEventListener("message", handler);
    postMessage({ type: "ready" });
    postMessage({ type: "getOpenEditors" });
    postMessage({ type: "getAgents" });
    postMessage({ type: "getSkills" });
    return () => window.removeEventListener("message", handler);
  }, [
    session.activeSession?.id,
    handleEvent,
    locale.setVscodeLanguage,
    msg.setMessages,
    fileChanges.setDiffs,
    fileChanges.clearDiffs,
    prov.setAllProvidersData,
    prov.setProviders,
    prov.setSelectedModel,
    session.setActiveSession,
    session.setSessions,
  ]);

  // Cross-cutting action handlers (span multiple hooks)

  const handleSend = useCallback(
    (text: string, files: FileAttachment[], agent?: string, primaryAgent?: string, skill?: string) => {
      if (!session.activeSession) return;
      // Build the explicit effort entry only when an effort has been
      // selected by the user. Omitting the property entirely (rather
      // than `effort: undefined`) preserves the default payload
      // semantics: the extension host forwards no `variant` and the
      // opencode server applies its own default behavior. The hook
      // already normalizes `selectedModelEffort` from the model
      // metadata, so we can pass it through directly.
      type SendMessagePayload = Extract<UIToHostMessage, { type: "sendMessage" }>;
      const payload: SendMessagePayload = {
        type: "sendMessage",
        sessionId: session.activeSession.id,
        text,
        model: prov.selectedModel ?? undefined,
        files: files.length > 0 ? files : undefined,
        agent,
        primaryAgent,
        skill,
      };
      if (prov.selectedModelEffort) {
        payload.effort = prov.selectedModelEffort;
      }
      postMessage(payload);
    },
    [session.activeSession, prov.selectedModel, prov.selectedModelEffort],
  );

  // ! プレフィクスで入力されたシェルコマンドを session.shell API 経由で実行する
  const handleShellExecute = useCallback(
    (command: string) => {
      if (!session.activeSession) return;
      // 次に到着する assistant メッセージをシェル結果としてタグ付けする準備
      msg.markPendingShell();
      postMessage({
        type: "executeShell",
        sessionId: session.activeSession.id,
        command,
        model: prov.selectedModel ?? undefined,
      });
    },
    [session.activeSession, prov.selectedModel, msg.markPendingShell],
  );

  const handleAbort = useCallback(() => {
    if (!session.activeSession) return;
    postMessage({ type: "abort", sessionId: session.activeSession.id });
  }, [session.activeSession]);

  // ユーザーメッセージを編集して再送信する
  // Use a ref for msg.messages so handleEditAndResend stays stable during
  // streaming — without this, every rAF delta creates a new callback reference,
  // defeating React.memo on MessageItem.
  const messagesRef = useRef(msg.messages);
  messagesRef.current = msg.messages;
  const handleEditAndResend = useCallback(
    (messageId: string, text: string) => {
      if (!session.activeSession) return;
      // messageId は編集対象のユーザーメッセージ。
      // その直前のメッセージまで巻き戻し、編集後のテキストを送信する。
      // Explicit effort travels the same way as a normal send so the
      // edit-and-resend path preserves the same explicit effort
      // behavior. When effort is unset, the property is omitted so
      // the host forwards no `variant` on the wire. The hook already
      // normalizes `selectedModelEffort`, so we can pass it through.
      type EditAndResendPayload = Extract<UIToHostMessage, { type: "editAndResend" }>;
      const buildPayload = (targetMessageId: string): EditAndResendPayload => {
        const payload: EditAndResendPayload = {
          type: "editAndResend",
          sessionId: session.activeSession!.id,
          messageId: targetMessageId,
          text,
          model: prov.selectedModel ?? undefined,
        };
        if (prov.selectedModelEffort) {
          payload.effort = prov.selectedModelEffort;
        }
        return payload;
      };
      const currentMessages = messagesRef.current;
      const msgIndex = currentMessages.findIndex((m) => m.info.id === messageId);
      if (msgIndex < 0) return;
      if (msgIndex === 0) {
        // 最初のメッセージの場合: 新規セッションを作成して送信する方がクリーン
        // ただし revert API のフォールバックとして、messageId 自体で revert
        postMessage(buildPayload(messageId));
      } else {
        // 直前のメッセージまで巻き戻して再送信
        const prevMessageId = currentMessages[msgIndex - 1].info.id;
        postMessage(buildPayload(prevMessageId));
      }
    },
    [session.activeSession, prov.selectedModel, prov.selectedModelEffort],
  );

  // チェックポイントまで巻き戻す + ユーザーメッセージのテキストを入力欄に復元
  const handleRevertToCheckpoint = useCallback(
    (assistantMessageId: string, userText: string | null) => {
      if (!session.activeSession) return;
      postMessage({
        type: "revertToMessage",
        sessionId: session.activeSession.id,
        messageId: assistantMessageId,
      });
      // ユーザーメッセージのテキストを入力欄にプリフィルする
      msg.setPrefillText(userText ?? "");
    },
    [session.activeSession, msg],
  );

  const handleOpenDiffEditor = useCallback((filePath: string, before: string, after: string) => {
    postMessage({ type: "openDiffEditor", filePath, before, after });
  }, []);

  const handleOpenFile = useCallback((filePath: string, line?: number) => {
    postMessage({ type: "openFile", filePath, line });
  }, []);

  // チェックポイントからセッションを Fork する
  const handleForkFromCheckpoint = useCallback(
    (messageId: string) => {
      if (!session.activeSession) return;
      postMessage({
        type: "forkSession",
        sessionId: session.activeSession.id,
        messageId,
      });
    },
    [session.activeSession],
  );

  // セッションを共有する
  const handleShareSession = useCallback(() => {
    if (!session.activeSession) return;
    postMessage({ type: "shareSession", sessionId: session.activeSession.id });
  }, [session.activeSession]);

  // セッションの共有を解除する
  const handleUnshareSession = useCallback(() => {
    if (!session.activeSession) return;
    postMessage({ type: "unshareSession", sessionId: session.activeSession.id });
  }, [session.activeSession]);

  // Undo: 最後のアシスタントメッセージまで巻き戻す
  // 巻き戻しで消えるユーザーメッセージのテキストを入力欄に復元する。
  const handleUndo = useCallback(() => {
    if (!session.activeSession) return;
    const messages = msg.messages;
    // 最後のアシスタントメッセージを探す
    const lastAssistantIdx = [...messages].reverse().findIndex((m) => m.info.role === "assistant");
    if (lastAssistantIdx < 0) return;
    const assistantIdx = messages.length - 1 - lastAssistantIdx;
    const lastAssistantMsg = messages[assistantIdx];

    // アシスタントメッセージの直後にあるユーザーメッセージのテキストを取得する
    const nextUserMsg = messages[assistantIdx + 1];
    if (nextUserMsg && nextUserMsg.info.role === "user") {
      const textParts = nextUserMsg.parts.filter((p) => p.type === "text" && !(p as any).synthetic);
      const fallback = textParts.length > 0 ? textParts : nextUserMsg.parts.filter((p) => p.type === "text");
      const text = fallback.map((p) => (p as any).text).join("") || "";
      msg.setPrefillText(text);
    } else {
      // ユーザーメッセージがない場合（アシスタントが最後のメッセージ）は空にしない
      // revert はアシスタントメッセージ自体を消すので、その前のユーザーメッセージのテキストを復元する
      const prevUserMsg = [...messages]
        .slice(0, assistantIdx)
        .reverse()
        .find((m) => m.info.role === "user");
      if (prevUserMsg) {
        const textParts = prevUserMsg.parts.filter((p) => p.type === "text" && !(p as any).synthetic);
        const fallback = textParts.length > 0 ? textParts : prevUserMsg.parts.filter((p) => p.type === "text");
        const text = fallback.map((p) => (p as any).text).join("") || "";
        msg.setPrefillText(text);
      }
    }

    postMessage({
      type: "undoSession",
      sessionId: session.activeSession.id,
      messageId: lastAssistantMsg.info.id,
    });
  }, [session.activeSession, msg.messages, msg.setPrefillText]);

  // Redo: Undo で取り消したメッセージを復元する
  // メッセージが復元されるので入力欄のプリフィルをクリアする。
  const handleRedo = useCallback(() => {
    if (!session.activeSession) return;
    msg.setPrefillText("");
    postMessage({ type: "redoSession", sessionId: session.activeSession.id });
  }, [session.activeSession, msg.setPrefillText]);

  // Undo 可能判定: メッセージが 2 つ以上（ユーザー + アシスタント）あり、ビジーでない
  const canUndo = msg.messages.length >= 2 && !session.sessionBusy;
  // Redo 可能判定: session.revert フィールドが存在する（Undo 済みの状態）
  const canRedo = !!session.activeSession?.revert && !session.sessionBusy;

  // 子セッションにナビゲートする
  const handleNavigateToChild = useCallback(
    (sessionId: string) => {
      session.handleSelectSession(sessionId);
    },
    [session.handleSelectSession],
  );

  // 親セッションに戻る
  const handleNavigateToParent = useCallback(() => {
    if (!session.activeSession?.parentID) return;
    session.handleSelectSession(session.activeSession.parentID);
  }, [session.activeSession, session.handleSelectSession]);

  // 子セッション閲覧中かの判定
  const isChildSession = !!session.activeSession?.parentID;

  const contextValue: AppContextValue = {
    sessions: session.sessions,
    activeSession: session.activeSession,
    sessionBusy: session.sessionBusy,
    showSessionList: session.showSessionList,
    onNewSession: session.handleNewSession,
    onSelectSession: session.handleSelectSession,
    onDeleteSession: session.handleDeleteSession,
    onToggleSessionList: session.toggleSessionList,
    messages: msg.messages,
    latestTodos: todos,
    prefillText: msg.prefillText,
    onPrefillConsumed: msg.consumePrefill,
    providers: prov.providers,
    allProvidersData: prov.allProvidersData,
    selectedModel: prov.selectedModel,
    onModelSelect: prov.handleModelSelect,
    permissions: perm.permissions,
    questions: quest.questions,
    openEditors,
    workspaceFiles,
    fileDiffs: fileChanges.diffs,
    difitAvailable,
    onOpenDiffEditor: handleOpenDiffEditor,
    onOpenFile: handleOpenFile,
    onSend: handleSend,
    onShellExecute: handleShellExecute,
    isShellMessage: msg.isShellMessage,
    onAbort: handleAbort,
    onEditAndResend: handleEditAndResend,
    onRevertToCheckpoint: handleRevertToCheckpoint,
    onForkFromCheckpoint: handleForkFromCheckpoint,
    openCodePaths,
    onOpenConfigFile: handleOpenConfigFile,
    onOpenTerminal: handleOpenTerminal,
    localeSetting: locale.localeSetting,
    onLocaleSettingChange: locale.handleLocaleSettingChange,
    soundSettings: sound.soundSettings,
    onSoundSettingChange: sound.handleSoundSettingChange,
    childSessions,
    onNavigateToChild: handleNavigateToChild,
    onNavigateToParent: handleNavigateToParent,
  };

  return (
    <LocaleProvider value={locale.strings}>
      <AppContextProvider value={contextValue}>
        <div className="chat-container">
          <ChatHeader
            activeSession={session.activeSession}
            onNewSession={session.handleNewSession}
            onToggleSessionList={session.toggleSessionList}
            onShareSession={msg.messages.length > 0 ? handleShareSession : undefined}
            onUnshareSession={handleUnshareSession}
            onNavigateToParent={isChildSession ? handleNavigateToParent : undefined}
            onUndo={handleUndo}
            onRedo={handleRedo}
            canUndo={canUndo}
            canRedo={canRedo}
            isBusy={session.sessionBusy}
          />
          {session.showSessionList && (
            <SessionList
              sessions={session.sessions}
              activeSessionId={session.activeSession?.id ?? null}
              onSelect={session.handleSelectSession}
              onDelete={session.handleDeleteSession}
              onClose={session.toggleSessionList}
            />
          )}
          {session.activeSession ? (
            <>
              <MessagesArea
                messages={msg.messages}
                sessionBusy={session.sessionBusy}
                activeSessionId={session.activeSession.id}
                questions={quest.questions}
                onEditAndResend={handleEditAndResend}
                onRevertToCheckpoint={handleRevertToCheckpoint}
                onForkFromCheckpoint={handleForkFromCheckpoint}
              />
              {todos.length > 0 && <TodoHeader todos={todos} />}
              {fileChanges.diffs.length > 0 && (
                <FileChangesHeader
                  diffs={fileChanges.diffs}
                  onOpenDiffEditor={handleOpenDiffEditor}
                  difitAvailable={difitAvailable}
                />
              )}
              <PermissionQueue permissions={perm.permissions} />
              {!isChildSession && (
                <InputArea
                  onSend={handleSend}
                  onShellExecute={handleShellExecute}
                  onAbort={handleAbort}
                  isBusy={session.sessionBusy}
                  providers={prov.providers}
                  allProvidersData={prov.allProvidersData}
                  selectedModel={prov.selectedModel}
                  onModelSelect={prov.handleModelSelect}
                  selectedModelEffort={prov.selectedModelEffort}
                  onModelEffortSelect={prov.setSelectedModelEffort}
                  recentModels={prov.recentModels}
                  selectedPrimaryAgent={selectedPrimaryAgent}
                  onPrimaryAgentSelect={setSelectedPrimaryAgent}
                  openEditors={openEditors}
                  activeEditorFile={activeEditorFile}
                  workspaceFiles={workspaceFiles}
                  prefillText={msg.prefillText}
                  onPrefillConsumed={msg.consumePrefill}
                  openCodePaths={openCodePaths}
                  onOpenConfigFile={handleOpenConfigFile}
                  onOpenTerminal={handleOpenTerminal}
                  contextMemoryText={contextMemory}
                  localeSetting={locale.localeSetting}
                  onLocaleSettingChange={locale.handleLocaleSettingChange}
                  soundSettings={sound.soundSettings}
                  onSoundSettingChange={sound.handleSoundSettingChange}
                  agents={agents}
                  skills={skills}
                />
              )}
            </>
          ) : (
            <EmptyState onNewSession={session.handleNewSession} />
          )}
        </div>
      </AppContextProvider>
    </LocaleProvider>
  );
}
