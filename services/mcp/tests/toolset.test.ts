import { describe, expect, it } from "vitest";
import { createKeeperMcpToolset } from "../src/toolset";

describe("createKeeperMcpToolset", () => {
  it("exposes the full tool surface", () => {
    const toolset = createKeeperMcpToolset();

    expect(Object.keys(toolset).toSorted()).toEqual([
      "create_event",
      "delete_event",
      "get_event",
      "get_event_count",
      "get_events",
      "get_ical_feed",
      "get_pending_invites",
      "list_accounts",
      "list_calendars",
      "rsvp_event",
      "update_event",
    ]);
  });

  it("each tool has a title and description", () => {
    const toolset = createKeeperMcpToolset();

    for (const [, tool] of Object.entries(toolset)) {
      expect(tool.title).toBeTruthy();
      expect(tool.description).toBeTruthy();
    }
  });

  it("accepts the opaque occurrence IDs returned by event reads", () => {
    const toolset = createKeeperMcpToolset();
    const occurrenceId = "occurrence:019c0000-0000-7000-8000-000000000001:1772445600000";
    const eventIdSchemas = [
      toolset.get_event.inputSchema?.eventId,
      toolset.update_event.inputSchema?.eventId,
      toolset.delete_event.inputSchema?.eventId,
      toolset.rsvp_event.inputSchema?.eventId,
    ];

    for (const schema of eventIdSchemas) {
      if (!schema) {
        throw new Error("Expected every event tool to expose an eventId schema");
      }
      expect(schema.safeParse(occurrenceId).success).toBe(true);
    }
  });
});
