import type { calendar_v3 } from "@googleapis/calendar";

type OriginalStart =
  | { readonly kind: "date"; readonly value: string }
  | { readonly kind: "dateTime"; readonly value: string };

const basicDate = (value: string): string | null => {
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return new Date(parsed).toISOString().slice(0, 10).replaceAll("-", "");
};

const basicInstant = (value: string): string | null => {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return null;
  }
  const iso = new Date(parsed).toISOString();
  return `${iso.slice(0, 10).replaceAll("-", "")}T${iso.slice(11, 19).replaceAll(":", "")}Z`;
};

const originalStartOf = (item: calendar_v3.Schema$Event): OriginalStart | null => {
  const named = item.originalStartTime;
  if (!named) {
    return null;
  }
  if (typeof named.date === "string") {
    const value = basicDate(named.date);
    if (value === null) {
      return null;
    }
    return { kind: "date", value };
  }
  if (typeof named.dateTime === "string") {
    const value = basicInstant(named.dateTime);
    if (value === null) {
      return null;
    }
    return { kind: "dateTime", value };
  }
  return null;
};

const exceptionDateLine = (start: OriginalStart): string => {
  if (start.kind === "date") {
    return `EXDATE;VALUE=DATE:${start.value}`;
  }
  return `EXDATE:${start.value}`;
};

const instanceUidSuffix = (start: OriginalStart): string => `#${start.value}`;

export { exceptionDateLine, instanceUidSuffix, originalStartOf };
export type { OriginalStart };
