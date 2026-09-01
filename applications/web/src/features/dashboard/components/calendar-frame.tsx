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
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-2xl border border-border-elevated shadow-xs">
      <header className="shrink-0 [view-transition-name:calendar-header]">
        {/* View transitions lift named elements into a flat overlay where the frame no longer clips them, so the filled ones round their own corners to the frame's radius less its border. */}
        <div className="flex items-center justify-between gap-3 rounded-t-[calc(var(--radius-2xl)-1px)] bg-background-elevated px-4 py-3 [view-transition-name:calendar-toolbar]">
          {toolbar}
        </div>
        <div className="relative [view-transition-name:calendar-column-header]">
          {/* Scoped to the column header rather than the whole header, so the fill starts dissolving right below the toolbar in both views. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-background-elevated mask-b-from-0%"
          />
          <div className="relative">{columnHeader}</div>
        </div>
      </header>
      <div
        className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-b-[calc(var(--radius-2xl)-1px)] [view-transition-name:calendar-grid]"
        style={{ maxHeight: gridMaxHeight }}
      >
        {children}
      </div>
    </div>
  );
}
