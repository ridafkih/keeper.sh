const PENDING_INGEST_KEY = "push:pending-ingest";
const PENDING_FAILURES_KEY = "push:pending-failures";
const UNKNOWN_CHANNEL_PREFIX = "push:nochan";

const buildUnknownChannelKey = (provider: string, channelKey: string): string =>
  `${UNKNOWN_CHANNEL_PREFIX}:${provider}:${channelKey}`;

export {
  buildUnknownChannelKey,
  PENDING_FAILURES_KEY,
  PENDING_INGEST_KEY,
  UNKNOWN_CHANNEL_PREFIX,
};
