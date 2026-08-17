import { describe, expect, test } from "vitest";
import { outcomeKindOf, outcomeOf } from "../support/expect";
import { createHarness, operationContext } from "../support/harness";
import { createIntent, normalizedOf, timedContent } from "../support/intents";

const replayableCreate = (installation: string) =>
  createIntent("mirror-of-source-42", normalizedOf(timedContent()), installation);

describe("a replayed create leaves exactly one object", () => {
  test("GOOG-O14: the same create issued twice leaves one object", async () => {
    const harness = createHarness();
    const intent = replayableCreate(harness.environment.installation.value);

    const first = await harness.provider.write(intent, operationContext(harness.environment));
    const second = await harness.provider.write(intent, operationContext(harness.environment));

    expect(outcomeKindOf(first)).toBe("created");
    expect(outcomeKindOf(second)).toBe("alreadyExists");
    expect(harness.fake.items()).toHaveLength(1);
  });

  test("GOOG-O14: the replay names the same remote reference, never a fresh id", async () => {
    const harness = createHarness();
    const intent = replayableCreate(harness.environment.installation.value);

    const first = outcomeOf(await harness.provider.write(intent, operationContext(harness.environment)));
    const second = outcomeOf(
      await harness.provider.write(intent, operationContext(harness.environment)),
    );

    if (first.kind !== "created" || second.kind !== "alreadyExists") {
      throw new Error(`the replay answered "${first.kind}" then "${second.kind}"`);
    }
    expect(second.remote).toEqual(first.remote);
  });

  test("GOOG-O14: a differing create against a taken id is refused, never blindly recreated", async () => {
    const harness = createHarness();
    const installation = harness.environment.installation.value;
    await harness.provider.write(
      replayableCreate(installation),
      operationContext(harness.environment),
    );

    const differing = await harness.provider.write(
      createIntent(
        "mirror-of-source-42",
        normalizedOf(timedContent({ title: "a different title entirely" })),
        installation,
      ),
      operationContext(harness.environment),
    );

    expect(outcomeKindOf(differing)).not.toBe("created");
    expect(harness.fake.items()).toHaveLength(1);
  });
});
