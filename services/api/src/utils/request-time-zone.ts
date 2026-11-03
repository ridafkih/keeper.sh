import { resolveTimeZone } from "@keeper.sh/calendar";

const INVALID_TIME_ZONE_MESSAGE = "timezone must be an IANA timezone identifier";

type TimeZoneErrorFactory = (identifier: string, cause?: unknown) => Error;

const readSupportedTimeZone = (identifier: string, toError: TimeZoneErrorFactory): string | undefined => {
  try {
    return resolveTimeZone(identifier);
  } catch (error) {
    if (!(error instanceof RangeError)) {
      throw error;
    }
    throw toError(identifier, error);
  }
};

const resolveTimeZoneOrThrow = (identifier: string, toError: TimeZoneErrorFactory): string => {
  const timeZone = readSupportedTimeZone(identifier, toError);
  if (!timeZone) {
    throw toError(identifier);
  }
  return timeZone;
};

export { INVALID_TIME_ZONE_MESSAGE, resolveTimeZoneOrThrow };
