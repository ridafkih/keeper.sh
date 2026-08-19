import { normalizeTimezone } from "./normalize-timezone";
import { isSupportedTimeZone } from "./timezone-instant";

const LINE_BREAK_PATTERN = /\r?\n/;
const CONTINUATION_PATTERN = /^[\t ]/;
const TIMEZONE_BEGIN_PATTERN = /^BEGIN:VTIMEZONE[\t ]*$/i;
const TIMEZONE_END_PATTERN = /^END:VTIMEZONE[\t ]*$/i;
const RECURRENCE_RULE_PATTERN = /^RRULE[;:]/i;
const TIMEZONE_ID_PATTERN = /^TZID:(.*)$/i;

const unfoldLines = (lines: string[]): string[] => {
  const logical: string[] = [];
  for (const line of lines) {
    const previousIndex = logical.length - 1;
    const previous = logical[previousIndex];
    if (previous && CONTINUATION_PATTERN.test(line)) {
      logical[previousIndex] = previous + line.slice(1);
      continue;
    }
    logical.push(line);
  }
  return logical;
};

/*
 * The ts-ics parser resolves a projected observance by re-expanding its RRULE
 * for every date it converts, and Keeper overrides exactly those zones with the
 * IANA rules afterwards, so the expansion is a per-event cost paid for an
 * answer that is thrown away.
 */
const isProjectedIanaZone = (blockLines: string[]): boolean => {
  let hasRecurrenceRule = false;
  let declaredId = "";
  for (const line of unfoldLines(blockLines)) {
    if (RECURRENCE_RULE_PATTERN.test(line)) {
      hasRecurrenceRule = true;
    }
    const idMatch = TIMEZONE_ID_PATTERN.exec(line);
    if (idMatch) {
      declaredId = idMatch[1]?.trim() ?? "";
    }
  }
  if (!hasRecurrenceRule) {
    return false;
  }
  const timeZone = normalizeTimezone(declaredId);
  return Boolean(timeZone) && isSupportedTimeZone(timeZone);
};

interface DetachedProjectedVtimezones {
  icsString: string;
  projectedBlocks: string[];
}

const detachProjectedVtimezones = (icsString: string): DetachedProjectedVtimezones => {
  const kept: string[] = [];
  const projectedBlocks: string[] = [];
  let block: string[] = [];

  for (const line of icsString.split(LINE_BREAK_PATTERN)) {
    if (TIMEZONE_BEGIN_PATTERN.test(line)) {
      kept.push(...block);
      block = [line];
      continue;
    }
    if (block.length === 0) {
      kept.push(line);
      continue;
    }
    block.push(line);
    if (!TIMEZONE_END_PATTERN.test(line)) {
      continue;
    }
    if (isProjectedIanaZone(block)) {
      projectedBlocks.push(block.join("\r\n"));
    } else {
      kept.push(...block);
    }
    block = [];
  }
  kept.push(...block);
  if (projectedBlocks.length === 0) {
    return { icsString, projectedBlocks };
  }
  return { icsString: kept.join("\r\n"), projectedBlocks };
};

export { detachProjectedVtimezones };
export type { DetachedProjectedVtimezones };
