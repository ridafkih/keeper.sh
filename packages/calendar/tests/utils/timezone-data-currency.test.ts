import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  REQUIRED_TIME_ZONE_DATA_VERSION,
  assertTimeZoneDataCurrent,
  exitUnlessTimeZoneDataCurrent,
  readConfiguredTimeZoneDataVersion,
} from "../../src/utils/timezone-data-currency";
import {
  REQUIRED_TIME_ZONE_DATA_VERSION as exportedRequiredVersion,
  exitUnlessTimeZoneDataCurrent as exportedStartupCheck,
} from "../../src";

const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const vendoredDirectory = join(repositoryRoot, "docker/icu-timezone");
const moduleUnderTest = fileURLToPath(
  new URL("../../src/utils/timezone-data-currency.ts", import.meta.url),
);
const timeMathServices = ["api", "cron", "worker", "mcp"];

const environmentWithoutTimeZoneData: Record<string, string | undefined> = {};
const unconfigured = environmentWithoutTimeZoneData.ICU_TIMEZONE_FILES_DIR;

const temporaryDirectories: string[] = [];

const createTemporaryDirectory = (): string => {
  const directory = mkdtempSync(join(tmpdir(), "keeper-tz-data-"));
  temporaryDirectories.push(directory);
  return directory;
};

const createDataDirectory = (version: string): string => {
  const directory = createTemporaryDirectory();
  writeFileSync(join(directory, "VERSION"), `${version}\n`);
  return directory;
};

const runStartupCheck = (...directory: string[]) => {
  const scriptDirectory = createTemporaryDirectory();
  const script = join(scriptDirectory, "check.ts");
  writeFileSync(
    script,
    [
      `import { exitUnlessTimeZoneDataCurrent } from ${JSON.stringify(moduleUnderTest)};`,
      "exitUnlessTimeZoneDataCurrent(process.argv[2]);",
      'console.log("started");',
    ].join("\n"),
  );
  return spawnSync(process.execPath, [script, ...directory], { encoding: "utf8" });
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("assertTimeZoneDataCurrent", () => {
  it("rejects tz data older than the required version", () => {
    expect(() => assertTimeZoneDataCurrent("2025b", "2026f")).toThrow();
  });

  it.each([
    ["2026f", "2026f"],
    ["2026g", "2026f"],
    ["2027a", "2026z"],
  ])("accepts %s when %s is required", (runtimeVersion, requiredVersion) => {
    expect(() => assertTimeZoneDataCurrent(runtimeVersion, requiredVersion)).not.toThrow();
  });

  it.each([[unconfigured], [""], ["2026"], ["26f"], ["2026F"], ["2026fg"]])(
    "rejects a missing or malformed version %j",
    (runtimeVersion) => {
      expect(() => assertTimeZoneDataCurrent(runtimeVersion, "2026f")).toThrow();
    },
  );

  it("rejects an earlier letter in the same year", () => {
    expect(() => assertTimeZoneDataCurrent("2026e", "2026f")).toThrow();
  });

  it("names both versions and the variable to set", () => {
    expect(() => assertTimeZoneDataCurrent("2025b", "2026f")).toThrow(/2025b/);
    expect(() => assertTimeZoneDataCurrent("2025b", "2026f")).toThrow(/2026f/);
    expect(() => assertTimeZoneDataCurrent("2025b", "2026f")).toThrow(/ICU_TIMEZONE_FILES_DIR/);
  });

  it("names the required version and the variable when no version is configured", () => {
    expect(() => assertTimeZoneDataCurrent(unconfigured, "2026f")).toThrow(/2026f/);
    expect(() => assertTimeZoneDataCurrent(unconfigured, "2026f")).toThrow(/ICU_TIMEZONE_FILES_DIR/);
  });
});

describe("readConfiguredTimeZoneDataVersion", () => {
  it("reads the trimmed VERSION file of the configured directory", () => {
    expect(readConfiguredTimeZoneDataVersion(createDataDirectory("2025b"))).toBe("2025b");
  });

  it("returns undefined when the directory has no VERSION file", () => {
    expect(readConfiguredTimeZoneDataVersion(createTemporaryDirectory())).toBeUndefined();
  });

  it("returns undefined when no directory is configured", () => {
    expect(readConfiguredTimeZoneDataVersion(unconfigured)).toBeUndefined();
  });
});

describe("exitUnlessTimeZoneDataCurrent", () => {
  it("is a function the services call at startup", () => {
    expect(typeof exitUnlessTimeZoneDataCurrent).toBe("function");
  });

  it("lets a service start with the vendored tz data", () => {
    const result = runStartupCheck(vendoredDirectory);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("started");
  });

  it("exits non-zero with a clear message when no tz data directory is configured", () => {
    const result = runStartupCheck();
    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain("started");
    expect(result.stderr).toContain("ICU_TIMEZONE_FILES_DIR");
    expect(result.stderr).toContain(REQUIRED_TIME_ZONE_DATA_VERSION);
  });

  it("exits non-zero with a clear message when the configured tz data is stale", () => {
    const result = runStartupCheck(createDataDirectory("2025b"));
    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain("started");
    expect(result.stderr).toContain("2025b");
    expect(result.stderr).toContain(REQUIRED_TIME_ZONE_DATA_VERSION);
    expect(result.stderr).toContain("ICU_TIMEZONE_FILES_DIR");
  });
});

describe("vendored tz data stays in step with the required version", () => {
  it("requires the version recorded in docker/icu-timezone/VERSION", () => {
    const vendoredVersion = readFileSync(join(vendoredDirectory, "VERSION"), "utf8").trim();
    expect(REQUIRED_TIME_ZONE_DATA_VERSION).toBe(vendoredVersion);
  });

  it("requires the version ICU reads from the vendored zoneinfo64.res", () => {
    const resource = readFileSync(join(vendoredDirectory, "zoneinfo64.res"));
    expect(resource.includes(Buffer.from("TZVersion", "ascii"))).toBe(true);
    expect(resource.includes(Buffer.from(REQUIRED_TIME_ZONE_DATA_VERSION, "utf16le"))).toBe(true);
  });
});

describe("package entry point", () => {
  it("exports the startup check", () => {
    expect(exportedStartupCheck).toBe(exitUnlessTimeZoneDataCurrent);
    expect(exportedRequiredVersion).toBe(REQUIRED_TIME_ZONE_DATA_VERSION);
  });
});

describe.each(timeMathServices)("the %s service", (service) => {
  const serviceDirectory = join(repositoryRoot, "services", service);

  it.each(["dev", "start"])("sets ICU_TIMEZONE_FILES_DIR to the vendored data in its %s script", (name) => {
    const manifest = JSON.parse(readFileSync(join(serviceDirectory, "package.json"), "utf8"));
    const script: string = manifest.scripts[name];
    const assignment = script.match(/(?:^|\s)ICU_TIMEZONE_FILES_DIR=(\S+)\s/);
    expect(assignment).not.toBeNull();
    const configuredDirectory = join(serviceDirectory, assignment?.[1] ?? "");
    expect(configuredDirectory).toBe(vendoredDirectory);
    expect(readConfiguredTimeZoneDataVersion(configuredDirectory)).toBe(REQUIRED_TIME_ZONE_DATA_VERSION);
  });

  it("depends on @keeper.sh/calendar for the startup check", () => {
    const manifest = JSON.parse(readFileSync(join(serviceDirectory, "package.json"), "utf8"));
    expect(manifest.dependencies["@keeper.sh/calendar"]).toBe("workspace:*");
  });

  it("checks the configured tz data before its first statement", () => {
    const source = readFileSync(join(serviceDirectory, "src/index.ts"), "utf8");
    const firstStatement = source
      .split("\n")
      .find((line) => line.length > 0 && !/^\s/.test(line) && !/^(import|\}|\)|export \{)/.test(line));
    expect(firstStatement).toBe("exitUnlessTimeZoneDataCurrent(process.env.ICU_TIMEZONE_FILES_DIR);");
    expect(source).toMatch(/import \{[^}]*\bexitUnlessTimeZoneDataCurrent\b[^}]*\} from "@keeper\.sh\/calendar"/);
  });
});
