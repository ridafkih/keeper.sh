import { describe, expect, it, vi } from "vitest";

const NOT_RENDERED = "Failed to execute 'commitStyles' on 'Animation': Target element is not rendered.";

vi.mock("motion", () => ({
  scroll: (animation: { attachTimeline: (options: unknown) => () => void }) =>
    animation.attachTimeline({
      observe: () => () => {},
      timeline: globalThis.undefined,
    }),
}));

const { linkAnimationToScroll } = await import(
  "../../../../src/features/dashboard/components/scroll-linked-animation"
);

interface FakeWebAnimation {
  playState: AnimationPlayState;
  cancel: () => void;
  commitStyles: () => void;
  pause: () => void;
  play: () => void;
}

const createHiddenTarget = (): HTMLElement => {
  const webAnimation: FakeWebAnimation = {
    playState: "running",
    cancel: () => {
      webAnimation.playState = "idle";
    },
    commitStyles: () => {
      throw new DOMException(NOT_RENDERED, "InvalidStateError");
    },
    pause: () => {
      webAnimation.playState = "paused";
    },
    play: () => {
      webAnimation.playState = "running";
    },
  };

  return Object.assign(new EventTarget(), {
    animate: () => webAnimation,
    isConnected: true,
    style: {},
  }) as unknown as HTMLElement;
};

describe("linkAnimationToScroll", () => {
  it("tears down without committing styles to a target that is no longer rendered", () => {
    const teardown = linkAnimationToScroll({
      axis: "x",
      container: {} as HTMLElement,
      keyframes: { transform: ["translateX(0%)", "translateX(-50%)"] },
      target: createHiddenTarget(),
    });

    expect(teardown).not.toThrow();
  });
});
