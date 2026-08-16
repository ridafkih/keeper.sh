import { Text } from "@/components/ui/primitives/text";

interface WriteBackDeletion {
  confirmed: boolean;
  deletedAt: string;
  description: string | null;
  destinationCalendarName: string | null;
  endTime: string | null;
  expiresAt: string;
  id: string;
  isAllDay: boolean;
  location: string | null;
  sourceCalendarName: string | null;
  startTime: string | null;
  startTimeZone: string | null;
  title: string | null;
}

const UNTITLED_EVENT_LABEL = "Untitled event";
const UNKNOWN_CALENDAR_LABEL = "a calendar that has since been removed";
const UNREADABLE_EVENT_LABEL = "Keeper.sh could not read the details of this event.";
const UNCONFIRMED_DELETION_LABEL =
  "Keeper.sh asked the calendar to delete this event but never got confirmation, so the"
  + " original may still be there.";

const formatInstant = (value: string | null): string | null => {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toLocaleString(undefined, {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "long",
    year: "numeric",
  });
};

const formatDay = (value: string): string => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
};

const describeWhen = (deletion: WriteBackDeletion): string | null => {
  const start = formatInstant(deletion.startTime);
  if (!start) {
    return null;
  }
  if (deletion.isAllDay) {
    return `All day on ${formatDay(deletion.startTime ?? deletion.deletedAt)}`;
  }
  const end = formatInstant(deletion.endTime);
  return end ? `${start} to ${end}` : start;
};

const describeCalendars = (deletion: WriteBackDeletion): string => {
  const source = deletion.sourceCalendarName ?? UNKNOWN_CALENDAR_LABEL;
  const destination = deletion.destinationCalendarName ?? UNKNOWN_CALENDAR_LABEL;
  return `Deleted from ${source} on ${formatDay(deletion.deletedAt)}, after the copy on ${destination} was deleted.`;
};

const describeRetention = (deletion: WriteBackDeletion): string =>
  `This record is kept until ${formatDay(deletion.expiresAt)}.`;

function DeletedEventRow({ deletion }: { deletion: WriteBackDeletion }) {
  const when = describeWhen(deletion);

  return (
    <li className="flex flex-col gap-1 rounded-md border border-border p-3">
      <Text size="sm">{deletion.title ?? UNTITLED_EVENT_LABEL}</Text>
      {when && <Text size="xs" tone="muted">{when}</Text>}
      {!when && <Text size="xs" tone="muted">{UNREADABLE_EVENT_LABEL}</Text>}
      {deletion.location && <Text size="xs" tone="muted">{deletion.location}</Text>}
      {deletion.description && <Text size="xs" tone="muted">{deletion.description}</Text>}
      <Text size="xs" tone="muted">{describeCalendars(deletion)}</Text>
      {!deletion.confirmed && <Text size="xs" tone="muted">{UNCONFIRMED_DELETION_LABEL}</Text>}
      <Text size="xs" tone="muted">{describeRetention(deletion)}</Text>
    </li>
  );
}

const TRUNCATED_RECORD_COPY =
  "This is only the most recent part of the record. There are older deletions from the last"
  + " 30 days that are not shown here — contact support to see them.";

const EMPTY_RECORD_COPY =
  "Keeper.sh has not deleted any original events on your calendars in the last 30 days.";

/*
 * Turning on deletion propagation is authorized against a promise that Keeper.sh keeps a
 * record of what it deleted for 30 days. This is that record. It is read-only on purpose:
 * putting an event back on a source calendar would re-invite everyone it named, so the
 * product hands the user what was there and lets them decide.
 */
function DeletedEventsRecord(
  { deletions, truncated }: { deletions: WriteBackDeletion[]; truncated?: boolean },
) {
  if (deletions.length === 0) {
    return <Text size="sm" tone="muted">{EMPTY_RECORD_COPY}</Text>;
  }

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-2">
        {deletions.map((deletion) => (
          <DeletedEventRow deletion={deletion} key={deletion.id} />
        ))}
      </ul>
      {truncated && <Text size="xs" tone="muted">{TRUNCATED_RECORD_COPY}</Text>}
    </div>
  );
}

export {
  DeletedEventsRecord,
  EMPTY_RECORD_COPY,
  TRUNCATED_RECORD_COPY,
  UNCONFIRMED_DELETION_LABEL,
  UNTITLED_EVENT_LABEL,
};
export type { WriteBackDeletion };
