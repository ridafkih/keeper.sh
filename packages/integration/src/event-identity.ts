import { KEEPER_EVENT_SUFFIX } from "@keeper.sh/constants";

export const generateEventUid = (): string => {
  return `${crypto.randomUUID()}${KEEPER_EVENT_SUFFIX}`;
};

export const isKeeperEvent = (uid: string): boolean =>
  uid.endsWith(KEEPER_EVENT_SUFFIX);
