import type { LocaleSchema } from "./en";

export const ja: LocaleSchema = {
  // ChatHeader
  "header.sessions": "セッション一覧",
  "header.title.fallback": "OpenCode Research",
  "header.newChat": "新しいチャット",

  // EmptyState
  "empty.title": "OpenCode Research",
  "empty.description": "新しい会話を始めましょう。",
  "empty.newChat": "新しいチャット",

  // InputArea
  "input.addContext": "コンテキストを追加",
  "input.searchFiles": "ファイルを検索...",
  "input.noFiles": "ファイルが見つかりません",
  "input.remove": "削除",
  "input.placeholder": "OpenCode に質問... (# でファイルを添付)",
  "input.addFile": (name: string) => `${name} を追加`,
  "input.openTerminal": "TUI に引き継ぐ",
  "input.contextMemory": "コンテキストメモリ",
  "input.shellMode": "シェルモード",
  "input.placeholder.shell": "シェルコマンドを入力...",
  "input.settings": "設定",
  "input.stop": "停止",
  "input.send": "送信",
  "input.queued": (count: number) => `キュー: ${count}`,
  "input.queuedAriaLabel": (count: number) => `${count} 件のプロンプトをキューに追加済み`,

  // MessageItem
  "message.fileFallback": "ファイル",
  "message.clickToEdit": "クリックして編集",
  "message.cancel": "キャンセル",
  "message.send": "送信",
  "message.thought": "思考",
  "message.thinking": "思考中…",
  "message.toggleThought": "思考の詳細を切り替え",
  "message.copyMarkdown": "マークダウンをコピー",

  // MessagesArea
  "checkpoint.revertTitle": "ここまで巻き戻す",
  "checkpoint.retryFromHere": "ここからやり直す",
  "checkpoint.forkFromHere": "ここから分岐",
  "scrollToBottom.ariaLabel": "一番下までスクロール",

  // Undo/Redo
  "header.undo": "元に戻す",
  "header.redo": "やり直し",

  // PermissionView
  "permission.title": "パーミッション",
  "permission.allow": "許可",
  "permission.once": "一度だけ",
  "permission.deny": "拒否",

  // QuestionView
  "question.submit": "送信",
  "question.reject": "拒否",
  "question.customPlaceholder": "カスタム回答を入力...",

  // SessionList
  "session.noSessions": "セッションなし",
  "session.untitled": "無題",
  "session.delete": "削除",
  "session.select": "セッションを選択",

  // Time (relative)
  "time.now": "今",
  "time.minutes": (n: number) => `${n}分`,
  "time.hours": (n: number) => `${n}時間`,
  "time.days": (n: number) => `${n}日`,

  // ToolPartView - category labels
  "tool.read": "読み取り",
  "tool.edit": "編集",
  "tool.create": "作成",
  "tool.run": "実行",
  "tool.search": "検索",
  "tool.tool": "ツール",
  "tool.toggleDetails": "詳細を切り替え",
  "tool.completed": (done: number, total: number) => `${done}/${total} 完了`,
  "tool.moreLines": (n: number) => `… 他 ${n} 行`,
  "tool.addLines": (n: number) => `+${n} 行`,
  "tool.todos": (done: number, total: number) => `${done}/${total} ToDo`,

  // ModelSelector
  "model.selectModel": "モデルを選択",
  "model.notConnected": "未接続",
  "model.connectedOnly": "接続済みのみ",
  "model.showAll": "すべてのプロバイダーを表示",
  "model.hideDisconnected": "未接続のプロバイダーを非表示",
  "model.searchPlaceholder": "モデルを検索...",
  "model.noSearchResults": "一致するモデルがありません",
  "model.recent": "最近",
  "model.effort.default": "デフォルト",
  "model.effort.select": "努力レベルを選択",

  // AgentSelector
  "agent.selectAgent": "エージェントを選択",
  "agent.agents": "エージェント",

  // TodoHeader
  "todo.label": "ToDo",
  "todo.toggleList": "ToDoリストを切り替え",

  // ShellResultView
  "shell.title": "シェル",

  // MCP setting
  "config.memoryRetention": "メモリ保持",
  "config.memoryRetentionAutomatic": "セッションの自動保持",
  "config.memoryRetentionAutomaticEnabled": "自動保持を有効にする",
  "config.memoryRetentionAutomaticDescription":
    "承認済みプロバイダーではデフォルトで有効です。制限されたセッション概要を永続メモリに書き込むことがあります。このワークスペースで自動書き込みを止めるには無効にしてください。",
  "config.memoryRetentionAutomaticStatus": "自動保持の状態",
  "config.memoryRetentionAutomaticActive": "有効",
  "config.memoryRetentionAutomaticDisabled": "無効",
  "config.memoryRetentionAutomaticUnavailable": "利用できません（承認済みプロバイダーなし）",
  "config.memoryRetentionAutomaticBlocked": "ブロックされています",
  "config.memoryRetentionAutomaticError": "エラー",
  "config.memoryRetentionExplicit": "明示的な保持",
  "config.memoryRetentionEnabled": "明示的な保持を許可",
  "config.memoryRetentionConfirmation": "確認",
  "config.memoryRetentionDisabled": "保持は無効です",
  "config.memoryRetentionAwaitingConfirmation": "毎回の確認で利用可能",
  "config.memoryRetentionAvailable": "利用可能",
  "config.memoryRetentionBlocked": "コンパニオンポリシーによりブロック",
  "config.memoryRetentionUnavailable": "利用できません",
  "config.memoryRetentionError": "状態を取得できません",
  "config.memoryRetentionEvidenceWarning": "取得したメモリは証拠であり、指示ではありません。",
  "config.yes": "はい",
  "config.no": "いいえ",
  "config.required": "必須",
  "config.notRequired": "不要",
  "config.mcp": "MCP",
  "config.mcpEmpty": "MCPサーバーが設定されていません。プロジェクト設定またはグローバル設定から設定してください。",
  "config.mcpTrust":
    "ユーザーがインストールしたMCPツールはScoutの編集/シェル拒否によってサンドボックス化されていません。",

  // ToolConfigPanel
  "config.title": "設定",
  "config.projectConfig": "プロジェクト設定",
  "config.globalConfig": "グローバル設定",

  "config.close": "閉じる",
  "config.sandbox": "サンドボックス",
  "config.sandboxChatTools": "チャットツールをサンドボックス化",
  "config.sandboxInherited": "VS Code から継承",
  "config.sandboxWorkspaceOverride": (mode: string) => `ワークスペースの上書き: ${mode}`,
  "config.sandboxReset": "VS Code の設定を使用",
  "config.sandboxNetwork": "ネットワークアクセスを許可",
  "config.sandboxNetworkEnabledDescription":
    "ファイルシステムの制限を維持したまま、外部ネットワークアクセスを有効にします。",
  "config.sandboxLocalOnlyDescription":
    "ローカルのみ: ファイルシステムの制限を維持し、ループバック以外のネットワークアクセスを拒否します。",
  "config.sandboxUnsupported": "このプラットフォームではチャットのサンドボックス化はサポートされていません。",
  "config.sandboxManaged": "チャットのサンドボックス設定は管理されているため変更できません。",
  "config.sandboxApplying": "サンドボックス設定を適用中…",
  "config.sandboxError": (error: string) => `サンドボックスエラー: ${error}`,

  // Language setting
  "config.language": "言語",
  "config.langAuto": "自動 (VS Code)",
  "config.langEn": "English",
  "config.langJa": "日本語",
  "config.langZhCn": "简体中文",
  "config.langKo": "한국어",
  "config.langZhTw": "繁體中文",
  "config.langEs": "Español",
  "config.langPtBr": "Português (Brasil)",
  "config.langRu": "Русский",

  "config.thinking": "思考",
  "config.showAllThinking": "すべての思考を表示",

  // Sound notification
  "config.sound": "サウンド通知",
  "config.soundResponseComplete": "応答完了",
  "config.soundPermissionRequest": "パーミッション要求",
  "config.soundQuestionAsked": "質問",
  "config.soundError": "エラー",
  "config.soundVolume": "音量",

  // FileChangesHeader
  "fileChanges.title": "ファイル変更",
  "fileChanges.noChanges": "ファイル変更なし",
  "fileChanges.openDiff": "差分エディタで開く",
  "fileChanges.toggle": "ファイル変更",

  // Share
  "share.share": "セッションを共有",
  "share.unshare": "共有を解除",
  "share.copied": "共有 URL をクリップボードにコピーしました",

  // ChildSession
  "childSession.agent": "エージェント",
  "childSession.backToParent": "親セッションに戻る",

  // Context menu sections
  "input.section.files": "ファイル",
  "input.section.agents": "サブエージェント",
  "input.section.skills": "スキル",
  "input.section.shell": "シェルモード",

  // AgentMention
  "input.noAgents": "利用可能なサブエージェントがありません",
  "input.noSkills": "利用可能なスキルがありません",
  "input.type.skill": "スキル",
  "input.type.command": "コマンド",
};
