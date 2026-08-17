import { describe, expect, test } from "vitest";
import { classifyCalDAVFailure } from "../../src/errors/classify";
import { filesMatchingPattern, sourceFiles } from "../support/sources";

const messageReaders =
  /\b(?:message|statusText|responsedescription)\b\s*(?:\.(?:includes|match|startsWith|endsWith|toLowerCase)|===|==|!==)/;

describe("no CalDAV verdict is reached by reading prose", () => {
  test("DAV-H14: src classifies on no error message anywhere", async () => {
    const offenders = await filesMatchingPattern("src", messageReaders);
    const files = await sourceFiles("src");

    const classified = classifyCalDAVFailure({
      status: 503,
      precondition: null,
      operation: "listChanges",
      retryAfter: null,
      credentialsWithheld: false,
    });

    expect(offenders).toEqual([]);
    expect(files.length).toBeGreaterThan(40);
    expect(classified).toEqual({ kind: "transient", status: 503 });
  });
});
