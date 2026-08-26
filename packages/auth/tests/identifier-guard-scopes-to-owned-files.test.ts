import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import {
  collectGuardedFiles,
  findOpaqueIdentifierOffenders,
  findWallClockTimestampOffenders,
  readGuardedFile,
} from "./support/identifier-guard";

const opaqueToken = ["aB3xQ9zK1mN7pR2s", "T5vW8yC4dF6gH0jL"].join("");
const wallClockTimestamp = ["06:15:33.956", "UTC"].join(" ");

const unownedFixturePath = "packages/queue/tests/zz-identifier-guard-scope-fixture.test.ts";
const ownedFixturePath = "packages/auth/tests/zz-identifier-guard-owned-fixture.test.ts";

const makeTemporaryRoot = async () => {
  const root = await mkdtemp(resolve(tmpdir(), "identifier-guard-scope-"));
  onTestFinished(async () => {
    await rm(root, { recursive: true, force: true });
  });
  return root;
};

const fixtureSource = (body: string) => `export const fixtureValue = ${JSON.stringify(body)};\n`;

const writeFixture = async (root: string, relativePath: string, body: string) => {
  const absolute = resolve(root, relativePath);
  await mkdir(resolve(absolute, ".."), { recursive: true });
  await writeFile(absolute, fixtureSource(body));
};

describe("identifier guard scopes to the files it owns", () => {
  it("does not collect or report a test file in a package the guard does not own", async () => {
    const root = await makeTemporaryRoot();
    await writeFixture(root, unownedFixturePath, opaqueToken);
    const collected = await collectGuardedFiles({ root });
    expect(collected).not.toContain(unownedFixturePath);
    const offenders = await findOpaqueIdentifierOffenders(undefined, { root });
    expect(offenders.filter((offender) => offender.includes(unownedFixturePath))).toEqual([]);
    expect(offenders.filter((offender) => offender.includes(opaqueToken))).toEqual([]);
  });

  it("still reports the same opaque identifier when it lands in a file the guard owns", async () => {
    const root = await makeTemporaryRoot();
    await writeFixture(root, ownedFixturePath, opaqueToken);
    const collected = await collectGuardedFiles({ root });
    expect(collected).toContain(ownedFixturePath);
    const offenders = await findOpaqueIdentifierOffenders(undefined, { root });
    expect(offenders).toContain(`${ownedFixturePath}: ${opaqueToken}`);
  });

  it("still reports a deletion wall-clock timestamp in a file the guard owns", async () => {
    const root = await makeTemporaryRoot();
    await writeFixture(root, ownedFixturePath, `deleted at ${wallClockTimestamp}`);
    const offenders = await findWallClockTimestampOffenders(undefined, { root });
    expect(offenders).toContain(`${ownedFixturePath}: ${wallClockTimestamp}`);
  });

  it("throws instead of reporting absence when an owned remediation file has been renamed away", async () => {
    const missingPath = "packages/sync/tests/aborted-run-verdict.renamed-away.test.ts";
    await expect(readGuardedFile(missingPath)).rejects.toThrow(missingPath);
    await expect(findOpaqueIdentifierOffenders([missingPath])).rejects.toThrow(missingPath);
    await expect(findWallClockTimestampOffenders([missingPath])).rejects.toThrow(missingPath);
  });
});
