import type { Instant } from "@keeper.sh/sync-protocol";

const hourMs = 60 * 60 * 1000;

const googleWatchProfile = {
  maximumLifetimeMs: 7 * 24 * hourMs,
  renewalLeadMs: 12 * hourMs,
  staggerWindowMs: 6 * hourMs,
  renewal: "recreate",
} as const;

type GoogleWatchProfile = typeof googleWatchProfile;

const staggerOffsetMs = (calendarId: string, hash: (input: string) => string): number => {
  const digest = hash(calendarId);
  const rolling = { accumulated: 0 };
  for (const character of digest) {
    rolling.accumulated =
      (rolling.accumulated * 31 + (character.codePointAt(0) ?? 0)) % 2_147_483_647;
  }
  return rolling.accumulated % googleWatchProfile.staggerWindowMs;
};

const renewalInstantOf = (
  expiration: Instant,
  calendarId: string,
  hash: (input: string) => string,
): Instant => {
  const expiring = Date.parse(expiration.value);
  const staggered =
    expiring - googleWatchProfile.renewalLeadMs + staggerOffsetMs(calendarId, hash);
  return { kind: "instant", value: new Date(Math.min(staggered, expiring)).toISOString() };
};

export { googleWatchProfile, renewalInstantOf, staggerOffsetMs };
export type { GoogleWatchProfile };
