import { afterEach, describe, expect, it, vi } from "vitest";
import { createOutlookSyncProvider } from "../../../../src/providers/outlook/destination/provider";

const HOUR_MS = 3_600_000;
const NOT_FOUND_STATUS = 404;
const OK_STATUS = 200;

const UID = "040000008200E00074C5B7101A82E008@keeper.sh";
const STALE_GRAPH_ID = "AAMkAGI2-before-the-restore";
const LIVE_GRAPH_ID = "AAMkAGI2-after-the-restore";

const createProvider = () => createOutlookSyncProvider({
  accessToken: "test-token",
  accessTokenExpiresAt: new Date(Date.now() + HOUR_MS),
  calendarId: "cal-1",
  externalCalendarId: "external-cal-1",
  refreshToken: "test-refresh",
  userId: "user-1",
});

const probe = (): Promise<string> => {
  const provider = createProvider() as unknown as {
    probeRemoteEvent?: (
      reference: { deleteId: string; uid: string },
    ) => Promise<string>;
  };
  if (!provider.probeRemoteEvent) {
    throw new Error("The Outlook destination provider cannot confirm a copy is gone");
  }
  return provider.probeRemoteEvent({ deleteId: STALE_GRAPH_ID, uid: UID });
};

describe("Outlook destination: a copy Graph reidentified", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not report absent while the mailbox still holds the copy under its uid", async () => {
    vi.stubGlobal("fetch", vi.fn((input: string | URL) => {
      const url = new URL(input.toString());
      if (url.pathname.includes(encodeURIComponent(STALE_GRAPH_ID))) {
        return Promise.resolve(new Response("{}", { status: NOT_FOUND_STATUS }));
      }
      return Promise.resolve(Response.json(
        { value: [{ iCalUId: UID, id: LIVE_GRAPH_ID }] },
        { status: OK_STATUS },
      ));
    }));

    await expect(probe()).resolves.not.toBe("absent");
  });
});
