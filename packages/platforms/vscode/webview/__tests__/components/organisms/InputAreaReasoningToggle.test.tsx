import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { InputArea } from "../../../components/organisms/InputArea/InputArea";

const baseProps = {
  onSend: vi.fn(),
  onAbort: vi.fn(),
  isBusy: false,
  providers: [],
  allProvidersData: null,
  selectedModel: null,
  onModelSelect: vi.fn(),
  selectedModelVariants: [],
  selectedPrimaryAgent: null,
  onPrimaryAgentSelect: vi.fn(),
  openEditors: [],
  activeEditorFile: null,
  workspaceFiles: [],
  openCodePaths: null,
  onOpenConfigFile: vi.fn(),
  onOpenTerminal: vi.fn(),
  localeSetting: "en" as const,
  onLocaleSettingChange: vi.fn(),
  soundSettings: {},
  onSoundSettingChange: vi.fn(),
  agents: [],
  skills: [],
  reasoningReviewRuntime: { state: "available" as const },
  reasoningReviewPreference: { userEnabled: true, workspaceOptOut: false, effective: true },
  onReasoningReviewPreferenceChange: vi.fn(),
};

describe("InputArea reasoning-review toggle", () => {
  it("toggles only userEnabled and reflects authoritative preference updates", async () => {
    const callback = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<InputArea {...baseProps} onReasoningReviewPreferenceChange={callback} />);
    const button = screen.getByRole("button", { name: "Reasoning review: on" });
    expect(button).toHaveAttribute("aria-pressed", "true");
    await user.click(button);
    expect(callback).toHaveBeenCalledWith({ userEnabled: false });
    expect(button).toHaveAttribute("aria-pressed", "true");

    rerender(
      <InputArea
        {...baseProps}
        reasoningReviewPreference={{ userEnabled: false, workspaceOptOut: false, effective: false }}
        onReasoningReviewPreferenceChange={callback}
      />,
    );
    const offButton = screen.getByRole("button", { name: "Reasoning review: off" });
    expect(offButton).toHaveAttribute("aria-pressed", "false");
    await user.click(offButton);
    expect(callback).toHaveBeenLastCalledWith({ userEnabled: true });
  });

  it("hides unless runtime is available and disables unloaded or opted-out preferences", async () => {
    const callback = vi.fn();
    const { rerender } = render(<InputArea {...baseProps} reasoningReviewRuntime={{ state: "checking" }} />);
    expect(screen.queryByRole("button", { name: /Reasoning review/ })).not.toBeInTheDocument();

    rerender(<InputArea {...baseProps} reasoningReviewPreference={null} />);
    expect(screen.getByRole("button", { name: "Reasoning review: off" })).toBeDisabled();

    rerender(
      <InputArea
        {...baseProps}
        reasoningReviewPreference={{ userEnabled: true, workspaceOptOut: true, effective: false }}
        onReasoningReviewPreferenceChange={callback}
      />,
    );
    const blockedButton = screen.getByRole("button", { name: "Reasoning review is blocked by workspace settings" });
    expect(blockedButton).toBeDisabled();
    await userEvent.setup().click(blockedButton);
    expect(callback).not.toHaveBeenCalled();
  });

  it("supports native keyboard activation", async () => {
    const callback = vi.fn();
    const user = userEvent.setup();
    render(
      <InputArea
        {...baseProps}
        reasoningReviewPreference={{ ...baseProps.reasoningReviewPreference, userEnabled: false }}
        onReasoningReviewPreferenceChange={callback}
      />,
    );
    const button = screen.getByRole("button", { name: "Reasoning review: off" });
    button.focus();
    await user.keyboard("{Enter}");
    expect(callback).toHaveBeenCalledWith({ userEnabled: true });
  });

  it("keeps the Settings checkbox and quick toggle synchronized with host preference updates", async () => {
    const callback = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<InputArea {...baseProps} onReasoningReviewPreferenceChange={callback} />);

    await user.click(screen.getByRole("button", { name: "Settings" }));
    const checkbox = screen.getByRole("checkbox", { name: "Enable reasoning review" });
    const toggle = screen.getByRole("button", { name: "Reasoning review: on" });
    expect(checkbox).toBeChecked();
    expect(toggle).toHaveAttribute("aria-pressed", "true");

    await user.click(checkbox);
    expect(callback).toHaveBeenCalledWith({ userEnabled: false });

    rerender(
      <InputArea
        {...baseProps}
        reasoningReviewPreference={{ userEnabled: false, workspaceOptOut: false, effective: false }}
        onReasoningReviewPreferenceChange={callback}
      />,
    );
    expect(screen.getByRole("checkbox", { name: "Enable reasoning review" })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Reasoning review: off" })).toHaveAttribute("aria-pressed", "false");
  });
});
