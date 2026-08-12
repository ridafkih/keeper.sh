import { describe, expect, it } from "vitest";
import { deleteEventStatesInChunks } from "../../src/utils/delete-event-states";

/*
 * Postgres caps a bind message at 65535 parameters and this delete spends one per
 * id plus the calendar. Unbounded ICS history means a feed that regenerates its
 * UIDs can produce a delete list past that ceiling, and the rejection rolls the
 * whole ingest back and recurs every tick — the same permanent wedge the insert
 * side was chunked to avoid.
 */
describe("deleteEventStatesInChunks", () => {
  it("keeps every statement under the bind-parameter ceiling", async () => {
    const batchSizes: number[] = [];
    const transaction = {
      delete: () => ({
        where: (_condition: unknown) => Promise.resolve(),
      }),
    };
    const eventStateIds = Array.from({ length: 70_000 }, (_unused, index) => `state-${index}`);

    await deleteEventStatesInChunks(
      transaction as never,
      "calendar-1",
      eventStateIds,
      (ids) => {
        batchSizes.push(ids.length);
      },
    );

    expect(batchSizes.reduce((total, size) => total + size, 0)).toBe(70_000);
    expect(Math.max(...batchSizes)).toBeLessThanOrEqual(5000);
  });

  it("issues no statement when there is nothing to delete", async () => {
    const batchSizes: number[] = [];
    let called = false;
    const transaction = {
      delete: () => {
        called = true;
        return { where: () => Promise.resolve() };
      },
    };

    const noop = (): void => {
      batchSizes.push(0);
    };

    await deleteEventStatesInChunks(transaction as never, "calendar-1", [], noop);

    expect(called).toBe(false);
    expect(batchSizes).toEqual([]);
  });
});
