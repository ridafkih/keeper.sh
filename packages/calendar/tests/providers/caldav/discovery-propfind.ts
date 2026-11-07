const CALENDAR_HOME_URL = "https://caldav.example.test/home/";

interface ListedCalendar {
  components?: string[];
  ctag?: string;
  displayName?: string;
  projectedProps?: Record<string, unknown>;
  url: string;
}

interface DiscoveryPropfindRequest {
  depth: "0" | "1";
  url: string;
}

const toListingResponse = (calendar: ListedCalendar) => ({
  href: calendar.url,
  ok: true,
  props: {
    displayname: calendar.displayName,
    getctag: calendar.ctag,
    resourcetype: { calendar: {}, collection: {} },
    ...calendar.components && {
      supportedCalendarComponentSet: { comp: calendar.components.map((name) => ({ _attributes: { name } })) },
    },
    ...calendar.projectedProps,
  },
  status: 200,
  statusText: "OK",
});

const answerDiscoveryPropfind = (listCalendars: () => Promise<ListedCalendar[]> | ListedCalendar[]) =>
  async (request: DiscoveryPropfindRequest) => {
    if (request.depth === "1") {
      const calendars = await listCalendars();
      return calendars.map((calendar) => toListingResponse(calendar));
    }
    return [{
      href: request.url,
      ok: true,
      props: { calendarHomeSet: { href: CALENDAR_HOME_URL } },
      status: 200,
      statusText: "OK",
    }];
  };

export { answerDiscoveryPropfind };
