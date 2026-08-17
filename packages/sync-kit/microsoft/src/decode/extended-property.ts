import type {
  Event as GraphEvent,
  SingleValueLegacyExtendedProperty,
} from "@microsoft/microsoft-graph-types";

const keeperPropertySet = "{keeper-sh-0000-0000-000000000001}";

const namedProperty = (name: string): string => `String ${keeperPropertySet} Name ${name}`;

const mirroredUidPropertyName = namedProperty("uid");
const recurrencePropertyName = namedProperty("recurrence");

const extendedPropertyValue = (event: GraphEvent, id: string): string | null => {
  const held = event.singleValueExtendedProperties;
  if (!Array.isArray(held)) {
    return null;
  }
  const found = held.find((property) => property?.id === id);
  if (!found || typeof found.value !== "string") {
    return null;
  }
  return found.value;
};

const singleValueProperty = (id: string, value: string): SingleValueLegacyExtendedProperty => ({
  id,
  value,
});

const installationPropertyName = namedProperty("installation");

const keeperPropertyNames = [
  installationPropertyName,
  mirroredUidPropertyName,
  recurrencePropertyName,
] as const;

const anyOfOurIds = (): string =>
  keeperPropertyNames.map((name) => `id eq '${name}'`).join(" or ");

const expandKeeperProperties = (): string =>
  `singleValueExtendedProperties($filter=${anyOfOurIds()})`;

const matchesPropertyValue = (name: string, value: string): string =>
  `singleValueExtendedProperties/any(ep:ep/id eq '${name}' and ep/value eq '${value}')`;

export {
  anyOfOurIds,
  expandKeeperProperties,
  extendedPropertyValue,
  installationPropertyName,
  keeperPropertyNames,
  keeperPropertySet,
  matchesPropertyValue,
  mirroredUidPropertyName,
  namedProperty,
  recurrencePropertyName,
  singleValueProperty,
};
