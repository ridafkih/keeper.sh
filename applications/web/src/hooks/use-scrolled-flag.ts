import { useEffect, type RefObject } from "react";
import { resolveScrollParent } from "@/lib/scroll-parent";

// Marks the element with data-scrolled once anything has scrolled beneath it, in its scroll parent or a sibling page body.
export function useScrolledFlag(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    let frame = 0;

    const update = () => {
      frame = 0;
      const element = ref.current;
      if (!element) return;
      const parent = resolveScrollParent(element);
      const body = element.parentElement?.querySelector<HTMLElement>("[data-page-scroller]");
      const offset = (parent ? parent.scrollTop : window.scrollY) + (body?.scrollTop ?? 0);
      element.dataset.scrolled = offset > 0 ? "true" : "false";
    };

    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(update);
    };

    update();
    // Scroll events don't bubble, so the capture phase is what sees the column or the window scrolling.
    window.addEventListener("scroll", schedule, { capture: true, passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule, { capture: true });
      window.removeEventListener("resize", schedule);
    };
  }, [ref]);
}
