import { describe, expect, it } from "bun:test";
import { SourceIngestionLifecycleEventType } from "@keeper.sh/state-machines";
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

  it("resolves timeout and not-found errors deterministically", () => {
    expect(
      resolveSourceIngestionErrorCode(new Error("request timed out after 60000ms")),
    ).toBe(SourceIngestionErrorCode.TIMEOUT);
    expect(resolveSourceIngestionErrorCode(new Error("upstream 404"))).toBe(
      SourceIngestionErrorCode.NOT_FOUND,
    );
  });

  it("parses known string values and rejects unknown codes", () => {
    expect(parseSourceIngestionErrorCode("transient_failure")).toBe(
      SourceIngestionErrorCode.TRANSIENT_FAILURE,
    );
    expect(parseSourceIngestionErrorCode("mystery_code")).toBeNull();
  });
});

