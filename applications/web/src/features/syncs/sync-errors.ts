import { readApiErrorMessage } from "@keeper.sh/data-schemas";
import type { SyncConflict } from "@keeper.sh/data-schemas";
import { HttpError } from "@/lib/fetcher";
import { describeConflicts, type CalendarsById } from "./syncs";

export const STALE_SYNC_MESSAGE = "This sync changed somewhere else since you opened it. The latest version is loaded under your edits; check them and save again.";

const isConflictList = (value: unknown): value is SyncConflict[] =>
  Array.isArray(value) && value.every((item) => typeof item === "object" && item !== null && "syncName" in item);

const bodyOf = (error: unknown): Record<string, unknown> | null =>
  error instanceof HttpError && typeof error.body === "object" && error.body !== null ? { ...error.body } : null;

export const isStaleSyncError = (error: unknown): boolean =>
  error instanceof HttpError && error.status === 409 && bodyOf(error)?.stale === true;

export const resolveSyncError = (error: unknown, fallback: string, calendarsById: CalendarsById): string => {
  if (!(error instanceof HttpError)) return fallback;
  const body = bodyOf(error);
  if (error.status === 409 && body?.stale === true) return STALE_SYNC_MESSAGE;
  const conflicts = body?.conflicts;
  if (error.status === 409 && isConflictList(conflicts) && conflicts.length > 0) return describeConflicts(conflicts, calendarsById);
  if (error.status === 404) return "This sync no longer exists. It may have been deleted somewhere else.";
  const message = readApiErrorMessage(error.body);
  if (error.status === 403) return message ?? "Your plan doesn't include this change.";
  if (error.status === 400) return message ?? "Keeper couldn't accept this sync. Check its calendars and rules.";
  return message ?? fallback;
};
