import type { Result } from "@keeper.sh/sync-protocol";
import type { CalDAVInternals } from "../internals";
import type { DavCall, DavProperties } from "../client/dav-client";
import { readProperties } from "../client/dav-client";
import type { CalDAVOperation } from "../client/operation";
import { runCalDAVRequest } from "../client/request";
import { absoluteUrl } from "../identity/resource-path";
import { flattenProps, supportedReportProps } from "../listing/request-shape";

interface SupportedReports {
  readonly syncCollection: boolean;
  readonly calendarMultiget: boolean;
}

const comparableName = (name: string): string => name.toLowerCase().replaceAll(/[^a-z]/gu, "");

const announced = (names: readonly string[], wanted: string): boolean =>
  names.some((name) => comparableName(name) === wanted);

const supportOf = (names: readonly string[]): SupportedReports => ({
  syncCollection: announced(names, "synccollection"),
  calendarMultiget: announced(names, "calendarmultiget"),
});

const probeSupportedReports = async (
  internals: CalDAVInternals,
  collectionPath: string,
  run: CalDAVOperation,
): Promise<Result<SupportedReports>> => {
  const cached = internals.reportSupport.get(collectionPath);
  if (cached) {
    return { ok: true, value: cached };
  }
  const url = absoluteUrl(internals.dependencies.credentials.serverUrl, collectionPath);
  const answered = await runCalDAVRequest<DavProperties>(internals, {
    operation: run.surroundings.operation,
    collections: [collectionPath],
    run,
    accepts: [],
    call: (call: DavCall) => readProperties(call, url, flattenProps(supportedReportProps()), "0"),
    statusOf: (value: DavProperties) => ({
      status: value.status,
      precondition: null,
      retryAfter: null,
    }),
  });
  if (answered.kind === "failed") {
    return { ok: false, failure: answered.failure };
  }
  const names = answered.value.rows.flatMap((row) => [...row.reports]);
  const support = supportOf(names);
  internals.reportSupport.set(collectionPath, support);
  return { ok: true, value: support };
};

export { probeSupportedReports };
export type { SupportedReports };
