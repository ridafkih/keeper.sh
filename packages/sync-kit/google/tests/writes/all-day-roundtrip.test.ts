import { describe, expect, test } from "vitest";
import { normalizeForGoogle } from "../../src/write/normalize";
import { listingOf, outcomeOf } from "../support/expect";
import { createHarness, marchWindow, operationContext, scopeOver } from "../support/harness";
import { allDayContent, createIntent, normalizedOf } from "../support/intents";

const mirroredAllDay = () => allDayContent("2026-03-21", "2026-03-24");

const pushAndReadBack = async (harness: ReturnType<typeof createHarness>) => {
  const shaped = normalizeForGoogle(mirroredAllDay(), harness.environment.hash);
  if (!shaped.ok) {
    throw new Error("an all-day range was refused before it was ever written");
  }
  const written = outcomeOf(
    await harness.provider.write(
      createIntent("mirror-all-day", shaped.value, harness.environment.installation.value),
      operationContext(harness.environment),
    ),
  );
  const listing = listingOf(
    await harness.provider.listChanges(
      { scope: scopeOver(marchWindow), resume: null },
      operationContext(harness.environment),
    ),
  );
  return { shaped: shaped.value, written, listing };
};

describe("an all-day event round-trips without churn", () => {
  test("GOOG-O45: writing, reading back and diffing an all-day event twice produces zero operations", async () => {
    const harness = createHarness();
    const first = await pushAndReadBack(harness);
    const readBack = first.listing.events?.at(0);
    if (!readBack) {
      throw new Error("the calendar listed nothing after the all-day write");
    }

    const second = await pushAndReadBack(harness);

    expect(readBack.fingerprint).toEqual(first.shaped.fingerprint);
    expect(second.written.kind).toBe("alreadyExists");
    expect(harness.fake.items()).toHaveLength(1);
  });

  test("GOOG-O45: the round trip comes back as a date pair, never as a pair of UTC midnights", async () => {
    const harness = createHarness();
    const { listing } = await pushAndReadBack(harness);
    const readBack = listing.events?.at(0);
    if (!readBack) {
      throw new Error("the calendar listed nothing after the all-day write");
    }

    const { content } = readBack;
    if (content.recurrence !== null) {
      throw new Error("a single all-day event came back as a recurring one");
    }
    expect(content.time.kind).toBe("allDay");
  });

  test("GOOG-O45: the second run deletes nothing it had already written", async () => {
    const harness = createHarness();
    await pushAndReadBack(harness);
    await pushAndReadBack(harness);

    expect(harness.fake.requests().filter((request) => request.method === "DELETE")).toEqual([]);
  });

  test("GOOG-O45: an unshaped copy of the same event fingerprints the same as the shaped one", () => {
    const harness = createHarness();
    const shaped = normalizeForGoogle(mirroredAllDay(), harness.environment.hash);
    if (!shaped.ok) {
      throw new Error("an all-day range was refused");
    }

    expect(normalizedOf(shaped.value.content).content).toEqual(shaped.value.content);
  });
});
