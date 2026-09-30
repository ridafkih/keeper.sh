import type { SyncActivityEntry, SyncActivitySummary, SyncChange, SyncRunRecord } from "@keeper.sh/data-schemas";
import { pluralize } from "@/lib/pluralize";

export type ActivityKind = "all" | "runs" | "changes";

export interface ActivityFilter {
  kind: ActivityKind;
  calendarId: string | null;
}

export type ActivityItem =
  | { kind: "change"; id: string; at: Date; change: SyncChange }
  | { kind: "pass"; id: string; at: Date; runs: SyncRunRecord[] };

export interface ActivityDay {
  key: string;
  date: Date;
  items: ActivityItem[];
  added: number;
  removed: number;
}

const PASS_GAP_MS = 2 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

const startOfDay = (date: Date): Date => new Date(date.getFullYear(), date.getMonth(), date.getDate());

const matches = (entry: SyncActivityEntry, filter: ActivityFilter): boolean => {
  if (entry.kind === "change") return filter.kind !== "runs";
  if (filter.kind === "changes") return false;
  return filter.calendarId === null || entry.run.destinationCalendarId === filter.calendarId;
};

// Each destination logs its own run, so runs a moment apart read as one pass across the calendars.
export const groupActivity = (entries: readonly SyncActivityEntry[], filter: ActivityFilter): ActivityDay[] => {
  const days: ActivityDay[] = [];
  let passStart = 0;

  for (const entry of entries) {
    if (!matches(entry, filter)) continue;
    const at = new Date(entry.createdAt);
    const date = startOfDay(at);
    let day = days[days.length - 1];
    if (day?.date.getTime() !== date.getTime()) {
      day = { added: 0, date, items: [], key: date.toISOString(), removed: 0 };
      days.push(day);
    }

    if (entry.kind === "change") {
      day.items.push({ at, change: entry.change, id: entry.id, kind: "change" });
      continue;
    }

    day.added += entry.run.added;
    day.removed += entry.run.removed;
    const last = day.items[day.items.length - 1];
    const joinsPass = last?.kind === "pass"
      && passStart - at.getTime() <= PASS_GAP_MS
      && last.runs.every((run) => run.destinationCalendarId !== entry.run.destinationCalendarId);
    if (last?.kind === "pass" && joinsPass) {
      last.runs.push(entry.run);
    } else {
      day.items.push({ at, id: entry.id, kind: "pass", runs: [entry.run] });
    }
    passStart = at.getTime();
  }

  return days;
};

export const formatActivityDay = (date: Date, nowMs = Date.now()): string => {
  const days = Math.round((startOfDay(new Date(nowMs)).getTime() - date.getTime()) / DAY_MS);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", weekday: "long" });
};

export const formatActivityClock = (date: Date): string =>
  date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

const listNames = (names: readonly string[]): string => {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
};

export interface ActivitySentence {
  period: string;
  headline: string;
  detail: string;
}

export const describeActivitySummary = (
  summary: SyncActivitySummary,
  calendarNames: readonly string[],
  waitingOn: readonly string[],
): ActivitySentence => {
  const moved = [
    summary.added > 0 && `copied ${pluralize(summary.added, "event")}`,
    summary.removed > 0 && `removed ${pluralize(summary.removed, "copy", "copies")}`,
  ].filter(Boolean).join(" and ");
  const across = calendarNames.length > 3 ? ` across ${calendarNames.length} calendars` : calendarNames.length > 0 ? ` across ${listNames(calendarNames)}` : "";
  const headline = moved ? `${moved}${across}.` : "nothing needed copying.";

  const top = summary.skippedBy[0];
  const skipping = summary.skipped > 0 ? `Skipping ${pluralize(summary.skipped, "event")}${top ? `, mostly ${top.name.toLowerCase()}` : ""}.` : "";
  const waiting = waitingOn.length > 0 ? `${listNames(waitingOn)} ${waitingOn.length === 1 ? "is" : "are"} waiting on a reconnect.` : "";

  return { detail: [skipping, waiting].filter(Boolean).join(" "), headline, period: "In the last 7 days," };
};
