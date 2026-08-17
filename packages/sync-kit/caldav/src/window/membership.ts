import { withinTimeWindow } from "@keeper.sh/sync-ical";
import type { EventTime, TimeWindow, WindowMembership } from "@keeper.sh/sync-protocol";

const withinCalDAVWindow: WindowMembership = (window: TimeWindow, time: EventTime): boolean =>
  withinTimeWindow(window, time);

export { withinCalDAVWindow };
