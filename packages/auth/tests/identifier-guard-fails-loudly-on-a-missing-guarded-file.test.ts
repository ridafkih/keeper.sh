import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  collectGuardedFiles,
  findOpaqueIdentifierOffenders,
  findWallClockTimestampOffenders,
  readGuardedFile,
  remediationTestFiles,
} from "./support/identifier-guard";

const listedPath = "packages/sync/tests/aborted-run-verdict.test.ts";

const withTemporaryRoot = async (run: (root: string) => Promise<void>) => {
  const root = await mkdtemp(resolve(tmpdir(), "identifier-guard-missing-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

describe("identifier guard fails loudly on a missing guarded file", () => {
  it("rejects when reading a listed path that does not exist", async () => {
    await withTemporaryRoot(async (root) => {
      expect(remediationTestFiles()).toContain(listedPath);
      await expect(readGuardedFile(listedPath, { root })).rejects.toThrow(listedPath);
    });
  });

  it("rejects instead of scanning nothing when an opaque identifier scan is handed a missing path", async () => {
    await withTemporaryRoot(async (root) => {
      await expect(findOpaqueIdentifierOffenders([listedPath], { root })).rejects.toThrow(
        listedPath,
      );
    });
  });

  it("rejects instead of scanning nothing when a wall clock scan is handed a missing path", async () => {
    await withTemporaryRoot(async (root) => {
      await expect(findWallClockTimestampOffenders([listedPath], { root })).rejects.toThrow(
        listedPath,
      );
    });
  });

  it("covers every remediation test this branch adds outside the globbed package", async () => {
    const branchRemediationTests = [
      "packages/calendar/tests/core/sync-engine/user-deleted-fallback-answers-before-the-first-chunk.test.ts",
      "services/api/tests/utils/push-notifications/deregister-user-channels-abandoned-attribution.test.ts",
    ];
    const collected = await collectGuardedFiles();
    for (const relativePath of branchRemediationTests) {
      expect(collected).toContain(relativePath);
    }
  });
});
