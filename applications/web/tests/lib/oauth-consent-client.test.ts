import { describe, expect, it } from "vitest";
import {
  buildPublicOAuthClientUrl,
  readOAuthClientName,
  resolveRedirectDestination,
} from "../../src/lib/oauth-consent-client";

describe("readOAuthClientName", () => {
  it("reads the name the client registered with", () => {
    expect(readOAuthClientName({ client_id: "abc", client_name: "Claude" })).toBe("Claude");
  });

  it("trims surrounding whitespace", () => {
    expect(readOAuthClientName({ client_name: "  Claude  " })).toBe("Claude");
  });

  it("returns null when the client registered no usable name", () => {
    expect(readOAuthClientName({ client_id: "abc" })).toBeNull();
    expect(readOAuthClientName({ client_name: "   " })).toBeNull();
    expect(readOAuthClientName({ client_name: 42 })).toBeNull();
    expect(readOAuthClientName(null)).toBeNull();
  });
});

describe("resolveRedirectDestination", () => {
  it("shows the host of a web redirect, including its port", () => {
    expect(resolveRedirectDestination("https://claude.ai/api/mcp/auth_callback")).toBe("claude.ai");
    expect(resolveRedirectDestination("http://127.0.0.1:6274/oauth/callback")).toBe("127.0.0.1:6274");
  });

  it("keeps the scheme of an app redirect so it can't pass for a website", () => {
    expect(resolveRedirectDestination("cursor://anysphere.cursor-retrieval/oauth/callback")).toBe(
      "cursor://anysphere.cursor-retrieval",
    );
  });

  it("falls back to the scheme when an app redirect has no host", () => {
    expect(resolveRedirectDestination("com.example.app:/oauth")).toBe("com.example.app:");
  });

  it("returns null for a value that isn't a URL", () => {
    expect(resolveRedirectDestination("not a url")).toBeNull();
  });
});

describe("buildPublicOAuthClientUrl", () => {
  it("encodes the client id into the public client lookup", () => {
    expect(buildPublicOAuthClientUrl("a b&c")).toBe("/api/auth/oauth2/public-client?client_id=a+b%26c");
  });
});
