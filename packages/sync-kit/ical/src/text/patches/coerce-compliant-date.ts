import type { IcsPatch, IcsPatchCoercion } from "../patch";

const bareDate = /^(\d{4})(\d{2})(\d{2})$/u;

const isRealCalendarDate = (value: string): boolean => {
  const matched = bareDate.exec(value);
  if (!matched) {
    return false;
  }
  const [, year, month, day] = matched;
  const asUtc = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return (
    asUtc.getUTCFullYear() === Number(year) &&
    asUtc.getUTCMonth() + 1 === Number(month) &&
    asUtc.getUTCDate() === Number(day)
  );
};

const coerceCompliantDate: IcsPatch = {
  properties: ["DTSTART", "DTEND", "EXDATE", "RDATE", "RECURRENCE-ID"],
  coerce: (params: string, value: string): IcsPatchCoercion | null => {
    if (params !== "") {
      return null;
    }
    const values = value.split(",");
    if (values.length === 0 || !values.every((entry) => isRealCalendarDate(entry))) {
      return null;
    }
    return { params: ";VALUE=DATE", value };
  },
};

export { coerceCompliantDate, isRealCalendarDate };
