import type { LocaleSchema } from "./en";

export const ko: LocaleSchema = {
  // ChatHeader
  "header.sessions": "세션 목록",
  "header.title.fallback": "OpenCode Scribe",
  "header.newChat": "새 채팅",

  // EmptyState
  "empty.title": "OpenCode Scribe",
  "empty.description": "새 대화를 시작하세요.",
  "empty.newChat": "새 채팅",

  // InputArea
  "input.addContext": "컨텍스트 추가",
  "input.searchFiles": "파일 검색...",
  "input.noFiles": "파일을 찾을 수 없습니다",
  "input.remove": "제거",
  "input.placeholder": "OpenCode에 질문하기... (# 으로 파일 첨부)",
  "input.addFile": (name: string) => `${name} 추가`,
  "input.openTerminal": "TUI로 이관",
  "input.contextMemory": "컨텍스트 메모리",
  "input.shellMode": "셸 모드",
  "input.placeholder.shell": "셸 명령어 입력...",
  "input.settings": "설정",
  "input.reasoningReviewOn": "추론 검토: 켜짐",
  "input.reasoningReviewOff": "추론 검토: 꺼짐",
  "input.reasoningReviewBlocked": "워크스페이스 설정으로 추론 검토가 차단되었습니다",
  "input.stop": "중지",
  "input.send": "전송",
  "input.queued": (count: number) => `대기 중: ${count}`,
  "input.queuedAriaLabel": (count: number) => `${count}개의 프롬프트가 대기 중`,

  // MessageItem
  "message.fileFallback": "파일",
  "message.clickToEdit": "클릭하여 편집",
  "message.cancel": "취소",
  "message.send": "전송",
  "message.thought": "사고",
  "message.thinking": "사고 중…",
  "message.toggleThought": "사고 상세 전환",
  "message.copyMarkdown": "마크다운 복사",
  "message.moreActions": "More actions",

  // MessagesArea
  "checkpoint.revertTitle": "이 지점으로 되돌리기",
  "checkpoint.retryFromHere": "여기서 다시 시도",
  "checkpoint.forkFromHere": "여기서 분기",
  "scrollToBottom.ariaLabel": "맨 아래로 스크롤",

  // Undo/Redo
  "header.undo": "실행 취소",
  "header.redo": "다시 실행",

  // PermissionView
  "permission.title": "권한",
  "permission.allow": "허용",
  "permission.once": "한 번만",
  "permission.deny": "거부",

  // QuestionView
  "question.submit": "제출",
  "question.reject": "거부",
  "question.customPlaceholder": "사용자 정의 답변을 입력하세요...",

  // SessionList
  "session.noSessions": "세션 없음",
  "session.untitled": "제목 없음",
  "session.delete": "삭제",
  "session.select": "세션 선택",

  // Time (relative)
  "time.now": "방금",
  "time.minutes": (n: number) => `${n}분`,
  "time.hours": (n: number) => `${n}시간`,
  "time.days": (n: number) => `${n}일`,

  // ToolPartView - category labels
  "tool.read": "읽기",
  "tool.edit": "편집",
  "tool.create": "생성",
  "tool.run": "실행",
  "tool.search": "검색",
  "tool.tool": "도구",
  "tool.toggleDetails": "상세 전환",
  "tool.outputUnavailable": "[도구 출력을 표시할 수 없습니다]",
  "tool.completed": (done: number, total: number) => `${done}/${total} 완료`,
  "tool.moreLines": (n: number) => `… +${n}줄 더`,
  "tool.addLines": (n: number) => `+${n}줄`,
  "tool.todos": (done: number, total: number) => `${done}/${total} 할 일`,

  // ModelSelector
  "model.selectModel": "모델 선택",
  "model.notConnected": "연결 안 됨",
  "model.connectedOnly": "연결됨만",
  "model.showAll": "모든 제공자 표시",
  "model.hideDisconnected": "연결 안 된 제공자 숨기기",
  "model.searchPlaceholder": "모델 검색...",
  "model.noSearchResults": "일치하는 모델이 없습니다",
  "model.recent": "최근",
  "model.effort.default": "기본",
  "model.effort.select": "노력 수준 선택",

  // AgentSelector
  "agent.selectAgent": "에이전트 선택",
  "agent.agents": "에이전트",

  // TodoHeader
  "todo.label": "할 일",
  "todo.toggleList": "할 일 목록 전환",

  // ShellResultView
  "shell.title": "셸",

  "config.yes": "예",
  "config.no": "아니요",
  "config.required": "필수",
  "config.notRequired": "필수 아님",
  "config.mcp": "MCP",
  "config.mcpEmpty": "MCP 서버가 구성되지 않았습니다. 프로젝트 설정 또는 전역 설정에서 구성하세요.",
  "config.mcpTrust": "사용자가 설치한 MCP 도구는 Scout의 편집/셸 거부에 의해 샌드박스 처리되지 않습니다.",
  "config.mcpLocked": "시스템 또는 관리 정책에 의해 차단되었습니다.",

  // ToolConfigPanel
  "config.title": "설정",
  "config.projectConfig": "프로젝트 설정",
  "config.globalConfig": "전역 설정",

  "config.close": "닫기",
  "config.sandbox": "샌드박스",
  "config.sandboxChatTools": "채팅 도구 샌드박스 처리",
  "config.sandboxInherited": "VS Code에서 상속됨",
  "config.sandboxWorkspaceOverride": (mode: string) => `작업 영역 재정의: ${mode}`,
  "config.sandboxReset": "VS Code 설정 사용",
  "config.sandboxNetwork": "네트워크 액세스 허용",
  "config.sandboxNetworkEnabledDescription": "파일 시스템 제한을 유지하면서 아웃바운드 네트워크 액세스를 허용합니다.",
  "config.sandboxLocalOnlyDescription":
    "로컬 전용 작업: 파일 시스템 제한을 유지하고 루프백이 아닌 네트워크 액세스를 거부합니다.",
  "config.sandboxUnsupported": "이 플랫폼에서는 채팅 샌드박스를 지원하지 않습니다.",
  "config.sandboxManaged": "채팅 샌드박스 설정은 관리되므로 변경할 수 없습니다.",
  "config.sandboxApplying": "샌드박스 설정 적용 중…",
  "config.sandboxError": (error: string) => `샌드박스 오류: ${error}`,

  // Reasoning review (availability-gated)
  "config.reasoningReview": "추론 검토",
  "config.reasoningReviewEnable": "추론 검토 사용",
  "config.reasoningReviewWorkspaceOptOut": "이 작업 공간에서 사용 안 함",
  "config.reasoningReviewDescription":
    "추론 검토 런타임을 사용할 수 있을 때 이 호스트에서 응답을 검토합니다. 작업 공간 옵트아웃은 이 작업 공간의 전역 설정보다 우선합니다.",
  "config.reasoningReviewEffective": (enabled: boolean) =>
    enabled ? "이 작업 공간에서 활성화됨" : "이 작업 공간에서 비활성화됨",
  "reasoningReview.action": "논증 검토",
  "reasoningReview.cancel": "검토 취소",
  "reasoningReview.cancelling": "검토 취소 중…",
  "reasoningReview.inProgress": "검토 진행 중",
  "reasoningReview.cancelled": "검토가 취소되었습니다.",
  "reasoningReview.resultLabel": "논증 검토",
  "reasoningReview.boundaryLabel": "검토 한계",
  "reasoningReview.statusLabel": "상태",
  "reasoningReview.evidenceLabel": "증거",
  "reasoningReview.assumptionsLabel": "가정",
  "reasoningReview.challengesLabel": "열린 반론",
  "reasoningReview.status.notReviewed": "검토되지 않음",
  "reasoningReview.status.reviewing": "검토 중",
  "reasoningReview.status.structurallyChecked": "구조 확인됨",
  "reasoningReview.status.conditional": "조건부",
  "reasoningReview.status.unresolved": "미해결",
  "reasoningReview.status.refuted": "반박됨",
  "reasoningReview.status.blocked": "차단됨",
  "reasoningReview.status.auditFailed": "검토 실패",
  "reasoningReview.status.unavailable": "사용할 수 없음",
  "reasoningReview.evidence.notAssessed": "평가되지 않음",
  "reasoningReview.evidence.notRequired": "필요하지 않음",
  "reasoningReview.evidence.sourceRecorded": "출처 기록됨",
  "reasoningReview.evidence.unverified": "검증되지 않음",
  "reasoningReview.evidence.humanVerified": "사람이 확인함",
  "reasoningReview.evidence.conflicted": "충돌함",
  "reasoningReview.severity.critical": "치명적",
  "reasoningReview.severity.major": "중요",
  "reasoningReview.severity.minor": "경미",
  "reasoningReview.severity.note": "참고",
  "reasoningReview.stage.claimProjection": "AF 주장 투영",
  "reasoningReview.stage.adversarialReview": "prover/verifier 검토",

  // Reasoning assist lifecycle
  "reasoningAssist.title": "추론 보조",
  "reasoningAssist.stage.assessing": "프롬프트 평가 중",
  "reasoningAssist.stage.mapping": "논증 구조화 중",
  "reasoningAssist.stage.recording": "구조 기록 중",
  "reasoningAssist.stage.critiquing": "반론 검토 중",
  "reasoningAssist.stage.preparing": "답변 준비 중",
  "reasoningAssist.stage.applied": "보조 적용됨",
  "reasoningAssist.toggleDetails": "추론 보조 세부 정보 펼치기 또는 접기",
  "reasoningAssist.candidateConclusion": "후보 결론",
  "reasoningAssist.assumptions": "가정",
  "reasoningAssist.evidenceBoundary": "근거 범위",
  "reasoningAssist.afRecordedStructure": "AF에 기록된 구조",
  "reasoningAssist.afNotAvailable": "AF 구조를 사용할 수 없음",

  // Language setting
  "config.language": "언어",
  "config.langAuto": "자동 (VS Code)",
  "config.langEn": "English",
  "config.langJa": "日本語",
  "config.langZhCn": "简体中文",
  "config.langKo": "한국어",
  "config.langZhTw": "繁體中文",
  "config.langEs": "Español",
  "config.langPtBr": "Português (Brasil)",
  "config.langRu": "Русский",

  "config.thinking": "사고",
  "config.showAllThinking": "모든 사고 표시",

  // Sound notification
  "config.sound": "사운드 알림",
  "config.soundResponseComplete": "응답 완료",
  "config.soundPermissionRequest": "권한 요청",
  "config.soundQuestionAsked": "질문",
  "config.soundError": "오류",
  "config.soundVolume": "볼륨",

  // FileChangesHeader
  "fileChanges.title": "파일 변경",
  "fileChanges.noChanges": "파일 변경 없음",
  "fileChanges.openDiff": "차이 편집기에서 열기",
  "fileChanges.toggle": "파일 변경",
  "fileChanges.binaryUnavailable": "바이너리 파일이므로 내용을 표시할 수 없습니다.",
  "fileChanges.contentUnavailable": "이 변경의 내용을 사용할 수 없습니다.",

  // Share
  "share.share": "세션 공유",
  "share.unshare": "공유 해제",
  "share.copied": "공유 URL이 클립보드에 복사되었습니다",

  // ChildSession
  "childSession.agent": "에이전트",
  "childSession.backToParent": "상위 세션으로 돌아가기",

  // Context menu sections
  "input.section.files": "파일",
  "input.section.agents": "서브 에이전트",
  "input.section.skills": "스킬",
  "input.section.shell": "셸 모드",

  // AgentMention
  "input.noAgents": "사용 가능한 서브 에이전트가 없습니다",
  "input.noSkills": "사용 가능한 스킬이 없습니다",
  "input.type.skill": "스킬",
  "input.type.command": "명령",
};
