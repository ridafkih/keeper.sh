import { afterEach, describe, expect, it, vi } from "vitest";
import { microsoftDirectoryTenantSchema } from "@keeper.sh/data-schemas";
import type { MicrosoftDirectoryTenant } from "@keeper.sh/data-schemas";
import { resolveSyncProvider } from "../src/resolve-provider";

const DIRECTORY_TENANT = microsoftDirectoryTenantSchema.assert("abcdef01-2345-6789-abcd-ef0123456789");

type FetchFunction = (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>;

const createDatabaseWithExpiredOutlookToken = () => {
  const persisted: unknown[] = [];
  const row = {
    accessToken: "expired-access-token",
    expiresAt: new Date(0),
    externalCalendarId: "outlook-calendar-id",
    oauthCredentialId: "credential-id",
    refreshToken: "old-refresh-token",
  };
  const query = {
    from: () => query,
    innerJoin: () => query,
    where: () => query,
    limit: () => Promise.resolve([row]),
  };
  const database = {
    select: () => query,
    update: () => ({
      set: (values: unknown) => {
        persisted.push(values);
        return { where: () => Promise.resolve() };
      },
    }),
  };

  return { database, persisted };
};

const stubMicrosoftEndpoints = (tokenEndpoint: string) => {
  const fetchMock = vi.fn<FetchFunction>((input, init) => {
    const url = String(input);

    if (url === tokenEndpoint) {
      const form = new URLSearchParams(String(init?.body));
      expect(form.get("grant_type")).toBe("refresh_token");
      expect(form.get("refresh_token")).toBe("old-refresh-token");
      return Promise.resolve(Response.json({
        access_token: "new-access-token",
        expires_in: 3600,
        refresh_token: "rotated-refresh-token",
        scope: "Calendars.ReadWrite User.Read offline_access",
        token_type: "Bearer",
      }));
    }

    if (url.startsWith("https://graph.microsoft.com/")) {
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer new-access-token");
      return Promise.resolve(Response.json({ value: [] }));
    }

    throw new Error(`Unexpected outbound request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe.each<{ description: string; tenant: MicrosoftDirectoryTenant }>([
  { description: "with the common tenant", tenant: "common" },
  { description: "with a directory tenant", tenant: DIRECTORY_TENANT },
])("an Outlook destination with an expired token $description", ({ tenant }) => {
  it(`refreshes at the ${tenant} token endpoint and persists the rotated token`, async () => {
    const { database, persisted } = createDatabaseWithExpiredOutlookToken();
    const fetchMock = stubMicrosoftEndpoints(
      `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    );

    const provider = await resolveSyncProvider({
      database: database as never,
      provider: "outlook",
      calendarId: "calendar-id",
      userId: "user-id",
      accountId: "account-id",
      oauthConfig: {
        microsoftCredentials: {
          clientId: "microsoft-client-id",
          clientSecret: "microsoft-client-secret",
          tenant,
        },
      },
    });

    if (!provider) {
      throw new Error("Outlook provider was not configured");
    }

    await expect(provider.listRemoteEvents({
      timeMin: new Date("2026-01-01T00:00:00Z"),
      timeMax: new Date("2026-02-01T00:00:00Z"),
    })).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(persisted).toEqual([{
      accessToken: "new-access-token",
      expiresAt: expect.any(Date),
      refreshToken: "rotated-refresh-token",
    }]);
  });
});
