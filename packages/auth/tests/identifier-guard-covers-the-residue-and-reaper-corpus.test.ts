import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { collectGuardedFiles, findOpaqueIdentifierOffenders } from "./support/identifier-guard";

const opaqueToken = ["aB3xK9mQ7zR2tY5n", "W8vC1dF4gH6jL0pS"].join("");

const reaperResiduePath =
  "packages/calendar/tests/core/deletion/reaper-revokes-oauth-grant-residue.test.ts";
const revocableGrantsPath = "services/api/tests/utils/revocable-grants-recorded-for-the-reaper.test.ts";
const cronReaperPath =
  "services/cron/tests/jobs/reaper-refuses-to-revoke-a-google-account-a-surviving-user-still-holds.test.ts";

const makeTemporaryRoot = async () => {
  const root = await mkdtemp(resolve(tmpdir(), "identifier-guard-residue-"));
  onTestFinished(async () => {
    await rm(root, { recursive: true, force: true });
  });
  return root;
};

const writeFixture = async (root: string, relativePath: string, body: string) => {
  const absolute = resolve(root, relativePath);
  await mkdir(resolve(absolute, ".."), { recursive: true });
  await writeFile(absolute, `export const fixtureValue = ${JSON.stringify(body)};\n`);
};

describe("identifier guard covers the residue and reaper corpus", () => {
  it("collects the deletion residue and reaper tests added by the residue rounds", async () => {
    const collected = await collectGuardedFiles();
    expect(collected).toContain(reaperResiduePath);
    expect(collected).toContain(revocableGrantsPath);
    expect(collected).toContain(cronReaperPath);
  });

  it("reports an opaque customer identifier planted in a reaper residue test", async () => {
    const root = await makeTemporaryRoot();
    await writeFixture(root, reaperResiduePath, opaqueToken);
    await writeFixture(root, revocableGrantsPath, opaqueToken);
    const offenders = await findOpaqueIdentifierOffenders(undefined, { root });
    expect(offenders).toContain(`${reaperResiduePath}: ${opaqueToken}`);
    expect(offenders).toContain(`${revocableGrantsPath}: ${opaqueToken}`);
  });
});
