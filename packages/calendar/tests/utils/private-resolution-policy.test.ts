import { describe, expect, it, vi } from "vitest";
import {
  describePrivateResolutionPolicy,
  resolvePrivateResolutionPolicy,
} from "../../src/utils/private-resolution-policy";
import { UrlSafetyError, validateUrlSafety } from "../../src/utils/safe-fetch";

const { mockResolve4, mockResolve6 } = vi.hoisted(() => ({
  mockResolve4: vi.fn<(hostname: string) => Promise<string[]>>(),
  mockResolve6: vi.fn<(hostname: string) => Promise<string[]>>(),
}));

vi.mock("node:dns/promises", () => ({
  resolve4: mockResolve4,
  resolve6: mockResolve6,
}));

const PRIVATE_SERVER = "http://192.168.1.20:5232/calendars/";

describe("resolvePrivateResolutionPolicy", () => {
  it("blocks private addresses when nothing is configured", () => {
    expect(resolvePrivateResolutionPolicy({})).toEqual({
      options: { blockPrivateResolution: true },
      source: "default",
    });
  });

  it("blocks private addresses when the setting is turned on", () => {
    expect(resolvePrivateResolutionPolicy({ BLOCK_PRIVATE_RESOLUTION: true })).toEqual({
      options: { blockPrivateResolution: true },
      source: "configured",
    });
  });

  it("allows private addresses only when the setting is turned off explicitly", () => {
    expect(resolvePrivateResolutionPolicy({ BLOCK_PRIVATE_RESOLUTION: false })).toEqual({
      options: { blockPrivateResolution: false },
      source: "configured",
    });
  });

  it("keeps allowing private addresses when turned off outside commercial mode", () => {
    const policy = resolvePrivateResolutionPolicy({
      BLOCK_PRIVATE_RESOLUTION: false,
      COMMERCIAL_MODE: false,
    });

    expect(policy.options.blockPrivateResolution).toBe(false);
  });

  it("blocks private addresses in commercial mode even when the setting is turned off", () => {
    expect(
      resolvePrivateResolutionPolicy({ BLOCK_PRIVATE_RESOLUTION: false, COMMERCIAL_MODE: true }),
    ).toEqual({
      options: { blockPrivateResolution: true },
      source: "commercial-mode",
    });
  });

  it("blocks private addresses in commercial mode when nothing else is configured", () => {
    expect(resolvePrivateResolutionPolicy({ COMMERCIAL_MODE: true })).toEqual({
      options: { blockPrivateResolution: true },
      source: "default",
    });
  });

  it("reads the allowed hosts from a comma-separated list", () => {
    const policy = resolvePrivateResolutionPolicy({
      PRIVATE_RESOLUTION_WHITELIST: "192.168.1.20:5232, nas.local ,,",
    });

    expect(policy.options.allowedPrivateHosts).toEqual(new Set(["192.168.1.20:5232", "nas.local"]));
  });

  it("leaves the allowed hosts unset when no list is given", () => {
    expect(resolvePrivateResolutionPolicy({ PRIVATE_RESOLUTION_WHITELIST: "" }).options)
      .not.toHaveProperty("allowedPrivateHosts");
  });
});

describe("the resolved policy applied to a server on a private network", () => {
  it("refuses it when nothing is configured", async () => {
    const { options } = resolvePrivateResolutionPolicy({});

    await expect(validateUrlSafety(PRIVATE_SERVER, options)).rejects.toThrow(UrlSafetyError);
  });

  it("reaches it when the setting is turned off", async () => {
    const { options } = resolvePrivateResolutionPolicy({ BLOCK_PRIVATE_RESOLUTION: false });

    await expect(validateUrlSafety(PRIVATE_SERVER, options)).resolves.toBeUndefined();
  });

  it("reaches it in commercial mode only when the host is on the allowed list", async () => {
    const { options } = resolvePrivateResolutionPolicy({
      BLOCK_PRIVATE_RESOLUTION: false,
      COMMERCIAL_MODE: true,
      PRIVATE_RESOLUTION_WHITELIST: "192.168.1.20:5232",
    });

    await expect(validateUrlSafety(PRIVATE_SERVER, options)).resolves.toBeUndefined();
    await expect(validateUrlSafety("http://192.168.1.21:5232/", options)).rejects.toThrow(UrlSafetyError);
  });
});

describe("describePrivateResolutionPolicy", () => {
  it("reports the effective setting, where it came from and the size of the allowed list", () => {
    const policy = resolvePrivateResolutionPolicy({
      BLOCK_PRIVATE_RESOLUTION: false,
      COMMERCIAL_MODE: true,
      PRIVATE_RESOLUTION_WHITELIST: "nas.local,192.168.1.20:5232",
    });

    expect(describePrivateResolutionPolicy(policy)).toEqual({
      "config.block_private_resolution": true,
      "config.block_private_resolution_source": "commercial-mode",
      "config.private_resolution_whitelist_size": 2,
    });
  });

  it("reports a disabled setting as disabled", () => {
    const policy = resolvePrivateResolutionPolicy({ BLOCK_PRIVATE_RESOLUTION: false });

    expect(describePrivateResolutionPolicy(policy)).toEqual({
      "config.block_private_resolution": false,
      "config.block_private_resolution_source": "configured",
      "config.private_resolution_whitelist_size": 0,
    });
  });
});
