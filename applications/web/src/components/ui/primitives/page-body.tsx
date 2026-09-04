import type { PropsWithChildren } from "react";
import { cn } from "@/utils/cn";
import { ScrollFader } from "./scroll-fader";

// At lg the page fills the column and this body scrolls instead, so the header above it never rides an elastic bounce.
export function PageBody({ children, className }: PropsWithChildren<{ className?: string }>) {
  return (
    <div data-page-scroller className="lg:-mx-(--sidebar-pad-x) lg:-mb-(--sidebar-pad-b) lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-y-contain lg:px-(--sidebar-pad-x) lg:pb-(--sidebar-pad-b)">
      <ScrollFader>
        <div className={cn("flex flex-col", className)}>{children}</div>
      </ScrollFader>
    </div>
  );
}
