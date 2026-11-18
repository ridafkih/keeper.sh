import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPOSITORY_ROOT = join(import.meta.dirname, "..", "..", "..", "..");

const readDockerfile = (...segments: string[]): string =>
  readFileSync(join(REPOSITORY_ROOT, ...segments, "Dockerfile"), "utf8");

const SETTING_PATTERN = /^ENV BLOCK_PRIVATE_RESOLUTION=(\S+)$/mu;

const readShippedSetting = (dockerfile: string): string | null =>
  dockerfile.match(SETTING_PATTERN)?.[1] ?? null;

const bundledImages = [
  { name: "keeper-standalone", path: ["docker", "standalone"] },
  { name: "keeper-services", path: ["docker", "services"] },
];

const serviceImages = [
  { name: "keeper-api", path: ["services", "api"] },
  { name: "keeper-cron", path: ["services", "cron"] },
  { name: "keeper-worker", path: ["services", "worker"] },
];

describe.each(bundledImages)("$name private address setting", ({ path }) => {
  it("ships turned off so servers on the host's own network stay reachable", () => {
    expect(readShippedSetting(readDockerfile(...path))).toBe("false");
  });

  it("ships outside commercial mode, where turning it off is honoured", () => {
    expect(readDockerfile(...path)).toMatch(/^ENV COMMERCIAL_MODE=false$/mu);
  });
});

describe.each(serviceImages)("$name private address setting", ({ path }) => {
  it("ships no value, leaving the service on its blocking default", () => {
    expect(readShippedSetting(readDockerfile(...path))).toBeNull();
  });
});
