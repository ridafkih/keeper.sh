import type { PropsWithChildren } from "react";
import { cn } from "@/utils/cn";
import { ScrollFader } from "./scroll-fader";

// At lg the page fills the column and this body scrolls instead, so the header above it never rides an elastic bounce.
// A column with a neighbour sets --page-body-bleed-end to keep the scrollbar off that neighbour.
export function PageBody({ children, className }: PropsWithChildren<{ className?: string }>) {
  return (
    <div data-page-scroller className="lg:-ms-(--sidebar-pad-x) lg:-me-[var(--page-body-bleed-end,var(--sidebar-pad-x))] lg:-mb-(--sidebar-pad-b) lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-y-contain lg:ps-(--sidebar-pad-x) lg:pe-[var(--page-body-bleed-end,var(--sidebar-pad-x))] lg:pb-(--sidebar-pad-b)">
      <ScrollFader>
        <div className={cn("flex flex-col", className)}>{children}</div>
      </ScrollFader>
    </div>
  );
}
