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

export {
  GOOGLE_PUSH_REQUESTS_PER_MINUTE,
  GOOGLE_REQUESTS_PER_MINUTE,
  OUTLOOK_REQUESTS_PER_MINUTE,
};
