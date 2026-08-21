import type { CSSProperties, ReactNode } from "react";

interface CalendarFrameProps {
  /** Title, view switcher and paging controls; the header card's top row. */
  toolbar: ReactNode;
  /** The column labels (weekday / date row) that sit beneath the toolbar,
   * inside the header card, so they stay put while the grid scrolls. No
   * separator is drawn between the two; the slot owns its own lines. */
  columnHeader: ReactNode;
  /** Caps the grid card's content height (px). The card still shrinks to fit
   * short viewports, but stops growing past this on tall ones — so a grid with
   * a natural height (24 hours) is not left floating in empty card. */
  gridMaxHeight?: CSSProperties["maxHeight"];
  /** The grid itself; fills the second card. */
  children: ReactNode;
}

/**
 * The calendar pane's chrome: a header card (toolbar over column labels)
 * stacked on a grid card, matching the sidebar's card rhythm. The grid card
 * carries `overflow-hidden` + `isolate` so a scrolling child is clipped to its
 * rounded corners, and `min-h-0 flex-1` so that child can size itself.
 *
 * Each view renders its own frame, so switching views swaps the whole thing.
 * The cards and the header's rows carry `view-transition-name`s so that, when
 * the switch runs inside a view transition (see `CalendarView`), the header
 * card's height morphs between the two column headers and the grid card
 * slides to meet it instead of both snapping.
 */
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
      {/* `box-content` so `gridMaxHeight` measures the content, not the border. */}
      <div
        className="box-content flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border-elevated bg-background-elevated shadow-xs isolate"
        style={{ maxHeight: gridMaxHeight, viewTransitionName: "calendar-grid" }}
      >
        {children}
      </div>
    </div>
  );
}
