import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const serviceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const repositoryRoot = resolve(serviceRoot, "../..");

const pushSources = [
  join(serviceRoot, "src/utils/push-notifications/handle-webhook.ts"),
  join(serviceRoot, "src/utils/push-notifications/pending-ingest.ts"),
  join(serviceRoot, "src/routes/api/webhook/google.ts"),
  join(serviceRoot, "src/routes/api/webhook/outlook.ts"),
  join(repositoryRoot, "services/cron/src/utils/drain-pending-ingest.ts"),
];

describe("push trigger modules", () => {
  it("never reach for the sync-lock invalidation primitive", async () => {
    for (const path of pushSources) {
      const source = await readFile(path, "utf8");

      expect({ path, usesInvalidation: source.includes("invalidateCalendar") })
        .toEqual({ path, usesInvalidation: false });
      expect({ path, usesInvalidation: source.includes("isCalendarInvalidated") })
        .toEqual({ path, usesInvalidation: false });
    }
  });

  it("never import the destination sync package", async () => {
    for (const path of pushSources) {
      const source = await readFile(path, "utf8");

      expect({ importsSync: source.includes("@keeper.sh/sync"), path })
        .toEqual({ importsSync: false, path });
    }
  });
});
