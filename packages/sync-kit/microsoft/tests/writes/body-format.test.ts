import { describe, expect, test } from "vitest";
import { readBody } from "../../src/decode/body";
import { outcomeOf } from "../support/expect";
import { createHarness, operationContext } from "../support/harness";
import { createIntent, normalizedOf, timedContent } from "../support/intents";
import { seedOf } from "../support/items";

describe("an echo diffed across body formats is uncomparable, not divergence", () => {
  test("MS-O24: an HTML body echo is uncomparable, not diverged", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf([]));
    harness.fake.rewritesBody(true);

    const created = outcomeOf(
      await harness.provider.write(
        createIntent(
          "idempotency-html",
          normalizedOf(timedContent({ description: "the body we sent" })),
          "microsoft-tests",
        ),
        operationContext(harness.environment),
      ),
    );

    if (created.kind !== "created") {
      throw new Error(`a create answered "${created.kind}"`);
    }
    expect(created.echo.kind).toBe("notObserved");
  }, 30_000);

  test("MS-O24: a body returned as html is refused for comparison at the decoder", () => {
    expect(readBody({ contentType: "html", content: "<p>hello</p>" })).toEqual({
      kind: "uncomparable",
      reason: "bodyFormat",
    });
    expect(readBody({ contentType: "text", content: "hello" })).toEqual({
      kind: "comparable",
      text: "hello",
    });
  });
});
