import { beforeEach, describe, expect, it, vi } from "vitest";

const BASE_URL = "https://keeper.test.invalid";
const TOKEN_LIFETIME_SECONDS = 3600;

let values: Record<string, unknown> = {};
let importResult: () => Promise<string> = () => Promise.resolve("account-1");
let stateStoreFails = false;
const discardedCredentials: string[] = [];

class TestCalendarListError extends Error {
  public readonly status: number;
  public readonly providerErrorCode: string | null;

  constructor(status: number, providerErrorCode: string | null) {
    super(`Failed to list calendars: ${status}`);
    this.name = "CalendarListError";
    this.status = status;
    this.providerErrorCode = providerErrorCode;
  }
}

vi.mock("@/utils/logging", () => ({
  context: async (run: () => Promise<unknown>) => await run(),
  widelog: {
    count: () => null,
    error: () => null,
    errorFields: () => null,
    flush: () => null,
    max: () => null,
    min: () => null,
    set: (key: string, value: unknown) => {
      values = { ...values, [key]: value };
    },
  },
}));

vi.mock("@/utils/middleware", () => ({
  withWideEvent: (handler: unknown) => handler,
}));

vi.mock("@/context", () => ({
  baseUrl: BASE_URL,
}));

vi.mock("@/utils/destinations", () => ({
  exchangeCodeForTokens: () =>
    Promise.resolve({
      access_token: "access-token-1",
      expires_in: TOKEN_LIFETIME_SECONDS,
      refresh_token: "refresh-token-1",
    }),
  fetchUserInfo: () =>
    Promise.resolve({ email: "person@tenant.test.invalid", id: "graph-object-id-1" }),
  validateState: () => {
    if (stateStoreFails) {
      return Promise.reject(new Error("Redis unavailable"));
    }
    return Promise.resolve({ userId: "user-1" });
  },
}));

vi.mock("@/utils/oauth-source-credentials", () => ({
  createOAuthSourceCredential: () => Promise.resolve("credential-1"),
  discardUnusedOAuthSourceCredential: (credentialId: string) => {
    discardedCredentials.push(credentialId);
    return Promise.resolve();
  },
}));

vi.mock("@/utils/error-labelling", () => ({
  labelFailure: () => null,
}));

vi.mock("@/utils/user-milestones", () => ({
  noteUserMilestone: () => Promise.resolve(),
}));

vi.mock("@/utils/oauth-sources", () => ({
  importOAuthAccountCalendars: () => importResult(),
}));

const { GET: handleCallback } = await import("@/routes/api/sources/callback/[provider]");
const { isFailedResponse } = await import("@/utils/response-outcome");

const callbackRoute = handleCallback as unknown as (ctx: {
  params: Record<string, string>;
  request: Request;
}) => Promise<Response>;

const runCallback = async (query: Record<string, string>): Promise<Response> =>
  await callbackRoute({
    params: { provider: "outlook" },
    request: new Request(
      `${BASE_URL}/api/sources/callback/outlook?${new URLSearchParams(query).toString()}`,
    ),
  });

const ADMIN_CONSENT_DESCRIPTION =
  "AADSTS90094: The grant requires admin permission. User person@tenant.test.invalid. Trace ID: 0000";

beforeEach(() => {
  values = {};
  importResult = () => Promise.resolve("account-1");
  discardedCredentials.length = 0;
  stateStoreFails = false;
});

describe("an Outlook connect the provider refused", () => {
  const refuse = () =>
    runCallback({
      error: "access_denied",
      error_description: ADMIN_CONSENT_DESCRIPTION,
      error_subcode: "cancel",
      state: "state-1",
    });

  it("records Microsoft's error, subcode and AADSTS code", async () => {
    await refuse();

    expect(values["oauth.provider_error"]).toBe("access_denied");
    expect(values["oauth.provider_error_subcode"]).toBe("cancel");
    expect(values["oauth.provider_error_code"]).toBe("AADSTS90094");
    expect(values["oauth.failure_stage"]).toBe("provider");
  });

  it("attributes the failure to the user who started the connect", async () => {
    await refuse();

    expect(values["user.id"]).toBe("user-1");
  });

  it("never records the description itself, which can name the account", async () => {
    await refuse();

    expect(JSON.stringify(values)).not.toContain("person@tenant.test.invalid");
  });

  it("marks the redirect as a failed request", async () => {
    expect(isFailedResponse(await refuse())).toBe(true);
  });
});

describe("an Outlook connect whose account has no mailbox", () => {
  beforeEach(() => {
    importResult = () =>
      Promise.reject(new TestCalendarListError(404, "MailboxNotEnabledForRESTAPI"));
  });

  const connect = () => runCallback({ code: "auth-code-1", state: "state-1" });

  it("records Graph's error code", async () => {
    await connect();

    expect(values["provider.error_code"]).toBe("MailboxNotEnabledForRESTAPI");
    expect(values["oauth.failure_stage"]).toBe("import");
  });

  it("tells the user the account has no Outlook mailbox", async () => {
    const response = await connect();
    const location = new URL(response.headers.get("location") ?? "");

    expect(location.searchParams.get("reason")).toBe("no-mailbox");
  });

  it("does not leave the credential behind", async () => {
    await connect();

    expect(discardedCredentials).toEqual(["credential-1"]);
  });
});

describe("an Outlook connect that succeeds", () => {
  it("is attributed to the user and not marked failed", async () => {
    const response = await runCallback({ code: "auth-code-1", state: "state-1" });

    expect(values["user.id"]).toBe("user-1");
    expect(isFailedResponse(response)).toBe(false);
    expect(discardedCredentials).toEqual([]);
  });
});

describe("an Outlook connect while the state store is down", () => {
  it("sends the user back with an error instead of failing the request", async () => {
    stateStoreFails = true;

    const response = await runCallback({ code: "auth-code-1", state: "state-1" });

    expect(response.status).toBe(302);
    expect(values["oauth.failure_stage"]).toBe("state");
  });
});
