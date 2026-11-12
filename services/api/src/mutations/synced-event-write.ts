import { isKeeperEvent } from "@keeper.sh/calendar";
import type { ResolvedEventCredentials } from "./resolve-credentials";

const resolveSyncedEventWriteError = (
  resolved: Pick<ResolvedEventCredentials, "isRecurring" | "occurrenceStart" | "sourceEventUid">,
): string | null => {
  if (resolved.isRecurring || resolved.occurrenceStart) {
    return "Recurring events from a connected calendar cannot be modified yet.";
  }

  if (!resolved.sourceEventUid) {
    return "Event cannot be modified (no source UID).";
  }

  if (isKeeperEvent(resolved.sourceEventUid)) {
    return "This event is a copy kept in sync by Keeper.sh. Modify the original event instead.";
  }

  return null;
};

export { resolveSyncedEventWriteError };
