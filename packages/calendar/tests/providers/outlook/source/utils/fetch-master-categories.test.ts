import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearMasterCategoryColorsCache,
  fetchMasterCategoryColors,
  getMasterCategoryColors,
} from "../../../../../src/providers/outlook/source/utils/fetch-master-categories";

const originalFetch = globalThis.fetch;

const createFetchQueue = (
  queuedResponses: Response[],
  requestedUrls: string[] = [],
): typeof fetch => {
  let requestCount = 0;
  return ((input: Request | URL | string): Promise<Response> => {
    if (input instanceof Request) {
      requestedUrls.push(input.url);
    } else {
      requestedUrls.push(input.toString());
    }
    const nextResponse = queuedResponses[requestCount];
    requestCount += 1;
    if (!nextResponse) {
      throw new Error("Unexpected fetch invocation");
    }
    return Promise.resolve(nextResponse);
  }) as typeof fetch;
};

beforeEach(() => {
  clearMasterCategoryColorsCache();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("fetchMasterCategoryColors", () => {
  it("follows pagination and maps lowercased names to preset hexes", async () => {
    const requestedUrls: string[] = [];
    globalThis.fetch = createFetchQueue([
      Response.json({
        "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/outlook/masterCategories?$skip=2",
        value: [
          { color: "preset7", displayName: "Blue Category" },
          { color: "none", displayName: "Colorless" },
        ],
      }),
      Response.json({
        value: [
          { color: "preset0", displayName: "Red Category" },
          { color: null, displayName: "Null Color" },
          { color: "preset1" },
        ],
      }),
    ], requestedUrls);

    const colors = await fetchMasterCategoryColors("token-1");

    expect(requestedUrls[0]).toContain("/me/outlook/masterCategories");
    expect(requestedUrls[1]).toContain("$skip=2");
    expect(colors.get("blue category")).toBe("#5ca9e5");
    expect(colors.get("red category")).toBe("#dc626d");
    expect(colors.size).toBe(2);
  });

  it("throws on a non-ok response", async () => {
    globalThis.fetch = createFetchQueue([Response.json({}, { status: 403 })]);

    await expect(fetchMasterCategoryColors("token-1")).rejects.toThrow(
      "Failed to fetch master categories: 403",
    );
  });
});

describe("getMasterCategoryColors", () => {
  it("caches per token and reuses the fetched map", async () => {
    const requestedUrls: string[] = [];
    globalThis.fetch = createFetchQueue([
      Response.json({ value: [{ color: "preset7", displayName: "Blue" }] }),
    ], requestedUrls);

    const first = await getMasterCategoryColors("token-1");
    const second = await getMasterCategoryColors("token-1");

    expect(requestedUrls).toHaveLength(1);
    expect(first).toBe(second);
    expect(first?.get("blue")).toBe("#5ca9e5");
  });

  it("returns null instead of throwing when the fetch fails", async () => {
    globalThis.fetch = createFetchQueue([Response.json({}, { status: 500 })]);

    await expect(getMasterCategoryColors("token-1")).resolves.toBeNull();
  });

  it("shares one in-flight fetch between concurrent callers", async () => {
    const requestedUrls: string[] = [];
    globalThis.fetch = createFetchQueue([
      Response.json({ value: [{ color: "preset7", displayName: "Blue" }] }),
    ], requestedUrls);

    const [first, second] = await Promise.all([
      getMasterCategoryColors("token-1"),
      getMasterCategoryColors("token-1"),
    ]);

    expect(requestedUrls).toHaveLength(1);
    expect(first).toBe(second);
  });

  it("caches a failure briefly instead of refetching on every call", async () => {
    const requestedUrls: string[] = [];
    globalThis.fetch = createFetchQueue([Response.json({}, { status: 403 })], requestedUrls);

    expect(await getMasterCategoryColors("token-1")).toBeNull();
    expect(await getMasterCategoryColors("token-1")).toBeNull();

    expect(requestedUrls).toHaveLength(1);
  });

  it("does not cache a fetch its caller aborted", async () => {
    const requestedUrls: string[] = [];
    const controller = new AbortController();
    globalThis.fetch = createFetchQueue([
      Response.json({}, { status: 500 }),
      Response.json({ value: [{ color: "preset7", displayName: "Blue" }] }),
    ], requestedUrls);

    controller.abort();
    expect(await getMasterCategoryColors("token-1", controller.signal)).toBeNull();
    const colors = await getMasterCategoryColors("token-1");

    expect(requestedUrls).toHaveLength(2);
    expect(colors?.get("blue")).toBe("#5ca9e5");
  });
});
