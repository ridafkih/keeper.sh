import type { ZoneId } from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";
import { isKnownToPlatform } from "./normalize-zone-id";
import type { DeclaredZone } from "./vtimezone";

const isIanaAuthoritative = (declared: DeclaredZone | null, zone: ZoneId): boolean => {
  if (!isKnownToPlatform(zone.value)) {
    return false;
  }
  if (!declared) {
    return true;
  }
  switch (declared.observances) {
    case "projected": {
      return true;
    }
    case "explicit": {
      return false;
    }
    default: {
      return assertNever(declared.observances);
    }
  }
};

export { isIanaAuthoritative };
