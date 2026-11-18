import { describe, expect, it } from "vitest";
import { withDefaultCacheControl } from "../../src/middleware/cache-control";

const FEED_CACHE_CONTROL = "private, max-age=300";

const respond = (response: Response | undefined): Promise<Response | undefined> =>
  Promise.resolve(withDefaultCacheControl(() => response)(new Request("http://localhost/api/health")));

describe("withDefaultCacheControl", () => {
  it("marks a response without a cache header as not storable", async () => {
    const response = await respond(Response.json({ ok: true }));

    expect(response?.headers.get("Cache-Control")).toBe("no-store");
  });

  it("marks error responses as not storable too", async () => {
    const response = await respond(new Response("Not found", { status: 404 }));

    expect(response?.headers.get("Cache-Control")).toBe("no-store");
  });

  it("leaves a cache header the route chose for itself", async () => {
    const response = await respond(
      new Response("BEGIN:VCALENDAR", { headers: { "Cache-Control": FEED_CACHE_CONTROL } }),
    );

    expect(response?.headers.get("Cache-Control")).toBe(FEED_CACHE_CONTROL);
  });

  it("leaves a cache header written in lower case", async () => {
    const response = await respond(
      new Response("{}", { headers: { "cache-control": "public, max-age=60" } }),
    );

    expect(response?.headers.get("Cache-Control")).toBe("public, max-age=60");
  });

  it("keeps the status, body and other headers of the response", async () => {
    const response = await respond(
      Response.json({ id: "source-1" }, { headers: { "x-request-id": "request-1" }, status: 201 }),
    );

    expect(response?.status).toBe(201);
    expect(response?.headers.get("x-request-id")).toBe("request-1");
    expect(response?.headers.get("content-type")).toContain("application/json");
    await expect(response?.json()).resolves.toEqual({ id: "source-1" });
  });

  it("keeps every cookie a response sets", async () => {
    const original = new Response(null, { status: 200 });
    original.headers.append("Set-Cookie", "first=1; Path=/");
    original.headers.append("Set-Cookie", "second=2; Path=/");

    const response = await respond(original);

    expect(response?.headers.getSetCookie()).toEqual(["first=1; Path=/", "second=2; Path=/"]);
  });

  it("handles a response that carries no body", async () => {
    const response = await respond(new Response(null, { status: 204 }));

    expect(response?.status).toBe(204);
    expect(response?.headers.get("Cache-Control")).toBe("no-store");
  });

  it("passes through a request that produced no response, such as a socket upgrade", async () => {
    await expect(respond(globalThis.undefined)).resolves.toBeUndefined();
  });
});
