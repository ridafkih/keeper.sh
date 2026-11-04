import { createEnv } from "arkenv";
import { describe, expect, it, vi } from "vitest";
import { schema as apiSchema } from "../../src/env";
import { schema as cronSchema } from "../../../cron/src/env";
import { schema as workerSchema } from "../../../worker/src/env";

vi.mock("arkenv", async (importOriginal) => ({
  ...await importOriginal<{ createEnv: typeof createEnv }>(),
  // Import each service's schema without parsing the test runner's own environment.
  default: () => ({}),
}));

const TENANT_ID = "abcdef01-2345-6789-abcd-ef0123456789";

describe.each([
  { name: "api", schema: apiSchema },
  { name: "cron", schema: cronSchema },
  { name: "worker", schema: workerSchema },
])("$name Microsoft environment", ({ schema }) => {
  it("accepts existing deployments without a tenant setting", () => {
    expect(() => createEnv({ MICROSOFT_TENANT_ID: schema.MICROSOFT_TENANT_ID }, {
      env: {},
    })).not.toThrow();
  });

  it("normalizes the tenant before it reaches authorization or refresh", () => {
    const env = createEnv({ MICROSOFT_TENANT_ID: schema.MICROSOFT_TENANT_ID }, {
      env: { MICROSOFT_TENANT_ID: ` ${TENANT_ID.toUpperCase()} ` },
    });

    expect(env.MICROSOFT_TENANT_ID).toBe(TENANT_ID);
  });

  it("fails startup for a malformed tenant instead of failing the next refresh", () => {
    expect(() => createEnv({ MICROSOFT_TENANT_ID: schema.MICROSOFT_TENANT_ID }, {
      env: { MICROSOFT_TENANT_ID: "../common?prompt=none" },
    })).toThrow(/MICROSOFT_TENANT_ID/);
  });
});
