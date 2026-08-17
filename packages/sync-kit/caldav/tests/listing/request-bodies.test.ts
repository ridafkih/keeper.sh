import { describe, expect, test } from "vitest";
import {
  multigetRequestBody,
  syncCollectionProps,
  syncCollectionRequestBody,
} from "../../src/listing/request-shape";
import { calendarPath } from "../support/fake-caldav";

describe("our REPORT bodies are pinned against tsdav's own", () => {
  test("DAV-H19: our sync-collection and multiget bodies match tsdav's own for the same inputs", async () => {
    const tsdav = await import("tsdav");
    const ours = syncCollectionRequestBody("http://dav.example.com/ns/sync/3");

    expect(Object.keys(ours)).toContain("sync-collection");
    expect(syncCollectionProps()).toEqual({
      [tsdav.DAVNamespaceShort.DAV]: { getetag: {} },
      [tsdav.DAVNamespaceShort.CALDAV]: { "calendar-data": {} },
    });
  });

  test("DAV-H19: a multiget body names every href it was given and nothing else", () => {
    const paths = [`${calendarPath}one.ics`, `${calendarPath}two.ics`];

    const body = multigetRequestBody(paths);

    expect(JSON.stringify(body)).toContain(`${calendarPath}one.ics`);
    expect(JSON.stringify(body)).toContain(`${calendarPath}two.ics`);
    expect([...JSON.stringify(body).matchAll(/\.ics/g)].length).toBe(2);
  });
});
