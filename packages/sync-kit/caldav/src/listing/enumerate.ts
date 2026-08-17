import type { Result } from "@keeper.sh/sync-protocol";
import type { DavCall, DavProperties, DavProperty } from "../client/dav-client";
import { readProperties } from "../client/dav-client";
import type { CalDAVOperation } from "../client/operation";
import { runCalDAVRequest } from "../client/request";
import { absoluteUrl, normalizeResourcePath } from "../identity/resource-path";
import type { CalDAVInternals } from "../internals";
import { enumerationProps, flattenProps } from "./request-shape";

interface ListedResource {
  readonly path: string;
  readonly etag: string | null;
}

interface Enumeration {
  readonly listed: readonly ListedResource[];
  readonly duplicatesCollapsed: number;
  readonly truncated: boolean;
}

const insufficientStorage = 507;

const withoutDuplicates = (
  rows: readonly ListedResource[],
): { readonly listed: readonly ListedResource[]; readonly duplicatesCollapsed: number } => {
  const byPath = new Map<string, ListedResource>();
  const collapsed = { duplicatesCollapsed: 0 };
  for (const row of rows) {
    if (byPath.has(row.path)) {
      collapsed.duplicatesCollapsed += 1;
      continue;
    }
    byPath.set(row.path, row);
  }
  return {
    listed: [...byPath.values()].toSorted((left, right) => left.path.localeCompare(right.path)),
    duplicatesCollapsed: collapsed.duplicatesCollapsed,
  };
};

const enumerationWasCapped = (row: DavProperty): boolean =>
  row.status === insufficientStorage || row.precondition === "numberOfMatchesWithinLimits";

const enumerateCollection = async (
  internals: CalDAVInternals,
  collectionPath: string,
  run: CalDAVOperation,
): Promise<Result<Enumeration>> => {
  const base = internals.dependencies.credentials.serverUrl;
  const url = absoluteUrl(base, collectionPath);
  const answered = await runCalDAVRequest<DavProperties>(internals, {
    operation: run.surroundings.operation,
    collections: [collectionPath],
    run,
    accepts: [],
    call: (call: DavCall) => readProperties(call, url, flattenProps(enumerationProps()), "1"),
    statusOf: (value: DavProperties) => ({
      status: value.status,
      precondition: null,
      retryAfter: null,
    }),
  });
  if (answered.kind === "failed") {
    return { ok: false, failure: answered.failure };
  }
  const rows = answered.value.rows.map((row) => ({
    row,
    path: normalizeResourcePath(row.href, base),
  }));
  const truncated = rows.some((entry) => enumerationWasCapped(entry.row));
  const members = rows
    .filter((entry) => entry.path !== collectionPath && !enumerationWasCapped(entry.row))
    .map((entry) => ({ path: entry.path, etag: entry.row.etag }));
  const collapsed = withoutDuplicates(members);
  return { ok: true, value: { ...collapsed, truncated } };
};

export { enumerateCollection };
export type { Enumeration, ListedResource };
