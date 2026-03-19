import { describe, expect, it } from "bun:test";
import {
  collectJobsFromModuleExports,
  isRuntimeJobEntrypoint,
} from "./get-jobs";

const validCallback = (): Promise<void> => Promise.resolve();

describe("collectJobsFromModuleExports", () => {
  it("collects default cron exports from single and array modules", () => {
    const jobs = collectJobsFromModuleExports([
      {
        entrypoint: "/jobs/single.ts",
        defaultExport: { callback: validCallback, cron: "* * * * *", name: "single-job" },
      },
      {
        entrypoint: "/jobs/multi.ts",
        defaultExport: [
          { callback: validCallback, cron: "* * * * *", name: "array-job-1" },
          { callback: validCallback, cron: "* * * * *", name: "array-job-2" },
        ],
      },
    ]);

    const names = jobs.map((job) => job.name).toSorted();
    expect(names).toEqual(["array-job-1", "array-job-2", "single-job"]);
  });

  it("throws when a module is missing a default cron export", () => {
    expect(() =>
      collectJobsFromModuleExports([
        {
          defaultExport: globalThis.undefined,
          entrypoint: "/jobs/invalid.ts",
        },
      ])).toThrow("is missing a default cron export");
  });

  it("throws when an array export contains invalid cron entries", () => {
    expect(() =>
      collectJobsFromModuleExports([
        {
          defaultExport: [{ callback: "invalid-callback", name: "invalid" }],
          entrypoint: "/jobs/invalid-array.ts",
        },
      ])).toThrow("has an invalid cron export at index 0");
  });
});

describe("isRuntimeJobEntrypoint", () => {
  it("accepts runtime job files", () => {
    expect(isRuntimeJobEntrypoint("/jobs/ingest-sources.ts")).toBe(true);
    expect(isRuntimeJobEntrypoint("/jobs/push-destinations.js")).toBe(true);
  });

  it("rejects tests, specs, declarations, and runtime helpers", () => {
    expect(isRuntimeJobEntrypoint("/jobs/ingest-sources.test.ts")).toBe(false);
    expect(isRuntimeJobEntrypoint("/jobs/ingest-sources.spec.ts")).toBe(false);
    expect(isRuntimeJobEntrypoint("/jobs/types.d.ts")).toBe(false);
    expect(isRuntimeJobEntrypoint("/jobs/source-ingestion-lifecycle-runtime.ts")).toBe(false);
    expect(isRuntimeJobEntrypoint("/jobs/source-ingestion-lifecycle-runtime.js")).toBe(false);
  });
});
