import type { SyncableEvent } from "./types";

const KEEPER_DOMAIN = "@keeper.sh";

const createEventHash = (event: SyncableEvent): string => {
  const data = `${event.sourceId}:${event.startTime.getTime()}:${event.endTime.getTime()}`;
  return Buffer.from(data).toString("base64url").slice(0, 16);
};

export const generateEventUid = (
  userId: string,
  event: SyncableEvent,
): string => {
  const hash = createEventHash(event);
  return `${userId}-${hash}${KEEPER_DOMAIN}`;
};

export const parseEventUid = (
  uid: string,
): { userId: string; hash: string } | null => {
  if (!uid.endsWith(KEEPER_DOMAIN)) {
    return null;
  }

  const localPart = uid.slice(0, -KEEPER_DOMAIN.length);
  const [userId, ...hashComponents] = localPart.split("-");

  if (!userId || hashComponents.length === 0) {
    return null;
  }

  return { userId, hash: hashComponents.join("-") };
};

export const isKeeperEvent = (uid: string): boolean =>
  uid.endsWith(KEEPER_DOMAIN);
