import { describe, expect, it } from "bun:test";
import { fixtureManifest, getFixturePath } from "@keeper.sh/fixtures";
import { diffEvents } from "../../../src/ics/utils/diff-events";
import { parseIcsCalendar } from "../../../src/ics/utils/parse-ics-calendar";
import { parseIcsEvents } from "../../../src/ics/utils/parse-ics-events";
import type { StoredEventTimeSlot } from "../../../src/ics/utils/types";

const enabledFixtures = fixtureManifest.filter((fixtureSource) => fixtureSource.enabled !== false);

const recurrenceSignalPattern = /^RRULE:|^EXDATE|^RECURRENCE-ID/m;

describe("ics fixtures parsing", () => {
  for (const fixtureSource of enabledFixtures) {
    it(`parses ${fixtureSource.id}`, async () => {
      const fixturePath = getFixturePath(fixtureSource);
      const icsString = await Bun.file(fixturePath).text();

      const parsedCalendar = parseIcsCalendar({ icsString });
      const parsedEvents = parseIcsEvents(parsedCalendar);

      expect(parsedEvents.length).toBeGreaterThan(0);

      if (fixtureSource.expected?.containsTimeZone) {
        const hasTimeZone = parsedEvents.some((event) => Boolean(event.startTimeZone));
        expect(hasTimeZone).toBe(true);
      }

      if (fixtureSource.expected?.containsRecurrence) {
        const hasRecurrenceSignal = recurrenceSignalPattern.test(icsString);
        expect(hasRecurrenceSignal).toBe(true);
      }
    });
  }
});

describe("ics fixtures diff stability", () => {
  for (const fixtureSource of enabledFixtures) {
    it(`produces no diff for equivalent stored events in ${fixtureSource.id}`, async () => {
      const fixturePath = getFixturePath(fixtureSource);
      const icsString = await Bun.file(fixturePath).text();

      const parsedCalendar = parseIcsCalendar({ icsString });
      const parsedEvents = parseIcsEvents(parsedCalendar);

      const storedEvents: StoredEventTimeSlot[] = parsedEvents.map((event, index) => ({
        ...event,
        id: `${fixtureSource.id}-stored-${index}`,
      }));

      const diff = diffEvents(parsedEvents, storedEvents);
      expect(diff.toAdd).toHaveLength(0);
      expect(diff.toRemove).toHaveLength(0);
    });
  }
});
