import type { CalendarSyncProvider, PendingChanges } from "./types";

interface UnrecordedCopyTally {
  deleted: number;
}

const flushOrDeleteUnrecordedCopies = async (
  changes: PendingChanges,
  flush: (changes: PendingChanges) => Promise<void>,
  provider: Pick<CalendarSyncProvider, "deleteEvents">,
  tally: UnrecordedCopyTally,
): Promise<void> => {
  try {
    await flush(changes);
  } catch (error) {
    if (changes.inserts.length === 0) {
      throw error;
    }
    const results = await provider.deleteEvents(
      changes.inserts.map(({ deleteIdentifier }) => deleteIdentifier),
    ).catch((deleteError: unknown) => {
      throw new AggregateError([error, deleteError], "Copies whose mappings failed to store could not be deleted");
    });
    tally.deleted += results.filter(({ success }) => success).length;
    throw error;
  }
};

export { flushOrDeleteUnrecordedCopies };
export type { UnrecordedCopyTally };
