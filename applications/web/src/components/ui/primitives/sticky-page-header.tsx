import { useRef, type PropsWithChildren } from "react";
import { cn } from "@/utils/cn";
import { useScrolledFlag } from "@/hooks/use-scrolled-flag";

// Sits under the popover blur overlay (z-10) but above page content, and reaches up over the column's top padding
// (1rem on phones, all of it at lg) so it keeps that breathing room once stuck to the top.
// A tall header only pins where the body scrolls beside it; on phones it would cover much of the screen.
export function StickyPageHeader({ children, className, stickyFrom }: PropsWithChildren<{ className?: string; stickyFrom?: "lg" }>) {
  const ref = useRef<HTMLDivElement>(null);

  // The fade exists to soften content passing beneath the header, so it only earns its
  // place once something is actually under there; at rest it would wash out the first row.
  useScrolledFlag(ref);

  return (
    <div
      ref={ref}
      data-scrolled="false"
      className={cn(
        "sticky top-0 z-[5] -mt-4 flex flex-col bg-background pt-4 pb-1 after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-6 after:bg-linear-to-b after:from-background after:to-transparent after:opacity-0 after:transition-opacity data-[scrolled=true]:after:opacity-100 lg:-top-(--sidebar-pad-t) lg:-mx-(--sidebar-pad-x) lg:-mt-(--sidebar-pad-t) lg:px-(--sidebar-pad-x) lg:pt-(--sidebar-pad-t)",
        stickyFrom === "lg" && "max-lg:relative max-lg:after:hidden",
        className,
      )}
    >
      {children}
    </div>
  );
}
