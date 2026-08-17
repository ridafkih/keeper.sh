import { describe, expect, test } from "vitest";
import { createAuthenticatingFetch } from "../../src/client/authenticating-fetch";
import type { CalDAVAuthMethod } from "../../src/dependencies";
import { calendarPath, createFakeCalDAV, serverUrl } from "../support/fake-caldav";
import { credentials } from "../support/harness";

describe("a stored auth method is a hint, not a fact", () => {
  test("DAV-O50: a stale stored method converges on the server's actual scheme within one run", async () => {
    const fake = createFakeCalDAV({ options: { offersDigestOnly: true } });
    const resolved: CalDAVAuthMethod[] = [];
    const authenticating = createAuthenticatingFetch({
      fetch: fake.fetch,
      credentials: { ...credentials, knownAuthMethod: "basic" },
      onAuthMethodResolved: (method) => {
        resolved.push(method);
      },
    });

    const first = await authenticating(`${serverUrl}${calendarPath}`, { method: "PROPFIND" });
    const second = await authenticating(`${serverUrl}${calendarPath}`, { method: "PROPFIND" });

    expect(first.status).toBe(207);
    expect(second.status).toBe(207);
    expect(resolved).toEqual(["digest"]);
    expect(fake.requests().filter((entry) => !entry.headers.authorization).length).toBe(
      1,
    );
  }, 30_000);
});
