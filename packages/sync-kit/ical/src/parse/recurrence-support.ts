import type { EventUid } from "@keeper.sh/sync-protocol";
import type { IcsLimits } from "../options";
import { walkComponents } from "../text/component-walk";
import type { WalkedProperty } from "../text/component-walk";
import { parameterValue } from "../text/property-line";

const isEventLevel = (property: WalkedProperty): boolean => {
  const [calendar, event, nested] = property.componentPath;
  return calendar === "VCALENDAR" && event === "VEVENT" && typeof nested !== "string";
};

const declaringUids = (
  body: string,
  limits: IcsLimits,
  declares: (property: WalkedProperty) => boolean,
): readonly EventUid[] => {
  const walk = walkComponents(body, limits);
  if (walk.kind !== "walked") {
    return [];
  }
  const eventProperties = walk.properties.filter((property) => isEventLevel(property));
  const declaringInstances = new Set(
    eventProperties
      .filter((property) => declares(property))
      .map((property) => property.componentInstancePath[1]),
  );
  const uids: EventUid[] = [];
  for (const property of eventProperties) {
    if (property.property.name !== "UID") {
      continue;
    }
    if (!declaringInstances.has(property.componentInstancePath[1])) {
      continue;
    }
    uids.push({ kind: "eventUid", value: property.property.value.trim() });
  }
  return uids;
};

const detectEventLevelRecurrenceDates = (body: string, limits: IcsLimits): readonly EventUid[] =>
  declaringUids(body, limits, (property) => property.property.name === "RDATE");

const detectRecurrenceRangeOverrides = (body: string, limits: IcsLimits): readonly EventUid[] =>
  declaringUids(body, limits, (property) => {
    if (property.property.name !== "RECURRENCE-ID") {
      return false;
    }
    return parameterValue(property.property.params, "RANGE") === "THISANDFUTURE";
  });

export { detectEventLevelRecurrenceDates, detectRecurrenceRangeOverrides };
