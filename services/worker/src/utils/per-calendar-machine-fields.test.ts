import { describe, expect, it } from "bun:test";
import { createPerCalendarMachineFieldCollector } from "./per-calendar-machine-fields";

describe("per-calendar machine field collector", () => {
  it("keeps machine counters isolated per calendar", () => {
    const collector = createPerCalendarMachineFieldCollector();

    collector.pushEvent("destination_execution", "cal-a", {
      aggregateId: "cal-a",
      outcome: "APPLIED",
      envelope: { id: "a-1", event: { type: "LOCK_ACQUIRED" } },
      snapshot: { state: "locked" },
      transition: {
        commands: [{ type: "RELEASE_LOCK" }],
        outputs: [{ type: "DESTINATION_EXECUTION_CHANGED" }],
      },
      version: 1,
    });
    collector.pushEvent("destination_execution", "cal-a", {
      aggregateId: "cal-a",
      outcome: "APPLIED",
      envelope: { id: "a-2", event: { type: "EXECUTION_STARTED" } },
      snapshot: { state: "executing" },
      transition: {
        commands: [{ type: "EMIT_SYNC_EVENT" }],
        outputs: [{ type: "DESTINATION_EXECUTION_CHANGED" }],
      },
      version: 2,
    });
    collector.pushEvent("destination_execution", "cal-b", {
      aggregateId: "cal-b",
      outcome: "APPLIED",
      envelope: { id: "b-1", event: { type: "LOCK_ACQUIRED" } },
      snapshot: { state: "locked" },
      transition: {
        commands: [{ type: "RELEASE_LOCK" }],
        outputs: [{ type: "DESTINATION_EXECUTION_CHANGED" }],
      },
      version: 1,
    });

    const calendarA = collector.consumeCalendarFields("cal-a");
    const calendarB = collector.consumeCalendarFields("cal-b");

    expect(calendarA.get("machine.destination_execution.processed_total")).toBe(2);
    expect(calendarB.get("machine.destination_execution.processed_total")).toBe(1);
  });

  it("clears per-calendar fields after consume", () => {
    const collector = createPerCalendarMachineFieldCollector();

    collector.pushEvent("credential_health", "cal-z", {
      aggregateId: "oauth-1",
      outcome: "APPLIED",
      envelope: { id: "z-1", event: { type: "REFRESH_STARTED" } },
      snapshot: { state: "refreshing" },
      transition: {
        commands: [{ type: "REFRESH_TOKEN" }],
        outputs: [{ type: "CREDENTIAL_HEALTH_CHANGED" }],
      },
      version: 1,
    });

    const first = collector.consumeCalendarFields("cal-z");
    const second = collector.consumeCalendarFields("cal-z");

    expect(first.get("machine.credential_health.processed_total")).toBe(1);
    expect(second.size).toBe(0);
  });

  it("releases sink state per calendar after each consume cycle", () => {
    const collector = createPerCalendarMachineFieldCollector();

    for (let index = 0; index < 50; index += 1) {
      const calendarId = `cal-${index}`;
      collector.pushEvent("destination_execution", calendarId, {
        aggregateId: calendarId,
        outcome: "APPLIED",
        envelope: { id: `env-${index}`, event: { type: "EXECUTION_STARTED" } },
        snapshot: { state: "executing" },
        transition: {
          commands: [{ type: "EMIT_SYNC_EVENT" }],
          outputs: [{ type: "DESTINATION_EXECUTION_CHANGED" }],
        },
        version: 1,
      });

      const fields = collector.consumeCalendarFields(calendarId);
      expect(fields.get("machine.destination_execution.processed_total")).toBe(1);
      expect(fields.get("machine.destination_execution.last_version")).toBe(1);
      expect(fields.get("machine.destination_execution.aggregate_id")).toBe(calendarId);
    }

    expect(collector.consumeCalendarFields("cal-0").size).toBe(0);
  });
});
