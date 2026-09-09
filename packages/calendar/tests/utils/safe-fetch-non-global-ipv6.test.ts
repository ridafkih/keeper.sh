import { describe, it, expect, vi, beforeEach } from "vitest";
import { validateUrlSafety, UrlSafetyError } from "../../src/utils/safe-fetch";
import type { SafeFetchOptions } from "../../src/utils/safe-fetch";

const { mockResolve4, mockResolve6 } = vi.hoisted(() => ({
  mockResolve4: vi.fn<(hostname: string) => Promise<string[]>>(),
  mockResolve6: vi.fn<(hostname: string) => Promise<string[]>>(),
}));

vi.mock("node:dns/promises", () => ({
  resolve4: mockResolve4,
  resolve6: mockResolve6,
}));

const enabledOptions: SafeFetchOptions = { blockPrivateResolution: true };

const noRecords = () => {
  mockResolve4.mockRejectedValue(new Error("no A records"));
  mockResolve6.mockRejectedValue(new Error("no AAAA records"));
};

beforeEach(() => {
  mockResolve4.mockReset();
  mockResolve6.mockReset();
});

describe("non-global IPv6 scopes are rejected", () => {
  it("rejects a site-local literal", async () => {
    noRecords();
    await expect(validateUrlSafety("http://[fec0::2]:8080/feed.ics", enabledOptions)).rejects.toThrow(UrlSafetyError);
  });

  it("rejects a site-local address returned by DNS", async () => {
    noRecords();
    mockResolve6.mockResolvedValue(["fec0::2"]);
    await expect(validateUrlSafety("http://internal.example.com/feed.ics", enabledOptions)).rejects.toThrow(UrlSafetyError);
  });

  it("rejects an IPv4-compatible loopback literal", async () => {
    noRecords();
    await expect(validateUrlSafety("http://[::7f00:1]:8080/feed.ics", enabledOptions)).rejects.toThrow(UrlSafetyError);
  });

  it("rejects a unique-local literal", async () => {
    noRecords();
    await expect(validateUrlSafety("http://[fd00::1]/feed.ics", enabledOptions)).rejects.toThrow(UrlSafetyError);
  });

  it("rejects a documentation-range literal inside 2000::/3", async () => {
    noRecords();
    await expect(validateUrlSafety("http://[2001:db8::1]/feed.ics", enabledOptions)).rejects.toThrow(UrlSafetyError);
  });

  it("rejects the RFC 9637 documentation range 3fff::/20", async () => {
    noRecords();
    await expect(validateUrlSafety("http://[3fff::abcd]/feed.ics", enabledOptions)).rejects.toThrow(UrlSafetyError);
  });

  it("rejects 3fff::/20 returned by DNS", async () => {
    noRecords();
    mockResolve6.mockResolvedValue(["3fff:0:0:1::2"]);
    await expect(validateUrlSafety("http://doc.example.com/feed.ics", enabledOptions)).rejects.toThrow(UrlSafetyError);
  });
});

describe("global addresses remain allowed", () => {
  it("allows a global IPv6 literal", async () => {
    noRecords();
    await expect(validateUrlSafety("http://[2606:4700:4700::1111]/feed.ics", enabledOptions)).resolves.toBeUndefined();
  });

  it("allows a global IPv6 address returned by DNS", async () => {
    noRecords();
    mockResolve6.mockResolvedValue(["2606:4700:4700::1111"]);
    await expect(validateUrlSafety("http://cdn.example.com/feed.ics", enabledOptions)).resolves.toBeUndefined();
  });

  it("allows an IPv4-mapped public address", async () => {
    noRecords();
    await expect(validateUrlSafety("http://[::ffff:93.184.216.34]/feed.ics", enabledOptions)).resolves.toBeUndefined();
  });
});
