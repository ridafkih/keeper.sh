import { beforeEach, describe, expect, it, vi } from "vitest";

type WideEvent = Record<string, unknown>;

interface Harness {
  current: WideEvent;
  emitted: WideEvent[];
  env: Record<string, unknown>;
}

const harness = vi.hoisted((): Harness => ({ current: {}, emitted: [], env: {} }));

vi.mock("../../src/env", () => ({
  get default(): Record<string, unknown> {
    return harness.env;
  },
}));

vi.mock("../../src/utils/logging", () => ({
  context: <Result>(callback: () => Result): Result => callback(),
  widelog: {
    flush: (): void => {
      harness.emitted.push(harness.current);
      harness.current = {};
    },
    set: (key: string, value: unknown): void => {
      harness.current[key] = value;
    },
    setFields: (fields: WideEvent): void => {
      harness.current = { ...harness.current, ...fields };
    },
  },
}));

const loadWith = (env: Record<string, unknown>) => {
  harness.env = env;
  vi.resetModules();
  return import("../../src/utils/safe-fetch-options");
};

describe("worker outbound fetch options", () => {
  beforeEach(() => {
    harness.current = {};
    harness.emitted = [];
  });

  it("blocks private addresses when the setting is absent", async () => {
    const { safeFetchOptions } = await loadWith({});

    expect(safeFetchOptions.blockPrivateResolution).toBe(true);
  });

  it("allows private addresses when the setting is turned off", async () => {
    const { safeFetchOptions } = await loadWith({ BLOCK_PRIVATE_RESOLUTION: false });

    expect(safeFetchOptions.blockPrivateResolution).toBe(false);
  });

  it("blocks private addresses in commercial mode even when the setting is turned off", async () => {
    const { safeFetchOptions } = await loadWith({
      BLOCK_PRIVATE_RESOLUTION: false,
      COMMERCIAL_MODE: true,
    });

    expect(safeFetchOptions.blockPrivateResolution).toBe(true);
  });

  it("passes the allowed hosts through", async () => {
    const { safeFetchOptions } = await loadWith({ PRIVATE_RESOLUTION_WHITELIST: "nas.local:5232" });

    expect(safeFetchOptions.allowedPrivateHosts).toEqual(new Set(["nas.local:5232"]));
  });

  it("reports the effective setting as one startup event", async () => {
    const { reportPrivateResolutionPolicy } = await loadWith({ BLOCK_PRIVATE_RESOLUTION: false });

    reportPrivateResolutionPolicy();

    expect(harness.emitted).toEqual([
      {
        "config.block_private_resolution": false,
        "config.block_private_resolution_source": "configured",
        "config.private_resolution_whitelist_size": 0,
        "operation.name": "private-resolution-policy",
        "operation.type": "lifecycle",
        outcome: "success",
      },
    ]);
  });

  it("emits nothing until the service asks for the report", async () => {
    await loadWith({});

    expect(harness.emitted).toEqual([]);
  });
});
