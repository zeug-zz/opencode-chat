/**
 * Mermaid diagram rendering helper.
 *
 * Statically imports Mermaid so it is bundled into the main chunk (which is
 * authorised by the webview nonce).  Dynamic imports are incompatible with
 * VS Code webview CSP because Vite resolves chunk URLs relative to the page
 * origin (`vscode-webview://`) rather than the script CDN origin.
 *
 * The helper returns the rendered SVG as a **string** (not a live DOM
 * container) so that DOM insertion, sanitisation, and React integration stay
 * under the caller's control.  Mermaid's container-based path mutates an
 * existing element, so this helper renders through a private scratch element
 * and removes it before returning.
 */

import mermaid from "mermaid";

let initialized = false;
let idCounter = 0;

const MERMAID_OPERATION_TIMEOUT_MS = 8000;

/**
 * Pick a Mermaid theme that matches the current VS Code workbench theme.
 * VS Code sets `data-vscode-theme-kind` on the webview body; we read it on
 * first render so diagrams do not render with light colours on a dark
 * background (or vice versa).
 */
function getMermaidTheme(): "dark" | "default" | "neutral" {
  if (typeof document === "undefined") return "default";
  const kind = document.body?.dataset.vscodeThemeKind;
  if (kind === "vscode-dark" || kind === "vscode-high-contrast") return "dark";
  if (kind === "vscode-high-contrast-light") return "neutral";
  return "default";
}

/** Options for {@link renderMermaidDiagram}. */
export interface RenderMermaidOptions {
  /**
   * Optional DOM-safe ID for the rendered SVG.  A unique ID is auto-generated
   * when omitted.
   */
  id?: string;
  /**
   * Optional {@link AbortSignal} for cancellation/staleness protection.
   *
   * When the signal is aborted before or during a render, the function throws
   * a `DOMException` with the name `"AbortError"`.  Callers should catch this
   * error and skip DOM mutation — the render result is stale.
   *
   * The signal is checked at each `await` boundary:
   * 1. Before `mermaid.render()` — the most impactful check.
   * 2. After `mermaid.render()` — the render completed but may be stale;
   *    caller must not mutate the DOM.
   */
  signal?: AbortSignal;
}

/**
 * Result of a Mermaid render.  The caller is responsible for sanitising the
 * SVG (e.g. with DOMPurify) and inserting it into the DOM, then optionally
 * invoking {@link bindFunctions} to attach Mermaid's event listeners.
 */
export interface RenderMermaidResult {
  /** Rendered SVG markup (not yet sanitised). */
  svg: string;
  /**
   * Optional function Mermaid returns to wire up event listeners on the
   * inserted SVG (e.g. click handlers, popovers).  Callers must invoke this
   * **after** the SVG has been parsed by the browser; passing the target
   * element lets Mermaid resolve the right DOM node.
   */
  bindFunctions?: (element: Element) => void;
}

async function withMermaidTimeout<T>(operation: Promise<T>, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Mermaid ${label} timed out after ${MERMAID_OPERATION_TIMEOUT_MS}ms`));
    }, MERMAID_OPERATION_TIMEOUT_MS);
  });

  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Render a Mermaid diagram definition to an SVG string.
 *
 * @param source      - The Mermaid diagram source text
 *                      (e.g. `"graph TB\\na-->b"`).
 * @param idOrOptions - Either a DOM-safe ID string (shorthand for
 *                      `{ id: string }`) or a full {@link RenderMermaidOptions}
 *                      object.  When omitted, a unique ID is auto-generated.
 * @returns           A {@link RenderMermaidResult} with the rendered SVG
 *                      markup and an optional `bindFunctions` callback the
 *                      caller should run after insertion.
 * @throws            `DOMException` with name `"AbortError"` when the
 *                      {@link RenderMermaidOptions.signal} is aborted —
 *                      callers should skip DOM mutation for stale renders.
 * @throws            Errors from Mermaid itself (parse / render failures) —
 *                      callers should surface these in the UI without crashing.
 *
 * @example
 * ```ts
 * const { svg, bindFunctions } = await renderMermaidDiagram(source, { signal });
 * target.innerHTML = DOMPurify.sanitize(svg, MERMAID_PURIFY_CONFIG);
 * bindFunctions?.(target);
 * ```
 */
export async function renderMermaidDiagram(
  source: string,
  idOrOptions?: string | RenderMermaidOptions,
): Promise<RenderMermaidResult> {
  // --- Normalise arguments (backward-compatible with positional `id`) ---
  const options: RenderMermaidOptions = typeof idOrOptions === "string" ? { id: idOrOptions } : (idOrOptions ?? {});

  const { signal } = options;

  // --- Checkpoint 1: before render (early exit for cancelled operations) ---
  if (signal?.aborted) {
    throw new DOMException("Mermaid render cancelled", "AbortError");
  }

  // One-time initialisation with safe defaults
  if (!initialized) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: getMermaidTheme(),
      suppressErrorRendering: true,
      // Render labels as SVG <text> instead of HTML inside <foreignObject>.
      // HTML labels are harder to theme and sanitise in a VS Code webview,
      // and they rely on external font/CSS resources that CSP often blocks.
      htmlLabels: false,
      flowchart: { useMaxWidth: true },
      sequence: { useMaxWidth: true },
      class: { useMaxWidth: true },
      state: { useMaxWidth: true },
    });
    initialized = true;
  }

  // Generate a safe unique ID when caller does not provide one.
  // Source content is never embedded in the ID to avoid injection vectors.
  const resolvedId = options.id ?? `mermaid-diagram-${++idCounter}`;

  // --- Checkpoint 2: before Mermaid render (catches most stale renders) ---
  if (signal?.aborted) {
    throw new DOMException("Mermaid render cancelled", "AbortError");
  }

  // Validate before rendering. Invalid syntax should fail here rather than
  // letting Mermaid create its own temporary error diagram in document.body.
  await withMermaidTimeout(mermaid.mermaidAPI.parse(source), "parse");

  // --- Checkpoint 3: after parse completes (parse is stale) ---
  if (signal?.aborted) {
    throw new DOMException("Mermaid render cancelled", "AbortError");
  }

  const scratch = document.createElement("div");
  scratch.setAttribute("aria-hidden", "true");
  scratch.style.position = "absolute";
  scratch.style.left = "-10000px";
  scratch.style.top = "0";
  scratch.style.visibility = "hidden";
  scratch.style.pointerEvents = "none";
  document.body.appendChild(scratch);

  try {
    // Render into a private scratch container. This avoids Mermaid's no-
    // container path, which appends temporary render/error DOM to document.body.
    const { svg, bindFunctions } = await withMermaidTimeout(
      mermaid.mermaidAPI.render(resolvedId, source, scratch),
      "render",
    );

    // --- Checkpoint 4: after render completes (render is stale) ---
    // The SVG was generated but the operation that requested it is no longer
    // relevant (e.g. the component re-rendered with newer source).  The caller
    // must not mutate the DOM with this result.
    if (signal?.aborted) {
      throw new DOMException("Mermaid render cancelled", "AbortError");
    }

    return { svg, bindFunctions };
  } finally {
    scratch.remove();
  }
}
