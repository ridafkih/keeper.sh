import { beforeEach, describe, expect, it, vi } from "vitest";
import { HTTP_STATUS } from "@keeper.sh/constants";
import {
  CredentialRowMissingError,
  RotatedTokenNotPersistedError,
} from "@keeper.sh/calendar/oauth-persistence";

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

const ROTATED_TOKEN_LOST_MESSAGE =
  "The calendar connection could not be completed. Please reconnect the account.";

describe("oauthSourceFailureResponse with a rotated refresh token", () => {
  beforeEach(() => {
    recordedFields = [];
  });

  it("answers a vanished credential row with the same reconnect conflict when the token rotated", async () => {
    const response = oauthSourceFailureResponse(
      new RotatedTokenNotPersistedError(new CredentialRowMissingError("credential-1")),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(HTTP_STATUS.CONFLICT);
    expect(body.error).toBe(RECONNECT_MESSAGE);
    expect(recordedFields).toContainEqual(
      expect.objectContaining({ retriable: false, slug: "connect-credential-row-missing" }),
    );
  });

  it("still answers a rotation loss from any other cause with the retriable internal error", async () => {
    const response = oauthSourceFailureResponse(
      new RotatedTokenNotPersistedError(new Error("connection terminated")),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(HTTP_STATUS.INTERNAL_SERVER_ERROR);
    expect(body.error).toBe(ROTATED_TOKEN_LOST_MESSAGE);
    expect(recordedFields).toContainEqual(
      expect.objectContaining({ slug: "rotated-token-not-persisted" }),
    );
  });
});
