import type { OccurrenceDuration } from "@keeper.sh/sync-protocol";

const weekDuration = /^P(\d+)W$/u;
const dateAndTimeDuration = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/u;

const secondsInMinute = 60;
const secondsInHour = 3600;
const secondsInDay = 86_400;
const daysInWeek = 7;
const maxRepresentableDays = 366_000;
const maxRepresentableSeconds = maxRepresentableDays * secondsInDay;

const nominalDays = (days: number): OccurrenceDuration | null => {
  if (days > maxRepresentableDays) {
    return null;
  }
  return { kind: "nominal", days };
};

const exactSeconds = (seconds: number): OccurrenceDuration | null => {
  if (seconds > maxRepresentableSeconds) {
    return null;
  }
  return { kind: "exact", seconds };
};

const parseIcsDuration = (value: string): OccurrenceDuration | null => {
  const weeks = weekDuration.exec(value);
  if (weeks) {
    return nominalDays(Number(weeks[1]) * daysInWeek);
  }
  const matched = dateAndTimeDuration.exec(value);
  if (!matched) {
    return null;
  }
  const [, days, hours, minutes, seconds] = matched;
  const hasTime = Boolean(hours ?? minutes ?? seconds);
  if (!days && !hasTime) {
    return null;
  }
  if (days && hasTime) {
    return null;
  }
  if (days) {
    return nominalDays(Number(days));
  }
  return exactSeconds(
    Number(hours ?? 0) * secondsInHour +
      Number(minutes ?? 0) * secondsInMinute +
      Number(seconds ?? 0),
  );
};

export { maxRepresentableDays, maxRepresentableSeconds, parseIcsDuration };
