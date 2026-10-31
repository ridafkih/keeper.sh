import { windowsZones } from "./windows-zones";

const isKnownToPlatform = (identifier: string): boolean => {
  try {
    const resolved = new Intl.DateTimeFormat("sv-SE", { timeZone: identifier }).resolvedOptions();
    return resolved.timeZone.length > 0;
  } catch (error) {
    if (error instanceof RangeError) {
      return false;
    }
    throw error;
  }
};

const windowsTable: Record<string, string> = windowsZones;

const windowsMapping = (identifier: string): string | null => windowsTable[identifier] ?? null;

const normalizeZoneIdentifier = (identifier: string): string | null => {
  const trimmed = identifier.trim();
  const mapped = windowsMapping(trimmed);
  if (mapped) {
    return mapped;
  }
  if (isKnownToPlatform(trimmed)) {
    return trimmed;
  }
  return null;
};

export { isKnownToPlatform, normalizeZoneIdentifier, windowsMapping };
