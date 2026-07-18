import { describe, expect, it } from "vitest";

import { resolveEventReadModel } from "../../src/queries/get-event";
import type {
  EventReadRepository,
  SyncedEventOwner,
} from "../../src/queries/get-event";
import { projectSyncedEvents } from "../../src/queries/event-read-model";
import type { KeeperEvent } from "../../src/types";

const USER_ID = "user-1";
const MASTER_ID = "019c0000-0000-7000-8000-000000000001";
const OVERRIDE_ID = "019c0000-0000-7000-8000-000000000002";
const USER_EVENT_ID = "019c0000-0000-7000-8000-000000000003";
const CALENDAR_ID = "019c0000-0000-7000-8000-000000000004";

const master: SyncedEventOwner = {
  availability: "busy",
  calendarId: CALENDAR_ID,
  calendarName: "Source",
  calendarProvider: "google",
  calendarUrl: null,
  description: "Description",
  endTime: new Date("2026-03-02T11:00:00.000Z"),
  exceptionDates: null,
  id: MASTER_ID,
  isAllDay: false,
  location: "Location",
  recurrenceId: null,
  recurrenceRule: JSON.stringify({ count: 3, frequency: "WEEKLY" }),
  sourceEventUid: "series-1",
  startTime: new Date("2026-03-02T10:00:00.000Z"),
  startTimeZone: "Etc/UTC",
  title: "Master",
};

const detachedOverride: SyncedEventOwner = {
  ...master,
  description: "Moved occurrence",
  endTime: new Date("2026-03-10T13:00:00.000Z"),
  id: OVERRIDE_ID,
  recurrenceId: new Date("2026-03-09T10:00:00.000Z"),
  recurrenceRule: null,
  startTime: new Date("2026-03-10T12:00:00.000Z"),
  title: "Override",
};

const sourceMap = new Map([
  [
    CALENDAR_ID,
    {
      name: master.calendarName,
      provider: master.calendarProvider,
      url: master.calendarUrl,
      userId: USER_ID,
    },
  ],
]);

interface RepositoryFixture {
  owner?: SyncedEventOwner | null;
  seriesRows?: SyncedEventOwner[];
  userEvent?: KeeperEvent | null;
}

interface RepositoryCalls {
  series: number;
  synced: number;
  user: number;
}

const createRepository = (
  fixture: RepositoryFixture,
): { calls: RepositoryCalls; repository: EventReadRepository } => {
  const calls: RepositoryCalls = { series: 0, synced: 0, user: 0 };
  const repository: EventReadRepository = {
    getSeriesRows: () => {
      calls.series += 1;
      return Promise.resolve(fixture.seriesRows ?? []);
    },
    getSyncedOwner: () => {
      calls.synced += 1;
      return Promise.resolve(fixture.owner ?? null);
    },
    getUserEvent: () => {
      calls.user += 1;
      return Promise.resolve(fixture.userEvent ?? null);
    },
  };
  return { calls, repository };
};

const getFirstGeneratedOccurrence = () => {
  const occurrences = projectSyncedEvents(
    [master],
    sourceMap,
    new Date("2026-03-01T00:00:00.000Z"),
    new Date("2026-03-31T23:59:59.999Z"),
  );
  const [occurrence] = occurrences;
  if (!occurrence) {
    throw new Error("Expected a generated occurrence");
  }
  return occurrence;
};

describe("resolveEventReadModel", () => {
  it("round-trips the exact recurring occurrence returned by a range read", async () => {
    const listedOccurrence = getFirstGeneratedOccurrence();
    const { repository } = createRepository({ owner: master, seriesRows: [master] });

    const resolved = await resolveEventReadModel(repository, USER_ID, listedOccurrence.id);

    expect(resolved).toMatchObject({
      endTime: listedOccurrence.endTime.toISOString(),
      eventStateId: MASTER_ID,
      id: listedOccurrence.id,
      startTime: listedOccurrence.startTime.toISOString(),
      title: "Master",
    });
  });

  it("round-trips a legacy recurring master without a stored source UID", async () => {
    const legacyMaster: SyncedEventOwner = { ...master, sourceEventUid: null };
    const [listedOccurrence] = projectSyncedEvents(
      [legacyMaster],
      sourceMap,
      new Date("2026-03-01T00:00:00.000Z"),
      new Date("2026-03-31T23:59:59.999Z"),
    );
    if (!listedOccurrence) {
      throw new Error("Expected a generated legacy occurrence");
    }
    const { repository } = createRepository({
      owner: legacyMaster,
      seriesRows: [legacyMaster],
    });

    await expect(resolveEventReadModel(repository, USER_ID, listedOccurrence.id))
      .resolves.toMatchObject({ eventStateId: MASTER_ID, id: listedOccurrence.id });
  });

  it("does not call the repository for malformed or internal recurrence IDs", async () => {
    const { calls, repository } = createRepository({ owner: master, seriesRows: [master] });

    await expect(resolveEventReadModel(repository, USER_ID, "recurrence-internal-hash"))
      .resolves.toBeNull();
    await expect(resolveEventReadModel(repository, USER_ID, "not-a-uuid"))
      .resolves.toBeNull();
    expect(calls).toEqual({ series: 0, synced: 0, user: 0 });
  });

  it("keeps a detached override addressable by its persisted UUID", async () => {
    const { calls, repository } = createRepository({ owner: detachedOverride });

    const resolved = await resolveEventReadModel(repository, USER_ID, OVERRIDE_ID);

    expect(resolved).toMatchObject({
      eventStateId: OVERRIDE_ID,
      id: OVERRIDE_ID,
      startTime: "2026-03-10T12:00:00.000Z",
      title: "Override",
    });
    expect(calls.series).toBe(0);
  });

  it("keeps a user event addressable by its UUID without an event state", async () => {
    const userEvent: KeeperEvent = {
      calendarId: CALENDAR_ID,
      calendarName: "Source",
      calendarProvider: "google",
      calendarUrl: null,
      description: null,
      endTime: "2026-03-02T11:00:00.000Z",
      eventStateId: null,
      id: USER_EVENT_ID,
      location: null,
      startTime: "2026-03-02T10:00:00.000Z",
      title: "User event",
    };
    const { calls, repository } = createRepository({ owner: master, userEvent });

    await expect(resolveEventReadModel(repository, USER_ID, USER_EVENT_ID)).resolves.toEqual(userEvent);
    expect(calls).toEqual({ series: 0, synced: 0, user: 1 });
  });

  it("returns null when a formerly addressable occurrence is excepted", async () => {
    const listedOccurrence = getFirstGeneratedOccurrence();
    const exceptedMaster: SyncedEventOwner = {
      ...master,
      exceptionDates: JSON.stringify([{
        date: listedOccurrence.startTime.toISOString(),
        type: "DATE-TIME",
      }]),
    };
    const { repository } = createRepository({
      owner: exceptedMaster,
      seriesRows: [exceptedMaster],
    });

    await expect(resolveEventReadModel(repository, USER_ID, listedOccurrence.id))
      .resolves.toBeNull();
  });

  it("returns null for a validly encoded timestamp outside the series", async () => {
    const outsideSeriesId = `occurrence:${MASTER_ID}:${new Date("2026-03-05T10:00:00.000Z").getTime()}`;
    const { repository } = createRepository({ owner: master, seriesRows: [master] });

    await expect(resolveEventReadModel(repository, USER_ID, outsideSeriesId)).resolves.toBeNull();
  });
});
