import { describe, expect, it } from "vitest";
import { parseRegistrationEmailDomains } from "../src/registration-email-domains";

describe("parseRegistrationEmailDomains", () => {
  it("reads a comma-separated list, trimming spaces, a leading @ and case", () => {
    expect(parseRegistrationEmailDomains(" keeper.sh, @Example.COM ,")).toEqual([
      "keeper.sh",
      "example.com",
    ]);
  });

  it("reads an unset or empty value as no restriction", () => {
    expect(parseRegistrationEmailDomains()).toEqual([]);
    expect(parseRegistrationEmailDomains("")).toEqual([]);
  });
});
