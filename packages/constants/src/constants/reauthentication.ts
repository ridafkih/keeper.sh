const REAUTHENTICATION_SOURCE_INGEST = "source-ingest";
const REAUTHENTICATION_SOURCE_CREDENTIALS = "source-credentials";
const REAUTHENTICATION_TOKEN_REFRESH = "token-refresh";
const REAUTHENTICATION_DESTINATION_GRANT = "destination-grant";

// A source pull proves only the source credential; only a fresh grant clears a grant-raised demand.
const INGEST_UNADJUDICABLE_REAUTHENTICATION_SOURCES = [REAUTHENTICATION_DESTINATION_GRANT];

/*
 * A provider outage can flag a whole fleet of healthy accounts at once (iCloud flagged over a
 * hundred for four hours on 2026-11-17), so the email waits until an account has stayed
 * flagged for a full day.
 */
const REAUTHENTICATION_EMAIL_GRACE_MS = 24 * 60 * 60 * 1000;
const REAUTHENTICATION_EMAIL_BATCH_SIZE = 100;
const REAUTHENTICATION_RECONNECT_PATH = "/dashboard/accounts/:accountId/reconnect";

export {
  INGEST_UNADJUDICABLE_REAUTHENTICATION_SOURCES,
  REAUTHENTICATION_EMAIL_BATCH_SIZE,
  REAUTHENTICATION_EMAIL_GRACE_MS,
  REAUTHENTICATION_RECONNECT_PATH,
  REAUTHENTICATION_DESTINATION_GRANT,
  REAUTHENTICATION_SOURCE_CREDENTIALS,
  REAUTHENTICATION_SOURCE_INGEST,
  REAUTHENTICATION_TOKEN_REFRESH,
};
