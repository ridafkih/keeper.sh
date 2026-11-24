import { KEEPER_EVENT_SUFFIX } from "@keeper.sh/constants";

const generateDeterministicEventUid = (seed: string): string => {
  const hash = new Bun.CryptoHasher("sha256").update(seed).digest("hex").slice(0, 32);
  return `${hash}${KEEPER_EVENT_SUFFIX}`;
};

const generateCalendarScopedEventUid = (eventId: string, calendarId: string): string =>
  generateDeterministicEventUid(`${eventId}:${calendarId}`);

const isKeeperEvent = (uid: string): boolean => uid.endsWith(KEEPER_EVENT_SUFFIX);

export { generateCalendarScopedEventUid, generateDeterministicEventUid, isKeeperEvent };
