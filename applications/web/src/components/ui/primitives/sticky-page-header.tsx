import type { PropsWithChildren } from "react";
import { cn } from "@/utils/cn";

// Sits under the popover blur overlay (z-10) but above page content, and reaches up over the column's top padding at lg.
export function StickyPageHeader({ children, className }: PropsWithChildren<{ className?: string }>) {
  return (
    <div
      className={cn(
        "sticky top-0 z-[5] flex flex-col bg-background pb-1 after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-6 after:bg-linear-to-b after:from-background after:to-transparent lg:-top-(--sidebar-pad-t) lg:-mx-(--sidebar-pad-x) lg:-mt-(--sidebar-pad-t) lg:px-(--sidebar-pad-x) lg:pt-(--sidebar-pad-t)",
        className,
      )}
    >
      {children}
    </div>
  );
}
