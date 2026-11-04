type FirstSyncOutcome = "copied" | "destination-rejected" | "nothing-to-copy" | "source-empty";

interface FirstSyncReport {
  awaitingSourceCalendarIds: string[];
  completedSourceCalendarIds: string[];
  eventsAdded: number;
  eventsAddFailed: number;
  rejectedSourceCalendarIds: string[];
  sourceEventCounts: ReadonlyMap<string, number>;
}

const countEventsBySource = (events: { calendarId: string }[]): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const { calendarId } of events) {
    counts.set(calendarId, (counts.get(calendarId) ?? 0) + 1);
  }
  return counts;
};

const resolveFirstSyncOutcome = (
  report: FirstSyncReport,
  emptySourceCalendarIds: string[],
): FirstSyncOutcome | null => {
  if (report.rejectedSourceCalendarIds.length > 0) {
    return "destination-rejected";
  }
  if (report.completedSourceCalendarIds.length === 0) {
    return null;
  }
  if (report.eventsAdded > 0) {
    return "copied";
  }
  if (emptySourceCalendarIds.length === report.completedSourceCalendarIds.length) {
    return "source-empty";
  }
  return "nothing-to-copy";
};

const describeFirstSync = (report: FirstSyncReport): Record<string, number | string> => {
  const emptySourceCalendarIds = report.completedSourceCalendarIds
    .filter((calendarId) => (report.sourceEventCounts.get(calendarId) ?? 0) === 0);
  const outcome = resolveFirstSyncOutcome(report, emptySourceCalendarIds);
  const fields: Record<string, number | string> = {};
  if (report.awaitingSourceCalendarIds.length > 0) {
    fields["first_sync.awaiting_source_count"] = report.awaitingSourceCalendarIds.length;
    fields["first_sync.awaiting_source_calendar_ids"] = report.awaitingSourceCalendarIds.join(",");
  }
  if (!outcome) {
    return fields;
  }
  fields["first_sync.outcome"] = outcome;
  if (outcome === "destination-rejected") {
    fields["first_sync.rejected_count"] = report.rejectedSourceCalendarIds.length;
    fields["first_sync.rejected_source_calendar_ids"] = report.rejectedSourceCalendarIds.join(",");
    fields["first_sync.events_add_failed"] = report.eventsAddFailed;
    return fields;
  }
  fields["first_sync.completed_count"] = report.completedSourceCalendarIds.length;
  fields["first_sync.completed_source_calendar_ids"] = report.completedSourceCalendarIds.join(",");
  fields["first_sync.events_added"] = report.eventsAdded;
  fields["first_sync.source_events_in_window"] = report.completedSourceCalendarIds
    .reduce((total, calendarId) => total + (report.sourceEventCounts.get(calendarId) ?? 0), 0);
  if (emptySourceCalendarIds.length > 0) {
    fields["first_sync.empty_source_calendar_ids"] = emptySourceCalendarIds.join(",");
  }
  return fields;
};

export {
  countEventsBySource,
  describeFirstSync,
};
export type { FirstSyncReport };
