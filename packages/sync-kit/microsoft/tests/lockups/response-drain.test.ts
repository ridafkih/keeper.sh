import { describe, expect, test } from "vitest";
import { discardResponse } from "../../src/client/raw-response";
import { outcomeKindOf } from "../support/expect";
import { createHarness, operationContext } from "../support/harness";
import { deleteIntent, versionOf } from "../support/intents";
import { seedOf, timedItem } from "../support/items";

describe("a response body is read or cancelled, never abandoned", () => {
  test("MS-L19: a delete whose body is never read cancels the stream", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf([]));
    harness.fake.putItems([
      timedItem({
        id: "id-doomed",
        uid: "doomed",
        start: "2026-03-14T09:00:00.0000000",
        end: "2026-03-14T10:00:00.0000000",
      }),
    ]);

    const answered = await harness.provider.write(
      deleteIntent("id-doomed", versionOf("ck-1-id-doomed")),
      operationContext(harness.environment),
    );

    expect(outcomeKindOf(answered)).toBe("deleted");
    expect(harness.fake.deleteBodyWasCancelled()).toBe(true);
  }, 30_000);

  test("MS-L19: discarding a response cancels its body rather than leaving it open", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        controller.enqueue(new TextEncoder().encode("unread"));
      },
      cancel: () => {
        cancelled = true;
      },
    });

    await discardResponse(new Response(body, { status: 204 }));

    expect(cancelled).toBe(true);
  }, 30_000);
});
