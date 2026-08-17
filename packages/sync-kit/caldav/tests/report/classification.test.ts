import { describe, expect, test } from "vitest";
import { readMultistatus } from "../../src/report/multistatus";
import { classifySyncReport } from "../../src/report/sync-report";
import { calendarPath, serverUrl } from "../support/fake-caldav";

const truncatedDocument = `<?xml version="1.0" encoding="utf-8" ?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>${calendarPath}one.ics</d:href>
    <d:propstat><d:prop><d:getetag>"etag-1"</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
  </d:response>
  <d:response>
    <d:href>${calendarPath}</d:href>
    <d:status>HTTP/1.1 507 Insufficient Storage</d:status>
    <d:error><d:number-of-matches-within-limits/></d:error>
  </d:response>
  <d:sync-token>http://dav.example.com/ns/sync/7</d:sync-token>
</d:multistatus>`;

describe("the 507 on the collection href is the truncation signal, not a resource", () => {
  test("DAV-O3: a 507 on the collection href is truncation, not a changed object", () => {
    const document = readMultistatus(truncatedDocument);

    const report = classifySyncReport(document, calendarPath, serverUrl);

    expect(report.kind).toBe("truncated");
    if (report.kind !== "truncated") {
      throw new Error(`a 507 collection href classified as "${report.kind}"`);
    }
    expect(report.resources.map((resource) => resource.path)).toEqual([`${calendarPath}one.ics`]);
    expect(report.removed).toEqual([]);
    expect(report.token).toBe("http://dav.example.com/ns/sync/7");
  });

  test("DAV-O3: the truncated collection href never becomes a removal", () => {
    const document = readMultistatus(truncatedDocument);

    const report = classifySyncReport(document, calendarPath, serverUrl);

    if (report.kind === "tokenRejected" || report.kind === "unchanged") {
      throw new Error(`a truncated page classified as "${report.kind}"`);
    }
    expect(report.removed).not.toContain(calendarPath);
  });
});
