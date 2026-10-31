import type { IcsLimits } from "../options";
import { walkComponents } from "../text/component-walk";
import type { WalkedProperty } from "../text/component-walk";
import { parseUtcOffset } from "./offset";

interface DeclaredObservance {
  readonly wallStart: string;
  readonly offsetFromMinutes: number;
  readonly offsetToMinutes: number;
  readonly projected: boolean;
}

interface DeclaredZoneRules {
  readonly declaredId: string;
  readonly observances: readonly DeclaredObservance[];
}

interface DeclaredZone {
  readonly declaredId: string;
  readonly observances: "projected" | "explicit";
  readonly offsets: readonly number[];
}

const observanceNames = ["STANDARD", "DAYLIGHT"] as const;

const isObservanceProperty = (property: WalkedProperty): boolean => {
  const [, component, observance] = property.componentPath;
  if (component !== "VTIMEZONE") {
    return false;
  }
  return observanceNames.some((name) => name === observance);
};

const zoneIdentifierAt = (
  properties: readonly WalkedProperty[],
  instance: number | undefined,
): string | null => {
  const declaration = properties.find((property) => {
    if (property.property.name !== "TZID") {
      return false;
    }
    if (property.componentPath.at(-1) !== "VTIMEZONE") {
      return false;
    }
    return property.componentInstancePath.at(-1) === instance;
  });
  if (!declaration) {
    return null;
  }
  return declaration.property.value.trim();
};

const observanceKey = (property: WalkedProperty): string =>
  `${property.componentPath.join("/")}#${property.componentInstancePath.join(".")}`;

const observanceFrom = (properties: readonly WalkedProperty[]): DeclaredObservance | null => {
  const valueOf = (name: string): string | null => {
    const found = properties.find((property) => property.property.name === name);
    if (!found) {
      return null;
    }
    return found.property.value.trim();
  };
  const start = valueOf("DTSTART");
  const from = parseUtcOffset(valueOf("TZOFFSETFROM") ?? "");
  const to = parseUtcOffset(valueOf("TZOFFSETTO") ?? "");
  if (start === null || from === null || to === null) {
    return null;
  }
  return {
    wallStart: start,
    offsetFromMinutes: from,
    offsetToMinutes: to,
    projected: valueOf("RRULE") !== null,
  };
};

const groupByObservance = (
  properties: readonly WalkedProperty[],
): ReadonlyMap<string, readonly WalkedProperty[]> => {
  const grouped = new Map<string, WalkedProperty[]>();
  for (const property of properties) {
    const key = observanceKey(property);
    const existing = grouped.get(key);
    if (existing) {
      existing.push(property);
      continue;
    }
    grouped.set(key, [property]);
  }
  return grouped;
};

const declaredZoneRulesFrom = (properties: readonly WalkedProperty[]): readonly DeclaredZoneRules[] => {
  const observanceProperties = properties.filter((property) => isObservanceProperty(property));
  const byZone = new Map<number, DeclaredObservance[]>();
  for (const [, group] of groupByObservance(observanceProperties)) {
    const [sample] = group;
    if (!sample) {
      continue;
    }
    const [, zoneInstance] = sample.componentInstancePath;
    const observance = observanceFrom(group);
    if (typeof zoneInstance !== "number" || !observance) {
      continue;
    }
    const existing = byZone.get(zoneInstance);
    if (existing) {
      existing.push(observance);
      continue;
    }
    byZone.set(zoneInstance, [observance]);
  }
  const rules: DeclaredZoneRules[] = [];
  for (const [zoneInstance, observances] of byZone) {
    const declaredId = zoneIdentifierAt(properties, zoneInstance);
    if (declaredId === null) {
      continue;
    }
    rules.push({ declaredId, observances });
  }
  return rules;
};

const summariseZone = (rules: DeclaredZoneRules): DeclaredZone => {
  const offsets = [...new Set(rules.observances.map((observance) => observance.offsetToMinutes))];
  if (rules.observances.some((observance) => observance.projected)) {
    return { declaredId: rules.declaredId, observances: "projected", offsets };
  }
  return { declaredId: rules.declaredId, observances: "explicit", offsets };
};

const declaredZonesFrom = (properties: readonly WalkedProperty[]): readonly DeclaredZone[] =>
  declaredZoneRulesFrom(properties).map((rules) => summariseZone(rules));

const readDeclaredZones = (body: string, limits: IcsLimits): readonly DeclaredZone[] => {
  const walk = walkComponents(body, limits);
  if (walk.kind !== "walked") {
    return [];
  }
  return declaredZonesFrom(walk.properties);
};

export { declaredZoneRulesFrom, declaredZonesFrom, readDeclaredZones, summariseZone };
export type { DeclaredObservance, DeclaredZone, DeclaredZoneRules };
