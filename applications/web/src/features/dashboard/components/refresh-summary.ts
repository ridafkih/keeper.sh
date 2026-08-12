import { pluralize } from "@/lib/pluralize";

interface RefreshCounts {
  added: number;
  revived: number;
  unavailable: number;
}

interface SetupSearchForNewCalendars {
  step: "rename";
  id: string;
}

function buildChangeClauses({ added, revived }: RefreshCounts): string[] {
  const clauses: string[] = [];

  if (added > 0) {
    clauses.push(`Found ${pluralize(added, "new calendar")}.`);
  }
  if (revived > 0) {
    clauses.push(`${pluralize(revived, "calendar")} ${revived === 1 ? "is" : "are"} available again.`);
  }

  return clauses;
}

export function formatRefreshSummary(counts: RefreshCounts): string {
  const clauses = buildChangeClauses(counts);

  if (counts.unavailable > 0) {
    clauses.push(
      `${pluralize(counts.unavailable, "calendar")} ${counts.unavailable === 1 ? "is" : "are"} no longer available.`,
    );
  }

  if (clauses.length === 0) {
    return "No new calendars found.";
  }

  return clauses.join(" ");
}

export function buildSetupSearchForNewCalendars(
  calendarIds: string[],
): SetupSearchForNewCalendars | null {
  if (calendarIds.length === 0) return null;

  return { id: calendarIds.join(","), step: "rename" };
}
