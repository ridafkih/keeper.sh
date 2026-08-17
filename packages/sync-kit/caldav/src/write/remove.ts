import type { Result } from "@keeper.sh/sync-protocol";
import type { DavCall, DavWrite } from "../client/dav-client";
import { removeResource } from "../client/dav-client";
import { runCalDAVRequest } from "../client/request";
import { absoluteUrl } from "../identity/resource-path";
import type { ConditionalHeaders } from "./precondition";
import { preconditionFailed } from "./put";
import type { WriteSurroundings } from "./surroundings";

interface DeleteResponse {
  readonly status: number;
}

const absentStatuses = [404, 410] as const;

const conditionalDelete = async (
  surroundings: WriteSurroundings,
  path: string,
  condition: Extract<ConditionalHeaders, { kind: "ifMatch" }>,
): Promise<Result<DeleteResponse>> => {
  const { internals } = surroundings;
  const url = absoluteUrl(internals.dependencies.credentials.serverUrl, path);
  const answered = await runCalDAVRequest<DavWrite>(internals, {
    operation: "write",
    collections: [surroundings.collectionPath],
    run: surroundings.run,
    accepts: [preconditionFailed, ...absentStatuses],
    call: (call: DavCall) => removeResource(call, url, condition.headers),
    statusOf: (value: DavWrite) => ({
      status: value.status,
      precondition: null,
      retryAfter: null,
    }),
  });
  if (answered.kind === "failed") {
    return { ok: false, failure: answered.failure };
  }
  return { ok: true, value: { status: answered.value.status } };
};

export { absentStatuses, conditionalDelete };
export type { DeleteResponse };
