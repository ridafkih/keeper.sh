import { describe, expect, it } from "bun:test";
import { ErrorPolicy, SourceIngestionLifecycleEventType } from "@keeper.sh/state-machines";
import {
  classifySourceIngestionFailure,
  SourceIngestionFailureLogSlug,
} from "./source-ingestion-failure";

const dependencies = {
  isNotFoundError: (error: unknown): boolean =>
    error instanceof Error && error.message.includes("404"),
  resolveErrorCode: (_error: unknown): string => "resolved_code",
};

describe("classifySourceIngestionFailure", () => {
  it("returns reauth policy for auth failures", () => {
    const decision = classifySourceIngestionFailure(
      new Error("auth failed"),
      dependencies,
      {
        authFailureSlug: SourceIngestionFailureLogSlug.TOKEN_REFRESH_FAILED,
        isAuthFailure: () => true,
      },
    );

    expect(decision).toEqual({
      code: "auth_required",
      eventType: SourceIngestionLifecycleEventType.AUTH_FAILURE,
      logSlug: SourceIngestionFailureLogSlug.TOKEN_REFRESH_FAILED,
      policy: ErrorPolicy.REQUIRES_REAUTH,
    });
  });

  it("returns terminal policy for not found failures", () => {
    const decision = classifySourceIngestionFailure(
      new Error("upstream 404"),
      dependencies,
    );

    expect(decision).toEqual({
      code: "resolved_code",
      eventType: SourceIngestionLifecycleEventType.NOT_FOUND,
      logSlug: SourceIngestionFailureLogSlug.NOT_FOUND,
      policy: ErrorPolicy.TERMINAL,
    });
  });

  it("returns retryable policy for transient failures", () => {
    const decision = classifySourceIngestionFailure(
      new Error("upstream timeout"),
      {
        isNotFoundError: () => false,
        resolveErrorCode: () => "transient_failure",
      },
    );

    expect(decision).toEqual({
      code: "transient_failure",
      eventType: SourceIngestionLifecycleEventType.TRANSIENT_FAILURE,
      logSlug: SourceIngestionFailureLogSlug.TRANSIENT,
      policy: ErrorPolicy.RETRYABLE,
    });
  });
});
