import { afterEach, describe, expect, it, vi } from "vitest";
import { SegmentedControl } from "../../src/components/ui/primitives/segmented-control";
import { mountDom, type MountedDom } from "../helpers/mount-dom";

const OPTIONS = [
  { label: "Setup", value: "setup" },
  { label: "Activity", value: "activity" },
  { label: "Rules", value: "rules" },
] as const;

let mounted: MountedDom | null = null;

afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

const render = (value: string, onChange: (value: string) => void) => {
  mounted = mountDom(<SegmentedControl label="View" options={[...OPTIONS]} value={value} onChange={onChange} />);
  return [...mounted.container.querySelectorAll("button")] as HTMLButtonElement[];
};

describe("SegmentedControl", () => {
  it("keeps only the checked segment in the tab order", () => {
    const buttons = render("activity", () => null);
    expect(buttons.map((button) => button.getAttribute("tabindex"))).toEqual(["-1", "0", "-1"]);
    expect(buttons.map((button) => button.getAttribute("aria-checked"))).toEqual(["false", "true", "false"]);
  });

  it("moves and selects with the arrow keys, wrapping at the ends", () => {
    const onChange = vi.fn();
    const buttons = render("rules", onChange);
    const focus = vi.spyOn(buttons[0], "focus");

    const event = mounted?.fire(buttons[2], "keydown", { key: "ArrowRight" });

    expect(event?.defaultPrevented).toBe(true);
    expect(onChange).toHaveBeenCalledWith("setup");
    expect(focus).toHaveBeenCalled();

    mounted?.fire(buttons[2], "keydown", { key: "ArrowUp" });
    expect(onChange).toHaveBeenLastCalledWith("activity");
  });

  it("jumps with Home and End and ignores other keys", () => {
    const onChange = vi.fn();
    const buttons = render("activity", onChange);

    mounted?.fire(buttons[1], "keydown", { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith("rules");
    mounted?.fire(buttons[1], "keydown", { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith("setup");

    const other = mounted?.fire(buttons[1], "keydown", { key: "a" });
    expect(other?.defaultPrevented).toBe(false);
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});
