import { describe, expect, it } from "bun:test";
import { DestinationAccountOwnershipError } from "./destination-errors";
import { validateDestinationAccountOwnership } from "./destination-account-repository";

describe("validateDestinationAccountOwnership", () => {
  it("does not throw when account is missing", () => {
    expect(() =>
      validateDestinationAccountOwnership(globalThis.undefined, "user-1"),
    ).not.toThrow();
  });

  it("does not throw when account belongs to same user", () => {
    expect(() =>
      validateDestinationAccountOwnership(
        { caldavCredentialId: null, id: "account-1", oauthCredentialId: null, userId: "user-1" },
        "user-1",
      ),
    ).not.toThrow();
  });

  it("throws when account belongs to different user", () => {
    expect(() =>
      validateDestinationAccountOwnership(
        { caldavCredentialId: null, id: "account-1", oauthCredentialId: null, userId: "user-2" },
        "user-1",
      ),
    ).toThrow(DestinationAccountOwnershipError);
  });
});
