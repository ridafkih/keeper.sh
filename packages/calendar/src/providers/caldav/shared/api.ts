const CALDAV_MULTIGET_BATCH_SIZE = 250;

const isCalendarObjectPath = (path: string): boolean => path.includes(".ics");

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

export { buildCalendarObjectFilters, CALDAV_MULTIGET_BATCH_SIZE, isCalendarObjectPath };
