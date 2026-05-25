/**
 * ICS pre-parse patch layer.
 *
 * Real-world iCalendar feeds frequently violate RFC 5545 in well-known,
 * recoverable ways (e.g. bare-date `DTSTART:YYYYMMDD` without `VALUE=DATE`).
 * Apple, Google, and Outlook tolerate these violations; strict parsers like
 * `ts-ics` do not. Each accommodation lives as a declarative patch that targets
 * specific properties and coerces their parameters/value, run as a pre-pass
 * before the strict parser sees the text.
 *
 * Lines whose property no patch modifies are emitted verbatim (preserving
 * RFC 5545 §3.1 line folding); only modified properties are emitted in their
 * unfolded, rewritten form. Line breaks are normalized to CRLF on output
 * since RFC 5545 §3.1 mandates that terminator.
 */

interface IcsPatchCoercion {
  params: string;
  value: string;
}

interface IcsPatch {
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

const groupContinuations = (rawLines: readonly string[]): number[][] => {
  const groups: number[][] = [];
  for (let index = 0; index < rawLines.length; index += 1) {
    const rawLine = rawLines[index];
    if (typeof rawLine !== "string") {
      continue;
    }
    const lastGroup = groups.at(-1);
    if (lastGroup && CONTINUATION_PATTERN.test(rawLine)) {
      lastGroup.push(index);
    } else {
      groups.push([index]);
    }
  }
  return groups;
};

const unfoldGroup = (rawLines: readonly string[], indices: readonly number[]): string => {
  let unfolded = "";
  for (const [position, index] of indices.entries()) {
    const raw = rawLines[index] ?? "";
    if (position === 0) {
      unfolded += raw;
      continue;
    }
    unfolded += raw.slice(1);
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

const applyIcsPatches = (
  ics: string,
  patches: readonly IcsPatch[],
): string => {
  const rawLines = ics.split(LINE_BREAK_PATTERN);
  const output: string[] = [];
  for (const indices of groupContinuations(rawLines)) {
    const unfolded = unfoldGroup(rawLines, indices);
    const parsed = parsePropertyLine(unfolded);
    if (!parsed) {
      for (const index of indices) {
        output.push(rawLines[index] ?? "");
      }
      continue;
    }
    const coerced = coercePropertyLine(parsed, patches);
    if (coerced.params === parsed.params && coerced.value === parsed.value) {
      for (const index of indices) {
        output.push(rawLines[index] ?? "");
      }
      continue;
    }
    output.push(`${parsed.property}${coerced.params}:${coerced.value}`);
  }
  return output.join("\r\n");
};

export { applyIcsPatches };
export type { IcsPatch, IcsPatchCoercion };
