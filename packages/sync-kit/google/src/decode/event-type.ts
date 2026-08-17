import type { Availability } from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";

const googleEventTypes = [
  "default",
  "outOfOffice",
  "focusTime",
  "workingLocation",
  "fromGmail",
  "birthday",
] as const;

type GoogleEventType = (typeof googleEventTypes)[number];

type EventTypeVerdict =
  | { readonly kind: "mirrored"; readonly availability: Availability }
  | { readonly kind: "withheld" };

const readEventType = (value: string | null | undefined): GoogleEventType | null =>
  googleEventTypes.find((eventType) => eventType === value) ?? null;

const verdictForEventType = (eventType: GoogleEventType): EventTypeVerdict => {
  switch (eventType) {
    case "default":
    case "focusTime":
    case "fromGmail": {
      return { kind: "mirrored", availability: "busy" };
    }
    case "outOfOffice":
    case "birthday": {
      return { kind: "mirrored", availability: "free" };
    }
    case "workingLocation": {
      return { kind: "withheld" };
    }
    default: {
      return assertNever(eventType);
    }
  }
};

export { googleEventTypes, readEventType, verdictForEventType };
export type { EventTypeVerdict, GoogleEventType };
