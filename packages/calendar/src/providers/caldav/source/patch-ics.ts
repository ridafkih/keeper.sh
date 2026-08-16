import { resolveAudience } from "../../../core/source/writer";
import type { SourceEventAudience } from "../../../core/source/writer";

const NOT_FOUND_INDEX = -1;
const NO_BLOCKS = 0;
const NEXT_LINE = 1;
const SINGLE_MATCH = 1;
const NESTED_LEVEL = 1;
const TOP_LEVEL = 0;

const LINE_SEPARATOR = "\r\n";

interface PropertySpan {
  end: number;
  start: number;
}

interface VEventBlock {
  end: number;
  start: number;
}

const splitLines = (ics: string): string[] => ics.split(/\r\n|\n|\r/);

const isContinuation = (line: string): boolean =>
  line.startsWith(" ") || line.startsWith("\t");

const readPropertyName = (line: string): string => {
  const separator = line.search(/[;:]/);
  if (separator === NOT_FOUND_INDEX) {
    return line.toUpperCase();
  }
  return line.slice(0, separator).toUpperCase();
};

const readPropertyValue = (line: string): string => {
  const separator = line.indexOf(":");
  if (separator === NOT_FOUND_INDEX) {
    return "";
  }
  return line.slice(separator + NEXT_LINE);
};

/*
 * A VALARM carries its own DESCRIPTION, DURATION and DTSTAMP-shaped properties, and they
 * belong to the alarm, not the event. Walking into the sub-component would let a write-back
 * to the event's description delete the alarm's, or lift the alarm's DURATION into the
 * VEVENT body beside DTEND — a pair RFC 5545 forbids.
 */
const readComponentName = (line: string): string | null => {
  const name = readPropertyName(line);
  if (name !== "BEGIN" && name !== "END") {
    return null;
  }
  return readPropertyValue(line).trim().toUpperCase();
};

interface CollectedSpans {
  balanced: boolean;
  spans: Map<string, PropertySpan[]>;
}

/*
 * `balanced` is how a reader that lost the thread says so. A VEVENT that opens a
 * sub-component and reaches END:VEVENT without closing it leaves every property after the
 * BEGIN unread, including the event's own ATTENDEE lines, and an unread guest list reads
 * as an empty one unless the walk reports that it could not be followed.
 */
const collectSpans = (lines: string[], block: VEventBlock): CollectedSpans => {
  const spans = new Map<string, PropertySpan[]>();
  let index = block.start + NEXT_LINE;
  let depth = TOP_LEVEL;

  while (index < block.end) {
    const line = lines[index] ?? "";
    if (isContinuation(line)) {
      index += NEXT_LINE;
      continue;
    }
    const name = readPropertyName(line);
    if (name === "BEGIN" && readComponentName(line)) {
      depth += NESTED_LEVEL;
      index += NEXT_LINE;
      continue;
    }
    if (name === "END" && readComponentName(line)) {
      depth -= NESTED_LEVEL;
      index += NEXT_LINE;
      continue;
    }
    if (depth > TOP_LEVEL) {
      index += NEXT_LINE;
      continue;
    }
    let end = index + NEXT_LINE;
    while (end < block.end && isContinuation(lines[end] ?? "")) {
      end += NEXT_LINE;
    }
    spans.set(name, [...spans.get(name) ?? [], { end, start: index }]);
    index = end;
  }

  return { balanced: depth === TOP_LEVEL, spans };
};

const collectVEventBlocks = (lines: string[]): VEventBlock[] => {
  const blocks: VEventBlock[] = [];
  let start = NOT_FOUND_INDEX;

  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim().toUpperCase();
    if (trimmed === "BEGIN:VEVENT") {
      start = index;
    }
    if (trimmed === "END:VEVENT" && start !== NOT_FOUND_INDEX) {
      blocks.push({ end: index, start });
      start = NOT_FOUND_INDEX;
    }
  }

  return blocks;
};

const readOptionalSpanValue = (
  lines: string[],
  span: PropertySpan | undefined,
): string | null => {
  if (!span) {
    return null;
  }
  return readPropertyValue(lines.slice(span.start, span.end).join(""));
};

const readSpanValue = (lines: string[], span: PropertySpan): string =>
  lines.slice(span.start, span.end).join("");

/*
 * The user's event carries properties this codebase does not model — conferencing links,
 * structured locations, alarms, the VTIMEZONE its own dates reference. Regenerating the
 * object from a parsed model silently drops every one of them, so a write-back replaces
 * the property lines it was asked to change and leaves the file otherwise byte-identical.
 */
const findTargetBlock = (
  lines: string[],
  blocks: VEventBlock[],
  uid: string,
): VEventBlock | null => {
  const matches = blocks.filter((block) => {
    const { spans } = collectSpans(lines, block);
    const [uidSpan] = spans.get("UID") ?? [];
    if (!uidSpan) {
      return false;
    }
    if (spans.has("RECURRENCE-ID")) {
      return false;
    }
    return readPropertyValue(readSpanValue(lines, uidSpan)) === uid;
  });

  if (matches.length !== SINGLE_MATCH) {
    return null;
  }
  return matches[0] ?? null;
};

const extractProperties = (
  ics: string,
  names: ReadonlySet<string>,
): Map<string, string[]> => {
  const lines = splitLines(ics);
  const [block] = collectVEventBlocks(lines);
  const extracted = new Map<string, string[]>();
  if (!block) {
    return extracted;
  }

  const { spans } = collectSpans(lines, block);
  for (const name of names) {
    const [span] = spans.get(name) ?? [];
    if (span) {
      extracted.set(name, lines.slice(span.start, span.end));
    }
  }
  return extracted;
};

interface PatchIcsEventInput {
  ics: string;
  properties: Map<string, string[]>;
  propertyNames: ReadonlySet<string>;
  uid: string;
}

const patchIcsEvent = (input: PatchIcsEventInput): string | null => {
  const lines = splitLines(input.ics);
  const block = findTargetBlock(lines, collectVEventBlocks(lines), input.uid);
  if (!block) {
    return null;
  }

  const { spans } = collectSpans(lines, block);
  const removed = new Set<number>();
  let insertAt = block.end;

  for (const name of input.propertyNames) {
    for (const span of spans.get(name) ?? []) {
      for (let index = span.start; index < span.end; index += NEXT_LINE) {
        removed.add(index);
      }
      insertAt = Math.min(insertAt, span.start);
    }
  }

  const replacements = [...input.propertyNames].flatMap(
    (name) => input.properties.get(name) ?? [],
  );
  const patched: string[] = [];
  for (const [index, line] of lines.entries()) {
    if (index === insertAt) {
      patched.push(...replacements);
    }
    if (!removed.has(index)) {
      patched.push(line);
    }
  }

  return patched.join(LINE_SEPARATOR);
};

const collectDefinedTimezoneIds = (ics: string): Set<string> => {
  const identifiers = new Set<string>();
  for (const line of splitLines(ics)) {
    if (readPropertyName(line) === "TZID") {
      identifiers.add(readPropertyValue(line).trim());
    }
  }
  return identifiers;
};

/*
 * A server with iTIP scheduling sends a CANCEL to every ATTENDEE the object carries when
 * it is deleted, and a REQUEST when it is edited. An email VALARM carries an ATTENDEE of
 * its own that names nobody the write would notify, and collectSpans already refuses to
 * walk into a sub-component, so only the event's own attendees are read here.
 *
 * An object with no VEVENT in it at all, and one whose blocks could not be walked, are the
 * same answer: the guest list was not read, so nothing here may report it as empty.
 */
const readEventAudience = (ics: string): SourceEventAudience => {
  const lines = splitLines(ics);
  const blocks = collectVEventBlocks(lines);
  if (blocks.length === NO_BLOCKS) {
    return "unreadable";
  }

  let audience: SourceEventAudience = "no_one_else";
  for (const block of blocks) {
    const { balanced, spans } = collectSpans(lines, block);
    if (!balanced) {
      return "unreadable";
    }
    const [organizerSpan] = spans.get("ORGANIZER") ?? [];
    const blockAudience = resolveAudience({
      attendees: (spans.get("ATTENDEE") ?? []).map((span) => ({
        address: readPropertyValue(readSpanValue(lines, span)),
      })),
      organizer: readOptionalSpanValue(lines, organizerSpan),
    });
    if (blockAudience === "others") {
      audience = "others";
    }
  }
  return audience;
};

export {
  collectDefinedTimezoneIds,
  extractProperties,
  patchIcsEvent,
  readEventAudience,
};
