import type { Instant } from "@keeper.sh/sync-protocol";
import { ShadowInternalDataError } from "../errors";
import { isCanonicalUtcInstant } from "./instant";

const millisecondsPerSecond = 1000;
const secondsPerDay = 86_400;
const daysPerEra = 146_097;
const yearsPerEra = 400;
const daysFromCivilToUnixEpoch = 719_468;

const marchShiftedYear = (year: number, month: number): number => {
  if (month <= 2) {
    return year - 1;
  }
  return year;
};

const marchShiftedMonth = (month: number): number => {
  if (month > 2) {
    return month - 3;
  }
  return month + 9;
};

const daysFromCivil = (year: number, month: number, day: number): number => {
  const shiftedYear = marchShiftedYear(year, month);
  const era = Math.floor(shiftedYear / yearsPerEra);
  const yearOfEra = shiftedYear - era * yearsPerEra;
  const dayOfYear = Math.floor((153 * marchShiftedMonth(month) + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * daysPerEra + dayOfEra - daysFromCivilToUnixEpoch;
};

const fieldAt = (value: string, from: number, to: number): number => Number(value.slice(from, to));

const refuseNonCanonical = (instant: Instant): never => {
  throw new ShadowInternalDataError(
    `an instant reached the arithmetic without being canonical: ${instant.value}`,
  );
};

const epochMillisecondsOf = (instant: Instant): number => {
  if (!isCanonicalUtcInstant(instant)) {
    return refuseNonCanonical(instant);
  }
  const { value } = instant;
  const days = daysFromCivil(fieldAt(value, 0, 4), fieldAt(value, 5, 7), fieldAt(value, 8, 10));
  const secondsOfDay =
    fieldAt(value, 11, 13) * 3600 + fieldAt(value, 14, 16) * 60 + fieldAt(value, 17, 19);
  return (days * secondsPerDay + secondsOfDay) * millisecondsPerSecond + fieldAt(value, 20, 23);
};

const secondsBetween = (earlier: Instant, later: Instant): number =>
  (epochMillisecondsOf(later) - epochMillisecondsOf(earlier)) / millisecondsPerSecond;

export { epochMillisecondsOf, secondsBetween };
