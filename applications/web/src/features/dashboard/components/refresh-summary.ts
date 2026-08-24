import { type } from "arktype";
import { pluralize } from "@/lib/pluralize";

const refreshCalendarsResponseSchema = type({
  accounts: "number",
  added: "number",
  cooldownSeconds: "number",
  failed: "number",
  revived: "number",
  unavailable: "number",
});

type RefreshCalendarsResponse = typeof refreshCalendarsResponseSchema.infer;

interface RefreshCounts {
  added: number;
  revived: number;
  unavailable: number;
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

export function formatRefreshFailures(failed: number): string | null {
  if (failed === 0) return null;

  return `${pluralize(failed, "account")} could not be refreshed. Open the account to reconnect it.`;
}

export { refreshCalendarsResponseSchema };
export type { RefreshCalendarsResponse };
