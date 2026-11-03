import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { parseICalCalendarsToRemoteEvents } from "../../../../src/providers/caldav/shared/ics";

type EventOutcome = { end: string; start: string } | "unsupported";
type CalendarOutcome = Record<string, EventOutcome>;
type CorpusOutcome = Record<string, CalendarOutcome | { error: string }>;

const CORPUS_DIRECTORY = fileURLToPath(new URL(".", import.meta.url));

const listCorpusFiles = (): string[] =>
  readdirSync(CORPUS_DIRECTORY).filter((name) => name.endsWith(".ics")).toSorted();

const readCorpusFile = (name: string): string => readFileSync(join(CORPUS_DIRECTORY, name), "utf8");

const readCalendarOutcome = (icsStrings: string[]): CalendarOutcome => {
  const resources = parseICalCalendarsToRemoteEvents(icsStrings);
  const unsupportedUids = new Set(resources.unsupportedEvents.map(({ uid }) => uid));
  const outcome: CalendarOutcome = {};
  for (const event of resources.events) {
    if (unsupportedUids.has(event.uid)) {
      continue;
    }
    outcome[event.uid] = { end: event.endTime.toISOString(), start: event.startTime.toISOString() };
  }
  for (const uid of unsupportedUids) {
    outcome[uid] = "unsupported";
  }
  return outcome;
};

const readFileOutcome = (name: string): CalendarOutcome | { error: string } => {
  try {
    return readCalendarOutcome([readCorpusFile(name)]);
  } catch (error) {
    return { error: String(error) };
  }
};

const readCorpusOutcomes = (): CorpusOutcome =>
  Object.fromEntries(listCorpusFiles().map((name) => [name, readFileOutcome(name)]));

if (import.meta.main) {
  process.stdout.write(JSON.stringify(readCorpusOutcomes()));
}

export { CORPUS_DIRECTORY, listCorpusFiles, readCalendarOutcome, readCorpusFile, readCorpusOutcomes };
export type { CalendarOutcome, CorpusOutcome, EventOutcome };
