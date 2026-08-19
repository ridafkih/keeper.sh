import { KEEPER_EVENT_SUFFIX } from "@keeper.sh/constants";

/** Private extended property used to recognize Keeper-managed Google OOO events. */
const KEEPER_EVENT_UID_PROPERTY = "keeperEventUid";

/**
 * Google event ids must be base32hex (0-9a-v). SHA-256 hex is a valid subset.
 * Used for out-of-office inserts because iCalUID tombstones cause permanent 409s
 * on events.insert after delete (import cannot create outOfOffice events).
 */
const toGoogleEventId = (uid: string): string =>
  new Bun.CryptoHasher("sha256").update(`google-ooo:${uid}`).digest("hex");

const readKeeperEventUid = (
  event: {
    extendedProperties?: { private?: Record<string, string> };
    iCalUID?: string;
  },
): string | null => {
  const fromPrivate = event.extendedProperties?.private?.[KEEPER_EVENT_UID_PROPERTY];
  if (typeof fromPrivate === "string" && fromPrivate.endsWith(KEEPER_EVENT_SUFFIX)) {
    return fromPrivate;
  }
  if (typeof event.iCalUID === "string" && event.iCalUID.endsWith(KEEPER_EVENT_SUFFIX)) {
    return event.iCalUID;
  }
  return null;
};

export { KEEPER_EVENT_UID_PROPERTY, readKeeperEventUid, toGoogleEventId };
