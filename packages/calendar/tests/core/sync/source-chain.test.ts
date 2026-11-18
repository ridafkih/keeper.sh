import { describe, expect, it } from "vitest";
import { computeSyncOperations } from "../../../src/core/sync/operations";
import {
  listEffectiveMappings,
  resolveDownstreamDestinationIds,
  resolveEffectiveDestinationIds,
  resolveEffectiveSources,
} from "../../../src/core/sync/source-chain";
import type { EffectiveSource, SyncMapping } from "../../../src/core/sync/source-chain";
import type { EventMapping } from "../../../src/core/events/mappings";

const direct = (sourceCalendarId: string, destinationCalendarId: string): SyncMapping => ({
  destinationCalendarId,
  destinationProviderCalendarKey: destinationCalendarId,
  includeUpstreamSources: false,
  isSameOwner: true,
  sourceCalendarId,
  sourceProviderCalendarKey: sourceCalendarId,
});

const chained = (sourceCalendarId: string, destinationCalendarId: string): SyncMapping => ({
  ...direct(sourceCalendarId, destinationCalendarId),
  includeUpstreamSources: true,
});

const acrossOwners = (mapping: SyncMapping): SyncMapping => ({ ...mapping, isSameOwner: false });

const onProviderCalendar = (
  mapping: SyncMapping,
  providerCalendarKeys: Record<string, string>,
): SyncMapping => ({
  ...mapping,
  destinationProviderCalendarKey:
    providerCalendarKeys[mapping.destinationCalendarId] ?? mapping.destinationProviderCalendarKey,
  sourceProviderCalendarKey:
    providerCalendarKeys[mapping.sourceCalendarId] ?? mapping.sourceProviderCalendarKey,
});

const source = (sourceCalendarId: string, ...viaCalendarIds: string[]): EffectiveSource => ({
  sourceCalendarId,
  viaCalendarIds,
});

const bySourceCalendarId = (first: EffectiveSource, second: EffectiveSource): number =>
  first.sourceCalendarId.localeCompare(second.sourceCalendarId);

const sourcesOf = (mappings: SyncMapping[], destinationCalendarId: string): EffectiveSource[] =>
  resolveEffectiveSources(mappings, destinationCalendarId).toSorted(bySourceCalendarId);

const WINDOW = {
  timeMax: new Date("2100-01-01T00:00:00.000Z"),
  timeMin: new Date("2000-01-01T00:00:00.000Z"),
};

describe("resolveEffectiveSources", () => {
  it("keeps only direct sources when no link opted in", () => {
    const mappings = [direct("aubrey", "kids"), direct("kids", "secretop")];

    expect(sourcesOf(mappings, "secretop")).toEqual([source("kids")]);
    expect(sourcesOf(mappings, "kids")).toEqual([source("aubrey")]);
  });

  it("inherits the sources of an opted-in link across two hops", () => {
    const mappings = [direct("aubrey", "kids"), chained("kids", "secretop")];

    expect(sourcesOf(mappings, "secretop")).toEqual([
      source("aubrey", "kids"),
      source("kids"),
    ]);
  });

  it("inherits across three hops only while every later link opted in", () => {
    const mappings = [direct("a", "b"), chained("b", "c"), chained("c", "d")];

    expect(sourcesOf(mappings, "d")).toEqual([
      source("a", "b", "c"),
      source("b", "c"),
      source("c"),
    ]);
    expect(sourcesOf([direct("a", "b"), direct("b", "c"), chained("c", "d")], "d")).toEqual([
      source("b", "c"),
      source("c"),
    ]);
  });

  it("yields one source for a diamond", () => {
    const mappings = [
      direct("a", "b"),
      direct("a", "c"),
      chained("b", "d"),
      chained("c", "d"),
    ];

    expect(sourcesOf(mappings, "d")).toEqual([
      source("a", "b"),
      source("b"),
      source("c"),
    ]);
  });

  it("prefers the direct link over an inherited path to the same source", () => {
    const mappings = [direct("a", "d"), direct("a", "b"), chained("b", "d")];

    expect(sourcesOf(mappings, "d")).toEqual([source("a"), source("b")]);
  });

  it("terminates on a two-calendar cycle without sourcing a calendar from itself", () => {
    const mappings = [chained("a", "b"), chained("b", "a")];

    expect(sourcesOf(mappings, "a")).toEqual([source("b")]);
    expect(sourcesOf(mappings, "b")).toEqual([source("a")]);
  });

  it("terminates on a three-calendar cycle without sourcing a calendar from itself", () => {
    const mappings = [chained("a", "b"), chained("b", "c"), chained("c", "a")];

    expect(sourcesOf(mappings, "a")).toEqual([source("b", "c"), source("c")]);
    expect(sourcesOf(mappings, "b")).toEqual([source("a"), source("c", "a")]);
    expect(sourcesOf(mappings, "c")).toEqual([source("a", "b"), source("b")]);
  });

  it("follows an opted-in path through a calendar already seen as a direct source", () => {
    const mappings = [
      direct("a", "b"),
      direct("b", "d"),
      chained("b", "c"),
      chained("c", "d"),
    ];

    expect(sourcesOf(mappings, "d")).toEqual([
      source("a", "b", "c"),
      source("b"),
      source("c"),
    ]);
  });

  it("does not depend on the order mappings are listed in", () => {
    const mappings = [
      direct("a", "b"),
      direct("a", "c"),
      chained("b", "d"),
      chained("c", "d"),
    ];

    expect(sourcesOf(mappings.toReversed(), "d")).toEqual(sourcesOf(mappings, "d"));
  });

  it("keeps a stored link from a calendar to itself as a direct source", () => {
    const mappings = [direct("a", "a"), direct("b", "a")];

    expect(sourcesOf(mappings, "a")).toEqual([source("a"), source("b")]);
    expect(sourcesOf([chained("a", "a")], "a")).toEqual([source("a")]);
  });

  it("keeps a stored link from another owner's calendar as a direct source", () => {
    const mappings = [acrossOwners(direct("theirs", "mine")), direct("own", "mine")];

    expect(sourcesOf(mappings, "mine")).toEqual([source("own"), source("theirs")]);
  });

  it("never inherits across owners", () => {
    const mappings = [
      acrossOwners(direct("theirs", "kids")),
      direct("aubrey", "kids"),
      chained("kids", "secretop"),
    ];

    expect(sourcesOf(mappings, "secretop")).toEqual([source("aubrey", "kids"), source("kids")]);
    expect(sourcesOf([direct("a", "b"), acrossOwners(chained("b", "c"))], "c"))
      .toEqual([source("b")]);
  });

  it("never inherits a second connection of the destination's own provider calendar", () => {
    const sameProviderCalendar = { shared: "family@provider", sharedAgain: "family@provider" };
    const mappings = [
      direct("shared", "kids"),
      direct("aubrey", "kids"),
      chained("kids", "sharedAgain"),
    ].map((mapping) => onProviderCalendar(mapping, sameProviderCalendar));

    expect(sourcesOf(mappings, "sharedAgain")).toEqual([
      source("aubrey", "kids"),
      source("kids"),
    ]);
  });

  it("drops an inherited source once its middle link is removed", () => {
    const mappings = [direct("aubrey", "kids"), chained("kids", "secretop")];
    const withoutMiddleLink = mappings.filter(
      (mapping) => mapping.sourceCalendarId !== "aubrey",
    );

    expect(sourcesOf(withoutMiddleLink, "secretop")).toEqual([source("kids")]);
  });
});

describe("removing a middle link", () => {
  it("removes the copies the destination inherited through it", () => {
    const inheritedCopy: EventMapping = {
      calendarId: "secretop",
      deleteIdentifier: "delete-inherited",
      destinationEventUid: "inherited-uid",
      endTime: new Date("2026-03-08T15:00:00.000Z"),
      eventStateId: "aubrey-event",
      id: "inherited-mapping",
      sourceCalendarId: "aubrey",
      startTime: new Date("2026-03-08T14:00:00.000Z"),
      syncEventHash: "hash",
      syncEventId: "aubrey-event",
    };
    const remainingSources = resolveEffectiveSources([chained("kids", "secretop")], "secretop");

    const result = computeSyncOperations([], [inheritedCopy], [], {
      authoritativeSourceWindows: new Map([["kids", WINDOW]]),
      authoritativeWindow: WINDOW,
      configuredSourceCalendarIds: new Set(
        remainingSources.map((remaining) => remaining.sourceCalendarId),
      ),
      requestedWindow: WINDOW,
    });

    expect(result.operations).toEqual([{
      deleteId: "delete-inherited",
      mappingId: "inherited-mapping",
      startTime: inheritedCopy.startTime,
      type: "remove",
      uid: "inherited-uid",
    }]);
  });
});

describe("resolveEffectiveDestinationIds", () => {
  it("reaches every destination downstream of a source", () => {
    const mappings = [direct("a", "b"), chained("b", "c"), chained("c", "d")];

    expect(resolveEffectiveDestinationIds(mappings, "a").toSorted()).toEqual(["b", "c", "d"]);
    expect(resolveEffectiveDestinationIds(mappings, "c")).toEqual(["d"]);
  });

  it("stops at a link that has not opted in", () => {
    const mappings = [direct("a", "b"), direct("b", "c"), chained("c", "d")];

    expect(resolveEffectiveDestinationIds(mappings, "a")).toEqual(["b"]);
  });

  it("never lists a source as its own destination in a cycle", () => {
    const mappings = [chained("a", "b"), chained("b", "c"), chained("c", "a")];

    expect(resolveEffectiveDestinationIds(mappings, "a").toSorted()).toEqual(["b", "c"]);
  });

  it("agrees with the sources resolved for each destination", () => {
    const mappings = [
      direct("a", "b"),
      direct("a", "c"),
      chained("b", "d"),
      direct("c", "d"),
      chained("d", "e"),
      chained("e", "b"),
    ];
    const calendarIds = ["a", "b", "c", "d", "e"];

    for (const sourceCalendarId of calendarIds) {
      const destinationIds = calendarIds.filter((destinationCalendarId) =>
        resolveEffectiveSources(mappings, destinationCalendarId)
          .some((resolved) => resolved.sourceCalendarId === sourceCalendarId));

      expect(resolveEffectiveDestinationIds(mappings, sourceCalendarId).toSorted())
        .toEqual(destinationIds);
    }
  });
});

describe("without any opted-in link", () => {
  it("resolves destinations and mappings exactly as stored", () => {
    const mappings = [
      direct("a", "b"),
      direct("b", "c"),
      direct("a", "a"),
      acrossOwners(direct("theirs", "b")),
    ];

    expect(resolveEffectiveDestinationIds(mappings, "a")).toEqual(["a", "b"]);
    expect(resolveEffectiveDestinationIds(mappings, "theirs")).toEqual(["b"]);
    expect(listEffectiveMappings(mappings)).toEqual(mappings.map((mapping) => ({
      destinationCalendarId: mapping.destinationCalendarId,
      sourceCalendarId: mapping.sourceCalendarId,
      viaCalendarIds: [],
    })));
  });
});

describe("resolveDownstreamDestinationIds", () => {
  it("lists only the calendars that inherit what a destination receives", () => {
    const mappings = [direct("a", "b"), chained("b", "c"), direct("b", "x"), chained("c", "d")];

    expect(resolveDownstreamDestinationIds(mappings, "b").toSorted()).toEqual(["c", "d"]);
    expect(resolveDownstreamDestinationIds(mappings, "x")).toEqual([]);
  });
});

describe("listEffectiveMappings", () => {
  it("matches the stored mappings when no link opted in", () => {
    const mappings = [direct("a", "b"), direct("b", "a"), direct("a", "c")];

    expect(listEffectiveMappings(mappings)).toHaveLength(mappings.length);
  });

  it("counts every inherited pair an opted-in chain creates", () => {
    const mappings = [direct("a", "b"), chained("b", "c"), chained("c", "d")];

    expect(listEffectiveMappings(mappings).map((mapping) =>
      `${mapping.sourceCalendarId}>${mapping.destinationCalendarId}`).toSorted()).toEqual([
      "a>b",
      "a>c",
      "a>d",
      "b>c",
      "b>d",
      "c>d",
    ]);
  });
});
