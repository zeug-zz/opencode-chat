import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ModelEffortSelector } from "../../../components/molecules/ModelEffortSelector";

const variants = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
];

const defaultProps = {
  variants,
  onSelect: vi.fn(),
  onFocus: vi.fn(),
};

const q = (sel: string) => document.body.querySelector(sel);
const qa = (sel: string) => document.body.querySelectorAll(sel);

describe("ModelEffortSelector", () => {
  describe("when variants list is empty", () => {
    it("renders nothing", () => {
      const { container } = render(<ModelEffortSelector {...defaultProps} variants={[]} />);
      expect(container.textContent).toBe("");
    });
  });

  describe("when no effort is selected", () => {
    it("shows Default label on trigger", () => {
      render(<ModelEffortSelector {...defaultProps} />);
      expect(q(".button")).toBeInTheDocument();
      expect(q(".label")?.textContent).toBe("Default");
    });
  });

  describe("when an effort is selected", () => {
    it("shows the effort label on trigger", () => {
      render(<ModelEffortSelector {...defaultProps} selectedEffort={{ id: "high", label: "High" }} />);
      expect(q(".label")?.textContent).toBe("High");
    });

    it("falls back to id when label is missing", () => {
      render(<ModelEffortSelector {...defaultProps} selectedEffort={{ id: "xhigh" }} />);
      expect(q(".label")?.textContent).toBe("xhigh");
    });
  });

  describe("when trigger is clicked", () => {
    it("opens the popover panel", () => {
      render(<ModelEffortSelector {...defaultProps} />);
      fireEvent.click(q(".button")!);
      expect(q(".panel")).toBeInTheDocument();
    });

    it("shows Default option and all variants", () => {
      render(<ModelEffortSelector {...defaultProps} />);
      fireEvent.click(q(".button")!);
      const items = qa(`.item`);
      expect(items.length).toBe(4);
      expect(items[0].textContent).toContain("Default");
      expect(items[1].textContent).toContain("Low");
      expect(items[2].textContent).toContain("Medium");
      expect(items[3].textContent).toContain("High");
    });
  });

  describe("checked state", () => {
    it("checks Default when no effort selected", () => {
      render(<ModelEffortSelector {...defaultProps} />);
      fireEvent.click(q(".button")!);
      const inputs = qa('input[type="radio"]');
      expect(inputs.length).toBe(4);
      expect(inputs[0]).toBeChecked();
      expect(inputs[1]).not.toBeChecked();
      expect(inputs[2]).not.toBeChecked();
      expect(inputs[3]).not.toBeChecked();
    });

    it("checks the matching variant when effort is selected", () => {
      render(<ModelEffortSelector {...defaultProps} selectedEffort={{ id: "medium", label: "Medium" }} />);
      fireEvent.click(q(".button")!);
      const inputs = qa('input[type="radio"]');
      expect(inputs[0]).not.toBeChecked();
      expect(inputs[1]).not.toBeChecked();
      expect(inputs[2]).toBeChecked();
      expect(inputs[3]).not.toBeChecked();
    });
  });

  describe("selecting Default", () => {
    it("calls onSelect with undefined, closes popover, calls onFocus", () => {
      const onSelect = vi.fn();
      const onFocus = vi.fn();
      render(
        <ModelEffortSelector
          {...defaultProps}
          onSelect={onSelect}
          onFocus={onFocus}
          selectedEffort={{ id: "low", label: "Low" }}
        />,
      );
      fireEvent.click(q(".button")!);
      fireEvent.click(qa(`.item`)[0]);
      expect(onSelect).toHaveBeenCalledWith(undefined);
      expect(q(".panel")).toBeNull();
      expect(onFocus).toHaveBeenCalledOnce();
    });
  });

  describe("selecting a variant", () => {
    it("calls onSelect with the variant, closes popover, calls onFocus", () => {
      const onSelect = vi.fn();
      const onFocus = vi.fn();
      render(<ModelEffortSelector {...defaultProps} onSelect={onSelect} onFocus={onFocus} />);
      fireEvent.click(q(".button")!);
      fireEvent.click(qa(`.item`)[2]);
      expect(onSelect).toHaveBeenCalledWith({ id: "medium", label: "Medium" });
      expect(q(".panel")).toBeNull();
      expect(onFocus).toHaveBeenCalledOnce();
    });
  });

  describe("keyboard interaction", () => {
    it("selects Default via radio click", () => {
      const onSelect = vi.fn();
      const onFocus = vi.fn();
      render(
        <ModelEffortSelector
          {...defaultProps}
          onSelect={onSelect}
          onFocus={onFocus}
          selectedEffort={{ id: "low", label: "Low" }}
        />,
      );
      fireEvent.click(q(".button")!);
      fireEvent.click(qa('input[type="radio"]')[0]);
      expect(onSelect).toHaveBeenCalledWith(undefined);
      expect(onFocus).toHaveBeenCalledOnce();
    });

    it("selects a variant via radio click", () => {
      const onSelect = vi.fn();
      const onFocus = vi.fn();
      render(<ModelEffortSelector {...defaultProps} onSelect={onSelect} onFocus={onFocus} />);
      fireEvent.click(q(".button")!);
      fireEvent.click(qa('input[type="radio"]')[3]);
      expect(onSelect).toHaveBeenCalledWith({ id: "high", label: "High" });
      expect(onFocus).toHaveBeenCalledOnce();
    });
  });

  describe("accessibility", () => {
    it("trigger has aria-label reflecting current selection", () => {
      render(<ModelEffortSelector {...defaultProps} />);
      expect(q(".button")?.getAttribute("aria-label")).toBe("Select effort: Default");
    });

    it("trigger aria-label shows selected effort", () => {
      render(<ModelEffortSelector {...defaultProps} selectedEffort={{ id: "high", label: "High" }} />);
      expect(q(".button")?.getAttribute("aria-label")).toBe("Select effort: High");
    });

    it("panel has radiogroup role", () => {
      render(<ModelEffortSelector {...defaultProps} />);
      fireEvent.click(q(".button")!);
      expect(q('[role="radiogroup"]')).toBeInTheDocument();
    });

    it("each item has a native radio input", () => {
      render(<ModelEffortSelector {...defaultProps} />);
      fireEvent.click(q(".button")!);
      const inputs = qa('input[type="radio"]');
      expect(inputs.length).toBe(4);
      expect(inputs[0]).toBeChecked();
      expect(inputs[1]).not.toBeChecked();
    });
  });
});
