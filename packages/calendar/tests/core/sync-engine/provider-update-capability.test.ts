import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { executeRemoteOperations } from "../../../src/core/sync-engine/index";
import type { CalendarSyncProvider } from "../../../src/core/sync-engine/types";
import type { MaterializedSyncableEvent, SyncOperation } from "../../../src/core/types";

const packageRoot = fileURLToPath(new URL("../../../", import.meta.url));

const makeEvent = (id: string): MaterializedSyncableEvent => ({
  id,
  sourceEventUid: `uid-${id}`,
  startTime: new Date("2026-03-15T09:00:00Z"),
  endTime: new Date("2026-03-15T10:00:00Z"),
  summary: `Event ${id}`,
  calendarId: "cal-1",
  calendarName: "Test Calendar",
  calendarUrl: null,
});

describe("provider update capability", () => {
  it("types an optional updateEvents capability on CalendarSyncProvider", () => {
    const typecheck = spawnSync("bun", ["x", "tsc", "--noEmit"], {
      cwd: packageRoot,
      encoding: "utf8",
    });

    expect(`${typecheck.stdout ?? ""}${typecheck.stderr ?? ""}`).toBe("");
    expect(typecheck.status).toBe(0);
  }, 180_000);

  it("keeps syncing a provider that omits updateEvents", async () => {
    const provider: CalendarSyncProvider = {
      deleteEvents: () => Promise.resolve([]),
      listRemoteEvents: () => Promise.resolve([]),
      pushEvents: () => Promise.resolve([{ success: true, remoteId: "remote-1" }]),
    };
    const operations: SyncOperation[] = [{ type: "add", event: makeEvent("ev-1") }];

    const outcome = await executeRemoteOperations(operations, [], "dest-cal-1", provider);

    expect(provider.updateEvents).toBeUndefined();
    expect(outcome.result.added).toBe(1);
    expect(outcome.changes.inserts).toHaveLength(1);
  });
});
