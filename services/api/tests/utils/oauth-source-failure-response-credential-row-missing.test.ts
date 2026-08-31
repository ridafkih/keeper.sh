import { beforeEach, describe, expect, it, vi } from "vitest";
import { HTTP_STATUS } from "@keeper.sh/constants";
import { CredentialRowMissingError } from "@keeper.sh/calendar/oauth-persistence";

let recordedFields: Array<Record<string, unknown>> = [];

vi.mock("@/utils/logging", () => ({
  context: async (run: () => Promise<void>) => await run(),
  widelog: {
    count: () => null,
    error: () => null,
    errorFields: (_error: unknown, next: Record<string, unknown>) => {
      recordedFields = [...recordedFields, next];
    },
    max: () => null,
    min: () => null,
    set: () => null,
  },
}));

const { oauthSourceFailureResponse } = await import("@/utils/oauth-source-failure-response");

const RECONNECT_MESSAGE =
  "The calendar connection was removed while it was being added. Please reconnect the account.";

describe("oauthSourceFailureResponse", () => {
  beforeEach(() => {
    recordedFields = [];
  });

  it("answers a vanished credential row with a reconnect conflict, not a malformed body", async () => {
    const response = oauthSourceFailureResponse(new CredentialRowMissingError("credential-1"));
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(HTTP_STATUS.CONFLICT);
    expect(body.error).toBe(RECONNECT_MESSAGE);
    expect(body.error).not.toContain("Invalid request body");
    expect(body.error).not.toContain("Service temporarily unavailable");
    expect(recordedFields).toContainEqual(
      expect.objectContaining({ slug: "connect-credential-row-missing" }),
    );
  });

  it("still answers an unrecognised failure with the invalid request body fallback", async () => {
    const response = oauthSourceFailureResponse(new Error("nope"));
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(HTTP_STATUS.BAD_REQUEST);
    expect(body.error).toBe("Invalid request body");
  });
});
