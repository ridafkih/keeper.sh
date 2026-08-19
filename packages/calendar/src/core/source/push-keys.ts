const PENDING_INGEST_KEY = "push:pending-ingest";
const PENDING_FAILURES_KEY = "push:pending-failures";
// Held beside the sorted set, never inside its member.
// The member stays the bare calendar id RELEASE_IF_UNCHANGED scores on.
const PENDING_CORRELATION_KEY = "push:pending-correlation";
// A lossy nudge, not a queue: the sorted set above stays the durable record.
const PENDING_SIGNAL_KEY = "push:pending-signal";
const UNKNOWN_CHANNEL_PREFIX = "push:nochan";

const buildUnknownChannelKey = (provider: string, channelKey: string): string =>
  `${UNKNOWN_CHANNEL_PREFIX}:${provider}:${channelKey}`;

export {
  buildUnknownChannelKey,
  PENDING_CORRELATION_KEY,
  PENDING_FAILURES_KEY,
  PENDING_INGEST_KEY,
  PENDING_SIGNAL_KEY,
  UNKNOWN_CHANNEL_PREFIX,
};
