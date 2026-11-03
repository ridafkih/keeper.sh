import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { MS_PER_DAY } from "@keeper.sh/constants";
import {
  DEFAULT_FUTURE_SYNC_RANGE,
  DEFAULT_HISTORIC_SYNC_RANGE,
  createSyncWindow,
  getStartOfToday,
  getConfigurableSyncWindow,
  getWiderSyncRange,
  intersectSyncWindows,
} from "../../../src/core/sync/sync-range";

const SYNC_RANGE_MODULE_PATH = fileURLToPath(
  new URL("../../../src/core/sync/sync-range.ts", import.meta.url),
);
const ICU_TIMEZONE_FILES_DIR = fileURLToPath(
  new URL("../../../../../docker/icu-timezone", import.meta.url),
);
const SERVER_TIME_ZONES = [
  "UTC",
  "America/Edmonton",
  "Pacific/Auckland",
  "America/Los_Angeles",
  "Pacific/Kiritimati",
];

interface ZoneProbe {
  resolvedTimeZone: string;
  startOfToday: string;
  shortWindow: { timeMin: string; timeMax: string };
  monthEndWindow: { timeMin: string; timeMax: string };
  wideWindow: { timeMin: string; timeMax: string };
  weekAcrossDaylightSavingEnd: { timeMin: string; timeMax: string };
}

const PROBE_SCRIPT = `
const {
  getConfigurableSyncWindow,
  getStartOfToday,
} = await import(${JSON.stringify(SYNC_RANGE_MODULE_PATH)});
const serialize = ({ timeMin, timeMax }) => ({
  timeMax: timeMax.toISOString(),
  timeMin: timeMin.toISOString(),
});
console.log(JSON.stringify({
  monthEndWindow: serialize(
    getConfigurableSyncWindow("1_month", "1_month", new Date("2026-03-31T12:00:00.000Z")),
  ),
  resolvedTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  shortWindow: serialize(
    getConfigurableSyncWindow("1_week", "1_month", new Date("2026-10-20T15:00:00.000Z")),
  ),
  startOfToday: getStartOfToday(new Date("2026-07-20T22:30:00.000Z")).toISOString(),
  weekAcrossDaylightSavingEnd: serialize(
    getConfigurableSyncWindow("1_week", "1_week", new Date("2026-11-05T12:00:00.000Z")),
  ),
  wideWindow: serialize(
    getConfigurableSyncWindow("3_months", "2_years", new Date("2026-07-20T22:30:00.000Z")),
  ),
}));
`;

const PROBE_TIMEOUT_MS = 60_000;

const probeInServerTimeZone = async (timeZone: string): Promise<ZoneProbe> => {
  const child = Bun.spawn([process.execPath, "-e", PROBE_SCRIPT], {
    env: { ...process.env, ICU_TIMEZONE_FILES_DIR, TZ: timeZone },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  return JSON.parse(stdout);
};

describe("sync window independence from the server time zone", () => {
  const probes = new Map<string, ZoneProbe>();

  beforeAll(async () => {
    const entries = await Promise.all(
      SERVER_TIME_ZONES.map(async (timeZone) => [timeZone, await probeInServerTimeZone(timeZone)] as const),
    );
    for (const [timeZone, probe] of entries) {
      probes.set(timeZone, probe);
    }
  }, PROBE_TIMEOUT_MS);

  it.each(SERVER_TIME_ZONES)("computes UTC-midnight edges under TZ=%s", (timeZone) => {
    const probe = probes.get(timeZone);

    expect(probe?.resolvedTimeZone).toBe(timeZone);
    expect(probe?.startOfToday).toBe("2026-07-20T00:00:00.000Z");
    expect(probe?.shortWindow).toEqual({
      timeMax: "2026-11-20T00:00:00.000Z",
      timeMin: "2026-10-13T00:00:00.000Z",
    });
    expect(probe?.monthEndWindow).toEqual({
      timeMax: "2026-04-30T00:00:00.000Z",
      timeMin: "2026-02-28T00:00:00.000Z",
    });
    expect(probe?.wideWindow).toEqual({
      timeMax: "2028-07-20T00:00:00.000Z",
      timeMin: "2026-04-20T00:00:00.000Z",
    });
    expect(probe?.weekAcrossDaylightSavingEnd).toEqual({
      timeMax: "2026-11-12T00:00:00.000Z",
      timeMin: "2026-10-29T00:00:00.000Z",
    });
  });
});

describe("configurable sync ranges", () => {
  it("builds independent historic and future windows from the start of today", () => {
    const window = getConfigurableSyncWindow(
      "3_months",
      "2_years",
      new Date("2026-07-20T15:42:10.000Z"),
    );

    expect(window).toEqual({
      timeMin: new Date("2026-04-20T00:00:00.000Z"),
      timeMax: new Date("2028-07-20T00:00:00.000Z"),
    });
  });

  it("clamps month ranges at the end of shorter months", () => {
    const window = getConfigurableSyncWindow(
      "1_month",
      "1_month",
      new Date("2026-03-31T12:00:00.000Z"),
    );

    expect(window).toEqual({
      timeMin: new Date("2026-02-28T00:00:00.000Z"),
      timeMax: new Date("2026-04-30T00:00:00.000Z"),
    });
  });

  it("selects the widest range needed by mapped destinations", () => {
    expect(getWiderSyncRange("3_months", "12_months")).toBe("12_months");
    expect(getWiderSyncRange("12_months", "3_months")).toBe("12_months");
    expect(getWiderSyncRange("1_week", "1_week")).toBe("1_week");
  });

  it("defaults one month back and two years forward, deliberately wider than the retired fixed window", () => {
    const now = new Date("2026-07-20T15:42:10.000Z");
    const startOfToday = getStartOfToday(now);

    const defaults = getConfigurableSyncWindow(
      DEFAULT_HISTORIC_SYNC_RANGE,
      DEFAULT_FUTURE_SYNC_RANGE,
      now,
    );

    expect(startOfToday).toEqual(new Date("2026-07-20T00:00:00.000Z"));
    expect(defaults).toEqual({
      timeMin: new Date("2026-06-20T00:00:00.000Z"),
      timeMax: new Date("2028-07-20T00:00:00.000Z"),
    });
    expect(defaults.timeMin.getTime()).toBeLessThan(
      startOfToday.getTime() - 7 * MS_PER_DAY,
    );
  });

  it("advances the window by exactly one day across a day boundary", () => {
    const firstTick = new Date("2026-07-20T09:00:00.000Z");
    const laterSameDay = new Date("2026-07-20T23:59:59.000Z");
    const nextDay = new Date("2026-07-21T00:00:01.000Z");

    const first = getConfigurableSyncWindow("1_week", "1_month", firstTick);
    const later = getConfigurableSyncWindow("1_week", "1_month", laterSameDay);
    const next = getConfigurableSyncWindow("1_week", "1_month", nextDay);

    expect(later).toEqual(first);
    expect(next.timeMin.getTime() - first.timeMin.getTime()).toBe(MS_PER_DAY);
    expect(next.timeMin.getTime()).toBeGreaterThan(first.timeMin.getTime());
  });

  it("rejects unrecognized ranges instead of ordering them as narrowest", () => {
    const unsupported = "5_years" as never;

    expect(() => getWiderSyncRange(unsupported, "1_week")).toThrow(
      "Unsupported sync range: 5_years",
    );
    expect(() => getWiderSyncRange("1_week", unsupported)).toThrow(
      "Unsupported sync range: 5_years",
    );
  });

  it("rejects invalid windows and represents empty intersections as null", () => {
    const boundary = new Date("2026-03-01T00:00:00.000Z");
    expect(() => createSyncWindow(boundary, boundary)).toThrow(
      "Sync window start must be before its end",
    );
    expect(intersectSyncWindows(
      createSyncWindow(
        new Date("2026-01-01T00:00:00.000Z"),
        new Date("2026-02-01T00:00:00.000Z"),
      ),
      createSyncWindow(
        new Date("2026-02-01T00:00:00.000Z"),
        new Date("2026-03-01T00:00:00.000Z"),
      ),
    )).toBeNull();
  });
});
