import type { IcsLimits } from "../options";
import type { PatchOutcome } from "./patch";

const maximumOctets = 75;
const contentLineBreak = "\r\n";
const continuationPrefix = " ";

const octetsOf = (value: string): number => new TextEncoder().encode(value).length;

const codePointOctets = (codePoint: string): number => {
  const value = codePoint.codePointAt(0) ?? 0;
  if (value < 128) {
    return 1;
  }
  if (value < 2048) {
    return 2;
  }
  if (value < 65_536) {
    return 3;
  }
  return 4;
};

const foldContentLine = (line: string): readonly string[] => {
  const folded: string[] = [];
  const run = { current: "", used: 0 };
  for (const codePoint of line) {
    const width = codePointOctets(codePoint);
    if (run.used + width > maximumOctets) {
      folded.push(run.current);
      run.current = continuationPrefix;
      run.used = 1;
    }
    run.current = `${run.current}${codePoint}`;
    run.used += width;
  }
  return [...folded, run.current];
};

const isContinuation = (line: string): boolean => line.startsWith(" ") || line.startsWith("\t");

const physicalLinesOf = (body: string): readonly string[] => {
  const lines = body.split(/\r\n|\n|\r/u);
  if (lines.at(-1) === "") {
    return lines.slice(0, -1);
  }
  return lines;
};

interface UnfoldedGroup {
  readonly content: string;
  readonly raw: readonly string[];
}

type UnfoldOutcome =
  | { readonly kind: "unfolded"; readonly groups: readonly UnfoldedGroup[] }
  | { readonly kind: "refused"; readonly reason: "limitExceeded" };

const unfoldGroups = (body: string, limits: IcsLimits): UnfoldOutcome => {
  const lines = physicalLinesOf(body);
  if (lines.length > limits.maxContentLines) {
    return { kind: "refused", reason: "limitExceeded" };
  }
  const groups: { content: string[]; raw: string[] }[] = [];
  for (const line of lines) {
    const previous = groups.at(-1);
    if (previous && isContinuation(line)) {
      previous.content.push(line.slice(1));
      previous.raw.push(line);
      continue;
    }
    groups.push({ content: [line], raw: [line] });
  }
  return {
    kind: "unfolded",
    groups: groups.map((group) => ({ content: group.content.join(""), raw: group.raw })),
  };
};

const unfoldContentLines = (body: string, limits: IcsLimits): PatchOutcome => {
  const outcome = unfoldGroups(body, limits);
  if (outcome.kind === "refused") {
    return { kind: "refused", reason: outcome.reason };
  }
  return {
    kind: "patched",
    text: outcome.groups.map((group) => `${group.content}${contentLineBreak}`).join(""),
  };
};

export { contentLineBreak, foldContentLine, octetsOf, unfoldContentLines, unfoldGroups };
export type { UnfoldOutcome, UnfoldedGroup };
