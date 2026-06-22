import type { AgentInfo } from "@opencode-chat/core";
import { useMemo } from "react";
import { useLocale } from "../../../locales";
import { AgentIcon, ChevronRightIcon } from "../../atoms/icons";
import { Popover } from "../../atoms/Popover";
import styles from "./AgentSelector.module.css";

type Props = {
  agents: AgentInfo[];
  selectedAgent: string | null;
  onSelect: (agentName: string) => void;
};

const ALLOWED_AGENTS = ["plan", "build"];
const AGENT_DISPLAY_NAMES: Record<string, string> = { plan: "chat" };
const getDisplayName = (name: string) => AGENT_DISPLAY_NAMES[name] ?? name;

const AGENT_DESCRIPTIONS: Record<string, string> = {
  plan: "Default mode for chatting and planning. Read-only, no code execution.",
  build: "Full agent mode. Can run commands and edit files.",
};
const getDescription = (agent: AgentInfo) => AGENT_DESCRIPTIONS[agent.name] ?? agent.description;

export function AgentSelector({ agents, selectedAgent, onSelect }: Props) {
  const t = useLocale();

  // plan / build のみ表示（plan は "chat" として表示）
  const primaryAgents = useMemo(() => agents.filter((a) => ALLOWED_AGENTS.includes(a.name)), [agents]);

  const selectedAgentInfo = useMemo(
    () => primaryAgents.find((a) => a.name === selectedAgent),
    [primaryAgents, selectedAgent],
  );

  const displayName = selectedAgentInfo
    ? getDisplayName(selectedAgentInfo.name)
    : selectedAgent
      ? getDisplayName(selectedAgent)
      : t["agent.selectAgent"];

  if (primaryAgents.length === 0) return null;

  return (
    <Popover
      className={styles.root}
      trigger={({ open, toggle }) => (
        <button type="button" className={styles.button} onClick={toggle} title={t["agent.selectAgent"]}>
          {selectedAgentInfo?.color && (
            <span className={styles.colorDot} style={{ backgroundColor: selectedAgentInfo.color }} />
          )}
          {!selectedAgentInfo?.color && <AgentIcon width={14} />}
          <span className={styles.label}>{displayName}</span>
          <span className={`${styles.chevron} ${open ? styles.expanded : ""}`}>
            <ChevronRightIcon />
          </span>
        </button>
      )}
      panel={({ close }) => (
        <div className={styles.panel}>
          <div className={styles.panelBody}>
            <div className={styles.sectionTitle}>{t["agent.agents"]}</div>
            {primaryAgents.map((agent) => {
              const isSelected = agent.name === selectedAgent;
              return (
                <div
                  key={agent.name}
                  className={`${styles.item} ${isSelected ? styles.active : ""}`}
                  onClick={() => {
                    onSelect(agent.name);
                    close();
                  }}
                >
                  <span className={styles.itemCheck}>{isSelected ? "✓" : ""}</span>
                  <span className={styles.itemName}>
                    {agent.color && <span className={styles.colorDot} style={{ backgroundColor: agent.color }} />}
                    {getDisplayName(agent.name)}
                  </span>
                  {getDescription(agent) && <span className={styles.itemDescription}>{getDescription(agent)}</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    />
  );
}
