import type { Result } from "@keeper.sh/sync-protocol";
import type { DavCall, DavProperties } from "../client/dav-client";
import { readProperties } from "../client/dav-client";
import type { CalDAVOperation } from "../client/operation";
import { runCalDAVRequest } from "../client/request";
import { absoluteUrl } from "../identity/resource-path";
import type { CalDAVInternals } from "../internals";
import { collectionStateProps, flattenProps } from "../listing/request-shape";

interface CollectionState {
  readonly collectionTag: string | null;
  readonly syncToken: string | null;
}

const readCollectionState = async (
  internals: CalDAVInternals,
  collectionPath: string,
  run: CalDAVOperation,
): Promise<Result<CollectionState>> => {
  const url = absoluteUrl(internals.dependencies.credentials.serverUrl, collectionPath);
  const answered = await runCalDAVRequest<DavProperties>(internals, {
    operation: run.surroundings.operation,
    collections: [collectionPath],
    run,
    accepts: [],
    call: (call: DavCall) => readProperties(call, url, flattenProps(collectionStateProps()), "0"),
    statusOf: (value: DavProperties) => ({
      status: value.status,
      precondition: null,
      retryAfter: null,
    }),
  });
  if (answered.kind === "failed") {
    return { ok: false, failure: answered.failure };
  }
  const [row] = answered.value.rows;
  return {
    ok: true,
    value: { collectionTag: row?.collectionTag ?? null, syncToken: row?.syncToken ?? null },
  };
};

export { readCollectionState };
export type { CollectionState };
