import type { ProviderId, RemoteRef, WriteIntent } from "@keeper.sh/sync-protocol";
import type { ProviderUnderTest } from "../options";
import type { ProviderDecorator } from "./decorate";
import { withWrite } from "./decorate";

const remoteRefOf = (intent: WriteIntent): RemoteRef => {
  if (intent.kind === "create") {
    return {
      id: { kind: "remoteEventId", value: `id-${intent.idempotencyKey.value}` },
      deleteHandle: { kind: "deleteHandle", value: `handle-${intent.idempotencyKey.value}` },
    };
  }
  if (intent.kind === "update") {
    return {
      id: intent.target,
      deleteHandle: { kind: "deleteHandle", value: `handle-${intent.target.value}` },
    };
  }
  return {
    id: { kind: "remoteEventId", value: `id-${intent.target.value}` },
    deleteHandle: intent.target,
  };
};

const conflictingOn = (matches: (intent: WriteIntent) => boolean): ProviderDecorator => {
  const decorate = <Provider extends ProviderId>(
    provider: ProviderUnderTest<Provider>,
  ): ProviderUnderTest<Provider> =>
    withWrite(provider, (intent, context, inner) => {
      if (!matches(intent)) {
        return inner();
      }
      const remote = remoteRefOf(intent);
      return Promise.resolve({
        ok: true,
        value: {
          kind: "conflict",
          remote,
          observed: {
            kind: "matchesVersion",
            version: { kind: "remoteVersion", value: `conflicting-${remote.id.value}` },
          },
        },
      });
    });
  return decorate;
};

export { conflictingOn };
