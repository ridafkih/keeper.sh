import { KEEPER_EVENT_SUFFIX } from "@keeper.sh/constants";

const generateEventUid = (): string => `${crypto.randomUUID()}${KEEPER_EVENT_SUFFIX}`;

const isKeeperEvent = (uid: string): boolean => uid.endsWith(KEEPER_EVENT_SUFFIX);

export { generateEventUid, isKeeperEvent };
