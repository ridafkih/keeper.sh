interface AllDayEventShape {
  startTime: Date;
  endTime: Date;
  isAllDay?: boolean;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const isMidnightUtc = (value: Date): boolean =>
  value.getUTCHours() === 0
  && value.getUTCMinutes() === 0
  && value.getUTCSeconds() === 0
  && value.getUTCMilliseconds() === 0;

const inferAllDayEvent = ({ startTime, endTime }: Omit<AllDayEventShape, "isAllDay">): boolean => {
  const durationMs = endTime.getTime() - startTime.getTime();

  if (durationMs <= 0 || durationMs % MS_PER_DAY !== 0) {
    return false;
  }

  return isMidnightUtc(startTime) && isMidnightUtc(endTime);
};

const resolveIsAllDayEvent = ({ isAllDay, startTime, endTime }: AllDayEventShape): boolean => {
  if (typeof isAllDay === "boolean") {
    return isAllDay;
  }

  return inferAllDayEvent({ endTime, startTime });
};

export { inferAllDayEvent, resolveIsAllDayEvent };
export type { AllDayEventShape };
