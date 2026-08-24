import { resolveRepresentableTimeRange } from "@keeper.sh/calendar";

interface IsoTimeRange {
  endTime: string;
  startTime: string;
}

interface IsoRangeShape extends IsoTimeRange {
  isAllDay?: boolean;
}

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
