/*
 * Google enforces one per-user quota across every job that touches the account, so the
 * ceiling below is the whole budget rather than a per-job allowance. Destination push
 * is deliberately capped under that ceiling: a large drain and a full re-ingest run
 * concurrently, and an uncapped drain would spend the minute before ingestion could
 * claim any of it.
 */
const GOOGLE_REQUESTS_PER_MINUTE = 500;
const GOOGLE_PUSH_REQUESTS_PER_MINUTE = 350;

export { GOOGLE_PUSH_REQUESTS_PER_MINUTE, GOOGLE_REQUESTS_PER_MINUTE };
