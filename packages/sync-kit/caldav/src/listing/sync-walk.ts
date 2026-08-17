import type { Result } from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";
import type { DavCall, DavText } from "../client/dav-client";
import { reportRaw } from "../client/dav-client";
import type { CalDAVOperation } from "../client/operation";
import { runCalDAVRequest } from "../client/request";
import { absoluteUrl } from "../identity/resource-path";
import { readErrorPrecondition, readMultistatus } from "../report/multistatus";
import { classifySyncReport } from "../report/sync-report";
import type { ReportedResource, SyncReport } from "../report/sync-report";
import type { CalDAVInternals } from "../internals";
import { syncCollectionRequestBody } from "./request-shape";

interface SyncWalkRequest {
  readonly collectionPath: string;
  readonly token: string | null;
  readonly pageCeiling: number;
  readonly run: CalDAVOperation;
}

type SyncWalk =
  | {
      readonly kind: "complete";
      readonly token: string;
      readonly resources: readonly ReportedResource[];
      readonly removed: readonly string[];
      readonly pages: number;
    }
  | {
      readonly kind: "truncated";
      readonly resumeToken: string;
      readonly resources: readonly ReportedResource[];
      readonly removed: readonly string[];
      readonly pages: number;
    }
  | { readonly kind: "tokenRejected" };

const tokenRejection = 403;
const tokenConflict = 409;

const reportOf = (
  answered: DavText,
  collectionPath: string,
  base: string,
): SyncReport => {
  const refused = answered.status === tokenRejection || answered.status === tokenConflict;
  if (refused && readErrorPrecondition(answered.body) === "validSyncToken") {
    return { kind: "tokenRejected" };
  }
  return classifySyncReport(readMultistatus(answered.body), collectionPath, base);
};

const fetchPage = async (
  internals: CalDAVInternals,
  request: SyncWalkRequest,
  token: string | null,
): Promise<Result<SyncReport>> => {
  const base = internals.dependencies.credentials.serverUrl;
  const url = absoluteUrl(base, request.collectionPath);
  const answered = await runCalDAVRequest<DavText>(internals, {
    operation: request.run.surroundings.operation,
    collections: [request.collectionPath],
    run: request.run,
    accepts: [tokenRejection, tokenConflict],
    call: (call: DavCall) => reportRaw(call, url, syncCollectionRequestBody(token), "1"),
    statusOf: (value: DavText) => ({
      status: value.status,
      precondition: readErrorPrecondition(value.body),
      retryAfter: null,
    }),
  });
  if (answered.kind === "failed") {
    if (answered.cause?.kind === "tokenRejected") {
      return { ok: true, value: { kind: "tokenRejected" } };
    }
    return { ok: false, failure: answered.failure };
  }
  return { ok: true, value: reportOf(answered.value, request.collectionPath, base) };
};

interface WalkState {
  readonly resources: ReportedResource[];
  readonly removed: string[];
  token: string;
  pages: number;
}

const absorb = (state: WalkState, resources: readonly ReportedResource[], removed: readonly string[]): void => {
  state.resources.push(...resources);
  state.removed.push(...removed);
};

const completedWalk = (state: WalkState): SyncWalk => ({
  kind: "complete",
  token: state.token,
  resources: state.resources,
  removed: state.removed,
  pages: state.pages,
});

const truncatedWalk = (state: WalkState): SyncWalk => ({
  kind: "truncated",
  resumeToken: state.token,
  resources: state.resources,
  removed: state.removed,
  pages: state.pages,
});

const walkSyncCollection = async (
  internals: CalDAVInternals,
  request: SyncWalkRequest,
): Promise<Result<SyncWalk>> => {
  const state: WalkState = {
    resources: [],
    removed: [],
    token: request.token ?? "",
    pages: 0,
  };
  const cursor: { asked: string | null } = { asked: request.token };
  while (state.pages < request.pageCeiling) {
    const page = await fetchPage(internals, request, cursor.asked);
    if (!page.ok) {
      return { ok: false, failure: page.failure };
    }
    state.pages += 1;
    const report = page.value;
    switch (report.kind) {
      case "tokenRejected": {
        return { ok: true, value: { kind: "tokenRejected" } };
      }
      case "truncated": {
        absorb(state, report.resources, report.removed);
        if (report.token === state.token || report.token.length === 0) {
          return { ok: true, value: truncatedWalk(state) };
        }
        state.token = report.token;
        cursor.asked = report.token;
        break;
      }
      case "changed": {
        absorb(state, report.resources, report.removed);
        state.token = report.token;
        return { ok: true, value: completedWalk(state) };
      }
      case "removed": {
        absorb(state, [], report.removed);
        state.token = report.token;
        return { ok: true, value: completedWalk(state) };
      }
      case "unchanged": {
        state.token = report.token;
        return { ok: true, value: completedWalk(state) };
      }
      default: {
        return assertNever(report);
      }
    }
  }
  return { ok: true, value: truncatedWalk(state) };
};

export { walkSyncCollection };
export type { SyncWalk, SyncWalkRequest };
