import type { RemoteEventId } from "@keeper.sh/sync-protocol";

type RemovedReading =
  | { readonly kind: "deleted"; readonly id: RemoteEventId }
  | { readonly kind: "cancelled"; readonly id: RemoteEventId }
  | { readonly kind: "untyped"; readonly id: RemoteEventId | null }
  | { readonly kind: "notRemoved" };

const removedReasons = [
  { reason: "deleted", kind: "deleted" },
  { reason: "changed", kind: "cancelled" },
] as const;

const readProperty = (value: unknown, name: string): unknown => {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  return Reflect.get(value, name);
};

const identifierOf = (item: unknown): RemoteEventId | null => {
  const id = readProperty(item, "id");
  if (typeof id !== "string" || id.length === 0) {
    return null;
  }
  return { kind: "remoteEventId", value: id };
};

const readRemoved = (item: unknown): RemovedReading => {
  const removed = readProperty(item, "@removed");
  if (typeof removed !== "object" || removed === null) {
    return { kind: "notRemoved" };
  }
  const id = identifierOf(item);
  const reason = readProperty(removed, "reason");
  const named = removedReasons.find((candidate) => candidate.reason === reason);
  if (!named || id === null) {
    return { kind: "untyped", id };
  }
  if (named.kind === "cancelled") {
    return { kind: "cancelled", id };
  }
  return { kind: "deleted", id };
};

export { readRemoved };
export type { RemovedReading };
