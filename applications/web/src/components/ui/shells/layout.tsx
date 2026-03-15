import type { PropsWithChildren } from "react";
import { cn } from "@/utils/cn";

const GRID_COLS = "grid grid-cols-[minmax(1rem,1fr)_minmax(auto,48rem)_minmax(1rem,1fr)]";

export function Layout({ children }: PropsWithChildren) {
  return (
    <div className={cn(GRID_COLS, "auto-rows-min size-full")}>
      {children}
    </div>
  )
}

export function LayoutItem({ children }: PropsWithChildren) {
  return (
    <div className="contents *:col-[2/span_1]">{children}</div>
  )
}

export function LayoutRow({ children, className }: PropsWithChildren<{ className?: string }>) {
  return (
    <div className={cn(GRID_COLS, className)}>
      <div className="col-[2/span_1]">{children}</div>
    </div>
  )
}
