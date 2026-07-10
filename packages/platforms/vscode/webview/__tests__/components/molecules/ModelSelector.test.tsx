import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ModelSelector } from "../../../components/molecules/ModelSelector";
import { createProvider } from "../../factories";

const defaultProps = {
  providers: [
    createProvider("openai", {
      "gpt-4": { id: "gpt-4", name: "GPT-4", limit: { context: 128000, output: 4096 } },
    }),
  ],
  allProvidersData: null,
  selectedModel: { providerID: "openai", modelID: "gpt-4" },
  onSelect: vi.fn(),
};

const q = (sel: string) => document.body.querySelector(sel);
const qa = (sel: string) => document.body.querySelectorAll(sel);

describe("ModelSelector", () => {
  context("レンダリングした場合", () => {
    it("セレクターボタンをレンダリングすること", () => {
      render(<ModelSelector {...defaultProps} />);
      expect(q(".button")).toBeInTheDocument();
    });

    it("選択中のモデル名を表示すること", () => {
      render(<ModelSelector {...defaultProps} />);
      expect(q(".label")?.textContent).toBe("GPT-4");
    });
  });

  context("ボタンをクリックした場合", () => {
    it("モデルパネルを開くこと", () => {
      render(<ModelSelector {...defaultProps} />);
      fireEvent.click(q(".button")!);
      expect(q(".panel")).toBeInTheDocument();
    });
  });

  context("モデルを選択した場合", () => {
    it("onSelect が呼ばれること", () => {
      const onSelect = vi.fn();
      render(<ModelSelector {...defaultProps} onSelect={onSelect} />);
      fireEvent.click(q(".button")!);
      fireEvent.click(q(".item")!);
      expect(onSelect).toHaveBeenCalledWith({ providerID: "openai", modelID: "gpt-4" });
    });
  });

  context("モデルが未選択の場合", () => {
    it("プレースホルダーテキストを表示すること", () => {
      render(<ModelSelector {...defaultProps} selectedModel={null} />);
      expect(q(".label")?.textContent).toBeTruthy();
    });
  });

  describe("recentModels", () => {
    it("recentModels が渡された場合、Recent セクションがレンダリングされること", () => {
      render(<ModelSelector {...defaultProps} recentModels={[{ providerID: "openai", modelID: "gpt-4" }]} />);
      fireEvent.click(q(".button")!);
      expect(q(".sectionName")?.textContent).toBe("Recent");
      expect(q(".itemProvider")?.textContent).toBe("Openai");
    });

    it("検索中は Recent セクションが非表示になること", () => {
      render(<ModelSelector {...defaultProps} recentModels={[{ providerID: "openai", modelID: "gpt-4" }]} />);
      fireEvent.click(q(".button")!);
      expect(document.body.textContent).toContain("Recent");
      const searchInput = q(".searchInput")!;
      fireEvent.change(searchInput, { target: { value: "searching" } });
      expect(document.body.textContent).not.toContain("Recent");
      fireEvent.change(searchInput, { target: { value: "" } });
      expect(document.body.textContent).toContain("Recent");
    });

    it("存在しないプロバイダーやモデルのエントリは表示されないこと (stale filtering)", () => {
      render(<ModelSelector {...defaultProps} recentModels={[{ providerID: "nonexistent", modelID: "none" }]} />);
      fireEvent.click(q(".button")!);
      expect(document.body.textContent).not.toContain("Recent");
    });

    it("Recent のモデルをクリックすると onSelect が呼ばれること", () => {
      const onSelect = vi.fn();
      render(
        <ModelSelector
          {...defaultProps}
          onSelect={onSelect}
          recentModels={[{ providerID: "openai", modelID: "gpt-4" }]}
        />,
      );
      fireEvent.click(q(".button")!);
      fireEvent.click(q(".item")!);
      expect(onSelect).toHaveBeenCalledWith({ providerID: "openai", modelID: "gpt-4" });
    });

    it("recentModels が空の場合は Recent セクションが表示されないこと", () => {
      render(<ModelSelector {...defaultProps} recentModels={[]} />);
      fireEvent.click(q(".button")!);
      expect(document.body.textContent).not.toContain("Recent");
    });
  });
});
