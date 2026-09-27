import type { SyncConflict } from "@keeper.sh/data-schemas";
import { HttpError } from "@/lib/fetcher";
import { resolveErrorMessage } from "@/utils/errors";
import { describeConflicts, type CalendarsById } from "./syncs";

const isConflictList = (value: unknown): value is SyncConflict[] =>
  Array.isArray(value) && value.every((item) => typeof item === "object" && item !== null && "syncName" in item);

export const resolveSyncError = (error: unknown, fallback: string, calendarsById: CalendarsById): string => {
  if (error instanceof HttpError && typeof error.body === "object" && error.body !== null && "conflicts" in error.body) {
    const { conflicts } = error.body;
    if (isConflictList(conflicts)) return describeConflicts(conflicts, calendarsById);
  }
  return resolveErrorMessage(error, fallback);
};
