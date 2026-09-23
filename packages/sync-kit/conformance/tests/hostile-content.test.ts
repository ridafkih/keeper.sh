import { describe, expect, test } from "vitest";
import { failureOf, listChanges, listingKindOf, okValue } from "./support/drive";
import { referenceHarness, runReferenceCase } from "./support/harness";
import { foreignEvent, scopeOver, seedOf, spanning } from "./support/protocol";

const march = spanning("2026-03-01T00:00:00.000Z", "2026-04-01T00:00:00.000Z");
const scope = scopeOver(march);

const benign = foreignEvent({
  uid: "benign",
  title: "Weekly sync",
  start: "2026-03-02T09:00:00.000Z",
  end: "2026-03-02T10:00:00.000Z",
});

const hostileTitles = [
  "rate limit exceeded",
  "410 Gone",
  "Precondition Failed",
  "HTTP 429 Too Many Requests",
  "fullSyncRequired",
  "\u0000 NUL byte",
];

const hostileEvents = hostileTitles.map((title, index) =>
  foreignEvent({
    uid: `hostile-${index}`,
    title,
    start: "2026-03-02T09:00:00.000Z",
    end: "2026-03-02T10:00:00.000Z",
  }),
);

describe("event content cannot change how a failure is classified", () => {
  test("CONF-O23: hostile titles do not turn a healthy listing into a failure", async () => {
    const harness = await referenceHarness();
    await harness.provider.seed(seedOf(hostileEvents, []));

    const result = await listChanges(harness.provider, harness.environment, scope);

    expect(listingKindOf(result)).toBe("snapshot");
    expect(okValue(result).events).toHaveLength(hostileEvents.length);
    await harness.dispose();
  });

  test("CONF-O23: the identity of a hostile event matches the identity of a benign one", async () => {
    const hostile = await referenceHarness();
    const calm = await referenceHarness();
    await hostile.provider.seed(seedOf([hostileEvents[0] ?? benign], []));
    await calm.provider.seed(seedOf([benign], []));

    const first = okValue(await listChanges(hostile.provider, hostile.environment, scope));
    const second = okValue(await listChanges(calm.provider, calm.environment, scope));

    expect((first.events ?? []).map((event) => event.uid.value)).toHaveLength(
      (second.events ?? []).length,
    );
    expect(first.kind).toBe(second.kind);
    expect(first.diagnostics).toEqual(second.diagnostics);
    await hostile.dispose();
    await calm.dispose();
  });

  test("CONF-O23: a real rate limit is still classified as rateLimited whatever the content says", async () => {
    const harness = await referenceHarness();
    await harness.provider.seed(seedOf(hostileEvents, []));
    harness.environment.transport.answerWith({
      kind: "reject",
      failure: { kind: "rateLimited", retryAfter: null, scope: "perUser" },
      times: Number.MAX_SAFE_INTEGER,
    });

    const result = await listChanges(harness.provider, harness.environment, scope, null, {
      maxAttempts: 1,
    });

    expect(failureOf(result).kind).toBe("rateLimited");
    await harness.dispose();
  });

  test("CONF-O23: a NUL byte in a title does not split or truncate the identity key", async () => {
    const harness = await referenceHarness();
    const nulled = foreignEvent({
      uid: "with\u0000nul",
      title: "Contains a NUL",
      start: "2026-03-02T09:00:00.000Z",
      end: "2026-03-02T10:00:00.000Z",
    });
    await harness.provider.seed(seedOf([nulled, benign], []));

    const listing = okValue(await listChanges(harness.provider, harness.environment, scope));
    const uids = (listing.events ?? []).map((event) => event.uid.value);

    expect(uids).toHaveLength(2);
    expect(new Set(uids).size).toBe(2);
    await harness.dispose();
  });

  test("CONF-O23: the generated case passes for the reference provider", async () => {
    await expect(runReferenceCase("CONF-O23")).resolves.toBeUndefined();
  });
});
