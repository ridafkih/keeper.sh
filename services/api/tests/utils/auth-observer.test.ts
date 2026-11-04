import { beforeEach, describe, expect, it, vi } from "vitest";

type Event = Record<string, unknown>;

let current: Event = {};
let flushed: Event[] = [];

vi.mock("@/utils/logging", () => ({
  context: (run: () => unknown) => {
    const outer = current;
    current = {};
    try {
      return run();
    } finally {
      current = outer;
    }
  },
  widelog: {
    flush: () => {
      flushed.push(current);
    },
    set: (key: string, value: unknown) => {
      current = { ...current, [key]: value };
    },
  },
}));

const { authObserver } = await import("@/utils/auth-observer");

beforeEach(() => {
  current = {};
  flushed = [];
});

describe("authObserver", () => {
  it("puts the user, provider and better-auth error code on the auth request's event", () => {
    authObserver.onRequestResolved({ errorCode: "SESSION_EXPIRED", provider: "google", userId: "user-1" });

    expect(current).toEqual({
      "auth.error_code": "SESSION_EXPIRED",
      "auth.provider": "google",
      "user.id": "user-1",
    });
  });

  it("leaves out what the request did not resolve", () => {
    authObserver.onRequestResolved({ errorCode: null, provider: null, userId: null });

    expect(current).toEqual({});
  });

  it("emits user.created as its own lifecycle event without touching the request's event", () => {
    current = { "operation.name": "POST /api/auth/sign-up/email" };

    authObserver.onUserCreated("user-1");

    expect(flushed).toEqual([{
      "operation.name": "user.created",
      "operation.type": "lifecycle",
      outcome: "success",
      "user.id": "user-1",
    }]);
    expect(current).toEqual({ "operation.name": "POST /api/auth/sign-up/email" });
  });

  it("emits user.deleted as its own lifecycle event", () => {
    authObserver.onUserDeleted("user-1");

    expect(flushed.map((event) => event["operation.name"])).toEqual(["user.deleted"]);
  });
});
