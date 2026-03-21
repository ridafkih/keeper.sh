import { describe, expect, it } from "bun:test";
import { SourceIngestionLifecycleEventType } from "@keeper.sh/state-machines";
import {
  SourceIngestionNotFoundError,
  SourceIngestionTimeoutError,
} from "./source-ingestion-errors";
import {
  SourceIngestionErrorCode,
  mapSourceIngestionFailureEventToErrorCode,
  parseSourceIngestionErrorCode,
  resolveSourceIngestionErrorCode,
} from "./source-ingestion-error-code";

describe("source-ingestion-error-code", () => {
  it("maps lifecycle failure events to canonical error codes", () => {
    expect(
      mapSourceIngestionFailureEventToErrorCode(
        SourceIngestionLifecycleEventType.AUTH_FAILURE,
      ),
    ).toBe(SourceIngestionErrorCode.AUTH_REQUIRED);
    expect(
      mapSourceIngestionFailureEventToErrorCode(
        SourceIngestionLifecycleEventType.NOT_FOUND,
      ),
    ).toBe(SourceIngestionErrorCode.NOT_FOUND);
    expect(
      mapSourceIngestionFailureEventToErrorCode(
        SourceIngestionLifecycleEventType.TRANSIENT_FAILURE,
      ),
    ).toBe(SourceIngestionErrorCode.TRANSIENT_FAILURE);
  });

  it("resolves typed timeout and not-found errors deterministically", () => {
    expect(resolveSourceIngestionErrorCode(new SourceIngestionTimeoutError(60_000))).toBe(
      SourceIngestionErrorCode.TIMEOUT,
    );
    expect(resolveSourceIngestionErrorCode(new SourceIngestionNotFoundError())).toBe(
      SourceIngestionErrorCode.NOT_FOUND,
    );
  });

  it("resolves structured 404 errors as not-found", () => {
    const error = { status: 404 };
    expect(resolveSourceIngestionErrorCode(error)).toBe(SourceIngestionErrorCode.NOT_FOUND);
  });

  it("parses known string values and rejects unknown codes", () => {
    expect(parseSourceIngestionErrorCode("transient_failure")).toBe(
      SourceIngestionErrorCode.TRANSIENT_FAILURE,
    );
    expect(parseSourceIngestionErrorCode("mystery_code")).toBeNull();
  });
});
