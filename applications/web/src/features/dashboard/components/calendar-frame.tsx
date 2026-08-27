import type { CSSProperties, ReactNode } from "react";

interface CalendarFrameProps {
  toolbar: ReactNode;
  columnHeader: ReactNode;
  gridMaxHeight?: CSSProperties["maxHeight"];
  children: ReactNode;
}

// Scoped to the column header rather than the whole header, so the fill starts dissolving right below the toolbar in both views.
const HEADER_SURFACE_FADE = "linear-gradient(to bottom, black, transparent)";

export function CalendarFrame({
  toolbar,
  columnHeader,
  gridMaxHeight,
  children,
}: CalendarFrameProps) {
  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-2xl border border-border-elevated shadow-xs">
      <header className="shrink-0" style={{ viewTransitionName: "calendar-header" }}>
        <div
          className="flex items-center justify-between gap-3 bg-background-elevated px-4 py-3"
          style={{ viewTransitionName: "calendar-toolbar" }}
        >
          {toolbar}
        </div>
        <div className="relative" style={{ viewTransitionName: "calendar-column-header" }}>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-background-elevated"
            style={{ maskImage: HEADER_SURFACE_FADE, WebkitMaskImage: HEADER_SURFACE_FADE }}
          />
          <div className="relative">{columnHeader}</div>
        </div>
      </header>
      <div
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
        style={{ maxHeight: gridMaxHeight, viewTransitionName: "calendar-grid" }}
      >
        {children}
      </div>
    </div>
  );
}
