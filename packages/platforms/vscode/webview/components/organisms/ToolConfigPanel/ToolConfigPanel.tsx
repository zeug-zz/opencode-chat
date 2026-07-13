import type { McpServerStatus, McpStatus, SoundEventSetting, SoundEventType, SoundSettings } from "@opencode-chat/core";
import { useMemo, useState } from "react";
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
  soundSettings: SoundSettings;
  onSoundSettingChange: (eventType: SoundEventType, setting: Partial<SoundEventSetting>) => void;
  mcpServers?: McpStatus | null;
  onMcpToggle?: (server: string, enabled: boolean) => void;
};

export function ToolConfigPanel({
  paths,
  onOpenConfigFile,
  onClose,
  localeSetting,
  onLocaleSettingChange,
  soundSettings,
  onSoundSettingChange,
  mcpServers,
  onMcpToggle,
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
          <LinkButton onClick={() => onOpenConfigFile(`${paths.directory}/opencode.json`)}>
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

function formatMcpLifecycle(s: McpServerStatus): string {
  const label = s.status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return s.error ? `${label}: ${s.error}` : label;
}
