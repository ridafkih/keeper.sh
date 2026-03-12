import { describe, expect, it } from "bun:test";
import { createKeeperMcpToolset } from "./toolset";

const createMockApi = (calls?: string[]) => ({
  getEventCount: (userId: string) => {
    calls?.push(`count:${userId}`);
    return Promise.resolve(0);
  },
  getEventsInRange: (userId: string) => {
    calls?.push(`events:${userId}`);
    return Promise.resolve([]);
  },
  getSyncStatuses: () => Promise.resolve([]),
  listDestinations: () => Promise.resolve([]),
  listMappings: () => Promise.resolve([]),
  listSources: (userId: string) => {
    calls?.push(`sources:${userId}`);
    return Promise.resolve([]);
  },
});

describe("createKeeperMcpToolset", () => {
  it("exposes the agent-oriented tool surface", () => {
    const toolset = createKeeperMcpToolset(createMockApi());

    expect(Object.keys(toolset).toSorted()).toEqual([
      "get_event_count",
      "get_events",
      "list_calendars",
    ]);
  });

  it("passes the authenticated user id through to the read model functions", async () => {
    const calls: string[] = [];
    const toolset = createKeeperMcpToolset(createMockApi(calls));

    await toolset.list_calendars.execute({ userId: "user-123" });
    await toolset.get_event_count.execute({ userId: "user-123" });

    expect(calls).toEqual([
      "sources:user-123",
      "count:user-123",
    ]);
  });

  it("passes range arguments to the events read model", async () => {
    const rangeCalls: { from: string; to: string; userId: string }[] = [];

    const toolset = createKeeperMcpToolset({
      ...createMockApi(),
      getEventsInRange: (userId, range) => {
        rangeCalls.push({ from: String(range.from), to: String(range.to), userId });
        return Promise.resolve([]);
      },
    });

    await toolset.get_events.execute(
      { userId: "user-123" },
      {
        from: "2026-03-01T00:00:00.000Z",
        to: "2026-03-31T23:59:59.999Z",
      },
    );

    expect(rangeCalls).toEqual([
      {
        from: "2026-03-01T00:00:00.000Z",
        to: "2026-03-31T23:59:59.999Z",
        userId: "user-123",
      },
    ]);
  });
});
