import type { BoundedSample, Result } from "@keeper.sh/sync-protocol";
import type { DavCall, DavText } from "../client/dav-client";
import { reportRaw } from "../client/dav-client";
import type { CalDAVOperation } from "../client/operation";
import { runCalDAVRequest } from "../client/request";
import { absoluteUrl, normalizeResourcePath } from "../identity/resource-path";
import type { CalDAVInternals } from "../internals";
import { readMultistatus } from "../report/multistatus";
import type { ReportedResource } from "../report/sync-report";
import { caldavLimits } from "../limits";
import { boundedSample } from "./diagnostics";
import { multigetRequestBody } from "./request-shape";

type MultigetOutcome =
  | {
      readonly kind: "complete";
      readonly resources: readonly ReportedResource[];
      readonly unrequested: BoundedSample;
      readonly batches: number;
    }
  | {
      readonly kind: "incomplete";
      readonly resources: readonly ReportedResource[];
      readonly missing: BoundedSample;
      readonly unrequested: BoundedSample;
      readonly batches: number;
    };

const batched = (paths: readonly string[], size: number): readonly (readonly string[])[] => {
  const starts = Array.from(
    { length: Math.ceil(paths.length / Math.max(1, size)) },
    (unused, batch) => batch * size,
  );
  return starts.map((index) => paths.slice(index, index + size));
};

const readableRows = (
  body: string,
  base: string,
): readonly ReportedResource[] =>
  readMultistatus(body).responses.map((response) => ({
    path: normalizeResourcePath(response.href, base),
    etag: response.etag,
    calendarData: response.calendarData,
  }));

const multigetResources = async (
  internals: CalDAVInternals,
  collectionPath: string,
  paths: readonly string[],
  run: CalDAVOperation,
): Promise<Result<MultigetOutcome>> => {
  const base = internals.dependencies.credentials.serverUrl;
  const url = absoluteUrl(base, collectionPath);
  const wanted = new Set(paths);
  const found = new Map<string, ReportedResource>();
  const unrequested: string[] = [];
  const batches = batched(paths, caldavLimits.multigetBatchSize);
  for (const batch of batches) {
    const answered = await runCalDAVRequest<DavText>(internals, {
      operation: run.surroundings.operation,
      collections: [collectionPath],
      run,
      accepts: [],
      call: (call: DavCall) => reportRaw(call, url, multigetRequestBody(batch), "1"),
      statusOf: (value: DavText) => ({
        status: value.status,
        precondition: null,
        retryAfter: null,
      }),
    });
    if (answered.kind === "failed") {
      return { ok: false, failure: answered.failure };
    }
    for (const row of readableRows(answered.value.body, base)) {
      if (!wanted.has(row.path)) {
        unrequested.push(row.path);
        continue;
      }
      found.set(row.path, row);
    }
  }
  const missing = paths.filter((path) => !found.has(path));
  const resources = paths.flatMap((path) => {
    const row = found.get(path);
    if (!row) {
      return [];
    }
    return [row];
  });
  if (missing.length > 0) {
    return {
      ok: true,
      value: {
        kind: "incomplete",
        resources,
        missing: boundedSample(missing, caldavLimits.diagnosticSampleSize),
        unrequested: boundedSample(unrequested, caldavLimits.diagnosticSampleSize),
        batches: batches.length,
      },
    };
  }
  return {
    ok: true,
    value: {
      kind: "complete",
      resources,
      unrequested: boundedSample(unrequested, caldavLimits.diagnosticSampleSize),
      batches: batches.length,
    },
  };
};

export { multigetResources };
export type { MultigetOutcome };
