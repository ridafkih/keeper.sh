import { describe, expect, it } from "vitest";
import { mergeAbortSignals } from "../../../src/core/utils/fetch-with-timeout";

class PolyfilledAbortSignal extends EventTarget {
  public aborted = false;
  public reason: unknown;

  public abort(reason?: unknown): void {
    this.aborted = true;
    this.reason = reason;
    this.dispatchEvent(new Event("abort"));
  }
}

describe("mergeAbortSignals", () => {
  it("merges a structurally compatible signal from a different implementation", () => {
    const nativeController = new AbortController();
    const polyfilledSignal = new PolyfilledAbortSignal();
    const externalSignal = polyfilledSignal as unknown as AbortSignal;

    expect(() => AbortSignal.any([
      nativeController.signal,
      externalSignal,
    ])).toThrow(TypeError);

    const merged = mergeAbortSignals(
      nativeController.signal,
      externalSignal,
    );

    polyfilledSignal.abort("bullmq cancelled the job");

    expect(merged.aborted).toBe(true);
    expect(merged.reason).toBe("bullmq cancelled the job");
  });

  it("preserves an already-aborted signal's reason", () => {
    const signal = new PolyfilledAbortSignal();
    signal.abort("already cancelled");

    const merged = mergeAbortSignals(signal as unknown as AbortSignal);

    expect(merged.aborted).toBe(true);
    expect(merged.reason).toBe("already cancelled");
  });
});
