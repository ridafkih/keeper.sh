import { describe, expect, it } from "vitest";
import { fixtureManifest, getFixturePath } from "@keeper.sh/fixtures";
import { parseICalToRemoteEvent } from "../../../../src/providers/caldav/shared/ics";

const enabledFixtures = fixtureManifest.filter((fixtureSource) => fixtureSource.enabled !== false);

describe("parseICalToRemoteEvent fixtures", () => {
  for (const fixtureSource of enabledFixtures) {
    it(`parses first event from ${fixtureSource.id}`, async () => {
      const fixturePath = getFixturePath(fixtureSource);
      const icsString = await Bun.file(fixturePath).text();

      const parsedEvent = parseICalToRemoteEvent(icsString);

      expect(parsedEvent).not.toBeNull();
      if (!parsedEvent) {
        throw new Error(`Expected parsed event for fixture ${fixtureSource.id}`);
      }

      expect(parsedEvent.uid.length).toBeGreaterThan(0);
      expect(Number.isNaN(parsedEvent.startTime.getTime())).toBe(false);
      expect(Number.isNaN(parsedEvent.endTime.getTime())).toBe(false);
      expect(parsedEvent.endTime.getTime()).toBeGreaterThanOrEqual(parsedEvent.startTime.getTime());
    });
  }
});
