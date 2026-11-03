import { resolveTimeZone } from "@keeper.sh/calendar";
import { EventRangeValidationError } from "@/utils/date-range";

const INVALID_VIEWER_TIME_ZONE_MESSAGE = "timezone must be an IANA timezone identifier";

const resolveViewerTimeZone = (identifier: string): string => {
  try {
    const timeZone = resolveTimeZone(identifier);
    if (timeZone) {
      return timeZone;
    }
  } catch (error) {
    if (!(error instanceof RangeError)) {
      throw error;
    }
  }
  throw new EventRangeValidationError(INVALID_VIEWER_TIME_ZONE_MESSAGE);
};

const parseViewerTimeZone = (url: URL): string | undefined => {
  const identifier = url.searchParams.get("timezone");
  if (identifier === null) {
    return globalThis.undefined;
  }
  return resolveViewerTimeZone(identifier);
};

export { parseViewerTimeZone };
