import type { IcsOptions } from "../options";
import { walkComponents } from "../text/component-walk";
import type { WalkedProperty } from "../text/component-walk";
import { octetsOf } from "../text/fold";
import { applyIcsPatches } from "../text/patch";
import type { UnreadableReason } from "../text/patch";
import type { PropertyLine } from "../text/property-line";
import { declaredZoneRulesFrom, declaredZonesFrom } from "../zone/vtimezone";
import type { DeclaredZone, DeclaredZoneRules } from "../zone/vtimezone";

interface VeventComponent {
  readonly instance: number;
  readonly properties: readonly PropertyLine[];
}

type IcsDocument =
  | {
      readonly kind: "readable";
      readonly calendarZone: string | null;
      readonly declaredZones: readonly DeclaredZone[];
      readonly zoneRules: readonly DeclaredZoneRules[];
      readonly components: readonly VeventComponent[];
    }
  | { readonly kind: "unreadable"; readonly reason: UnreadableReason };

const emptyDocument: IcsDocument = {
  kind: "readable",
  calendarZone: null,
  declaredZones: [],
  zoneRules: [],
  components: [],
};

const isEventProperty = (property: WalkedProperty): boolean => {
  const [calendar, event, nested] = property.componentPath;
  return calendar === "VCALENDAR" && event === "VEVENT" && typeof nested !== "string";
};

const veventComponentsFrom = (properties: readonly WalkedProperty[]): readonly VeventComponent[] => {
  const byInstance = new Map<number, PropertyLine[]>();
  for (const property of properties.filter((candidate) => isEventProperty(candidate))) {
    const [, instance] = property.componentInstancePath;
    if (typeof instance !== "number") {
      continue;
    }
    const existing = byInstance.get(instance);
    if (existing) {
      existing.push(property.property);
      continue;
    }
    byInstance.set(instance, [property.property]);
  }
  return [...byInstance]
    .toSorted((left, right) => left[0] - right[0])
    .map((entry) => ({ instance: entry[0], properties: entry[1] }));
};

const calendarZoneFrom = (properties: readonly WalkedProperty[]): string | null => {
  const declared = properties.find(
    (property) => property.property.name === "X-WR-TIMEZONE" && property.componentPath.length === 1,
  );
  if (!declared) {
    return null;
  }
  return declared.property.value.trim();
};

const exceedsByteBudget = (body: string, maxBytes: number): boolean => {
  if (body.length > maxBytes) {
    return true;
  }
  return octetsOf(body) > maxBytes;
};

const parseIcsDocument = (body: string, options: IcsOptions): IcsDocument => {
  if (body.trim() === "") {
    return { kind: "unreadable", reason: "emptyBody" };
  }
  if (exceedsByteBudget(body, options.limits.maxBytes)) {
    return { kind: "unreadable", reason: "limitExceeded" };
  }
  const patched = applyIcsPatches(body, options.patches, options.limits);
  if (patched.kind === "refused") {
    return { kind: "unreadable", reason: patched.reason };
  }
  if (!patched.text.includes("BEGIN:VCALENDAR\r\n")) {
    return { kind: "unreadable", reason: "noCalendarObject" };
  }
  const walk = walkComponents(patched.text, options.limits);
  if (walk.kind === "refused") {
    return { kind: "unreadable", reason: walk.reason };
  }
  return {
    kind: "readable",
    calendarZone: calendarZoneFrom(walk.properties),
    declaredZones: declaredZonesFrom(walk.properties),
    zoneRules: declaredZoneRulesFrom(walk.properties),
    components: veventComponentsFrom(walk.properties),
  };
};

export { emptyDocument, parseIcsDocument };
export type { IcsDocument, VeventComponent };
