import type { SyncCalendars, SyncSummary } from "@keeper.sh/data-schemas";

const BASE = "This removes the account and all its calendars from Keeper.sh.";
const UNKNOWN_SYNCS = `${BASE} Any syncs using them stop copying to and from them.`;

const listNames = (names: string[]): string => {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
};

const calendarIdsOf = (sync: SyncCalendars): string[] =>
  [...sync.sourceCalendarIds, ...sync.destinationCalendarIds, ...sync.memberCalendarIds];

const leftShort = (sync: SyncCalendars, removed: ReadonlySet<string>): boolean => {
  const remaining = (ids: string[]) => ids.filter((id) => !removed.has(id)).length;
  if (sync.mode === "both_ways") return remaining(sync.memberCalendarIds) < 2;
  return remaining(sync.sourceCalendarIds) === 0 || remaining(sync.destinationCalendarIds) === 0;
};

// Names the syncs that lose calendars, and which of them can no longer run at all.
export const describeAccountRemoval = (
  syncs: readonly SyncSummary[] | undefined,
  calendarIds: readonly string[],
): string => {
  if (!syncs) return UNKNOWN_SYNCS;
  const removed = new Set(calendarIds);
  const affected = syncs.filter((sync) => calendarIdsOf(sync).some((id) => removed.has(id)));
  if (affected.length === 0) return BASE;

  const sentences = [BASE];
  let stops = "stop";
  if (affected.length === 1) stops = "stops";
  sentences.push(`${listNames(affected.map((sync) => sync.name))} ${stops} copying to and from them.`);

  const broken = affected.filter((sync) => leftShort(sync, removed));
  let verb = "are";
  if (broken.length === 1) verb = "is";
  if (broken.length > 0) sentences.push(`${listNames(broken.map((sync) => sync.name))} ${verb} left without enough calendars to run.`);
  return sentences.join(" ");
};
