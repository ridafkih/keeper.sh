import { afterEach, describe, expect, it, vi } from "vitest";

const importLogging = () => import("../../src/utils/logging");

describe("logging build identity", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("refuses to load without the commit the service was built from", async () => {
    vi.stubEnv("COMMIT_SHA", globalThis.undefined);
    vi.resetModules();
    await expect(importLogging()).rejects.toThrow(/COMMIT_SHA/);
  });

  it("refuses to load without the release version", async () => {
    vi.stubEnv("VERSION", "");
    vi.resetModules();
    await expect(importLogging()).rejects.toThrow(/VERSION/);
  });

  it("refuses to load without a known runtime environment", async () => {
    vi.stubEnv("ENV", "staging");
    vi.resetModules();
    await expect(importLogging()).rejects.toThrow(/ENV/);
  });

  it("loads when the build identity is supplied", async () => {
    const logging = await importLogging();
    expect(logging.widelog).toBeDefined();
    await logging.destroy();
  });
});
