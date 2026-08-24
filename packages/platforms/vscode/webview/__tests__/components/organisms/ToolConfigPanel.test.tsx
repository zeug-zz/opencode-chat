import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ChatSandboxStatus, McpStatus } from "@opencode-chat/core";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ToolConfigPanel } from "../../../components/organisms/ToolConfigPanel";
import { LocaleProvider } from "../../../locales";
import { en } from "../../../locales/en";
import { es } from "../../../locales/es";
import { ja } from "../../../locales/ja";
import { ko } from "../../../locales/ko";
import { ptBr } from "../../../locales/pt-br";
import { ru } from "../../../locales/ru";
import { zhCn } from "../../../locales/zh-cn";
import { zhTw } from "../../../locales/zh-tw";

const sandboxLocaleKeys = [
  "config.sandbox",
  "config.sandboxChatTools",
  "config.sandboxInherited",
  "config.sandboxWorkspaceOverride",
  "config.sandboxReset",
  "config.sandboxNetwork",
  "config.sandboxNetworkEnabledDescription",
  "config.sandboxLocalOnlyDescription",
  "config.sandboxUnsupported",
  "config.sandboxManaged",
  "config.sandboxApplying",
  "config.sandboxError",
] as const;

const localeDictionaries = [en, ja, zhCn, ko, zhTw, es, ptBr, ru];

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

      it("wraps and keeps long failed diagnostics selectable", () => {
        const error =
          "Context7 request failed for https://context7.com/api/v1/libraries/vercel/next.js/docs?query=resolve%20the%20library%20ID%20for%20a%20long%20configuration%20diagnostic: " +
          "/Users/zeug/Projects/opencode-chat/packages/platforms/vscode/webview/.cache/context7/diagnostics/failed-request-response.json";
        const expected = `Failed: ${error}`;
        const { container } = render(
          <ToolConfigPanel
            {...defaultProps}
            mcpServers={{ context7: { connected: false, status: "failed", error } }}
            onMcpToggle={vi.fn()}
          />,
        );
        const lifecycle = container.querySelector<HTMLElement>(`.${"mcpLifecycle"}`);

        expect(lifecycle).toBeInTheDocument();
        expect(lifecycle?.textContent).toBe(expected);

        const style = document.createElement("style");
        style.textContent = readFileSync(
          resolve(process.cwd(), "webview/components/organisms/ToolConfigPanel/ToolConfigPanel.module.css"),
          "utf8",
        );
        document.head.append(style);
        try {
          const styles = window.getComputedStyle(lifecycle!);
          expect(styles.minWidth).toBe("0px");
          expect(styles.whiteSpace).toBe("normal");
          expect(styles.overflowWrap).toBe("anywhere");
          expect(styles.userSelect).toBe("text");
          expect(styles.flexShrink).not.toBe("0");
        } finally {
          style.remove();
        }
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

  context("Chat sandbox section", () => {
    const sandboxStatus: ChatSandboxStatus = {
      mode: "inherit",
      enabled: true,
      inherited: true,
      allowNetwork: true,
      applying: false,
      managed: false,
      supported: true,
    };

    it("renders effective sandbox and network state", () => {
      const { getByTestId, getByText } = render(<ToolConfigPanel {...defaultProps} sandboxStatus={sandboxStatus} />);
      expect(getByTestId("sandbox-chat-tools")).toBeChecked();
      expect(getByTestId("sandbox-network-access")).toBeChecked();
      expect(getByText("Inherited from VS Code")).toBeInTheDocument();
    });

    it("emits mode and network values for sandbox changes", async () => {
      const onChange = vi.fn();
      const { getByTestId } = render(
        <ToolConfigPanel {...defaultProps} sandboxStatus={sandboxStatus} onChatSandboxSettingsChange={onChange} />,
      );
      await userEvent.setup().click(getByTestId("sandbox-chat-tools"));
      expect(onChange).toHaveBeenCalledWith({ mode: "off", allowNetwork: true });
    });

    it("emits inherit on reset and preserves network value", async () => {
      const onChange = vi.fn();
      const { getByRole } = render(
        <ToolConfigPanel
          {...defaultProps}
          sandboxStatus={{ ...sandboxStatus, mode: "on", inherited: false, allowNetwork: false }}
          onChatSandboxSettingsChange={onChange}
        />,
      );
      await userEvent.setup().click(getByRole("button", { name: "Use VS Code setting" }));
      expect(onChange).toHaveBeenCalledWith({ mode: "inherit", allowNetwork: false });
    });

    it("disables network access when sandboxing is off or applying", () => {
      const { getByTestId, rerender } = render(
        <ToolConfigPanel {...defaultProps} sandboxStatus={{ ...sandboxStatus, enabled: false }} />,
      );
      expect(getByTestId("sandbox-network-access")).toBeDisabled();
      rerender(<ToolConfigPanel {...defaultProps} sandboxStatus={{ ...sandboxStatus, applying: true }} />);
      expect(getByTestId("sandbox-network-access")).toBeDisabled();
      expect(getByTestId("sandbox-chat-tools")).toBeDisabled();
    });

    it("disables sandbox changes during an active request without disabling unrelated controls", async () => {
      const onChange = vi.fn();
      const onMcpToggle = vi.fn();
      const onLocaleSettingChange = vi.fn();
      const user = userEvent.setup();
      const { getByTestId, getByRole } = render(
        <ToolConfigPanel
          {...defaultProps}
          sandboxStatus={sandboxStatus}
          sandboxControlsDisabled
          onChatSandboxSettingsChange={onChange}
          mcpServers={{ github: { connected: false, status: "disabled" } }}
          onMcpToggle={onMcpToggle}
          onLocaleSettingChange={onLocaleSettingChange}
        />,
      );

      expect(getByTestId("sandbox-chat-tools")).toBeDisabled();
      expect(getByTestId("sandbox-network-access")).toBeDisabled();
      await user.click(getByTestId("sandbox-chat-tools"));
      expect(onChange).not.toHaveBeenCalled();

      await user.click(getByRole("checkbox", { name: "githubDisabled" }));
      expect(onMcpToggle).toHaveBeenCalledWith("github", true);

      await user.click(getByRole("button", { name: "Auto (VS Code)" }));
      await user.click(getByRole("option", { name: "English" }));
      expect(onLocaleSettingChange).toHaveBeenCalledWith("en");
    });

    it("recovers sandbox controls after successful and failed transitions", async () => {
      const onChange = vi.fn();
      const user = userEvent.setup();
      const { getByTestId, rerender } = render(
        <ToolConfigPanel
          {...defaultProps}
          sandboxStatus={{ ...sandboxStatus, applying: true }}
          onChatSandboxSettingsChange={onChange}
        />,
      );
      expect(getByTestId("sandbox-chat-tools")).toBeDisabled();

      rerender(
        <ToolConfigPanel {...defaultProps} sandboxStatus={sandboxStatus} onChatSandboxSettingsChange={onChange} />,
      );
      expect(getByTestId("sandbox-chat-tools")).toBeEnabled();
      await user.click(getByTestId("sandbox-chat-tools"));
      expect(onChange).toHaveBeenCalledWith({ mode: "off", allowNetwork: true });

      onChange.mockClear();
      rerender(
        <ToolConfigPanel
          {...defaultProps}
          sandboxStatus={{ ...sandboxStatus, error: "transition failed" }}
          onChatSandboxSettingsChange={onChange}
        />,
      );
      expect(getByTestId("sandbox-chat-tools")).toBeEnabled();
      await user.click(getByTestId("sandbox-chat-tools"));
      expect(onChange).toHaveBeenCalledWith({ mode: "off", allowNetwork: true });
    });

    it("describes network-enabled and local-only modes", () => {
      const { getByText, rerender } = render(<ToolConfigPanel {...defaultProps} sandboxStatus={sandboxStatus} />);
      expect(
        getByText(
          /Compatibility mode: filesystem restrictions remain active, but network access is unrestricted for the companion and inherited MCPs\. This is not strict outbound-only or credential-confidential protection; the Chat API remains bound to 127\.0\.0\.1\./,
        ),
      ).toBeInTheDocument();
      rerender(<ToolConfigPanel {...defaultProps} sandboxStatus={{ ...sandboxStatus, allowNetwork: false }} />);
      expect(getByText(/Local-only operation/)).toBeInTheDocument();
    });

    it("provides the exact sandbox key set and function signatures in every locale", () => {
      for (const locale of localeDictionaries) {
        expect(
          Object.keys(locale)
            .filter((key) => key.startsWith("config.sandbox"))
            .sort(),
        ).toEqual([...sandboxLocaleKeys].sort());
        expect(typeof locale["config.sandboxWorkspaceOverride"]).toBe("function");
        expect(typeof locale["config.sandboxError"]).toBe("function");
        expect(locale["config.sandboxWorkspaceOverride"]("on")).toBeTruthy();
        expect(locale["config.sandboxError"]("host failure")).toContain("host failure");
      }
    });

    it("renders localized sandbox strings", () => {
      const { getByText } = render(
        <LocaleProvider value={ja}>
          <ToolConfigPanel {...defaultProps} sandboxStatus={sandboxStatus} />
        </LocaleProvider>,
      );
      expect(getByText("サンドボックス")).toBeInTheDocument();
      expect(getByText("チャットツールをサンドボックス化")).toBeInTheDocument();
      expect(getByText("VS Code から継承")).toBeInTheDocument();
    });
  });
});
