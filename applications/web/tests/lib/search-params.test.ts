import { describe, expect, it } from "vitest";
import { createMemoryHistory, createRootRoute, createRouter } from "@tanstack/react-router";
import { parseQueryString, stringifyQueryRecord } from "../../src/lib/search-params";

const SIGNED_CONSENT_QUERY = new URLSearchParams([
  ["response_type", "code"],
  ["redirect_uri", "http://localhost:61442/callback"],
  ["scope", "keeper.read keeper.write offline_access"],
  ["state", "1234567890"],
  ["client_id", "client"],
  ["prompt", "consent"],
  ["exp", "1793903305"],
  ["ba_iat", "1793902705645"],
  ["ba_param", "ba_iat"],
  ["ba_param", "ba_param"],
  ["ba_param", "client_id"],
  ["ba_param", "exp"],
  ["sig", "LINUn3YM02/6C1uo29rVDpy8W1diNLDb7o2xja15KZ0="],
]).toString();

const loadLocation = async (href: string) => {
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: [href] }),
    parseSearch: parseQueryString,
    routeTree: createRootRoute(),
    stringifySearch: stringifyQueryRecord,
  });
  await router.load();
  return router.state.location;
};

describe("router search serialization", () => {
  it("leaves a signed consent query byte-for-byte unchanged", async () => {
    const location = await loadLocation(`/oauth/consent?${SIGNED_CONSENT_QUERY}`);

    expect(location.searchStr).toBe(`?${SIGNED_CONSENT_QUERY}`);
    expect(new URLSearchParams(location.searchStr).getAll("ba_param")).toEqual([
      "ba_iat",
      "ba_param",
      "client_id",
      "exp",
    ]);
  });

  it("keeps numeric-looking values as plain strings", () => {
    expect(parseQueryString("?state=1234567890&exp=17")).toEqual({ exp: "17", state: "1234567890" });
  });

  it("writes repeated keys back as repeated parameters", () => {
    expect(stringifyQueryRecord({ index: 2, scope: ["a", "b"], step: undefined })).toBe("?index=2&scope=a&scope=b");
  });

  it("writes an empty search as no query string", () => {
    expect(stringifyQueryRecord({})).toBe("");
  });
});
