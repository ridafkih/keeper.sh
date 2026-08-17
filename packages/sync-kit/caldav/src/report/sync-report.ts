import { normalizeResourcePath } from "../identity/resource-path";
import type { MultistatusDocument, MultistatusResponse } from "./multistatus";

interface ReportedResource {
  readonly path: string;
  readonly etag: string | null;
  readonly calendarData: string | null;
}

type SyncReport =
  | {
      readonly kind: "changed";
      readonly token: string;
      readonly resources: readonly ReportedResource[];
      readonly removed: readonly string[];
    }
  | {
      readonly kind: "truncated";
      readonly token: string;
      readonly resources: readonly ReportedResource[];
      readonly removed: readonly string[];
    }
  | { readonly kind: "removed"; readonly token: string; readonly removed: readonly string[] }
  | { readonly kind: "unchanged"; readonly token: string }
  | { readonly kind: "tokenRejected" };

const insufficientStorage = 507;
const notFound = 404;
const gone = 410;
const successFloor = 200;
const successCeiling = 300;

const readable = (response: MultistatusResponse): boolean =>
  response.status >= successFloor && response.status < successCeiling;

const absent = (response: MultistatusResponse): boolean =>
  response.status === notFound || response.status === gone;

const truncationSignal = (response: MultistatusResponse): boolean =>
  response.status === insufficientStorage ||
  response.precondition === "numberOfMatchesWithinLimits";

const classifySyncReport = (
  document: MultistatusDocument,
  collectionPath: string,
  base: string,
): SyncReport => {
  if (document.precondition === "validSyncToken") {
    return { kind: "tokenRejected" };
  }
  const rows = document.responses.map((response) => ({
    response,
    path: normalizeResourcePath(response.href, base),
  }));
  const truncated = rows.some(
    (row) => row.path === collectionPath && truncationSignal(row.response),
  );
  const members = rows.filter((row) => row.path !== collectionPath);
  const resources = members
    .filter((row) => readable(row.response))
    .map((row) => ({
      path: row.path,
      etag: row.response.etag,
      calendarData: row.response.calendarData,
    }));
  const removed = members.filter((row) => absent(row.response)).map((row) => row.path);
  const token = document.syncToken ?? "";
  if (truncated) {
    return { kind: "truncated", token, resources, removed };
  }
  if (resources.length === 0 && removed.length === 0) {
    return { kind: "unchanged", token };
  }
  if (resources.length === 0) {
    return { kind: "removed", token, removed };
  }
  return { kind: "changed", token, resources, removed };
};

export { classifySyncReport };
export type { ReportedResource, SyncReport };
