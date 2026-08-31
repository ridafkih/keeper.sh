const UTC_TIME_ZONE_NAMES = new Set(["UTC", "Etc/UTC", "Universal", "Zulu"]);

const isUtcTimeZoneName = (zone: string | null | undefined): boolean => {
  if (!zone) {
    return false;
  }
  return UTC_TIME_ZONE_NAMES.has(zone);
};

export { isUtcTimeZoneName, UTC_TIME_ZONE_NAMES };
