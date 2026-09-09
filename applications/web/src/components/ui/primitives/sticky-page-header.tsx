import { useEffect, useRef, type PropsWithChildren } from "react";
import { cn } from "@/utils/cn";
import { resolveScrollParent } from "@/lib/scroll-parent";

// Sits under the popover blur overlay (z-10) but above page content, and reaches up over the column's top padding at lg.
export function StickyPageHeader({ children, className }: PropsWithChildren<{ className?: string }>) {
  const ref = useRef<HTMLDivElement>(null);

  // The fade exists to soften content passing beneath the header, so it only earns its
  // place once something is actually under there; at rest it would wash out the first row.
  useEffect(() => {
    let frame = 0;

    const update = () => {
      frame = 0;
      const element = ref.current;
      if (!element) return;
      const parent = resolveScrollParent(element);
      const offset = parent ? parent.scrollTop : window.scrollY;
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
  }, []);

  return (
    <div
      ref={ref}
      data-scrolled="false"
      className={cn(
        "sticky top-0 z-[5] flex flex-col bg-background pb-1 after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-6 after:bg-linear-to-b after:from-background after:to-transparent after:opacity-0 after:transition-opacity data-[scrolled=true]:after:opacity-100 lg:-top-(--sidebar-pad-t) lg:-mx-(--sidebar-pad-x) lg:-mt-(--sidebar-pad-t) lg:px-(--sidebar-pad-x) lg:pt-(--sidebar-pad-t)",
        className,
      )}
    >
      {children}
    </div>
  );
}
