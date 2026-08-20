import type { IcsLimits } from "../options";
import { stripByteOrderMark } from "./byte-order-mark";
import { unfoldGroups } from "./fold";
import type { UnreadableReason } from "./patch";
import { parsePropertyLine } from "./property-line";
import type { PropertyLine } from "./property-line";

interface WalkedProperty {
  readonly property: PropertyLine;
  readonly componentPath: readonly string[];
  readonly componentInstancePath: readonly number[];
}

type ComponentWalk =
  | { readonly kind: "walked"; readonly properties: readonly WalkedProperty[] }
  | { readonly kind: "refused"; readonly reason: UnreadableReason };

interface OpenComponent {
  readonly name: string;
  readonly instance: number;
  readonly siblings: Map<string, number>;
}

const nextInstance = (siblings: Map<string, number>, name: string): number => {
  const seen = siblings.get(name) ?? 0;
  siblings.set(name, seen + 1);
  return seen;
};

const walkComponents = (body: string, limits: IcsLimits): ComponentWalk => {
  const unfolded = unfoldGroups(stripByteOrderMark(body), limits);
  if (unfolded.kind === "refused") {
    return { kind: "refused", reason: unfolded.reason };
  }
  const rootSiblings = new Map<string, number>();
  const open: OpenComponent[] = [];
  const properties: WalkedProperty[] = [];
  for (const group of unfolded.groups) {
    const property = parsePropertyLine(group.content);
    if (!property) {
      continue;
    }
    if (property.name === "BEGIN") {
      const parent = open.at(-1);
      const siblings = parent?.siblings ?? rootSiblings;
      const name = property.value.trim().toUpperCase();
      open.push({ name, instance: nextInstance(siblings, name), siblings: new Map() });
      if (open.length > limits.maxComponentDepth) {
        return { kind: "refused", reason: "limitExceeded" };
      }
      continue;
    }
    if (property.name === "END") {
      const current = open.at(-1);
      if (!current || current.name !== property.value.trim().toUpperCase()) {
        return { kind: "refused", reason: "componentBoundaryMismatch" };
      }
      open.pop();
      continue;
    }
    properties.push({
      property,
      componentPath: open.map((component) => component.name),
      componentInstancePath: open.map((component) => component.instance),
    });
  }
  if (open.length > 0) {
    return { kind: "refused", reason: "componentBoundaryMismatch" };
  }
  return { kind: "walked", properties };
};

export { walkComponents };
export type { ComponentWalk, WalkedProperty };
