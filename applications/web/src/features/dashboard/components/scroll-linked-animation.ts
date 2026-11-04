import { scroll } from "motion";
import { animate } from "motion/mini";

type ScrollAxis = "x" | "y";

interface ScrollLinkedAnimationOptions {
  axis: ScrollAxis;
  container: HTMLElement;
  keyframes: Record<string, string[]>;
  target: HTMLElement;
}

const linkAnimationToScroll = ({
  axis,
  container,
  keyframes,
  target,
}: ScrollLinkedAnimationOptions): (() => void) => {
  const animation = animate(target, keyframes, { ease: "linear" });
  const detach = scroll(animation, { axis, container });

  return () => {
    animation.cancel();
    detach();
  };
};

export { linkAnimationToScroll };
export type { ScrollLinkedAnimationOptions };
