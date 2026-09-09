import { describe, expect, it } from "vitest";
import { resolveAccountIdentity } from "../../src/lib/account-identity";

describe("resolveAccountIdentity", () => {
  it("labels a user with a username by that username", () => {
    expect(
      resolveAccountIdentity({ email: "ada@local", id: "user-1", name: "Ada", username: "ada" }),
    ).toEqual({ label: "Username", value: "ada" });
  });

  it("labels a user without a username by email", () => {
    expect(
      resolveAccountIdentity({ email: "ada@example.com", id: "user-1", name: "Ada" }),
    ).toEqual({ label: "Email", value: "ada@example.com" });
  });

  it("returns an empty email label when there is no session", () => {
    expect(resolveAccountIdentity(null)).toEqual({ label: "Email", value: "" });
  });
});
