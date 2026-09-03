import type { LocaleSchema } from "./en";

export const es: LocaleSchema = {
  // ChatHeader
  "header.sessions": "Sesiones",
  "header.title.fallback": "OpenCode Research",
  "header.newChat": "Nuevo chat",

  // EmptyState
  "empty.title": "OpenCode Research",
  "empty.description": "Inicia una nueva conversación para comenzar.",
  "empty.newChat": "Nuevo chat",

  // InputArea
  "input.addContext": "Añadir contexto",
  "input.searchFiles": "Buscar archivos...",
  "input.noFiles": "No se encontraron archivos",
  "input.remove": "Eliminar",
  "input.placeholder": "Pregunta a OpenCode... (escribe # para adjuntar archivos)",
  "input.addFile": (name: string) => `Añadir ${name}`,
  "input.openTerminal": "Pasar al TUI",
  "input.contextMemory": "Memoria contextual",
  "input.shellMode": "Modo Shell",
  "input.placeholder.shell": "Ingresa un comando de shell...",
  "input.settings": "Configuración",
  "input.stop": "Detener",
  "input.send": "Enviar",

  // MessageItem
  "message.fileFallback": "archivo",
  "message.clickToEdit": "Haz clic para editar",
  "message.cancel": "Cancelar",
  "message.send": "Enviar",
  "message.thought": "Pensamiento",
  "message.thinking": "Pensando…",
  "message.toggleThought": "Alternar detalles de pensamiento",
  "message.copyMarkdown": "Copiar Markdown",

  // MessagesArea
  "checkpoint.revertTitle": "Revertir a este punto",
  "checkpoint.retryFromHere": "Reintentar desde aquí",
  "checkpoint.forkFromHere": "Bifurcar desde aquí",
  "scrollToBottom.ariaLabel": "Desplazarse al final",

  // Undo/Redo
  "header.undo": "Deshacer",
  "header.redo": "Rehacer",

  // PermissionView
  "permission.title": "Permisos",
  "permission.allow": "Permitir",
  "permission.once": "Solo una vez",
  "permission.deny": "Denegar",

  // QuestionView
  "question.submit": "Enviar",
  "question.reject": "Rechazar",
  "question.customPlaceholder": "Escribir una respuesta personalizada...",

  // SessionList
  "session.noSessions": "Sin sesiones",
  "session.untitled": "Sin título",
  "session.delete": "Eliminar",
  "session.select": "Seleccionar sesión",

  // Time (relative)
  "time.now": "ahora",
  "time.minutes": (n: number) => `${n}min`,
  "time.hours": (n: number) => `${n}h`,
  "time.days": (n: number) => `${n}d`,

  // ToolPartView - category labels
  "tool.read": "Leer",
  "tool.edit": "Editar",
  "tool.create": "Crear",
  "tool.run": "Ejecutar",
  "tool.search": "Buscar",
  "tool.tool": "Herramienta",
  "tool.toggleDetails": "Alternar detalles",
  "tool.completed": (done: number, total: number) => `${done}/${total} completados`,
  "tool.moreLines": (n: number) => `… +${n} líneas más`,
  "tool.addLines": (n: number) => `+${n} líneas`,
  "tool.todos": (done: number, total: number) => `${done}/${total} tareas`,

  // ModelSelector
  "model.selectModel": "Seleccionar modelo",
  "model.notConnected": "No conectado",
  "model.connectedOnly": "Solo conectados",
  "model.showAll": "Mostrar todos los proveedores",
  "model.hideDisconnected": "Ocultar proveedores desconectados",
  "model.searchPlaceholder": "Buscar modelos...",
  "model.noSearchResults": "No hay modelos coincidentes",
  "model.recent": "Reciente",
  "model.effort.default": "Predeterminado",
  "model.effort.select": "Seleccionar esfuerzo",

  // AgentSelector
  "agent.selectAgent": "Seleccionar agente",
  "agent.agents": "Agentes",

  // TodoHeader
  "todo.label": "Tareas",
  "todo.toggleList": "Alternar lista de tareas",

  // ShellResultView
  "shell.title": "Shell",

  // MCP setting
  "config.mcp": "MCP",
  "config.mcpEmpty":
    "No hay servidores MCP configurados. Configura mediante Configuración del Proyecto o Configuración Global.",
  "config.mcpTrust":
    "Las herramientas MCP instaladas por el usuario no están aisladas por las denegaciones de edición/shell de Scout.",

  // ToolConfigPanel
  "config.title": "Configuración",
  "config.projectConfig": "Configuración del proyecto",
  "config.globalConfig": "Configuración global",

  "config.close": "Cerrar",
  "config.sandbox": "Aislamiento",
  "config.sandboxChatTools": "Aislar las herramientas de Chat",
  "config.sandboxInherited": "Heredado de VS Code",
  "config.sandboxWorkspaceOverride": (mode: string) => `Anulación del espacio de trabajo: ${mode}`,
  "config.sandboxReset": "Usar configuración de VS Code",
  "config.sandboxNetwork": "Permitir acceso a la red",
  "config.sandboxNetworkEnabledDescription":
    "Las restricciones del sistema de archivos siguen activas mientras se permite el acceso de red saliente.",
  "config.sandboxLocalOnlyDescription":
    "Solo local: las restricciones del sistema de archivos siguen activas y se deniega el acceso de red no local.",
  "config.sandboxUnsupported": "El aislamiento de Chat no es compatible con esta plataforma.",
  "config.sandboxManaged": "La configuración de aislamiento de Chat está administrada y no se puede cambiar.",
  "config.sandboxApplying": "Aplicando configuración de aislamiento…",
  "config.sandboxError": (error: string) => `Error de aislamiento: ${error}`,

  // Language setting
  "config.language": "Idioma",
  "config.langAuto": "Automático (VS Code)",
  "config.langEn": "English",
  "config.langJa": "日本語",
  "config.langZhCn": "简体中文",
  "config.langKo": "한국어",
  "config.langZhTw": "繁體中文",
  "config.langEs": "Español",
  "config.langPtBr": "Português (Brasil)",
  "config.langRu": "Русский",

  // Sound notification
  "config.sound": "Notificación de sonido",
  "config.soundResponseComplete": "Respuesta completada",
  "config.soundPermissionRequest": "Solicitud de permiso",
  "config.soundQuestionAsked": "Pregunta",
  "config.soundError": "Error",
  "config.soundVolume": "Volumen",

  // FileChangesHeader
  "fileChanges.title": "Cambios de archivos",
  "fileChanges.noChanges": "Sin cambios de archivos",
  "fileChanges.openDiff": "Abrir en editor de diferencias",
  "fileChanges.toggle": "Cambios de archivos",

  // Share
  "share.share": "Compartir sesión",
  "share.unshare": "Dejar de compartir",
  "share.copied": "URL de compartir copiada al portapapeles",

  // ChildSession
  "childSession.agent": "Agente",
  "childSession.backToParent": "Volver a la sesión principal",

  // Context menu sections
  "input.section.files": "Archivos",
  "input.section.agents": "Sub-agentes",
  "input.section.skills": "Habilidades",
  "input.section.shell": "Modo Shell",

  // AgentMention
  "input.noAgents": "No hay sub-agentes disponibles",
  "input.noSkills": "No hay habilidades disponibles",
  "input.type.skill": "Habilidad",
  "input.type.command": "Comando",
};
