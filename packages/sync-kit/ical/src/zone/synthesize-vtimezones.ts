import type { IcsOptions } from "../options";
import { contentLineBreak } from "../text/fold";
import { buildVtimezone } from "./build-vtimezone";
import { normalizeZoneIdentifier } from "./normalize-zone-id";

const referencedIdentifiers = /;TZID=("[^"]*"|[^;:]*)/gu;
const declaredIdentifier = /^TZID:(.*)$/u;

const referencedZones = (lines: readonly string[]): readonly string[] => {
  const found: string[] = [];
  for (const line of lines) {
    for (const match of line.matchAll(referencedIdentifiers)) {
      const [, value] = match;
      if (value) {
        found.push(value.replaceAll('"', "").trim());
      }
    }
  }
  return [...new Set(found)];
};

const declaredZoneIdentifiers = (lines: readonly string[]): ReadonlySet<string> => {
  const declared = new Set<string>();
  for (const line of lines) {
    const matched = declaredIdentifier.exec(line);
    if (matched?.[1]) {
      declared.add(matched[1].trim());
    }
  }
  return declared;
};

const underDeclaredIdentifier = (text: string, identifier: string): readonly string[] =>
  text.split(contentLineBreak).map((line) => {
    if (!line.startsWith("TZID:")) {
      return line;
    }
    return `TZID:${identifier}`;
  });

const datedProperty = /^(?:DTSTART|DTEND|RECURRENCE-ID|EXDATE|RDATE)[^:]*:(\d{4})\d{4}/u;

const declaredYears = (lines: readonly string[]): readonly number[] =>
  lines.flatMap((line) => {
    const matched = datedProperty.exec(line);
    if (!matched?.[1]) {
      return [];
    }
    return [Number(matched[1])];
  });

const earliestReferencedYear = (lines: readonly string[]): number | null => {
  const years = declaredYears(lines);
  if (years.length === 0) {
    return null;
  }
  return Math.min(...years);
};

const insertionIndex = (lines: readonly string[]): number => {
  const firstEvent = lines.indexOf("BEGIN:VEVENT");
  if (firstEvent !== -1) {
    return firstEvent;
  }
  const closing = lines.indexOf("END:VCALENDAR");
  if (closing !== -1) {
    return closing;
  }
  return lines.length;
};

const synthesizeMissingVtimezones = (body: string, options: IcsOptions): string => {
  const lines = body.split(contentLineBreak);
  const declared = declaredZoneIdentifiers(lines);
  const missing = referencedZones(lines).filter((identifier) => !declared.has(identifier));
  const referenceYear = earliestReferencedYear(lines);
  if (referenceYear === null) {
    return body;
  }
  const synthesised = missing.flatMap((identifier) => {
    const normalized = normalizeZoneIdentifier(identifier);
    if (!normalized) {
      return [];
    }
    const block = buildVtimezone({ kind: "zoneId", value: normalized }, referenceYear, options);
    if (block.kind === "unresolvableZone") {
      return [];
    }
    return [...underDeclaredIdentifier(block.text, identifier)];
  });
  if (synthesised.length === 0) {
    return body;
  }
  const at = insertionIndex(lines);
  return [...lines.slice(0, at), ...synthesised, ...lines.slice(at)].join(contentLineBreak);
};

export { synthesizeMissingVtimezones };
