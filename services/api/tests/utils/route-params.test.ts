import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { normalizeRouteParams } from "../../src/utils/route-handler";

const SOURCE_ID = "e44540a9-9613-43e8-a72a-c1bd78bd6b37";
const DESTINATION_ID = "b5cbe034-bf5e-4fe6-83af-8f67f930a632";

describe("normalizing the params a route match carries", () => {
  it("passes a plain string through untouched", () => {
    expect(normalizeRouteParams({ id: SOURCE_ID })).toEqual({ id: SOURCE_ID });
  });

  it("collapses a repeated segment to the single value it stands for", () => {
    expect(normalizeRouteParams({ destination: DESTINATION_ID, id: [SOURCE_ID, SOURCE_ID] }))
      .toEqual({ destination: DESTINATION_ID, id: SOURCE_ID });
  });

  it("refuses conflicting values rather than picking one of them", () => {
    expect(() => normalizeRouteParams({ id: [SOURCE_ID, DESTINATION_ID] }))
      .toThrow(/conflicting values/u);
  });

  it("refuses a shape it cannot read rather than coercing it", () => {
    expect(() => normalizeRouteParams({ id: 7 })).toThrow(/neither a string nor a list/u);
    expect(() => normalizeRouteParams({ id: [7] })).toThrow(/non-string value/u);
  });
});

describe("the router this normalization exists for", () => {
  it("still repeats the outer segment of a nested dynamic route", () => {
    const router = new Bun.FileSystemRouter({
      dir: join(import.meta.dirname, "../../src/routes"),
      style: "nextjs",
    });

    const match = router.match(
      `http://localhost/api/sources/${SOURCE_ID}/destinations/${DESTINATION_ID}`,
    );

    expect(match?.params).toEqual({
      destination: DESTINATION_ID,
      id: [SOURCE_ID, SOURCE_ID],
    });
    expect(normalizeRouteParams(match?.params ?? {})).toEqual({
      destination: DESTINATION_ID,
      id: SOURCE_ID,
    });
  });
});
