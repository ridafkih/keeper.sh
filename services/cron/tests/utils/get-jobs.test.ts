import { afterAll, describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getAllJobs } from "../../src/utils/get-jobs";

const temporaryDirectories: string[] = [];

const createTempWorkspace = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), "keeper-get-jobs-"));
  temporaryDirectories.push(directory);
  return directory;
};

afterAll(async () => {
  await Promise.all(
    temporaryDirectories.map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("getAllJobs", () => {
  it("collects default cron exports from files and arrays", async () => {
    const workspaceRoot = await createTempWorkspace();

    await writeFile(
      join(workspaceRoot, "single.ts"),
      `export default { name: "single-job", cron: "* * * * *", callback: async () => {} };`,
      "utf8",
    );

    await mkdir(join(workspaceRoot, "nested"), { recursive: true });
    await writeFile(
      join(workspaceRoot, "nested", "multi.ts"),
      `export default [
        { name: "array-job-1", cron: "* * * * *", callback: async () => {} },
        { name: "array-job-2", cron: "* * * * *", callback: async () => {} },
      ];`,
      "utf8",
    );

    const jobs = await getAllJobs(workspaceRoot);
    const names = jobs.map((job) => job.name).toSorted();

    expect(names).toEqual(["array-job-1", "array-job-2", "single-job"]);
  });

  it("throws when a file is missing a default cron export", async () => {
    const workspaceRoot = await createTempWorkspace();

    await writeFile(
      join(workspaceRoot, "valid.ts"),
      `export default { name: "valid-job", cron: "* * * * *", callback: async () => {} };`,
      "utf8",
    );
    await writeFile(
      join(workspaceRoot, "invalid.ts"),
      `export const notDefault = 123;`,
      "utf8",
    );

    expect(getAllJobs(workspaceRoot)).rejects.toThrow(
      "is missing a default cron export",
    );
  });

  it("ignores test, spec, and declaration files during runtime discovery", async () => {
    const workspaceRoot = await createTempWorkspace();

    await writeFile(
      join(workspaceRoot, "valid.ts"),
      `export default { name: "valid-job", cron: "* * * * *", callback: async () => {} };`,
      "utf8",
    );
    await writeFile(
      join(workspaceRoot, "reconcile-subscriptions.test.ts"),
      `import { describe } from "bun:test"; describe("ignored", () => {});`,
      "utf8",
    );
    await writeFile(
      join(workspaceRoot, "reconcile-subscriptions.spec.ts"),
      `throw new Error("should not import spec files");`,
      "utf8",
    );
    await writeFile(
      join(workspaceRoot, "types.d.ts"),
      `declare const value: string;`,
      "utf8",
    );

    const jobs = await getAllJobs(workspaceRoot);
    const names = jobs.map((job) => job.name).toSorted();

    expect(names).toEqual(["valid-job"]);
  });
});
