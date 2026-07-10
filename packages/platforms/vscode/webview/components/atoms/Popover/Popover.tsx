import { type ReactNode, useCallback, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useClickOutside } from "../../../hooks/useClickOutside";
import styles from "./Popover.module.css";

type Props = {
  trigger: (params: { open: boolean; toggle: () => void }) => ReactNode;
  panel: (params: { close: () => void }) => ReactNode;
  className?: string;
};

type Coords = {
  left: number;
  top: number;
};

export function Popover({ trigger, panel, className }: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<Coords | null>(null);

  useClickOutside([containerRef, panelRef], () => setOpen(false), open);

  const updatePosition = useCallback(() => {
    const anchor = containerRef.current;
    const floating = panelRef.current;
    if (!anchor || !floating) return;

    const rect = anchor.getBoundingClientRect();
    const panelHeight = floating.offsetHeight;
    const gap = 4;
    let top = rect.top - panelHeight - gap;
    if (top < gap) {
      top = rect.bottom + gap;
    }
    let left = rect.left;
    const panelWidth = floating.offsetWidth;
    const maxLeft = Math.max(gap, window.innerWidth - panelWidth - gap);
    if (left > maxLeft) left = maxLeft;
    if (left < gap) left = gap;

    setCoords({ left, top });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setCoords(null);
      return;
    }
    updatePosition();
    const raf = requestAnimationFrame(updatePosition);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, updatePosition]);

  const toggle = () => setOpen((s) => !s);
  const close = () => setOpen(false);

  const classes = [styles.root, className].filter(Boolean).join(" ");

  return (
    <div className={classes} ref={containerRef}>
      {trigger({ open, toggle })}
      {open &&
        createPortal(
          <div
            ref={panelRef}
            className={styles.floating}
            style={
              coords
                ? { left: coords.left, top: coords.top, visibility: "visible" }
                : { left: 0, top: 0, visibility: "hidden" }
            }
          >
            {panel({ close })}
          </div>,
          document.body,
        )}
    </div>
  );
}
