import { describe, expect, it } from "bun:test";
import { mapCalDAVDiscoverError } from "./discover-error-mapping";

describe("mapCalDAVDiscoverError", () => {
  it("maps auth failures to unauthorized responses", async () => {
    const mapped = mapCalDAVDiscoverError({ status: 401 });

    expect(mapped.slug).toBe("caldav-auth-failed");
    expect(mapped.response.status).toBe(401);
    expect(await mapped.response.json()).toEqual({ error: "Invalid credentials" });
  });

  it("maps non-auth failures to bad request responses", async () => {
    const mapped = mapCalDAVDiscoverError(new Error("network unavailable"));

    expect(mapped.slug).toBe("caldav-connection-failed");
    expect(mapped.response.status).toBe(400);
    expect(await mapped.response.json()).toEqual({ error: "Failed to discover calendars" });
  });
});
