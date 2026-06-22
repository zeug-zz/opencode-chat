import { beforeEach, describe, expect, it, vi } from "vitest";

const mockMermaid = vi.hoisted(() => ({
  initialize: vi.fn(),
  mermaidAPI: {
    parse: vi.fn(),
    render: vi.fn(),
  },
}));

vi.mock("mermaid", () => ({
  default: mockMermaid,
}));

async function loadHelper() {
  vi.resetModules();
  return import("../../utils/mermaid");
}

describe("renderMermaidDiagram", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
    mockMermaid.mermaidAPI.parse.mockResolvedValue({ diagramType: "flowchart" });
    mockMermaid.mermaidAPI.render.mockResolvedValue({
      svg: '<svg viewBox="0 0 10 10"><text>diagram</text></svg>',
      bindFunctions: vi.fn(),
    });
  });

  it("initializes Mermaid with error DOM rendering disabled", async () => {
    document.body.dataset.vscodeThemeKind = "vscode-dark";
    const { renderMermaidDiagram } = await loadHelper();

    await renderMermaidDiagram("flowchart TD\n  A --> B");

    expect(mockMermaid.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "dark",
        suppressErrorRendering: true,
      }),
    );
  });

  it("renders through a private scratch container and removes it after success", async () => {
    const { renderMermaidDiagram } = await loadHelper();
    let scratch: Element | undefined;
    mockMermaid.mermaidAPI.render.mockImplementation(async (_id, _source, container) => {
      scratch = container;
      expect(container).toBeInstanceOf(HTMLElement);
      expect(document.body.contains(container)).toBe(true);
      return { svg: "<svg></svg>" };
    });

    await renderMermaidDiagram("flowchart TD\n  A --> B");

    expect(mockMermaid.mermaidAPI.render).toHaveBeenCalledWith("mermaid-diagram-1", "flowchart TD\n  A --> B", scratch);
    expect(scratch).toBeDefined();
    expect(document.body.contains(scratch!)).toBe(false);
  });

  it("preflights invalid syntax with parse before creating scratch DOM", async () => {
    const { renderMermaidDiagram } = await loadHelper();
    const parseError = new Error("Lexical error");
    mockMermaid.mermaidAPI.parse.mockRejectedValueOnce(parseError);

    await expect(renderMermaidDiagram("flowchart INVALID")).rejects.toThrow("Lexical error");

    expect(mockMermaid.mermaidAPI.render).not.toHaveBeenCalled();
    expect(document.body.querySelector('[aria-hidden="true"]')).toBeNull();
  });

  it("removes scratch DOM when Mermaid render fails", async () => {
    const { renderMermaidDiagram } = await loadHelper();
    let scratch: Element | undefined;
    mockMermaid.mermaidAPI.render.mockImplementation(async (_id, _source, container) => {
      scratch = container;
      throw new Error("render failed");
    });

    await expect(renderMermaidDiagram("flowchart TD\n  A --> B")).rejects.toThrow("render failed");

    expect(scratch).toBeDefined();
    expect(document.body.contains(scratch!)).toBe(false);
  });
});
