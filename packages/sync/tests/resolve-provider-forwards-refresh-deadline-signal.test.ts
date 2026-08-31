import { describe, expect, it, vi } from "vitest";

interface CoordinatedRefresherCapture {
  rawRefresh: (
    refreshToken: string,
    options?: { signal?: AbortSignal },
  ) => Promise<{ access_token: string; expires_in: number; refresh_token?: string }>;
}

const capturedCoordinatedOptions: CoordinatedRefresherCapture[] = [];
const googleRefresherSignals: (AbortSignal | undefined)[] = [];
const microsoftRefresherSignals: (AbortSignal | undefined)[] = [];

vi.mock("@keeper.sh/calendar", () => ({
  createGoogleTokenRefresher: () => (_refreshToken: string, signal?: AbortSignal) => {
    googleRefresherSignals.push(signal);
    return Promise.resolve({ access_token: "google-access", expires_in: 3600 });
  },
  createMicrosoftTokenRefresher: () => (_refreshToken: string, signal?: AbortSignal) => {
    microsoftRefresherSignals.push(signal);
    return Promise.resolve({ access_token: "microsoft-access", expires_in: 3600 });
  },
  createCoordinatedRefresher: (options: CoordinatedRefresherCapture) => {
    capturedCoordinatedOptions.push(options);
    return () => Promise.resolve(null);
  },
}));

vi.mock("@keeper.sh/calendar/google", () => ({
  createGoogleSyncProvider: () => ({ name: "google" }),
}));

vi.mock("@keeper.sh/calendar/outlook", () => ({
  createOutlookSyncProvider: () => ({ name: "outlook" }),
}));

vi.mock("@keeper.sh/database", () => ({
  decryptPassword: () => "password",
}));

const { resolveSyncProvider } = await import("../src/resolve-provider");

const createDatabaseStub = () => {
  const chain = {
    from: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    limit: () =>
      Promise.resolve([
        {
          accessToken: "access-token",
          refreshToken: "refresh-token",
          expiresAt: new Date(Date.now() + 3_600_000),
          externalCalendarId: "external-calendar",
          oauthCredentialId: "oauth-credential-1",
        },
      ]),
  };
  return { select: () => chain };
};

const captureRawRefresh = async (provider: string): Promise<CoordinatedRefresherCapture["rawRefresh"]> => {
  capturedCoordinatedOptions.length = 0;

  await resolveSyncProvider({
    database: createDatabaseStub() as never,
    provider,
    calendarId: "calendar-1",
    userId: "user-1",
    accountId: "account-1",
    oauthConfig: {
      googleClientId: "google-client",
      googleClientSecret: "google-secret",
      microsoftClientId: "microsoft-client",
      microsoftClientSecret: "microsoft-secret",
    },
  });

  const [captured] = capturedCoordinatedOptions;
  if (!captured) {
    throw new Error(`the ${provider} sync provider was built without a coordinated refresher`);
  }

  return captured.rawRefresh;
};

describe("resolveSyncProvider refresh deadline threading", () => {
  it("forwards the coordinated refresh deadline signal to the google provider refresher", async () => {
    const rawRefresh = await captureRawRefresh("google");
    googleRefresherSignals.length = 0;

    const signal = AbortSignal.timeout(20_000);
    await rawRefresh("refresh-token", { signal });

    expect(googleRefresherSignals).toHaveLength(1);
    expect(googleRefresherSignals[0]).toBe(signal);
  });

  it("forwards the coordinated refresh deadline signal to the outlook provider refresher", async () => {
    const rawRefresh = await captureRawRefresh("outlook");
    microsoftRefresherSignals.length = 0;

    const controller = new AbortController();
    await rawRefresh("refresh-token", { signal: controller.signal });

    expect(microsoftRefresherSignals).toHaveLength(1);
    expect(microsoftRefresherSignals[0]).toBe(controller.signal);
  });
});
