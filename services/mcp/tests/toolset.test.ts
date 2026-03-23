import { describe, expect, it } from "bun:test";
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
});
