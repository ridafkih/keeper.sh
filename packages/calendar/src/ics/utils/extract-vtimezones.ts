const LINE_BREAK_PATTERN = /\r?\n/;
const CONTINUATION_PATTERN = /^[\t ]/;
const TIMEZONE_BEGIN_PATTERN = /^BEGIN:VTIMEZONE[\t ]*$/i;
const TIMEZONE_END_PATTERN = /^END:VTIMEZONE[\t ]*$/i;
const TIMEZONE_ID_PATTERN = /^TZID:(.*)$/i;

interface ExtractedVtimezones {
  icsString: string;
  blocksByTimeZoneId: ReadonlyMap<string, string>;
}

const unfoldLines = (lines: readonly string[]): string[] => {
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

const readTimeZoneId = (blockLines: readonly string[]): string | undefined =>
  unfoldLines(blockLines)
    .map((line) => TIMEZONE_ID_PATTERN.exec(line)?.[1]?.trim())
    .find(Boolean);

const extractVtimezones = (icsString: string): ExtractedVtimezones => {
  const kept: string[] = [];
  const blocksByTimeZoneId = new Map<string, string>();
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
    const timeZoneId = readTimeZoneId(block);
    if (timeZoneId && !blocksByTimeZoneId.has(timeZoneId)) {
      blocksByTimeZoneId.set(timeZoneId, block.join("\r\n"));
    }
    block = [];
  }
  kept.push(...block);
  return { blocksByTimeZoneId, icsString: kept.join("\r\n") };
};

export { extractVtimezones };
export type { ExtractedVtimezones };
