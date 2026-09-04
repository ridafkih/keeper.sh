import type { PropsWithChildren } from "react";
import { cn } from "@/utils/cn";
import { ScrollFader } from "./scroll-fader";

// At lg the page fills the column and this body scrolls instead, so the header above it never rides an elastic bounce.
export function PageBody({ children, className }: PropsWithChildren<{ className?: string }>) {
  return (
    <div className="lg:-mx-1 lg:-mb-12 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-y-contain lg:px-1 lg:pb-12">
      <ScrollFader>
        <div className={cn("flex flex-col", className)}>{children}</div>
      </ScrollFader>
    </div>
  );
}
