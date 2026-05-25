/**
 * ICS pre-parse patch layer.
 *
 * Real-world iCalendar feeds frequently violate RFC 5545 in well-known,
 * recoverable ways (e.g. bare-date `DTSTART:YYYYMMDD` without `VALUE=DATE`).
 * Apple, Google, and Outlook tolerate these violations; strict parsers like
 * `ts-ics` do not. Each accommodation lives as a named, declarative patch
 * that targets specific properties and coerces their parameters/value, run as
 * a pre-pass before the strict parser sees the text.
 */

interface IcsPatchCoercion {
  params: string;
  value: string;
}

interface IcsPatch {
  readonly name: string;
  readonly properties: readonly string[];
  coerce(params: string, value: string): IcsPatchCoercion | null;
}

interface ParsedPropertyLine {
  property: string;
  params: string;
  value: string;
}

const LINE_BREAK_PATTERN = /\r?\n/;
const CONTINUATION_PATTERN = /^[ \t]/;
const PROPERTY_LINE_PATTERN = /^([A-Za-z][A-Za-z0-9-]*)((?:;[^:]*)?):(.*)$/;

const unfoldLines = (ics: string): string[] => {
  const unfolded: string[] = [];
  for (const rawLine of ics.split(LINE_BREAK_PATTERN)) {
    const previousIndex = unfolded.length - 1;
    if (CONTINUATION_PATTERN.test(rawLine) && previousIndex >= 0) {
      unfolded[previousIndex] = `${unfolded[previousIndex]}${rawLine.slice(1)}`;
    } else {
      unfolded.push(rawLine);
    }
  }
  return unfolded;
};

const parsePropertyLine = (line: string): ParsedPropertyLine | null => {
  const match = PROPERTY_LINE_PATTERN.exec(line);
  if (!match) {
    return null;
  }
  const [, property, params, value] = match;
  if (typeof property !== "string" || typeof params !== "string" || typeof value !== "string") {
    return null;
  }
  return { params, property: property.toUpperCase(), value };
};

const coercePropertyLine = (
  parsed: ParsedPropertyLine,
  patches: readonly IcsPatch[],
): IcsPatchCoercion => {
  let current: IcsPatchCoercion = { params: parsed.params, value: parsed.value };
  for (const patch of patches) {
    if (!patch.properties.includes(parsed.property)) {
      continue;
    }
    current = patch.coerce(current.params, current.value) ?? current;
  }
  return current;
};

const transformLine = (line: string, patches: readonly IcsPatch[]): string => {
  const parsed = parsePropertyLine(line);
  if (!parsed) {
    return line;
  }
  const coerced = coercePropertyLine(parsed, patches);
  if (coerced.params === parsed.params && coerced.value === parsed.value) {
    return line;
  }
  return `${parsed.property}${coerced.params}:${coerced.value}`;
};

const applyIcsPatches = (
  ics: string,
  patches: readonly IcsPatch[],
): string =>
  unfoldLines(ics)
    .map((line) => transformLine(line, patches))
    .join("\r\n");

export { applyIcsPatches };
export type { IcsPatch, IcsPatchCoercion };
