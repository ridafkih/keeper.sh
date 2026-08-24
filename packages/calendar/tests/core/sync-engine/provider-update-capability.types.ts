import type { CalendarSyncProvider } from "../../../src/core/sync-engine/types";
import type { MaterializedSyncableEvent, PushResult } from "../../../src/core/types";

const providerWithUpdateCapability: CalendarSyncProvider = {
  deleteEvents: () => Promise.resolve([]),
  listRemoteEvents: () => Promise.resolve([]),
  pushEvents: () => Promise.resolve([]),
  updateEvents: (updates: { deleteId: string; event: MaterializedSyncableEvent }[]): Promise<PushResult[]> =>
    Promise.resolve(updates.map(() => ({ success: true }))),
};

const providerWithoutUpdateCapability: CalendarSyncProvider = {
  deleteEvents: () => Promise.resolve([]),
  listRemoteEvents: () => Promise.resolve([]),
  pushEvents: () => Promise.resolve([]),
};

const updateEvents: NonNullable<CalendarSyncProvider["updateEvents"]> = (updates) =>
  Promise.resolve(updates.map((update): PushResult => ({
    deleteId: update.deleteId,
    remoteId: update.event.sourceEventUid,
    success: true,
  })));

export { providerWithUpdateCapability, providerWithoutUpdateCapability, updateEvents };
