import type { CSSProperties, ReactNode } from "react";

interface CalendarFrameProps {
  toolbar: ReactNode;
  columnHeader: ReactNode;
  gridMaxHeight?: CSSProperties["maxHeight"];
  children: ReactNode;
}

export function CalendarFrame({
  toolbar,
  columnHeader,
  gridMaxHeight,
  children,
}: CalendarFrameProps) {
  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-1.5">
      <header
        className="flex shrink-0 flex-col overflow-hidden rounded-2xl border border-border-elevated bg-background-elevated shadow-xs"
        style={{ viewTransitionName: "calendar-header" }}
      >
        <div
          className="flex items-center justify-between gap-3 px-4 py-3"
          style={{ viewTransitionName: "calendar-toolbar" }}
        >
          {toolbar}
        </div>
        <div style={{ viewTransitionName: "calendar-column-header" }}>{columnHeader}</div>
      </header>
      {/* `mx-px` insets the grid by the header card's border so their columns line up. */}
      <div
        className="mx-px flex min-h-0 flex-1 flex-col overflow-hidden"
        style={{ maxHeight: gridMaxHeight, viewTransitionName: "calendar-grid" }}
      >
        {children}
      </div>
    </div>
  );
}
