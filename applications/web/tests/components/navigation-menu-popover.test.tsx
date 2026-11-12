import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { NavigationMenuPopover } from "../../src/components/ui/composites/navigation-menu/navigation-menu-popover";
import { usePopover } from "../../src/components/ui/composites/navigation-menu/navigation-menu.contexts";
import { mountDom, type MountedDom } from "../helpers/mount-dom";

const { exit, omitMotionProps } = vi.hoisted(() => ({
  exit: { complete: null as (() => void) | null },
  omitMotionProps: <T extends Record<string, unknown>>(props: T) => {
    const domProps = { ...props };
    delete domProps.animate;
    delete domProps.exit;
    delete domProps.initial;
    delete domProps.transition;
    return domProps;
  },
}));

vi.mock("motion/react", () => ({
  AnimatePresence: ({ children, onExitComplete }: React.PropsWithChildren<{ onExitComplete?: () => void }>) => {
    exit.complete = onExitComplete ?? null;
    return <>{children}</>;
  },
  LazyMotion: ({ children }: React.PropsWithChildren) => <>{children}</>,
  useReducedMotion: () => false,
}));

vi.mock("motion/react-m", () => ({
  div: ({ children, ...props }: React.ComponentPropsWithoutRef<"div">) => <div {...omitMotionProps(props)}>{children}</div>,
}));

vi.mock("../../src/lib/motion-features", () => ({ loadMotionFeatures: async () => ({}) }));
vi.mock("../../src/hooks/use-popover-overlay", () => ({ useSetPopoverOverlay: () => () => null }));
vi.mock("../../src/lib/scroll-parent", () => ({ resolveScrollParent: () => null }));
vi.mock("../../src/lib/panel-placement", () => ({
  anchorMovesWithScroll: () => true,
  resolvePanelPlacement: () => ({ align: "center", delta: 0 }),
}));

function Options({ onAfterClose }: { onAfterClose: () => void }) {
  const { close, closeThen } = usePopover();
  return (
    <>
      <button type="button" data-option="then" onClick={() => closeThen(onAfterClose)}>Pick and then</button>
      <button type="button" data-option="plain" onClick={close}>Pick</button>
    </>
  );
}

let mounted: MountedDom | null = null;

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  exit.complete = null;
});

const render = () => {
  const onAfterClose = vi.fn();
  mounted = mountDom(
    <ul>
      <NavigationMenuPopover trigger={<span>All Calendars</span>}>
        <Options onAfterClose={onAfterClose} />
      </NavigationMenuPopover>
    </ul>,
  );
  Object.assign(globalThis.HTMLElement.prototype, {
    getBoundingClientRect: () => ({ bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0 }),
  });
  const container = mounted.container;
  const trigger = container.querySelector("button[aria-expanded]") as HTMLButtonElement;
  const option = (name: string) => container.querySelector(`[data-option='${name}']`) as HTMLButtonElement;
  const finishExit = () => act(() => exit.complete?.());
  return { finishExit, onAfterClose, option, trigger };
};

describe("NavigationMenuPopover", () => {
  it("exposes whether it is open and which panel it controls", () => {
    const { trigger } = render();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.hasAttribute("aria-controls")).toBe(false);

    mounted?.fire(trigger, "click");

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const panelId = trigger.getAttribute("aria-controls");
    expect(panelId && mounted?.container.querySelector(`[id='${panelId}']`)).toBeTruthy();
  });

  it("runs a closeThen callback once, after the panel has folded away", () => {
    const { finishExit, onAfterClose, option, trigger } = render();
    mounted?.fire(trigger, "click");
    mounted?.fire(option("then"), "click");

    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(onAfterClose).not.toHaveBeenCalled();
    finishExit();
    finishExit();
    expect(onAfterClose).toHaveBeenCalledTimes(1);
  });

  it("drops a queued callback when the panel is reopened before it finishes closing", () => {
    const { finishExit, onAfterClose, option, trigger } = render();
    mounted?.fire(trigger, "click");
    mounted?.fire(option("then"), "click");
    mounted?.fire(trigger, "click");
    mounted?.fire(option("plain"), "click");
    finishExit();

    expect(onAfterClose).not.toHaveBeenCalled();
  });

  it("returns focus to the trigger when it closes from inside the panel", () => {
    const { option, trigger } = render();
    const focus = vi.spyOn(trigger, "focus");
    mounted?.fire(trigger, "click");
    const picked = option("plain");
    Object.defineProperty(mounted?.document, "activeElement", { configurable: true, get: () => picked });

    mounted?.fire(picked, "click");

    expect(focus).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape", () => {
    const { trigger } = render();
    mounted?.fire(trigger, "click");
    if (!mounted) throw new Error("not mounted");
    mounted.fire(mounted.document, "keydown", { key: "Escape" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });
});
