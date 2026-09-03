import type { CalendarKey, EventUid, RemoteEvent, RemoteEventId } from "@keeper.sh/sync-protocol";
import type { ProviderSeed, WriteLogEntry } from "../options";

interface ReportedIdentity {
  readonly uid: EventUid;
  readonly id: RemoteEventId;
}

interface ReferenceStore {
  readonly seed: (seed: ProviderSeed) => void;
  readonly objects: () => readonly RemoteEvent[];
  readonly writeLog: () => readonly WriteLogEntry[];
  readonly corruptKnownRows: () => readonly string[];
  readonly cancelled: () => readonly EventUid[];
  readonly unattributableRemovals: () => readonly RemoteEventId[];
  readonly calendar: () => CalendarKey;
  readonly replaceObjects: (events: readonly RemoteEvent[]) => void;
  readonly record: (entry: WriteLogEntry) => void;
  readonly reported: () => readonly ReportedIdentity[];
  readonly setReported: (identities: readonly ReportedIdentity[]) => void;
  readonly sequenceOf: (uid: string) => number;
  readonly touch: (uid: string) => void;
  readonly currentSequence: () => number;
  readonly clearCorruption: () => void;
}

const signatureOf = (event: RemoteEvent): string =>
  `${event.revision}|${event.version.value}|${event.fingerprint.value}`;

interface ReferenceStoreState {
  stored: readonly RemoteEvent[];
  corrupt: readonly string[];
  cancellations: readonly EventUid[];
  unattributable: readonly RemoteEventId[];
  reported: readonly ReportedIdentity[];
  sequence: number;
}

const createReferenceStore = (calendar: CalendarKey): ReferenceStore => {
  const state: ReferenceStoreState = {
    stored: [],
    corrupt: [],
    cancellations: [],
    unattributable: [],
    reported: [],
    sequence: 0,
  };
  const log: WriteLogEntry[] = [];
  const sequences = new Map<string, number>();
  const signatures = new Map<string, string>();

  const touch = (uid: string): void => {
    state.sequence += 1;
    sequences.set(uid, state.sequence);
  };

  const replaceObjects = (events: readonly RemoteEvent[]): void => {
    for (const event of events) {
      const signature = signatureOf(event);
      if (signatures.get(event.uid.value) !== signature) {
        signatures.set(event.uid.value, signature);
        touch(event.uid.value);
      }
    }
    state.stored = events;
  };

  return {
    seed: (next: ProviderSeed) => {
      const { cancelled, corruptKnownRows, events, unattributableRemovals } = next;
      state.corrupt = corruptKnownRows;
      state.cancellations = cancelled;
      state.unattributable = unattributableRemovals;
      replaceObjects(events);
    },
    objects: () => state.stored,
    writeLog: () => log,
    corruptKnownRows: () => state.corrupt,
    cancelled: () => state.cancellations,
    unattributableRemovals: () => state.unattributable,
    calendar: () => calendar,
    replaceObjects,
    record: (entry: WriteLogEntry) => {
      log.push(entry);
    },
    reported: () => state.reported,
    setReported: (identities: readonly ReportedIdentity[]) => {
      state.reported = identities;
    },
    sequenceOf: (uid: string) => sequences.get(uid) ?? 0,
    touch,
    currentSequence: () => state.sequence,
    clearCorruption: () => {
      state.corrupt = [];
    },
  };
};

export { createReferenceStore };
export type { ReferenceStore, ReportedIdentity };
