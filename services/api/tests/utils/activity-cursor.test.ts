import { describe, expect, it } from "vitest";

import { decodeActivityCursor } from "@/utils/syncs";

const ROW_ID = "3a6f1a52-3b8e-4c2a-9f71-5e4d3c2b1a01";

describe("decodeActivityCursor", () => {
  it("keeps the timestamp's microseconds as Postgres printed them", () => {
    expect(decodeActivityCursor(`2026-10-06T09:00:00.123456Z_${ROW_ID}`)).toEqual({
      createdAt: "2026-10-06T09:00:00.123456Z",
      id: ROW_ID,
    });
  });

  it("ignores cursors that aren't a real UTC timestamp and a row id", () => {
    expect(decodeActivityCursor(null)).toBeNull();
    expect(decodeActivityCursor(ROW_ID)).toBeNull();
    expect(decodeActivityCursor("2026-10-06T09:00:00.123456Z_")).toBeNull();
    expect(decodeActivityCursor("2026-10-06T09:00:00.123456Z_row-1")).toBeNull();
    expect(decodeActivityCursor(`yesterday_${ROW_ID}`)).toBeNull();
    expect(decodeActivityCursor(`2026-13-45T99:99:99Z_${ROW_ID}`)).toBeNull();
    expect(decodeActivityCursor(`2026-02-30T09:00:00Z_${ROW_ID}`)).toBeNull();
    expect(decodeActivityCursor(`2026-10-06 09:00:00'; drop table syncs;--_${ROW_ID}`)).toBeNull();
  });
});
