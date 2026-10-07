import type { IcsLimits } from "../options";
import { stripByteOrderMark } from "./byte-order-mark";
import { contentLineBreak, foldContentLine, unfoldGroups } from "./fold";
import { formatPropertyLine, parsePropertyLine } from "./property-line";
import type { PropertyLine } from "./property-line";

interface IcsPatchCoercion {
  readonly params: string;
  readonly value: string;
}

interface IcsPatch {
  readonly properties: readonly string[];
  readonly coerce: (params: string, value: string) => IcsPatchCoercion | null;
}

const unreadableReasons = [
  "emptyBody",
  "noCalendarObject",
  "componentBoundaryMismatch",
  "limitExceeded",
] as const;
type UnreadableReason = (typeof unreadableReasons)[number];

type PatchOutcome =
  | { readonly kind: "patched"; readonly text: string }
  | { readonly kind: "refused"; readonly reason: UnreadableReason };

const coerceProperty = (property: PropertyLine, patches: readonly IcsPatch[]): PropertyLine => {
  const carried = { line: property };
  for (const patch of patches) {
    if (!patch.properties.includes(carried.line.name)) {
      continue;
    }
    const coerced = patch.coerce(carried.line.params, carried.line.value);
    if (!coerced) {
      continue;
    }
    carried.line = { name: carried.line.name, params: coerced.params, value: coerced.value };
  }
  return carried.line;
};

const emittedLinesFor = (property: PropertyLine): readonly string[] =>
  formatPropertyLine(property)
    .split(contentLineBreak)
    .flatMap((physical) => [...foldContentLine(physical)]);

const applyIcsPatches = (
  body: string,
  patches: readonly IcsPatch[],
  limits: IcsLimits,
): PatchOutcome => {
  const unfolded = unfoldGroups(stripByteOrderMark(body), limits);
  if (unfolded.kind === "refused") {
    return { kind: "refused", reason: unfolded.reason };
  }
  const emitted: string[] = [];
  for (const group of unfolded.groups) {
    const parsed = parsePropertyLine(group.content);
    if (!parsed) {
      emitted.push(...group.raw);
      continue;
    }
    const coerced = coerceProperty(parsed, patches);
    if (coerced.params === parsed.params && coerced.value === parsed.value) {
      emitted.push(...group.raw);
      continue;
    }
    emitted.push(...emittedLinesFor(coerced));
  }
  return { kind: "patched", text: emitted.map((line) => `${line}${contentLineBreak}`).join("") };
};

export { applyIcsPatches, unreadableReasons };
export type { IcsPatch, IcsPatchCoercion, PatchOutcome, UnreadableReason };
