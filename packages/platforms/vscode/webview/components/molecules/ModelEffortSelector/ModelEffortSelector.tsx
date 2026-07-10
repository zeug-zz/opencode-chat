import type { ModelVariantRef } from "@opencode-chat/core";
import { useLocale } from "../../../locales";
import { ChevronRightIcon } from "../../atoms/icons";
import { Popover } from "../../atoms/Popover";
import styles from "./ModelEffortSelector.module.css";

type Props = {
  variants: ModelVariantRef[];
  selectedEffort?: ModelVariantRef;
  onSelect: (variant?: ModelVariantRef) => void;
  onFocus: () => void;
};

const RADIO_NAME = "model-effort";

export function ModelEffortSelector({ variants, selectedEffort, onSelect, onFocus }: Props) {
  const t = useLocale();

  if (!variants || variants.length === 0) return null;

  const selectedLabel = selectedEffort ? selectedEffort.label || selectedEffort.id : t["model.effort.default"];

  return (
    <Popover
      className={styles.root}
      trigger={({ open, toggle }) => (
        <button
          type="button"
          className={styles.button}
          onClick={toggle}
          aria-label={`${t["model.effort.select"]}: ${selectedLabel}`}
        >
          <span className={styles.label}>{selectedLabel}</span>
          <span className={`${styles.chevron} ${open ? styles.expanded : ""}`}>
            <ChevronRightIcon />
          </span>
        </button>
      )}
      panel={({ close }) => (
        <div className={styles.panel} role="radiogroup" aria-label={t["model.effort.select"]}>
          <label className={`${styles.item} ${!selectedEffort ? styles.checked : ""}`}>
            <input
              type="radio"
              name={RADIO_NAME}
              checked={!selectedEffort}
              className={styles.radio}
              onChange={() => {
                onSelect(undefined);
                close();
                onFocus();
              }}
            />
            <span className={styles.itemCheck}>{!selectedEffort ? "✓" : ""}</span>
            <span className={styles.itemLabel}>{t["model.effort.default"]}</span>
          </label>
          {variants.map((variant) => {
            const isChecked = selectedEffort !== undefined && selectedEffort.id === variant.id;
            return (
              <label key={variant.id} className={`${styles.item} ${isChecked ? styles.checked : ""}`}>
                <input
                  type="radio"
                  name={RADIO_NAME}
                  checked={isChecked}
                  className={styles.radio}
                  onChange={() => {
                    onSelect(variant);
                    close();
                    onFocus();
                  }}
                />
                <span className={styles.itemCheck}>{isChecked ? "✓" : ""}</span>
                <span className={styles.itemLabel}>{variant.label || variant.id}</span>
              </label>
            );
          })}
        </div>
      )}
    />
  );
}
