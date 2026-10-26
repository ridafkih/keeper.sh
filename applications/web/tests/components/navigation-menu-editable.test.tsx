import { afterEach, describe, expect, it, vi } from "vitest";
import { NavigationMenuEditableItem } from "../../src/components/ui/composites/navigation-menu/navigation-menu-editable";
import { mountDom, type MountedDom } from "../helpers/mount-dom";

let mounted: MountedDom | null = null;

afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

const renderRow = ({ value = "", defaultEditing = true } = {}) => {
  const onCommit = vi.fn();
  const onCancel = vi.fn();
  const onRemove = vi.fn();
  mounted = mountDom(
    <ul>
      <NavigationMenuEditableItem
        label="Title Contains"
        value={value}
        defaultEditing={defaultEditing}
        trailing={<button type="button" aria-label="Remove" onClick={onRemove}>x</button>}
        onCancel={onCancel}
        onCommit={onCommit}
      />
    </ul>,
  );
  const find = (selector: string) => {
    const element = mounted?.container.querySelector(selector);
    if (!element) throw new Error(`Missing ${selector}`);
    return element as HTMLElement;
  };
  return { find, onCancel, onCommit, onRemove };
};

describe("NavigationMenuEditableItem", () => {
  it("keeps the input focused when the trailing remove is pressed, so the click removes instead of saving", () => {
    const { find, onCommit, onRemove } = renderRow();
    const input = find("input") as HTMLInputElement;
    input.value = "Standup";
    const remove = find("[aria-label='Remove']");

    const press = mounted?.fire(remove, "mousedown");
    mounted?.fire(remove, "click");

    expect(press?.defaultPrevented).toBe(true);
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("leaves the trailing control alone when the row isn't being edited", () => {
    const { find } = renderRow({ defaultEditing: false, value: "Standup" });
    expect(mounted?.fire(find("[aria-label='Remove']"), "mousedown").defaultPrevented).toBe(false);
  });

  it("keeps the same trailing element when editing ends, so its focus survives", async () => {
    const { find, onCommit } = renderRow();
    const remove = find("[aria-label='Remove']");
    const input = find("input") as HTMLInputElement;
    input.value = "Standup";

    mounted?.fire(input, "focusin");
    mounted?.fire(input, "keydown", { key: "Enter" });
    await mounted?.flush();

    expect(onCommit).toHaveBeenCalledWith("Standup");
    expect(mounted?.container.querySelector("input")).toBeNull();
    expect(find("[aria-label='Remove']")).toBe(remove);
  });

  it("cancels on Escape and on a blur with nothing typed", () => {
    const first = renderRow();
    mounted?.fire(first.find("input"), "focusin");
    mounted?.fire(first.find("input"), "keydown", { key: "Escape" });
    expect(first.onCancel).toHaveBeenCalledTimes(1);
    expect(first.onCommit).not.toHaveBeenCalled();
    mounted?.unmount();

    const second = renderRow();
    mounted?.fire(second.find("input"), "focusin");
    mounted?.fire(second.find("input"), "focusout");
    expect(second.onCancel).toHaveBeenCalledTimes(1);
    expect(second.onCommit).not.toHaveBeenCalled();
  });
});
