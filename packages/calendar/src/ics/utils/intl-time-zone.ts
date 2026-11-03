const MINUTES_PER_HOUR = 60;
const LONG_OFFSET_PATTERN = /^GMT(?:(?<sign>[+-])(?<hours>\d{2}):(?<minutes>\d{2}))?$/;

const formattableTimeZones = new Map<string, boolean>();
const offsetFormatters = new Map<string, Intl.DateTimeFormat>();

const canFormatTimeZone = (timeZone: string): boolean => {
  const known = formattableTimeZones.get(timeZone);
  if (known !== globalThis.undefined) {
    return known;
  }
  let formattable = true;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone }).format(0);
  } catch {
    formattable = false;
  }
  formattableTimeZones.set(timeZone, formattable);
  return formattable;
};

const getOffsetFormatter = (timeZone: string): Intl.DateTimeFormat => {
  const existing = offsetFormatters.get(timeZone);
  if (existing) {
    return existing;
  }
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" });
  offsetFormatters.set(timeZone, formatter);
  return formatter;
};

const readTimeZoneOffsetMinutes = (timeZone: string, instant: Date): number | undefined => {
  const label = getOffsetFormatter(timeZone)
    .formatToParts(instant)
    .find((part) => part.type === "timeZoneName")?.value ?? "";
  const match = LONG_OFFSET_PATTERN.exec(label);
  if (!match) {
    return;
  }
  const { hours, minutes, sign } = match.groups ?? {};
  if (!sign) {
    return 0;
  }
  const magnitude = Number(hours) * MINUTES_PER_HOUR + Number(minutes);
  if (sign === "-") {
    return -magnitude;
  }
  return magnitude;
};

const listSupportedTimeZones = (): readonly string[] => Intl.supportedValuesOf("timeZone");

export { canFormatTimeZone, listSupportedTimeZones, readTimeZoneOffsetMinutes };
