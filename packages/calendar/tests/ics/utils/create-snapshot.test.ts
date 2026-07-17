import { describe, expect, it } from "vitest";
import {
  persistCalendarSnapshot,
  prepareCalendarSnapshot,
} from "../../../src/ics/utils/create-snapshot";

describe("calendar snapshot persistence", () => {
  it("prepares changed content without persisting it before the ingestion flush", async () => {
    let selectCall = 0;
    let insertCalls = 0;
    const database = {
      insert: () => {
        insertCalls += 1;
        return {
          values: () => ({
            onConflictDoUpdate: () => Promise.resolve(),
          }),
        };
      },
      select: () => ({
        from: () => ({
          where: () => {
            selectCall += 1;
            if (selectCall === 1) {
              return Promise.resolve([{ id: "calendar-1" }]);
            }
            return Promise.resolve([]);
          },
        }),
      }),
    };

    const result = await prepareCalendarSnapshot(
      database as never,
      "calendar-1",
      "BEGIN:VCALENDAR\r\nEND:VCALENDAR",
    );

    expect(result.changed).toBe(true);
    expect(result.snapshot?.ical).toBe("BEGIN:VCALENDAR\r\nEND:VCALENDAR");
    expect(insertCalls).toBe(0);

    if (!result.snapshot) {
      throw new Error("Expected a pending snapshot");
    }
    await persistCalendarSnapshot(database as never, "calendar-1", result.snapshot);
    expect(insertCalls).toBe(1);
  });
});
