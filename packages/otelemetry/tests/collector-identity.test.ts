import { describe, expect, it } from "vitest";
import { readCollectorIdentity } from "../src/collector-identity";

describe("readCollectorIdentity", () => {
  it("names the service, version and environment the logs come from", () => {
    expect(
      readCollectorIdentity({ OTEL_SERVICE_NAME: "keeper-web", VERSION: "2.30.0", ENV: "production" }),
    ).toEqual({
      serviceName: "keeper-web",
      serviceVersion: "2.30.0",
      deploymentEnvironment: "production",
    });
  });

  it("refuses to forward logs without a service name instead of labelling them unknown", () => {
    expect(() => readCollectorIdentity({ VERSION: "2.30.0", ENV: "production" })).toThrow(
      /OTEL_SERVICE_NAME/,
    );
  });

  it("lists every missing key at once", () => {
    expect(() => readCollectorIdentity({})).toThrow(/OTEL_SERVICE_NAME, VERSION, ENV/);
  });
});
