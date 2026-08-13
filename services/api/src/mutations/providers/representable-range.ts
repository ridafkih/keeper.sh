import { resolveRepresentableTimeRange } from "@keeper.sh/calendar";

interface IsoTimeRange {
  endTime: string;
  startTime: string;
}

interface IsoRangeShape extends IsoTimeRange {
  isAllDay?: boolean;
}

/*
 * Every destination refuses a range it cannot hold: Google answers "The specified time
 * range is empty." for a span that does not grow, RFC 5545 §3.6.1 requires DTEND to be
 * later than DTSTART, and Graph rejects an all-day event whose wall times are not
 * midnight. A write therefore leaves this seam shaped by the same rule every read
 * publishes and every sync destination mirrors, so one event names one span wherever it
 * is looked at. An instant the shaping leaves where it found it keeps the string the
 * caller stated, so a range a destination already accepts crosses the wire untouched.
 */
const keepStatedInstant = (stated: string, shaped: Date, original: Date): string => {
  if (shaped.getTime() === original.getTime()) {
    return stated;
  }
  return shaped.toISOString();
};

const resolveRepresentableIsoRange = (
  { endTime, isAllDay, startTime }: IsoRangeShape,
): IsoTimeRange => {
  const start = new Date(startTime);
  const end = new Date(endTime);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new TypeError(`Event range is not a pair of instants: ${startTime}/${endTime}`);
  }

  const shaped = resolveRepresentableTimeRange({
    endTime: end,
    startTime: start,
    ...(typeof isAllDay === "boolean" && { isAllDay }),
  });

  return {
    endTime: keepStatedInstant(endTime, shaped.endTime, end),
    startTime: keepStatedInstant(startTime, shaped.startTime, start),
  };
};

export { resolveRepresentableIsoRange };
export type { IsoTimeRange };
