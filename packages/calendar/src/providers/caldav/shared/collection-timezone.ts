import {
  readDeclaredTimeZoneOffsets,
  resolveTimeZoneIdentifier,
} from "../../../ics/utils/resolve-timezone-identifier";

interface CollectionTimeZoneProps {
  calendarTimezone?: unknown;
  calendarTimezoneId?: unknown;
}

const readPropertyText = (value: unknown): string | undefined => {
  if (typeof value === "string") {
    return value.trim() || globalThis.undefined;
  }
  if (typeof value !== "object" || value === null) {
    return;
  }
  const { _cdata: cdata, _text: text } = value as Record<string, unknown>;
  return readPropertyText(cdata ?? text);
};

const resolveTimeZoneIdProperty = (value: unknown): string | undefined =>
  resolveTimeZoneIdentifier(readPropertyText(value))?.timeZone;

const resolveVtimezoneProperty = (value: unknown): string | undefined => {
  const vcalendar = readPropertyText(value);
  if (!vcalendar) {
    return;
  }
  const declaredOffsets = readDeclaredTimeZoneOffsets(vcalendar);
  const [timeZoneId, ...others] = declaredOffsets.keys();
  if (others.length > 0) {
    return;
  }
  return resolveTimeZoneIdentifier(timeZoneId, declaredOffsets)?.timeZone;
};

const resolveCollectionTimeZone = (props: CollectionTimeZoneProps): string | undefined =>
  resolveTimeZoneIdProperty(props.calendarTimezoneId)
  ?? resolveVtimezoneProperty(props.calendarTimezone);

export { resolveCollectionTimeZone };
export type { CollectionTimeZoneProps };
