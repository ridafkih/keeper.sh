import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  collectGuardedFiles,
  findOpaqueIdentifierOffenders,
  findWallClockTimestampOffenders,
  readGuardedFile,
} from "./support/identifier-guard";

const repositoryRoot = resolve(import.meta.dirname, "../../..");

const opaqueToken = ["aB3xQ9zK1mN7pR2s", "T5vW8yC4dF6gH0jL"].join("");
const wallClockTimestamp = ["06:15:33.956", "UTC"].join(" ");

const unownedFixturePath = `packages/queue/tests/zz-identifier-guard-scope-fixture-${process.pid}.test.ts`;
const ownedFixturePath = `packages/auth/tests/zz-identifier-guard-owned-fixture-${process.pid}.test.ts`;

const fixtureSource = (body: string) => `export const fixtureValue = ${JSON.stringify(body)};\n`;

const writeFixture = async (relativePath: string, body: string) => {
  const absolute = resolve(repositoryRoot, relativePath);
  await mkdir(resolve(absolute, ".."), { recursive: true });
  await writeFile(absolute, fixtureSource(body));
};

const removeFixture = async (relativePath: string) => {
  await rm(resolve(repositoryRoot, relativePath), { force: true });
};

afterEach(async () => {
  await removeFixture(unownedFixturePath);
  await removeFixture(ownedFixturePath);
});

describe("identifier guard scopes to the files it owns", () => {
  it("does not collect or report a test file in a package the guard does not own", async () => {
    try {
      await writeFixture(unownedFixturePath, opaqueToken);
      const collected = await collectGuardedFiles();
      expect(collected).not.toContain(unownedFixturePath);
      const offenders = await findOpaqueIdentifierOffenders();
      expect(offenders.filter((offender) => offender.includes(unownedFixturePath))).toEqual([]);
      expect(offenders.filter((offender) => offender.includes(opaqueToken))).toEqual([]);
    } finally {
      await removeFixture(unownedFixturePath);
    }
  });

  it("still reports the same opaque identifier when it lands in a file the guard owns", async () => {
    try {
      await writeFixture(ownedFixturePath, opaqueToken);
      const collected = await collectGuardedFiles();
      expect(collected).toContain(ownedFixturePath);
      const offenders = await findOpaqueIdentifierOffenders();
      expect(offenders).toContain(`${ownedFixturePath}: ${opaqueToken}`);
    } finally {
      await removeFixture(ownedFixturePath);
    }
  });

  it("still reports a deletion wall-clock timestamp in a file the guard owns", async () => {
    try {
      await writeFixture(ownedFixturePath, `deleted at ${wallClockTimestamp}`);
      const offenders = await findWallClockTimestampOffenders();
      expect(offenders).toContain(`${ownedFixturePath}: ${wallClockTimestamp}`);
    } finally {
      await removeFixture(ownedFixturePath);
    }
  });

  it("reports absence instead of throwing when an owned remediation file has been renamed away", async () => {
    const missingPath = "packages/sync/tests/aborted-run-verdict.renamed-away.test.ts";
    await expect(readGuardedFile(missingPath)).resolves.toBeNull();
    await expect(findOpaqueIdentifierOffenders([missingPath])).resolves.toEqual([]);
    await expect(findWallClockTimestampOffenders([missingPath])).resolves.toEqual([]);
  });
});
