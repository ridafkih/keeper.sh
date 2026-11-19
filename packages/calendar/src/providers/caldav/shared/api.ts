import { BYTES_PER_MEBIBYTE } from "../../../utils/bounded-response";

const CALDAV_MULTIGET_BATCH_SIZE = 250;
const MAX_CALDAV_RESPONSE_BYTES = 25 * BYTES_PER_MEBIBYTE;

const toComparablePath = (path: string): string => {
  const trimmed = path.replace(/\/+$/u, "");
  try {
    return decodeURIComponent(trimmed);
  } catch {
    return trimmed;
  }
};

const isCalendarObjectPath = (path: string, collectionPath: string): boolean =>
  !path.endsWith("/") && toComparablePath(path) !== toComparablePath(collectionPath);

const toCalDAVTimestamp = (value: string): string =>
  `${new Date(value).toISOString().slice(0, 19).replaceAll(/[-:.]/gu, "")}Z`;

const buildCalendarObjectFilters = (timeRange?: { start: string; end: string }): unknown[] => [
  {
    "comp-filter": {
      _attributes: { name: "VCALENDAR" },
      "comp-filter": {
        _attributes: { name: "VEVENT" },
        ...(timeRange && {
          "time-range": {
            _attributes: {
              start: toCalDAVTimestamp(timeRange.start),
              end: toCalDAVTimestamp(timeRange.end),
            },
          },
        }),
      },
    },
  },
];

export {
  buildCalendarObjectFilters,
  CALDAV_MULTIGET_BATCH_SIZE,
  isCalendarObjectPath,
  MAX_CALDAV_RESPONSE_BYTES,
};
