import { createZoneCache } from "@keeper.sh/sync-ical";
import { describe, expect, test } from "vitest";
import { resolveGraphZone } from "../../src/decode/zone";
import { filesMatchingPattern } from "../support/sources";

const valueImportOfTheZoneLadder = /^import \{[^}]*\} from "@keeper\.sh\/sync-ical"/m;

describe("the shared zone ladder is imported in exactly the two files that need it", () => {
  test("MS-H8: only the zone decoder and the wall-time emitter import sync-ical as values", async () => {
    const importers = await filesMatchingPattern("src", valueImportOfTheZoneLadder);

    expect(importers.toSorted()).toEqual(["src/decode/zone.ts", "src/write/wall-time.ts"]);
    expect(resolveGraphZone("Eastern Standard Time", createZoneCache()).kind).toBe("resolved");
  });
});
