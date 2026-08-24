import { describe, expect, it } from "vitest";
import { resolveWebhookConfig } from "../../../src/core/source/push-webhook-url";

describe("resolveWebhookConfig", () => {
  it("treats an unset variable as a supported configuration", () => {
    const environment: Record<string, string | undefined> = {};

    expect(resolveWebhookConfig(environment.WEBHOOK_PUBLIC_URL)).toBeNull();
    expect(resolveWebhookConfig("")).toBeNull();
  });

  it("rejects a plaintext origin", () => {
    expect(() => resolveWebhookConfig("http://example.com")).toThrow(/https/i);
  });

  it("rejects an origin no provider could reach", () => {
    const unreachable = [
      "https://localhost:3000",
      "https://127.0.0.1",
      "https://[::1]",
      "https://192.168.1.10",
      "https://10.0.0.4",
      "https://172.16.3.9",
      "https://169.254.1.1",
      "https://keeper.local",
    ];

    for (const origin of unreachable) {
      expect(() => resolveWebhookConfig(origin)).toThrow();
    }
  });

  it("accepts a public domain whose name begins with an ipv6 private prefix", () => {
    const reachable = [
      "https://fdcalendar.com",
      "https://fchosting.example.com",
      "https://fe80hosting.example.com",
      "https://fd.example.com",
    ];

    for (const origin of reachable) {
      expect(() => resolveWebhookConfig(origin)).not.toThrow();
    }

    expect(resolveWebhookConfig("https://fdcalendar.com")).toEqual({
      googleCallbackUrl: "https://fdcalendar.com/api/webhook/google",
      outlookCallbackUrl: "https://fdcalendar.com/api/webhook/outlook",
    });
  });

  it("still rejects bracketed ipv6 unique-local and link-local literals", () => {
    const unreachable = [
      "https://[fd00::1]",
      "https://[fc00::1]",
      "https://[fe80::1]",
    ];

    for (const origin of unreachable) {
      expect(() => resolveWebhookConfig(origin)).toThrow(/publicly reachable/u);
    }
  });

  it("rejects an origin carrying a path rather than silently discarding it", () => {
    expect(() => resolveWebhookConfig("https://example.com/keeper")).toThrow(/path/u);
    expect(() => resolveWebhookConfig("https://example.com/keeper/")).toThrow(/path/u);
  });

  it("rejects an origin carrying a query string or fragment", () => {
    expect(() => resolveWebhookConfig("https://example.com?x=1")).toThrow();
    expect(() => resolveWebhookConfig("https://example.com#frag")).toThrow();
    expect(() => resolveWebhookConfig("https://example.com/api?x=1")).toThrow();
    expect(() => resolveWebhookConfig("https://example.com/api#frag")).toThrow();
  });

  it("rejects a value that is not a url at all", () => {
    expect(() => resolveWebhookConfig("not a url")).toThrow();
  });

  it("builds both provider callback urls from a public origin", () => {
    expect(resolveWebhookConfig("https://www.example.com")).toEqual({
      googleCallbackUrl: "https://www.example.com/api/webhook/google",
      outlookCallbackUrl: "https://www.example.com/api/webhook/outlook",
    });
  });

  it("tolerates a trailing slash on the configured origin", () => {
    expect(resolveWebhookConfig("https://www.example.com/")).toEqual({
      googleCallbackUrl: "https://www.example.com/api/webhook/google",
      outlookCallbackUrl: "https://www.example.com/api/webhook/outlook",
    });
  });
});
