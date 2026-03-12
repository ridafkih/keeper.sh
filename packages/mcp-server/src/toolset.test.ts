import { describe, expect, it } from "bun:test";
import { createKeeperMcpToolset } from "./toolset";

describe("createKeeperMcpToolset", () => {
  it("exposes the Keeper read-only tool surface", () => {
    const toolset = createKeeperMcpToolset({
      getEventCount: async () => 0,
      getEventsInRange: async () => [],
      getSyncStatuses: async () => [],
      listDestinations: async () => [],
      listMappings: async () => [],
      listSources: async () => [],
    });

    expect(Object.keys(toolset).sort()).toEqual([
      "get_event_count",
      "get_events_range",
      "get_sync_status",
      "list_destinations",
      "list_mappings",
      "list_sources",
    ]);
  });

  it("passes the authenticated user id through to the read model functions", async () => {
    const calls: string[] = [];

    const toolset = createKeeperMcpToolset({
      getEventCount: async (userId) => {
        calls.push(`count:${userId}`);
        return 0;
      },
      getEventsInRange: async (userId) => {
        calls.push(`events:${userId}`);
        return [];
      },
      getSyncStatuses: async (userId) => {
        calls.push(`sync:${userId}`);
        return [];
      },
      listDestinations: async (userId) => {
        calls.push(`destinations:${userId}`);
        return [];
      },
      listMappings: async (userId) => {
        calls.push(`mappings:${userId}`);
        return [];
      },
      listSources: async (userId) => {
        calls.push(`sources:${userId}`);
        return [];
      },
    });

    await toolset.list_sources.execute({ userId: "user-123" });
    await toolset.list_destinations.execute({ userId: "user-123" });
    await toolset.list_mappings.execute({ userId: "user-123" });
    await toolset.get_sync_status.execute({ userId: "user-123" });
    await toolset.get_event_count.execute({ userId: "user-123" });

    expect(calls).toEqual([
      "sources:user-123",
      "destinations:user-123",
      "mappings:user-123",
      "sync:user-123",
      "count:user-123",
    ]);
  });

  it("passes range arguments to the events read model", async () => {
    const calls: Array<{ from: string; to: string; userId: string }> = [];

    const toolset = createKeeperMcpToolset({
      getEventCount: async () => 0,
      getEventsInRange: async (userId, range) => {
        calls.push({
          from: range.from instanceof Date ? range.from.toISOString() : range.from,
          to: range.to instanceof Date ? range.to.toISOString() : range.to,
          userId,
        });
        return [];
      },
      getSyncStatuses: async () => [],
      listDestinations: async () => [],
      listMappings: async () => [],
      listSources: async () => [],
    });

    await toolset.get_events_range.execute(
      { userId: "user-123" },
      {
        from: "2026-03-01T00:00:00.000Z",
        to: "2026-03-31T23:59:59.999Z",
      },
    );

    expect(calls).toEqual([
      {
        from: "2026-03-01T00:00:00.000Z",
        to: "2026-03-31T23:59:59.999Z",
        userId: "user-123",
      },
    ]);
  });
});
