import { resolveTimeZone } from "@keeper.sh/calendar";

const INVALID_TIME_ZONE_MESSAGE = "timezone must be an IANA timezone identifier";

type TimeZoneErrorFactory = (identifier: string, cause?: unknown) => Error;

const resolveTimeZoneOrThrow = (identifier: string, toError: TimeZoneErrorFactory): string => {
  try {
    const timeZone = resolveTimeZone(identifier);
    if (timeZone) {
      return timeZone;
    }
  } catch (error) {
    if (!(error instanceof RangeError)) {
      throw error;
    }
    throw toError(identifier, error);
  }
  throw toError(identifier);
};

export { INVALID_TIME_ZONE_MESSAGE, resolveTimeZoneOrThrow };
