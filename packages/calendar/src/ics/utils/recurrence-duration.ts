import type { IcsDuration } from "ts-ics";
import { MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE, MS_PER_SECOND, MS_PER_WEEK } from "@keeper.sh/constants";
import { instantToWallTime, wallTimeToInstant } from "./timezone-instant";

const getIcsDurationNominalMilliseconds = (duration: IcsDuration): number =>
  (duration.weeks ?? 0) * MS_PER_WEEK
  + (duration.days ?? 0) * MS_PER_DAY
  + (duration.hours ?? 0) * MS_PER_HOUR
  + (duration.minutes ?? 0) * MS_PER_MINUTE
  + (duration.seconds ?? 0) * MS_PER_SECOND;

const addIcsDuration = (
  start: Date,
  duration: IcsDuration,
  timeZone: string | undefined,
): Date => {
  const nominalMilliseconds = (duration.weeks ?? 0) * MS_PER_WEEK
    + (duration.days ?? 0) * MS_PER_DAY;
  let result = start;
  if (nominalMilliseconds !== 0) {
    let wallStart = start;
    if (timeZone) {
      wallStart = instantToWallTime(start, timeZone);
    }
    const wallEnd = new Date(wallStart.getTime() + nominalMilliseconds);
    result = wallEnd;
    if (timeZone) {
      result = wallTimeToInstant(wallEnd, timeZone);
    }
  }

  const accurateMilliseconds = (duration.hours ?? 0) * MS_PER_HOUR
    + (duration.minutes ?? 0) * MS_PER_MINUTE
    + (duration.seconds ?? 0) * MS_PER_SECOND;
  return new Date(result.getTime() + accurateMilliseconds);
};

export { addIcsDuration, getIcsDurationNominalMilliseconds };
