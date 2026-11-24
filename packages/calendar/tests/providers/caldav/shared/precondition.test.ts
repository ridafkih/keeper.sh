import { describe, expect, it } from "vitest";
import { readDAVPrecondition, readResponsePrecondition } from "../../../../src/providers/caldav/shared/precondition";

const NO_UID_CONFLICT_BODY = [
  "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
  "<D:error xmlns:D=\"DAV:\" xmlns:C=\"urn:ietf:params:xml:ns:caldav\">",
  "<C:no-uid-conflict><D:href>/123/calendars/home/abc.ics</D:href></C:no-uid-conflict>",
  "</D:error>",
].join("");

describe("reading the precondition a CalDAV server names when it refuses a write", () => {
  it("names the first precondition element inside a DAV error body", () => {
    expect(readDAVPrecondition(NO_UID_CONFLICT_BODY)).toBe("no-uid-conflict");
  });

  it("reads an unprefixed precondition element", () => {
    expect(readDAVPrecondition("<error xmlns=\"DAV:\"><need-privileges/></error>")).toBe("need-privileges");
  });

  it("reports nothing for a body that is not a DAV error", () => {
    expect(readDAVPrecondition("<html><body>Precondition Failed</body></html>")).toBeNull();
    expect(readDAVPrecondition("")).toBeNull();
  });

  it("reads the precondition from a response body without reading past the byte bound", async () => {
    const response = new Response(`${NO_UID_CONFLICT_BODY}${"x".repeat(100_000)}`, { status: 412 });

    await expect(readResponsePrecondition(response, NO_UID_CONFLICT_BODY.length)).resolves.toBe("no-uid-conflict");
  });

  it("reports nothing for a response without a body", async () => {
    await expect(readResponsePrecondition(new Response(null, { status: 412 }), 4096)).resolves.toBeNull();
  });
});
