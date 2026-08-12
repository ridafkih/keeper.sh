import { getDatabaseErrorObservability } from "./ingest-observability";

interface MissingCalendarFailure {
  disableCalendar: false;
  retriable: true;
  slug: "provider-calendar-not-found";
}

const hasNotFoundStatus = (error: Error): boolean =>
  "status" in error && error.status === 404;

const resolveMissingCalendarFailure = (error: unknown): MissingCalendarFailure | null => {
  if (
    !(error instanceof Error)
    || getDatabaseErrorObservability(error)
    || (!hasNotFoundStatus(error) && !error.message.includes("404"))
  ) {
    return null;
  }

  return {
    disableCalendar: false,
    retriable: true,
    slug: "provider-calendar-not-found",
  };
};

export { resolveMissingCalendarFailure };
export type { MissingCalendarFailure };
