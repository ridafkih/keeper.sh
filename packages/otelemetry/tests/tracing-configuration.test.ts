import { describe, expect, it } from "vitest";
import { loadTracingConfiguration } from "../src/tracing/configuration";

const buildIdentity = { ENV: "production", VERSION: "2.30.0", COMMIT_SHA: "8ce5a56c" };

describe("loadTracingConfiguration", () => {
  it("labels traces with the same version and commit the logs carry", () => {
    expect(loadTracingConfiguration(buildIdentity)).toMatchObject({
      environment: "production",
      version: "2.30.0",
      commit: "8ce5a56c",
    });
  });

  it("stays off until a collector endpoint is configured", () => {
    expect(loadTracingConfiguration(buildIdentity).enabled).toBe(false);
    expect(
      loadTracingConfiguration({ ...buildIdentity, OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:4318" }).enabled,
    ).toBe(true);
  });

  it.each(["ENV", "VERSION", "COMMIT_SHA"])("refuses to start without %s", (key) => {
    const environment = Object.fromEntries(Object.entries(buildIdentity).filter(([name]) => name !== key));
    expect(() => loadTracingConfiguration(environment)).toThrow(key);
  });
});
