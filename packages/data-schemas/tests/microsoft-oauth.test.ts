import { describe, expect, it } from "vitest";
import { microsoftTenantIdSchema } from "../src/index";

const TENANT_ID = "abcdef01-2345-6789-abcd-ef0123456789";

describe("Microsoft tenant configuration", () => {
  it.each<{ tenantId?: string }>([{}, { tenantId: "" }, { tenantId: "  " }])(
    "keeps the common authority when unset or blank: %j",
    ({ tenantId }) => {
      expect(microsoftTenantIdSchema.assert(tenantId)).toBe("common");
    },
  );

  it.each([TENANT_ID, ` ${TENANT_ID.toUpperCase()} `])("canonicalizes directory ID %j", (value) => {
    expect(microsoftTenantIdSchema.assert(value)).toBe(TENANT_ID);
  });

  it.each(["common", "organizations", "consumers"])("accepts authority %s", (value) => {
    expect(microsoftTenantIdSchema.assert(` ${value.toUpperCase()} `)).toBe(value);
  });

  it.each([
    "not-a-tenant",
    "contoso.onmicrosoft.com",
    "../common",
    "common?prompt=none",
    "common#fragment",
    "common/oauth2/v2.0",
    "common%2f..",
    "https://example.invalid/tenant",
  ])("rejects a noncanonical tenant or URL component %j", (value) => {
    expect(() => microsoftTenantIdSchema.assert(value)).toThrow();
  });
});
