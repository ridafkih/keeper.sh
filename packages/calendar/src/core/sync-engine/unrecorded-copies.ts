import type { CalendarSyncProvider, PendingChanges, PendingInsert } from "./types";

interface UnrecordedCopyTally {
  deleted: number;
  deleteFailed: number;
}

const deleteUnrecordedCopies = async (
  provider: Pick<CalendarSyncProvider, "deleteEvents">,
  inserts: PendingInsert[],
  tally: UnrecordedCopyTally,
): Promise<void> => {
  try {
    const results = await provider.deleteEvents(inserts.map(({ deleteIdentifier }) => deleteIdentifier));
    const deleted = results.filter(({ success }) => success).length;
    tally.deleted += deleted;
    tally.deleteFailed += inserts.length - deleted;
  } catch {
    tally.deleteFailed += inserts.length;
  }
};

const flushOrDeleteUnrecordedCopies = async (
  changes: PendingChanges,
  flush: (changes: PendingChanges) => Promise<void>,
  provider: Pick<CalendarSyncProvider, "deleteEvents">,
  tally: UnrecordedCopyTally,
): Promise<void> => {
  try {
    await flush(changes);
  } catch (error) {
    if (changes.inserts.length > 0) {
      await deleteUnrecordedCopies(provider, changes.inserts, tally);
    }
    throw error;
  }
};

export { flushOrDeleteUnrecordedCopies };
export type { UnrecordedCopyTally };
