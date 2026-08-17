import type { EchoVerdict, RemoteVersion } from "@keeper.sh/sync-protocol";
import type { PutResponse } from "./put";

const putEchoVerdict = (): EchoVerdict => ({ kind: "notObserved" });

const versionOfPut = (response: PutResponse): RemoteVersion | null => {
  if (response.etag === null || response.etag.length === 0) {
    return null;
  }
  return { kind: "remoteVersion", value: response.etag };
};

export { putEchoVerdict, versionOfPut };
