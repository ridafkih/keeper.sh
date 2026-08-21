import type { CSSProperties, ReactNode } from "react";

interface CalendarFrameProps {
  /** Title, view switcher and paging controls; the header card's top row. */
  toolbar: ReactNode;
  /** The column labels (weekday / date row) that sit beneath the toolbar,
   * inside the header card, so they stay put while the grid scrolls. No
   * separator is drawn between the two; the slot owns its own lines. */
  columnHeader: ReactNode;
  /** Caps the grid's height (px). It still shrinks to fit short viewports,
   * but stops growing past this on tall ones — so a grid with a natural
   * height (24 hours) does not stretch past its content. */
  gridMaxHeight?: CSSProperties["maxHeight"];
  /** The grid itself; fills the space beneath the header card. */
  children: ReactNode;
}

/**
 * The calendar pane's chrome: a header card (toolbar over column labels)
 * stacked on a bare grid. The grid has no card of its own — like the
 * sidebar's sync status and event graph, it sits straight on the page
 * background, and each view fades its own rules out toward the edges so the
 * grid dissolves into the page instead of stopping at a border. The wrapper
 * carries `overflow-hidden` so a scrolling child is clipped to the pane, and
 * `min-h-0 flex-1` so that child can size itself.
 *
 * Each view renders its own frame, so switching views swaps the whole thing.
 * The header card, its rows and the grid carry `view-transition-name`s so
 * that, when the switch runs inside a view transition (see `CalendarView`),
 * the header card's height morphs between the two column headers and the
 * grid slides to meet it instead of both snapping.
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
      {/* `mx-px` insets the grid by the header card's border, so its columns
          share the column header's origin and width and the two line up. */}
      <div
        className="mx-px flex min-h-0 flex-1 flex-col overflow-hidden"
        style={{ maxHeight: gridMaxHeight, viewTransitionName: "calendar-grid" }}
      >
        {children}
      </div>
    </div>
  );
}
