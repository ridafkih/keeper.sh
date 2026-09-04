import type { PropsWithChildren } from "react";
import { cn } from "@/utils/cn";

// Sits under the popover blur overlay (z-10) but above page content, and reaches up over the column's top padding at lg.
export function StickyPageHeader({ children, className }: PropsWithChildren<{ className?: string }>) {
  return (
    <div
      className={cn(
        "sticky top-0 z-[5] flex flex-col bg-background pb-1 after:absolute after:inset-x-0 after:top-full after:h-6 after:bg-linear-to-b after:from-background after:to-transparent lg:-top-6 lg:-mx-1 lg:-mt-6 lg:px-1 lg:pt-6",
        className,
      )}
    >
      {children}
    </div>
  );
}
