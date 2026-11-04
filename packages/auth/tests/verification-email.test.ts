import { describe, expect, it } from "vitest";
import { buildVerificationEmail } from "../src/verification-email";

describe("buildVerificationEmail", () => {
  const email = buildVerificationEmail({
    url: "https://www.keeper.sh/api/auth/verify-email?token=abc",
    user: { email: "person@example.com", name: "Person" },
  });

  it("names the email as a verification under the Keeper.sh brand", () => {
    expect(email.subject).toBe("Verify your email for Keeper.sh");
  });

  it("sends the verification link to the registering address", () => {
    expect(email.to).toBe("person@example.com");
    expect(email.template.variables).toEqual({
      name: "Person",
      url: "https://www.keeper.sh/api/auth/verify-email?token=abc",
    });
  });
});
