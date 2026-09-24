import type {
  ChatSandboxSettings,
  ChatSandboxStatus,
  McpServerStatus,
  McpStatus,
  ReasoningReviewRuntime,
  SoundEventSetting,
  SoundEventType,
  SoundSettings,
} from "@opencode-chat/core";
import { useMemo, useState } from "react";
import type { ReasoningReviewPreference, ReasoningReviewPreferencePatch } from "../../../hooks/useReasoningReview";
import type { LocaleSetting } from "../../../locales";
import { useLocale } from "../../../locales";
import { IconButton } from "../../atoms/IconButton";
import { ChevronRightIcon, CloseIcon, FileIcon } from "../../atoms/icons";
import { LinkButton } from "../../atoms/LinkButton";
import styles from "./ToolConfigPanel.module.css";

const LOCALE_OPTIONS = ["auto", "en", "ja", "zh-cn", "ko", "zh-tw", "es", "pt-br", "ru"] as const;

type Props = {
  paths: { home?: string; config: string; state: string; directory: string } | null;
  onOpenConfigFile: (filePath: string) => void;
  onClose: () => void;
  localeSetting: LocaleSetting;
  onLocaleSettingChange: (setting: LocaleSetting) => void;
  showAllThinking?: boolean;
  onShowAllThinkingChange?: (value: boolean) => void;
  soundSettings: SoundSettings;
  onSoundSettingChange: (eventType: SoundEventType, setting: Partial<SoundEventSetting>) => void;
  mcpServers?: McpStatus | null;
  onMcpToggle?: (server: string, enabled: boolean) => void;
  sandboxStatus?: ChatSandboxStatus;
  onChatSandboxSettingsChange?: (settings: ChatSandboxSettings) => void;
  sandboxControlsDisabled?: boolean;
  reasoningReviewRuntime?: ReasoningReviewRuntime | null;
  reasoningReviewPreference?: ReasoningReviewPreference | null;
  onReasoningReviewPreferenceChange?: (preference: ReasoningReviewPreferencePatch) => void;
};

export function ToolConfigPanel({
  paths,
  onOpenConfigFile,
  onClose,
  localeSetting,
  onLocaleSettingChange,
  showAllThinking = false,
  onShowAllThinkingChange = () => {},
  soundSettings,
  onSoundSettingChange,
  mcpServers,
  onMcpToggle,
  sandboxStatus,
  onChatSandboxSettingsChange,
  sandboxControlsDisabled = false,
  reasoningReviewRuntime,
  reasoningReviewPreference,
  onReasoningReviewPreferenceChange,
}: Props) {
  const t = useLocale();
  const [langMenuOpen, setLangMenuOpen] = useState(false);

  const localeLabelMap = useMemo(
    () =>
      ({
        auto: t["config.langAuto"],
        en: t["config.langEn"],
        ja: t["config.langJa"],
        "zh-cn": t["config.langZhCn"],
        ko: t["config.langKo"],
        "zh-tw": t["config.langZhTw"],
        es: t["config.langEs"],
        "pt-br": t["config.langPtBr"],
        ru: t["config.langRu"],
      }) as const,
    [t],
  );

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <span className={styles.title}>{t["config.title"]}</span>
        <IconButton variant="muted" size="sm" onClick={onClose} title={t["config.close"]}>
          <CloseIcon />
        </IconButton>
      </div>

      <div className={styles.body}>
        {/* Language Setting — compact in-panel menu (not radios, not old webview cache) */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}>{t["config.language"]}</div>
          <div className={styles.langMenu}>
            <button
              type="button"
              className={styles.langTrigger}
              aria-haspopup="listbox"
              aria-expanded={langMenuOpen}
              onClick={() => setLangMenuOpen((o) => !o)}
            >
              <span className={styles.langTriggerLabel}>{localeLabelMap[localeSetting]}</span>
              <span className={`${styles.langChevron} ${langMenuOpen ? styles.langChevronOpen : ""}`}>
                <ChevronRightIcon />
              </span>
            </button>
            {langMenuOpen && (
              <div className={styles.langList} role="listbox" aria-label={t["config.language"]}>
                {LOCALE_OPTIONS.map((opt) => {
                  const selected = localeSetting === opt;
                  return (
                    <button
                      key={opt}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={`${styles.langOption} ${selected ? styles.langOptionActive : ""}`}
                      onClick={() => {
                        onLocaleSettingChange(opt);
                        setLangMenuOpen(false);
                      }}
                    >
                      <span className={styles.langOptionCheck}>{selected ? "✓" : ""}</span>
                      <span>{localeLabelMap[opt]}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className={styles.section}>
          <div className={styles.sectionTitle}>{t["config.thinking"]}</div>
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={showAllThinking}
              onChange={(e) => onShowAllThinkingChange(e.target.checked)}
            />
            <span className={styles.toolName}>{t["config.showAllThinking"]}</span>
          </label>
        </div>

        {/* Sound Notification Setting */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}>{t["config.sound"]}</div>
          <div>
            {(["responseComplete", "permissionRequest", "questionAsked", "error"] as const).map((eventType) => {
              const labelMap = {
                responseComplete: t["config.soundResponseComplete"],
                permissionRequest: t["config.soundPermissionRequest"],
                questionAsked: t["config.soundQuestionAsked"],
                error: t["config.soundError"],
              } as const;
              const enabled = soundSettings[eventType]?.enabled ?? true;
              const volume = soundSettings[eventType]?.volume ?? 0.2;
              return (
                <div key={eventType} className={styles.soundItem}>
                  <label className={styles.toggle}>
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(e) => onSoundSettingChange(eventType, { enabled: e.target.checked })}
                    />
                    <span className={styles.toolName}>{labelMap[eventType]}</span>
                  </label>
                  {enabled && (
                    <div className={styles.volumeRow}>
                      <span className={styles.volumeLabel}>{t["config.soundVolume"]}</span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={Math.round(volume * 100)}
                        onChange={(e) => onSoundSettingChange(eventType, { volume: Number(e.target.value) / 100 })}
                        className={styles.volumeSlider}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {sandboxStatus && (
          <SandboxSection
            status={sandboxStatus}
            onSettingsChange={onChatSandboxSettingsChange}
            controlsDisabled={sandboxControlsDisabled}
          />
        )}

        {/* Availability-gated: an absent, checking, incompatible, or
            unavailable runtime renders nothing, never a disabled control. */}
        {reasoningReviewRuntime?.state === "available" && (
          <ReasoningReviewSection
            preference={reasoningReviewPreference}
            onPreferenceChange={onReasoningReviewPreferenceChange}
          />
        )}

        {/* MCP Setting */}
        {mcpServers != null && (
          <div className={styles.section}>
            <div className={styles.sectionTitle}>{t["config.mcp"]}</div>
            {Object.keys(mcpServers).length === 0 ? (
              <div className={styles.mcpEmpty}>{t["config.mcpEmpty"]}</div>
            ) : (
              <div>
                {Object.entries(mcpServers).map(([name, server]) => {
                  const lifecycleLabel =
                    !server.connected && server.status !== "unknown" ? formatMcpLifecycle(server) : null;
                  return (
                    <label key={name} className={`${styles.toggle} ${styles.toolItem} ${styles.mcpRow}`}>
                      <input
                        type="checkbox"
                        checked={server.connected}
                        onChange={(e) => onMcpToggle?.(name, e.target.checked)}
                      />
                      <span className={styles.toolName}>{name}</span>
                      {lifecycleLabel && <span className={styles.mcpLifecycle}>{lifecycleLabel}</span>}
                    </label>
                  );
                })}
              </div>
            )}
            <div className={styles.trustNotice}>{t["config.mcpTrust"]}</div>
          </div>
        )}
      </div>

      {paths && (
        <div className={styles.footer}>
          <LinkButton onClick={() => onOpenConfigFile(`${paths.directory}/.opencode/opencode.json`)}>
            <FileIcon />
            {t["config.projectConfig"]}
          </LinkButton>
          <LinkButton onClick={() => onOpenConfigFile(`${paths.config}/opencode.json`)}>
            <FileIcon />
            {t["config.globalConfig"]}
          </LinkButton>
        </div>
      )}
    </div>
  );
}

function SandboxSection({
  status,
  onSettingsChange,
  controlsDisabled,
}: {
  status: ChatSandboxStatus;
  onSettingsChange?: (settings: ChatSandboxSettings) => void;
  controlsDisabled: boolean;
}) {
  const t = useLocale();
  const canChange = status.supported && !status.managed && !status.applying && !controlsDisabled;
  const networkDisabled = !status.enabled || !canChange;
  const stateLabel = status.inherited
    ? t["config.sandboxInherited"]
    : t["config.sandboxWorkspaceOverride"](status.mode);
  const networkDescription = status.allowNetwork
    ? t["config.sandboxNetworkEnabledDescription"]
    : t["config.sandboxLocalOnlyDescription"];

  return (
    <div className={styles.section} data-testid="sandbox-section">
      <div className={styles.sectionTitle}>{t["config.sandbox"]}</div>
      <label className={`${styles.toggle} ${styles.sandboxRow}`}>
        <input
          data-testid="sandbox-chat-tools"
          type="checkbox"
          checked={status.enabled}
          disabled={!canChange}
          onChange={(event) =>
            onSettingsChange?.({ mode: event.target.checked ? "on" : "off", allowNetwork: status.allowNetwork })
          }
        />
        <span className={styles.toolName}>{t["config.sandboxChatTools"]}</span>
      </label>
      <div className={styles.sandboxStatus}>{stateLabel}</div>
      {!status.inherited && (
        <button
          type="button"
          className={styles.sandboxReset}
          disabled={!canChange}
          onClick={() => onSettingsChange?.({ mode: "inherit", allowNetwork: status.allowNetwork })}
        >
          {t["config.sandboxReset"]}
        </button>
      )}
      <label className={`${styles.toggle} ${styles.sandboxRow} ${styles.sandboxNetworkRow}`}>
        <input
          data-testid="sandbox-network-access"
          type="checkbox"
          checked={status.allowNetwork}
          disabled={networkDisabled}
          onChange={(event) => onSettingsChange?.({ mode: status.mode, allowNetwork: event.target.checked })}
        />
        <span className={styles.toolName}>{t["config.sandboxNetwork"]}</span>
      </label>
      <div className={styles.sandboxDescription}>{networkDescription}</div>
      {!status.supported && <div className={styles.sandboxError}>{t["config.sandboxUnsupported"]}</div>}
      {status.managed && <div className={styles.sandboxError}>{t["config.sandboxManaged"]}</div>}
      {status.error && <div className={styles.sandboxError}>{t["config.sandboxError"](status.error)}</div>}
      {status.applying && <div className={styles.sandboxStatus}>{t["config.sandboxApplying"]}</div>}
    </div>
  );
}

function ReasoningReviewSection({
  preference,
  onPreferenceChange,
}: {
  preference?: ReasoningReviewPreference | null;
  onPreferenceChange?: (preference: ReasoningReviewPreferencePatch) => void;
}) {
  const t = useLocale();
  // Before the host publishes, mirror the host-side availability-gated
  // defaults (enabled, no workspace opt-out) instead of an unset control.
  const userEnabled = preference?.userEnabled ?? true;
  const workspaceOptOut = preference?.workspaceOptOut ?? false;
  const effective = preference?.effective ?? false;

  return (
    <div className={styles.section} data-testid="reasoning-review-section">
      <div className={styles.sectionTitle}>{t["config.reasoningReview"]}</div>
      <label className={styles.toggle}>
        <input
          data-testid="reasoning-review-enabled"
          type="checkbox"
          checked={userEnabled}
          onChange={(event) => onPreferenceChange?.({ userEnabled: event.target.checked })}
        />
        <span className={styles.toolName}>{t["config.reasoningReviewEnable"]}</span>
      </label>
      <label className={`${styles.toggle} ${styles.sandboxRow}`}>
        <input
          data-testid="reasoning-review-workspace-opt-out"
          type="checkbox"
          checked={workspaceOptOut}
          onChange={(event) => onPreferenceChange?.({ workspaceOptOut: event.target.checked })}
        />
        <span className={styles.toolName}>{t["config.reasoningReviewWorkspaceOptOut"]}</span>
      </label>
      <div className={styles.sandboxDescription}>{t["config.reasoningReviewDescription"]}</div>
      <div className={styles.sandboxStatus}>{t["config.reasoningReviewEffective"](effective)}</div>
    </div>
  );
}

function formatMcpLifecycle(s: McpServerStatus): string {
  const label = s.status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return s.error ? `${label}: ${s.error}` : label;
}
