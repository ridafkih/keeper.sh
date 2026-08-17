import { calendarPath } from "./fake-caldav";

interface EventDraft {
  readonly uid?: string;
  readonly summary?: string;
  readonly start?: string;
  readonly end?: string;
  readonly tzid?: string | null;
  readonly sequence?: number | null;
  readonly extraLines?: readonly string[];
}

const veventLines = (draft: EventDraft): readonly string[] => {
  const tzid = draft.tzid ?? null;
  const stamp = (name: string, value: string): string => {
    if (!tzid) {
      return `${name}:${value}`;
    }
    return `${name};TZID=${tzid}:${value}`;
  };
  const sequence = draft.sequence ?? null;
  const sequenceLines = (() => {
    if (sequence === null) {
      return [];
    }
    return [`SEQUENCE:${sequence}`];
  })();
  return [
    "BEGIN:VEVENT",
    `UID:${draft.uid ?? "event-one@example.com"}`,
    "DTSTAMP:19700101T000000Z",
    stamp("DTSTART", draft.start ?? "20260321T090000Z"),
    stamp("DTEND", draft.end ?? "20260321T100000Z"),
    `SUMMARY:${draft.summary ?? "Standup"}`,
    ...sequenceLines,
    ...(draft.extraLines ?? []),
    "END:VEVENT",
  ];
};

const calendarOf = (events: readonly EventDraft[], preamble: readonly string[] = []): string =>
  [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//fake//caldav//EN",
    ...preamble,
    ...events.flatMap((event) => [...veventLines(event)]),
    "END:VCALENDAR",
    "",
  ].join("\r\n");

const resourceAt = (name: string, events: readonly EventDraft[]): { path: string; data: string } => ({
  path: `${calendarPath}${name}`,
  data: calendarOf(events),
});

const singleEventResource = (name: string, draft: EventDraft = {}): { path: string; data: string } =>
  resourceAt(name, [draft]);

const manyResources = (count: number): readonly { path: string; data: string }[] =>
  Array.from({ length: count }, (unused, index) =>
    singleEventResource(`bulk-${index}.ics`, {
      uid: `bulk-${index}@example.com`,
      summary: `Bulk ${index}`,
    }),
  );

const selfAuthoredResource = (
  name: string,
  installation: string,
  draft: EventDraft = {},
): { path: string; data: string } =>
  resourceAt(name, [
    { ...draft, extraLines: [`X-KEEPER-INSTALLATION:${installation}`, ...(draft.extraLines ?? [])] },
  ]);

const unparseableResource = (name: string): { path: string; data: string } => ({
  path: `${calendarPath}${name}`,
  data: "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART:not-a-date\r\n",
});

const emptyBodyResource = (name: string): { path: string; data: string } => ({
  path: `${calendarPath}${name}`,
  data: "  ",
});

export {
  calendarOf,
  emptyBodyResource,
  manyResources,
  resourceAt,
  selfAuthoredResource,
  singleEventResource,
  unparseableResource,
  veventLines,
};
export type { EventDraft };
