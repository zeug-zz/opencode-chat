import type { McpStatus } from "@opencode-chat/core";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ToolConfigPanel } from "../../../components/organisms/ToolConfigPanel";

const defaultProps = {
  paths: { home: "/home", config: "/config", state: "/state", directory: "/project" },
  onOpenConfigFile: vi.fn(),
  onClose: vi.fn(),
  localeSetting: "auto" as const,
  onLocaleSettingChange: vi.fn(),
  soundSettings: {} as Record<string, unknown>,
  onSoundSettingChange: vi.fn(),
};

describe("ToolConfigPanel", () => {
  // when rendered
  context("レンダリングした場合", () => {
    // renders the panel
    it("パネルをレンダリングすること", () => {
      const { container } = render(<ToolConfigPanel {...defaultProps} />);
      expect(container.querySelector(".root")).toBeInTheDocument();
    });

    // renders close button
    it("閉じるボタンをレンダリングすること", () => {
      const { container } = render(<ToolConfigPanel {...defaultProps} />);
      expect(container.querySelector(".muted.sm")).toBeInTheDocument();
    });

    // renders language dropdown (trigger + closed by default)
    it("言語オプションをレンダリングすること", () => {
      const { container } = render(<ToolConfigPanel {...defaultProps} />);
      const trigger = container.querySelector(`.${"langTrigger"}`);
      expect(trigger).toBeInTheDocument();
      expect(trigger?.textContent).toContain("Auto");
      // menu items hidden until opened
      expect(container.querySelectorAll(`.${"langOption"}`)).toHaveLength(0);
    });

    it("言語メニューを開くと 9 オプションが表示されること", async () => {
      const { container } = render(<ToolConfigPanel {...defaultProps} />);
      const user = userEvent.setup();
      const trigger = container.querySelector(`.${"langTrigger"}`);
      if (trigger) await user.click(trigger);
      expect(container.querySelectorAll(`.${"langOption"}`)).toHaveLength(9);
    });
  });

  // when paths are provided
  context("paths が提供されている場合", () => {
    // renders config file links
    it("設定ファイルリンクをレンダリングすること", () => {
      const { container } = render(<ToolConfigPanel {...defaultProps} />);
      expect(container.querySelectorAll(".footer button")).toHaveLength(2);
    });
  });

  // when paths are null
  context("paths が null の場合", () => {
    // does not render config file links
    it("設定ファイルリンクをレンダリングしないこと", () => {
      const { container } = render(<ToolConfigPanel {...defaultProps} paths={null} />);
      expect(container.querySelector(".footer")).not.toBeInTheDocument();
    });
  });

  // MCP section
  context("MCP セクション", () => {
    const mcpServers: McpStatus = {
      filesystem: { connected: true, status: "connected", tools: ["read", "write"] },
      github: { connected: false, status: "disabled" },
    };

    // renders section title when mcpServers provided
    it("mcpServers が提供されると MCP セクションをレンダリングすること", () => {
      const { container } = render(<ToolConfigPanel {...defaultProps} mcpServers={mcpServers} onMcpToggle={vi.fn()} />);
      const sectionTitles = container.querySelectorAll(`.${"sectionTitle"}`);
      const mcpTitle = Array.from(sectionTitles).find((el) => el.textContent === "MCP");
      expect(mcpTitle).toBeInTheDocument();
    });

    // does not render section when mcpServers is undefined
    it("mcpServers が未指定だと MCP セクションをレンダリングしないこと", () => {
      const { container } = render(<ToolConfigPanel {...defaultProps} />);
      expect(container.textContent).not.toContain("MCP");
    });

    // renders per-server checkbox for each server
    it("各サーバーのチェックボックスをレンダリングすること", () => {
      const { container } = render(<ToolConfigPanel {...defaultProps} mcpServers={mcpServers} onMcpToggle={vi.fn()} />);
      const mcpSection = Array.from(container.querySelectorAll(`.${"section"}`)).find(
        (el) => el.querySelector(`.${"sectionTitle"}`)?.textContent === "MCP",
      );
      const mcpCheckboxes = mcpSection?.querySelectorAll("input[type='checkbox']");
      expect(mcpCheckboxes).toHaveLength(2);
    });

    // calls onMcpToggle with correct arguments when checkbox changed
    it("チェックボックス変更時に onMcpToggle を呼び出すこと", async () => {
      const onMcpToggle = vi.fn();
      const { container } = render(
        <ToolConfigPanel {...defaultProps} mcpServers={mcpServers} onMcpToggle={onMcpToggle} />,
      );
      const user = userEvent.setup();
      const mcpSection = Array.from(container.querySelectorAll(`.${"section"}`)).find(
        (el) => el.querySelector(`.${"sectionTitle"}`)?.textContent === "MCP",
      );
      const checkboxes = mcpSection?.querySelectorAll("input[type='checkbox']");
      const githubCheckbox = checkboxes?.[1];
      if (githubCheckbox) {
        await user.click(githubCheckbox);
      }
      expect(onMcpToggle).toHaveBeenCalledWith("github", true);
    });

    // renders trust notice
    it("トラスト通知を表示すること", () => {
      const { container } = render(<ToolConfigPanel {...defaultProps} mcpServers={mcpServers} onMcpToggle={vi.fn()} />);
      const trustNotice = container.querySelector(`.${"trustNotice"}`);
      expect(trustNotice).toBeInTheDocument();
      expect(trustNotice?.textContent).toContain("not sandboxed");
    });

    // renders empty state when no servers
    it("サーバーがない場合は空の状態を表示すること", () => {
      const { container } = render(<ToolConfigPanel {...defaultProps} mcpServers={{}} onMcpToggle={vi.fn()} />);
      const mcpEmpty = container.querySelector(`.${"mcpEmpty"}`);
      expect(mcpEmpty).toBeInTheDocument();
      const mcpSection = Array.from(container.querySelectorAll(`.${"section"}`)).find(
        (el) => el.querySelector(`.${"sectionTitle"}`)?.textContent === "MCP",
      );
      expect(mcpSection?.querySelectorAll("input[type='checkbox']")).toHaveLength(0);
    });

    // MCP lifecycle labels
    context("lifecycle label", () => {
      it("shows lifecycle label for disabled server", () => {
        const { container } = render(
          <ToolConfigPanel
            {...defaultProps}
            mcpServers={{ github: { connected: false, status: "disabled" } }}
            onMcpToggle={vi.fn()}
          />,
        );
        const lifecycle = container.querySelector(`.${"mcpLifecycle"}`);
        expect(lifecycle).toBeInTheDocument();
        expect(lifecycle?.textContent).toBe("Disabled");
      });

      it("shows lifecycle label with error for failed server", () => {
        const { container } = render(
          <ToolConfigPanel
            {...defaultProps}
            mcpServers={{ github: { connected: false, status: "failed", error: "Connection refused" } }}
            onMcpToggle={vi.fn()}
          />,
        );
        const lifecycle = container.querySelector(`.${"mcpLifecycle"}`);
        expect(lifecycle).toBeInTheDocument();
        expect(lifecycle?.textContent).toBe("Failed: Connection refused");
      });

      it("shows lifecycle label for needs_auth server", () => {
        const { container } = render(
          <ToolConfigPanel
            {...defaultProps}
            mcpServers={{ github: { connected: false, status: "needs_auth" } }}
            onMcpToggle={vi.fn()}
          />,
        );
        const lifecycle = container.querySelector(`.${"mcpLifecycle"}`);
        expect(lifecycle).toBeInTheDocument();
        expect(lifecycle?.textContent).toBe("Needs Auth");
      });

      it("does not show lifecycle label for connected server", () => {
        const { container } = render(
          <ToolConfigPanel
            {...defaultProps}
            mcpServers={{ filesystem: { connected: true, status: "connected" } }}
            onMcpToggle={vi.fn()}
          />,
        );
        expect(container.querySelector(`.${"mcpLifecycle"}`)).not.toBeInTheDocument();
      });

      it("does not show lifecycle label for unknown status", () => {
        const { container } = render(
          <ToolConfigPanel
            {...defaultProps}
            mcpServers={{ weird: { connected: false, status: "unknown" } }}
            onMcpToggle={vi.fn()}
          />,
        );
        expect(container.querySelector(`.${"mcpLifecycle"}`)).not.toBeInTheDocument();
      });
    });
  });
});
