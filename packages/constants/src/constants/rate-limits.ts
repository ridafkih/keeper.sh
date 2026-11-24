/*
 * Google enforces one per-user quota across every job that touches the account, so the
 * ceiling below is the whole budget rather than a per-job allowance. Destination push
 * is deliberately capped under that ceiling: a large drain and a full re-ingest run
 * concurrently, and an uncapped drain would spend the minute before ingestion could
 * claim any of it.
 */
const GOOGLE_REQUESTS_PER_MINUTE = 500;
const GOOGLE_PUSH_REQUESTS_PER_MINUTE = 350;

/*
 * Microsoft Graph throttles per mailbox rather than per application, so the ceiling is
 * a property of the destination account. Pacing under MailboxConcurrency keeps a large
 * drain from earning the 429s the retry path would otherwise have to absorb.
 */
const OUTLOOK_REQUESTS_PER_MINUTE = 300;

const GOOGLE_PROJECT_REQUESTS_PER_MINUTE = 10_000;

const ICLOUD_ACCOUNT_REQUESTS_PER_MINUTE = 240;
const FASTMAIL_ACCOUNT_REQUESTS_PER_MINUTE = 240;

interface AccountThrottlePolicy {
  requestsPerMinute: number;
  minimumRequestsPerMinute: number;
  initialCooldownMs: number;
  maximumCooldownMs: number;
  recoveryWindowMs: number;
  jitterRatio: number;
  maximumParkMs: number;
}

const HOSTED_CALDAV_THROTTLE_RESPONSE: Omit<AccountThrottlePolicy, "requestsPerMinute"> = {
  initialCooldownMs: 30_000,
  jitterRatio: 0.2,
  maximumCooldownMs: 15 * 60_000,
  maximumParkMs: 15_000,
  minimumRequestsPerMinute: 15,
  recoveryWindowMs: 10 * 60_000,
};

const ICLOUD_ACCOUNT_THROTTLE_POLICY: AccountThrottlePolicy = {
  ...HOSTED_CALDAV_THROTTLE_RESPONSE,
  requestsPerMinute: ICLOUD_ACCOUNT_REQUESTS_PER_MINUTE,
};

const FASTMAIL_ACCOUNT_THROTTLE_POLICY: AccountThrottlePolicy = {
  ...HOSTED_CALDAV_THROTTLE_RESPONSE,
  requestsPerMinute: FASTMAIL_ACCOUNT_REQUESTS_PER_MINUTE,
};

export {
  FASTMAIL_ACCOUNT_REQUESTS_PER_MINUTE,
  FASTMAIL_ACCOUNT_THROTTLE_POLICY,
  ICLOUD_ACCOUNT_THROTTLE_POLICY,
  GOOGLE_PROJECT_REQUESTS_PER_MINUTE,
  GOOGLE_PUSH_REQUESTS_PER_MINUTE,
  GOOGLE_REQUESTS_PER_MINUTE,
  ICLOUD_ACCOUNT_REQUESTS_PER_MINUTE,
  OUTLOOK_REQUESTS_PER_MINUTE,
};
export type { AccountThrottlePolicy };
