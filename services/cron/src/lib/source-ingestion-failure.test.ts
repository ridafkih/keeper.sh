import { describe, expect, it } from "bun:test";
import { SourceIngestionLifecycleEventType } from "@keeper.sh/state-machines";
import { isSourceIngestionNotFoundError } from "./source-ingestion-errors";
import {
  classifySourceIngestionFailure,
  SourceIngestionFailureLogSlug,
} from "./source-ingestion-failure";
import { SourceIngestionErrorCode } from "./source-ingestion-error-code";

const dependencies = {
  isNotFoundError: isSourceIngestionNotFoundError,
  resolveErrorCode: (_error: unknown): SourceIngestionErrorCode =>
    SourceIngestionErrorCode.TRANSIENT_FAILURE,
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
      code: SourceIngestionErrorCode.AUTH_REQUIRED,
      eventType: SourceIngestionLifecycleEventType.AUTH_FAILURE,
      logSlug: SourceIngestionFailureLogSlug.TOKEN_REFRESH_FAILED,
    });
  });

  it("returns terminal policy for not found failures", () => {
    const decision = classifySourceIngestionFailure({ status: 404 }, dependencies);

    expect(decision).toEqual({
      code: SourceIngestionErrorCode.NOT_FOUND,
      eventType: SourceIngestionLifecycleEventType.NOT_FOUND,
      logSlug: SourceIngestionFailureLogSlug.NOT_FOUND,
    });
  });

  it("returns retryable policy for transient failures", () => {
    const decision = classifySourceIngestionFailure(
      new Error("upstream timeout"),
      {
        isNotFoundError: () => false,
        resolveErrorCode: () => SourceIngestionErrorCode.TRANSIENT_FAILURE,
      },
    );

    expect(decision).toEqual({
      code: SourceIngestionErrorCode.TRANSIENT_FAILURE,
      eventType: SourceIngestionLifecycleEventType.TRANSIENT_FAILURE,
      logSlug: SourceIngestionFailureLogSlug.TRANSIENT,
    });
  });
});
