import { beforeEach, describe, expect, it, vi } from "vitest";

type Event = Record<string, unknown>;

let current: Event = {};
let flushed: Event[] = [];
let stored: { userId: string; attribution: unknown }[] = [];
let recordFails = false;

vi.mock("@/utils/logging", () => ({
  context: async (run: () => Promise<unknown>) => {
    const outer = current;
    current = {};
    try {
      return await run();
    } finally {
      current = outer;
    }
  },
  widelog: {
    errorFields: () => null,
    flush: () => {
      flushed.push(current);
    },
    set: (key: string, value: unknown) => {
      current = { ...current, [key]: value };
    },
    setFields: (fields: Event) => {
      current = { ...current, ...fields };
    },
  },
}));

vi.mock("@/utils/error-labelling", () => ({
  labelFailure: () => null,
}));

vi.mock("@/context", () => ({ database: {} }));

vi.mock("@keeper.sh/database", () => ({
  recordUserSignUpAttribution: (_database: unknown, userId: string, attribution: unknown) => {
    if (recordFails) {
      return Promise.reject(new Error("connection closed"));
    }
    stored.push({ attribution, userId });
    return Promise.resolve();
  },
}));

const { noteUserCreated } = await import("@/utils/user-created");

beforeEach(() => {
  current = {};
  flushed = [];
  stored = [];
  recordFails = false;
});

describe("noteUserCreated", () => {
  it("puts where the user came from on user.created and stores it", async () => {
    await noteUserCreated("user-1", {
      landingPath: "/compare/onecal",
      referrerOrigin: "https://www.google.com",
      utmCampaign: "launch",
      utmMedium: "cpc",
      utmSource: "google",
    });

    expect(flushed).toEqual([{
      "operation.name": "user.created",
      "operation.type": "lifecycle",
      outcome: "success",
      "signup.attributed": true,
      "signup.attribution_stored": true,
      "signup.landing_path": "/compare/onecal",
      "signup.referrer_origin": "https://www.google.com",
      "signup.utm_campaign": "launch",
      "signup.utm_medium": "cpc",
      "signup.utm_source": "google",
      "user.id": "user-1",
    }]);
    expect(stored).toEqual([{ attribution: expect.objectContaining({ landingPath: "/compare/onecal" }), userId: "user-1" }]);
  });

  it("marks a sign-up that carried no attribution and stores nothing", async () => {
    await noteUserCreated("user-1", null);

    expect(flushed).toEqual([{
      "operation.name": "user.created",
      "operation.type": "lifecycle",
      outcome: "success",
      "signup.attributed": false,
      "user.id": "user-1",
    }]);
    expect(stored).toEqual([]);
  });

  it("still reports the sign-up when storing the attribution fails", async () => {
    recordFails = true;

    await noteUserCreated("user-1", { landingPath: "/" });

    expect(flushed).toEqual([expect.objectContaining({
      "operation.name": "user.created",
      outcome: "success",
      "signup.attribution_stored": false,
      "signup.landing_path": "/",
    })]);
  });
});
