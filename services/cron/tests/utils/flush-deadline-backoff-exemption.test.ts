import { describe, expect, it } from "vitest";
import { createSerialFlushWorker } from "@keeper.sh/calendar";
import { isIngestInfrastructureError, requiresReauthentication } from "../../src/utils/error-flags";

interface DeadlineItem {
  deadlineAt: number;
}

/*
 * A wedged flush (half-open connection) makes the pump's client-side run
 * deadline fire. That rejection never contacted the calendar's provider, so
 * it must carry the same infrastructure exemption as OperationTimeoutError
 * and SerialFlushWorkerClosedError — otherwise runSourceIngest applies
 * provider backoff to an innocent calendar and labels it provider-api-error.
 */
describe("pump deadline rejection", () => {
  it("is classified as ingest infrastructure, exempt from provider backoff", async () => {
    const wedged = Promise.withResolvers<never>();
    const worker = createSerialFlushWorker<DeadlineItem, never>(() => wedged.promise);

    let caught: unknown = null;
    try {
      await worker.submit({ deadlineAt: Date.now() + 20 });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain("deadline");
    // The abandoned run's error must be exempt exactly like the other two infrastructure errors.
    expect(isIngestInfrastructureError(caught)).toBe(true);
    expect(requiresReauthentication(caught)).toBe(true);

    // Let the abandoned run settle so the worker can close cleanly.
    wedged.reject(new Error("release wedged run"));
    await worker.close();
  });
});
