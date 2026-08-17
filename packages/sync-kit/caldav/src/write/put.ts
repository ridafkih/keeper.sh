import type { Result } from "@keeper.sh/sync-protocol";
import type { DavCall, DavWrite } from "../client/dav-client";
import { putResource } from "../client/dav-client";
import { runCalDAVRequest } from "../client/request";
import { absoluteUrl } from "../identity/resource-path";
import type { ConditionalHeaders } from "./precondition";
import type { WriteSurroundings } from "./surroundings";

interface PutResponse {
  readonly status: number;
  readonly etag: string | null;
}

const preconditionFailed = 412;

const conditionalPut = async (
  surroundings: WriteSurroundings,
  path: string,
  body: string,
  condition: Extract<ConditionalHeaders, { kind: "ifMatch" } | { kind: "ifNoneMatch" }>,
): Promise<Result<PutResponse>> => {
  const { internals } = surroundings;
  const url = absoluteUrl(internals.dependencies.credentials.serverUrl, path);
  const answered = await runCalDAVRequest<DavWrite>(internals, {
    operation: "write",
    collections: [surroundings.collectionPath],
    run: surroundings.run,
    accepts: [preconditionFailed],
    call: (call: DavCall) => putResource(call, url, body, condition.headers),
    statusOf: (value: DavWrite) => ({
      status: value.status,
      precondition: null,
      retryAfter: null,
    }),
  });
  if (answered.kind === "failed") {
    return { ok: false, failure: answered.failure };
  }
  return { ok: true, value: { status: answered.value.status, etag: answered.value.etag } };
};

export { conditionalPut, preconditionFailed };
export type { PutResponse };
