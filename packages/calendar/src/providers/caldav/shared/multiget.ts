const CALDAV_MULTIGET_BATCH_SIZE = 250;
const MISSING_HREF_SAMPLE_SIZE = 5;

interface CalDAVIncompleteMultiGetDetails {
  batchCount: number;
  calendarUrl: string;
  hrefsRequested: number;
  missingHrefs: string[];
  objectsReturned: number;
}

class CalDAVIncompleteMultiGetError extends Error {
  readonly batchCount: number;
  readonly calendarUrl: string;
  readonly hrefsRequested: number;
  readonly missingHrefs: string[];
  readonly objectsReturned: number;

  constructor(details: CalDAVIncompleteMultiGetDetails) {
    super(
      `CalDAV multiget returned ${details.objectsReturned} of ${details.hrefsRequested} requested objects for ${details.calendarUrl}`,
    );
    this.name = "CalDAVIncompleteMultiGetError";
    this.batchCount = details.batchCount;
    this.calendarUrl = details.calendarUrl;
    this.hrefsRequested = details.hrefsRequested;
    this.missingHrefs = details.missingHrefs.slice(0, MISSING_HREF_SAMPLE_SIZE);
    this.objectsReturned = details.objectsReturned;
  }
}

const decodeHrefSegment = (segment: string): string => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

const toHrefKey = (href: string, calendarUrl: string): string =>
  new URL(href, calendarUrl).pathname
    .split("/")
    .map((segment) => encodeURIComponent(decodeHrefSegment(segment)))
    .join("/");

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

const toAbsoluteHref = (href: string, calendarUrl: string): string => {
  if (!href || href.startsWith("http")) {
    return href;
  }
  return new URL(href, calendarUrl).href;
};

const toCalendarObjectPathnames = (
  responses: { href?: string }[],
  calendarUrl: string,
): string[] => {
  const pathnames = responses
    .map(({ href }) => toAbsoluteHref(href ?? "", calendarUrl))
    .filter((href) => href.includes(".ics"))
    .map((href) => new URL(href).pathname);

  return [
    ...new Map(pathnames.map((pathname) => [toHrefKey(pathname, calendarUrl), pathname])).values(),
  ];
};

/*
 * A multiget row's calendar-data is typed as a string by tsdav, but a row
 * answered with an empty <C:calendar-data/> element parses to an object
 * instead, which the ICS parser cannot read.
 */
const hasCalendarData = (object: { data?: unknown }): boolean =>
  typeof object.data === "string";

const orderCalendarObjectsByHref = <TObject extends { url: string }>(
  requestedPathnames: string[],
  objects: TObject[],
  calendarUrl: string,
): TObject[] => {
  const objectsByHrefKey = new Map(
    objects.map((object) => [toHrefKey(object.url, calendarUrl), object]),
  );

  return requestedPathnames.flatMap((pathname) => {
    const object = objectsByHrefKey.get(toHrefKey(pathname, calendarUrl));
    if (!object) {
      return [];
    }
    return [object];
  });
};

const findMissingHrefs = (
  requestedPathnames: string[],
  objects: { url: string }[],
  calendarUrl: string,
): string[] => {
  const returnedHrefKeys = new Set(objects.map(({ url }) => toHrefKey(url, calendarUrl)));

  return requestedPathnames.filter(
    (pathname) => !returnedHrefKeys.has(toHrefKey(pathname, calendarUrl)),
  );
};

export {
  buildCalendarObjectFilters,
  CALDAV_MULTIGET_BATCH_SIZE,
  CalDAVIncompleteMultiGetError,
  findMissingHrefs,
  hasCalendarData,
  orderCalendarObjectsByHref,
  toCalendarObjectPathnames,
  toHrefKey,
};
