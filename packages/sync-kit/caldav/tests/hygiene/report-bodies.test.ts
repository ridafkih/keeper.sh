import { describe, expect, test } from "vitest";
import {
  enumerationProps,
  multigetRequestBody,
  syncCollectionRequestBody,
} from "../../src/listing/request-shape";
import { calendarPath } from "../support/fake-caldav";
import { filesMatching } from "../support/sources";

describe("the bodies this adapter sends carry no retention-bounding element", () => {
  test("DAV-H2: the sync-collection body carries no DAV:limit element", async () => {
    const body = JSON.stringify(syncCollectionRequestBody("http://dav.example.com/ns/sync/3"));
    const mentions = await filesMatching("src", "nresults");

    expect(body).not.toContain("d:limit");
    expect(body).not.toContain("nresults");
    expect(mentions).toEqual([]);
  });

  test("DAV-H3: no request body contains an expand element", async () => {
    const bodies = [
      JSON.stringify(syncCollectionRequestBody(null)),
      JSON.stringify(multigetRequestBody([`${calendarPath}one.ics`])),
      JSON.stringify(enumerationProps()),
    ];
    const mentions = await filesMatching("src", "expand");

    expect(bodies.filter((body) => body.includes("expand"))).toEqual([]);
    expect(mentions).toEqual([]);
  });
});
