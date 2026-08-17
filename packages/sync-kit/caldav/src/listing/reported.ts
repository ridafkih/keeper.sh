import type { RemoteEventId, Removal } from "@keeper.sh/sync-protocol";
import type { CalDAVFeed } from "./build-feed";

interface ReportedLedger {
  readonly carried: (collectionPath: string) => ReadonlyMap<string, RemoteEventId>;
  readonly record: (collectionPath: string, present: ReadonlyMap<string, RemoteEventId>) => void;
  readonly merge: (
    collectionPath: string,
    feed: CalDAVFeed,
    removedPaths: readonly string[],
  ) => void;
  readonly uidAt: (collectionPath: string, resourcePath: string) => string | null;
  readonly corrupt: (uids: readonly string[]) => void;
  readonly corrupted: () => boolean;
}

const presentIdentities = (feed: CalDAVFeed): ReadonlyMap<string, RemoteEventId> => {
  const present = new Map<string, RemoteEventId>();
  for (const entry of feed.withheld) {
    if (entry.uid && entry.id) {
      present.set(entry.uid.value, entry.id);
    }
  }
  for (const event of feed.events) {
    present.set(event.uid.value, event.id);
  }
  return present;
};

const namedElsewhere = (removals: readonly Removal[]): ReadonlySet<string> =>
  new Set(
    removals.flatMap((removal) => {
      if (removal.kind === "outOfScope") {
        return [];
      }
      return [removal.uid.value];
    }),
  );

const removalsAgainstReported = (
  reported: ReportedLedger,
  collectionPath: string,
  feed: CalDAVFeed,
): readonly Removal[] => {
  const present = presentIdentities(feed);
  const carried = reported.carried(collectionPath);
  const alreadyNamed = namedElsewhere(feed.removals);
  reported.record(collectionPath, present);
  return [...carried.entries()].flatMap(([uid, id]) => {
    if (present.has(uid) || alreadyNamed.has(uid)) {
      return [];
    }
    return [{ kind: "deleted", id, uid: { kind: "eventUid", value: uid } } satisfies Removal];
  });
};

const createReportedLedger = (): ReportedLedger => {
  const byCollection = new Map<string, ReadonlyMap<string, RemoteEventId>>();
  const rows: { corruptRows: readonly string[] } = { corruptRows: [] };

  return {
    carried: (collectionPath: string) =>
      byCollection.get(collectionPath) ?? new Map<string, RemoteEventId>(),
    record: (collectionPath: string, present: ReadonlyMap<string, RemoteEventId>) => {
      byCollection.set(collectionPath, present);
    },
    merge: (collectionPath: string, feed: CalDAVFeed, removedPaths: readonly string[]) => {
      const next = new Map(byCollection.get(collectionPath));
      const gone = new Set(removedPaths);
      for (const [uid, id] of presentIdentities(feed).entries()) {
        next.set(uid, id);
      }
      for (const uid of namedElsewhere(feed.removals)) {
        next.delete(uid);
      }
      const tombstoned = [...next.entries()]
        .filter(([, id]) => gone.has(id.value))
        .map(([uid]) => uid);
      for (const uid of tombstoned) {
        next.delete(uid);
      }
      byCollection.set(collectionPath, next);
    },
    uidAt: (collectionPath: string, resourcePath: string) => {
      const carried = byCollection.get(collectionPath);
      if (!carried) {
        return null;
      }
      for (const [uid, id] of carried.entries()) {
        if (id.value === resourcePath) {
          return uid;
        }
      }
      return null;
    },
    corrupt: (uids: readonly string[]) => {
      rows.corruptRows = uids;
    },
    corrupted: () => rows.corruptRows.length > 0,
  };
};

export { createReportedLedger, removalsAgainstReported };
export type { ReportedLedger };
