import { describe, expect, test } from "vitest";
import { createAuthenticatingFetch } from "../../src/client/authenticating-fetch";
import type { CalDAVAuthMethod } from "../../src/dependencies";
import { createFakeCalDAV, calendarPath, serverUrl } from "../support/fake-caldav";
import { credentials } from "../support/harness";

const negotiatedAgainst = async (
  fake: ReturnType<typeof createFakeCalDAV>,
): Promise<{ readonly method: CalDAVAuthMethod | null; readonly status: number }> => {
  let resolved: CalDAVAuthMethod | null = null;
  const authenticating = createAuthenticatingFetch({
    fetch: fake.fetch,
    credentials,
    onAuthMethodResolved: (method) => {
      resolved = method;
    },
  });
  const response = await authenticating(`${serverUrl}${calendarPath}`, { method: "PROPFIND" });
  return { method: resolved, status: response.status };
};

describe("the scheme is negotiated from the challenge, in both directions", () => {
  test("DAV-O49: a 401 offering Digest upgrades; a 401 offering only Basic downgrades", async () => {
    const digestOnly = await negotiatedAgainst(createFakeCalDAV({ options: { offersDigestOnly: true } }));
    const basicOnly = await negotiatedAgainst(createFakeCalDAV({ options: { offersBasicOnly: true } }));

    expect(digestOnly.method).toBe("digest");
    expect(digestOnly.status).toBe(207);
    expect(basicOnly.method).toBe("basic");
    expect(basicOnly.status).toBe(207);
  }, 30_000);
});
