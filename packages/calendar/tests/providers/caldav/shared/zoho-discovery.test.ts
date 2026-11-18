import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CalDAVAuthenticationError,
  CalDAVClient,
} from "../../../../src/providers/caldav/shared/client";
import {
  createFakeZohoFetch,
  PRIMARY_CALENDAR_PATH,
  SECONDARY_CALENDAR_PATH,
} from "./fake-zoho-caldav";
import type { RecordedZohoRequest, WellKnownBehaviour } from "./fake-zoho-caldav";

const ORIGIN = "https://calendar.zoho.com";
const USERNAME = "someone@example.com";
const APP_PASSWORD = "app-specific-password";

let originalFetch: typeof globalThis.fetch = globalThis.fetch;
let recorded: RecordedZohoRequest[] = [];

const serveZoho = (wellKnown: WellKnownBehaviour): void => {
  recorded = [];
  globalThis.fetch = createFakeZohoFetch({ password: APP_PASSWORD, username: USERNAME, wellKnown }, recorded);
};

const discover = (serverUrl: string, password = APP_PASSWORD) =>
  new CalDAVClient({ credentials: { password, username: USERNAME }, serverUrl }).discoverCalendars();

const BOTH_CALENDARS = [
  expect.objectContaining({ ctag: "1770859408092", displayName: "My Calendar", url: `${ORIGIN}${PRIMARY_CALENDAR_PATH}` }),
  expect.objectContaining({ ctag: "1770859408117", displayName: "Work", url: `${ORIGIN}${SECONDARY_CALENDAR_PATH}` }),
];

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe.each<WellKnownBehaviour>(["answers-in-place", "redirects-to-caldav"])(
  "CalDAV discovery against Zoho Calendar when the well-known URI %s",
  (wellKnown) => {
    it("lists every CalDAV-enabled calendar from the bare server address Apple Calendar uses", async () => {
      serveZoho(wellKnown);

      await expect(discover(`${ORIGIN}/`)).resolves.toEqual(BOTH_CALENDARS);
    });

    it("lists every calendar from the well-known address eM Client uses", async () => {
      serveZoho(wellKnown);

      await expect(discover(`${ORIGIN}/.well-known/caldav`)).resolves.toEqual(BOTH_CALENDARS);
    });

    it("lists every calendar from the CalDAV service root", async () => {
      serveZoho(wellKnown);

      await expect(discover(`${ORIGIN}/caldav`)).resolves.toEqual(BOTH_CALENDARS);
    });

    it("lists the entered per-calendar URL alongside the rest of the account", async () => {
      serveZoho(wellKnown);

      await expect(discover(`${ORIGIN}${SECONDARY_CALENDAR_PATH}`)).resolves.toEqual(BOTH_CALENDARS);
    });

    it("asks each discovery step with an explicit Depth header", async () => {
      serveZoho(wellKnown);

      await discover(`${ORIGIN}/`);

      const propfinds = recorded.filter(({ method }) => method === "PROPFIND");
      expect(propfinds.length).toBeGreaterThan(0);
      expect(propfinds.every(({ depth }) => depth === "0" || depth === "1")).toBe(true);
    });

    it("reports a wrong app password as invalid credentials", async () => {
      serveZoho(wellKnown);

      await expect(discover(`${ORIGIN}/`, "wrong")).rejects.toBeInstanceOf(CalDAVAuthenticationError);
    });
  },
);
