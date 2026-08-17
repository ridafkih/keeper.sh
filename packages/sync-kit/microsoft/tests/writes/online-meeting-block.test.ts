import { describe, expect, test } from "vitest";
import { outcomeKindOf } from "../support/expect";
import { createHarness, operationContext } from "../support/harness";
import { normalizedOf, timedContent, updateIntent, versionOf } from "../support/intents";
import { seedOf, timedItem } from "../support/items";

const teamsBlob = [
  "________________________________________________________________________________",
  "Microsoft Teams meeting",
  "Join on your computer: https://teams.microsoft.com/l/meetup-join/19%3ameeting",
  "________________________________________________________________________________",
].join("\n");

const eventWithAMeeting = () => ({
  ...timedItem({
    id: "id-meeting",
    uid: "meeting",
    start: "2026-03-21T09:00:00.0000000",
    end: "2026-03-21T10:00:00.0000000",
    description: `the description we mirrored\n${teamsBlob}`,
  }),
  isOnlineMeeting: true,
  onlineMeeting: { joinUrl: "https://teams.microsoft.com/l/meetup-join/19%3ameeting" },
});

describe("the Teams join blob is Graph's region of the body, and it survives our write", () => {
  test("MS-O25: an update preserves the Teams join blob and never diffs on it", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf([]));
    harness.fake.putItems([eventWithAMeeting()]);

    const updated = await harness.provider.write(
      updateIntent(
        "id-meeting",
        normalizedOf(timedContent({ description: "a description we changed" })),
        versionOf("ck-1-id-meeting"),
      ),
      operationContext(harness.environment),
    );

    const stored = harness.fake.items().find((item) => item.id === "id-meeting");
    expect(outcomeKindOf(updated)).toBe("updated");
    expect(stored?.body?.content).toContain(teamsBlob);
    expect(stored?.body?.content).toContain("a description we changed");
  }, 30_000);
});
