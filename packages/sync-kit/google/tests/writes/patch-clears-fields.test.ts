import type { EditableContent } from "@keeper.sh/sync-protocol";
import { describe, expect, test } from "vitest";
import { outcomeOf } from "../support/expect";
import { createHarness, operationContext } from "../support/harness";
import { createIntent, normalizedOf, timedContent, updateIntent } from "../support/intents";

const weeklySeries: EditableContent = {
  title: "Weekly standup",
  description: null,
  location: null,
  availability: "busy",
  visibility: "default",
  recurrence: { dialect: "rfc5545", value: "RRULE:FREQ=WEEKLY;COUNT=5", exceptions: [] },
  anchor: {
    kind: "timed",
    start: { kind: "instant", value: "2026-03-02T09:00:00.000Z" },
    zone: { kind: "zoneId", value: "UTC" },
    duration: { kind: "exact", seconds: 3600 },
  },
};

const keysOf = (body: unknown): readonly string[] => {
  if (typeof body !== "object" || body === null) {
    return [];
  }
  return Object.keys(body);
};

const createdSeries = async (harness: ReturnType<typeof createHarness>) => {
  const created = outcomeOf(
    await harness.provider.write(
      createIntent(
        "mirror-of-a-series",
        normalizedOf(weeklySeries),
        harness.environment.installation.value,
      ),
      operationContext(harness.environment),
    ),
  );
  if (created.kind !== "created") {
    throw new Error(`creating the series answered "${created.kind}"`);
  }
  return created;
};

describe("a patch clears what the new content no longer carries", () => {
  test("GOOG-O47: demoting a series to a single occurrence clears the rule Google would otherwise keep", async () => {
    const harness = createHarness();
    const created = await createdSeries(harness);

    await harness.provider.write(
      updateIntent(created.remote.id.value, normalizedOf(timedContent()), created.version),
      operationContext(harness.environment),
    );

    expect(harness.fake.items().at(0)?.recurrence ?? []).toEqual([]);
  });

  test("GOOG-O47: the demotion echoes back as matched, so a retry can converge", async () => {
    const harness = createHarness();
    const created = await createdSeries(harness);

    const updated = outcomeOf(
      await harness.provider.write(
        updateIntent(created.remote.id.value, normalizedOf(timedContent()), created.version),
        operationContext(harness.environment),
      ),
    );

    if (updated.kind !== "updated") {
      throw new Error(`the demotion answered "${updated.kind}"`);
    }
    expect(updated.echo).toEqual({ kind: "matched" });
  });

  test("GOOG-O47: a patch never asserts a status, so it cannot resurrect a cancelled event", async () => {
    const harness = createHarness();
    const created = await createdSeries(harness);

    await harness.provider.write(
      updateIntent(created.remote.id.value, normalizedOf(timedContent()), created.version),
      operationContext(harness.environment),
    );

    const patches = harness.fake.requests().filter((request) => request.method === "PATCH");
    expect(patches.length).toBeGreaterThan(0);
    for (const patch of patches) {
      expect(keysOf(patch.body)).not.toContain("status");
    }
  });
});
