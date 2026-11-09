import { EventRangeValidationError } from "@/utils/date-range";
import { INVALID_TIME_ZONE_MESSAGE, resolveTimeZoneOrThrow } from "@/utils/request-time-zone";

const parseViewerTimeZone = (url: URL): string | undefined => {
  const identifier = url.searchParams.get("timezone");
  if (identifier === null) {
    return globalThis.undefined;
  }
  return resolveTimeZoneOrThrow(identifier, () => new EventRangeValidationError(INVALID_TIME_ZONE_MESSAGE));
};

export { parseViewerTimeZone };
