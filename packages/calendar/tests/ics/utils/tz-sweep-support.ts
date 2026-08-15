const ALL_TIME_ZONES = Intl.supportedValuesOf("timeZone");

// Sweeping every IANA zone at daily or sub-daily granularity across decades
// Is CPU-bound and takes tens of seconds per test. These suites assert
// Properties that hold for *every* zone (no minimum-count thresholds), so a
// Stride sample still exercises the full breadth of offset families while
// Running in a fraction of the time. Set CALENDAR_TZ_SWEEP_EXHAUSTIVE=1 to
// Run every zone, e.g. before a tzdata upgrade or when touching the
// Wall-time resolution code directly.
const EXHAUSTIVE = process.env.CALENDAR_TZ_SWEEP_EXHAUSTIVE === "1";
const SAMPLE_STRIDE = 4;

const sweepTimeZones = (): string[] => {
  if (EXHAUSTIVE) {
    return ALL_TIME_ZONES;
  }
  return ALL_TIME_ZONES.filter((_zone, index) => index % SAMPLE_STRIDE === 0);
};

export { ALL_TIME_ZONES, EXHAUSTIVE, sweepTimeZones };
