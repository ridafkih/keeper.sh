import { describe, expect, it } from "vitest";
import {
  runSetDestinationsForSource,
  runSetSourcesForDestination,
} from "../../src/utils/source-destination-mappings";

interface RecordedMutations {
  deleted: string[][];
  inserted: string[][];
  replaced: string[][];
}

const createRecorder = (): RecordedMutations => ({
  deleted: [],
  inserted: [],
  replaced: [],
});

const createDestinationDependencies = (
  existingDestinationIds: string[],
  recorder: RecordedMutations,
) => ({
  withTransaction: (transactionCallback: (transaction: Record<string, unknown>) => unknown) =>
    transactionCallback({
      acquireUserLock: () => Promise.resolve(),
      deleteSourceMappings: (_sourceCalendarId: string, destinationCalendarIds: string[]) => {
        recorder.deleted.push([...destinationCalendarIds].toSorted());
        return Promise.resolve();
      },
      ensureDestinationSyncStatuses: () => Promise.resolve(),
      findExistingDestinationIds: () => Promise.resolve([...existingDestinationIds]),
      findOwnedDestinationIds: (_userId: string, ids: string[]) => Promise.resolve([...ids]),
      insertSourceMappings: (_sourceCalendarId: string, destinationCalendarIds: string[]) => {
        recorder.inserted.push([...destinationCalendarIds].toSorted());
        return Promise.resolve();
      },
      replaceSourceMappings: (_sourceCalendarId: string, destinationCalendarIds: string[]) => {
        recorder.replaced.push([...destinationCalendarIds].toSorted());
        return Promise.resolve();
      },
      sourceExists: () => Promise.resolve(true),
    }),
});

const createSourceDependencies = (
  existingSourceIds: string[],
  recorder: RecordedMutations,
) => ({
  withTransaction: (transactionCallback: (transaction: Record<string, unknown>) => unknown) =>
    transactionCallback({
      acquireUserLock: () => Promise.resolve(),
      deleteDestinationMappings: (_destinationCalendarId: string, sourceCalendarIds: string[]) => {
        recorder.deleted.push([...sourceCalendarIds].toSorted());
        return Promise.resolve();
      },
      destinationExists: () => Promise.resolve(true),
      ensureDestinationSyncStatuses: () => Promise.resolve(),
      findExistingSourceIds: () => Promise.resolve([...existingSourceIds]),
      findOwnedSourceIds: (_userId: string, ids: string[]) => Promise.resolve([...ids]),
      insertDestinationMappings: (_destinationCalendarId: string, sourceCalendarIds: string[]) => {
        recorder.inserted.push([...sourceCalendarIds].toSorted());
        return Promise.resolve();
      },
      replaceDestinationMappings: (
        _destinationCalendarId: string,
        sourceCalendarIds: string[],
      ) => {
        recorder.replaced.push([...sourceCalendarIds].toSorted());
        return Promise.resolve();
      },
      sourceExists: () => Promise.resolve(true),
    }),
});

describe("mapping set replacement preserves untouched rows", () => {
  it("only removes and adds the destinations that actually changed", async () => {
    const recorder = createRecorder();

    await runSetDestinationsForSource(
      "user-1",
      "source-1",
      ["dest-b", "dest-d"],
      createDestinationDependencies(["dest-b", "dest-c"], recorder) as never,
    );

    expect(recorder.replaced).toEqual([]);
    expect(recorder.deleted).toEqual([["dest-c"]]);
    expect(recorder.inserted).toEqual([["dest-d"]]);
  });

  it("touches nothing when the destination set is unchanged", async () => {
    const recorder = createRecorder();

    await runSetDestinationsForSource(
      "user-1",
      "source-1",
      ["dest-b", "dest-c"],
      createDestinationDependencies(["dest-c", "dest-b"], recorder) as never,
    );

    expect(recorder.replaced).toEqual([]);
    expect(recorder.deleted.flat()).toEqual([]);
    expect(recorder.inserted.flat()).toEqual([]);
  });

  it("only removes and adds the sources that actually changed", async () => {
    const recorder = createRecorder();

    await runSetSourcesForDestination(
      "user-1",
      "destination-1",
      ["source-b", "source-d"],
      createSourceDependencies(["source-b", "source-c"], recorder) as never,
    );

    expect(recorder.replaced).toEqual([]);
    expect(recorder.deleted).toEqual([["source-c"]]);
    expect(recorder.inserted).toEqual([["source-d"]]);
  });
});
