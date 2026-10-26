const UNKNOWN_CHANNEL_PREFIX = "push:nochan";

const buildUnknownChannelKey = (provider: string, channelKey: string): string =>
  `${UNKNOWN_CHANNEL_PREFIX}:${provider}:${channelKey}`;

export { buildUnknownChannelKey };
