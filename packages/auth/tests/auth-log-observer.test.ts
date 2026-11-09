import { describe, expect, it } from "vitest";
import { createAuthObservation } from "../src/auth-observer";
import type { AuthLogEntry } from "../src/auth-observer";

describe("the auth log observer", () => {
  it("hands better-auth's own log lines to the observer of the request they belong to", () => {
    const entries: AuthLogEntry[] = [];
    const observation = createAuthObservation({
      onAuthLog: (entry) => entries.push(entry),
      onRequestResolved: () => null,
      onUserCreated: () => null,
      onUserDeleted: () => null,
    });

    observation.logger.log("error", "Polar subscriptions list failed. Error: timeout");

    expect(entries).toEqual([
      { level: "error", message: "Polar subscriptions list failed. Error: timeout" },
    ]);
  });
});
