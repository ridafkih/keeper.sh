interface IcsProperty {
  parameters: string[];
  property: string;
  propertyName: string;
  value: string;
}

const TZID_PARAMETER_PATTERN = /;TZID=(?:"([^"]*)"|([^;:]*))/i;
const DATE_TIME_PATTERN = /^(\d{8})T(\d{6})$/;

const parseIcsProperty = (line: string): IcsProperty | null => {
  const separatorIndex = line.indexOf(":");
  if (separatorIndex === -1) {
    return null;
  }
  const property = line.slice(0, separatorIndex);
  const [propertyName, ...parameters] = property.toUpperCase().split(";");
  if (!propertyName) {
    return null;
  }
  return {
    parameters,
    property,
    propertyName,
    value: line.slice(separatorIndex + 1),
  };
};

const readTimeZoneParameter = (property: string): string | undefined => {
  const match = TZID_PARAMETER_PATTERN.exec(property);
  return match?.[1] ?? match?.[2];
};

const padded = (value: number, length = 2): string => String(value).padStart(length, "0");

const toFloatingIcsDateTime = (wallTime: Date): string => [
  padded(wallTime.getUTCFullYear(), 4),
  padded(wallTime.getUTCMonth() + 1),
  padded(wallTime.getUTCDate()),
  "T",
  padded(wallTime.getUTCHours()),
  padded(wallTime.getUTCMinutes()),
  padded(wallTime.getUTCSeconds()),
].join("");

const toUtcIcsDateTime = (instant: Date): string => `${toFloatingIcsDateTime(instant)}Z`;

const readDateTimeWallTime = (value: string): Date | undefined => {
  const [, date, time] = DATE_TIME_PATTERN.exec(value.replace(/Z$/i, "")) ?? [];
  if (!date || !time) {
    return;
  }
  return new Date(Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(4, 6)) - 1,
    Number(date.slice(6, 8)),
    Number(time.slice(0, 2)),
    Number(time.slice(2, 4)),
    Number(time.slice(4, 6)),
  ));
};

export {
  parseIcsProperty,
  readDateTimeWallTime,
  readTimeZoneParameter,
  toFloatingIcsDateTime,
  toUtcIcsDateTime,
};
export type { IcsProperty };
