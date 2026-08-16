import { describe, expect, it } from "vitest";
import { createSiblingNotifier } from "../src/write-back";

const SOURCE_CALENDAR_ID = "source-1";
const DESTINATION_CALENDAR_ID = "destination-1";
const USER_ID = "user-1";

const createNotifier = (options: {
  hasSibling: boolean;
  notified: string[];
  withNotifier?: boolean;
}) => createSiblingNotifier({
  hasSibling: () => Promise.resolve(options.hasSibling),
  userId: USER_ID,
  ...((options.withNotifier ?? true) && {
    notifySourceChanged: (userId: string) => {
      options.notified.push(userId);
      return Promise.resolve();
    },
  }),
});

describe("sibling notification after a write-back", () => {
  it("wakes the user's destinations once when another mirrors the source", async () => {
    const notified: string[] = [];

    await createNotifier({ hasSibling: true, notified })(
      SOURCE_CALENDAR_ID,
      DESTINATION_CALENDAR_ID,
    );

    expect(notified).toEqual([USER_ID]);
  });

  /*
   * A destination that rewrites content on read-back diverges every cycle, so waking on
   * anything short of another mirror existing would make the wake-ups self-sustaining.
   */
  it("enqueues nothing when no other destination mirrors the source", async () => {
    const notified: string[] = [];

    await createNotifier({ hasSibling: false, notified })(
      SOURCE_CALENDAR_ID,
      DESTINATION_CALENDAR_ID,
    );

    expect(notified).toEqual([]);
  });

  it("does not read siblings at all when no notifier is wired", async () => {
    const notified: string[] = [];
    let siblingReads = 0;

    const notifier = createSiblingNotifier({
      hasSibling: () => {
        siblingReads += 1;
        return Promise.resolve(true);
      },
      userId: USER_ID,
    });
    await notifier(SOURCE_CALENDAR_ID, DESTINATION_CALENDAR_ID);

    expect(siblingReads).toBe(0);
    expect(notified).toEqual([]);
  });
});
