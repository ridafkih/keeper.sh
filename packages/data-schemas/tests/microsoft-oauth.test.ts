import { describe, expect, it } from "vitest";
import { microsoftDirectoryTenantSchema } from "../src/index";

const DIRECTORY_ID = "abcdef01-2345-6789-abcd-ef0123456789";

describe("Microsoft directory tenant", () => {
  it.each([DIRECTORY_ID, "common", "organizations", "consumers"])("accepts %j as written", (value) => {
    expect(microsoftDirectoryTenantSchema.assert(value)).toBe(value);
  });

  it.each([
    "",
    "  ",
    ` ${DIRECTORY_ID} `,
    DIRECTORY_ID.toUpperCase(),
    "Common",
    " common",
    "not-a-tenant",
    "contoso.onmicrosoft.com",
    "../common",
    "common?prompt=none",
    "common#fragment",
    "common/oauth2/v2.0",
    "common%2f..",
    "https://example.invalid/tenant",
  ])("rejects %j", (value) => {
    expect(() => microsoftDirectoryTenantSchema.assert(value)).toThrow();
  });
});
