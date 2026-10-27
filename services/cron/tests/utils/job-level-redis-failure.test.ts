import { MaxRetriesPerRequestError } from "ioredis/built/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const emitted: { fields: Record<string, unknown>; values: Record<string, unknown> }[] = [];
let current: { fields: Record<string, unknown>; values: Record<string, unknown> } = {
  fields: {},
  values: {},
};

vi.mock("@/utils/logging", () => ({
  context: async (run: () => Promise<void>) => await run(),
  widelog: {
    count: () => null,
    max: () => null,
    min: () => null,
    error: () => null,
    errorFields: (_error: unknown, fields: Record<string, unknown>) => {
      current.fields = { ...current.fields, ...fields };
    },
    flush: () => {
      emitted.push(current);
      current = { fields: {}, values: {} };
    },
    set: (key: string, value: unknown) => {
      current.values[key] = value;
    },
    time: {
      measure: async (_key: string, run: () => Promise<void>) => await run(),
    },
  },
}));

const { withCronWideEvent } = await import("../../src/utils/with-wide-event");

const rejectWith = async (error: unknown): Promise<void> => {
  await Bun.sleep(0);
  throw error;
};

const runJob = async (error: unknown): Promise<void> => {
  const job = withCronWideEvent({
    callback: () => rejectWith(error),
    cron: "@every_1_minutes",
    name: "manage-push-channels",
  });
  await expect((job.callback as () => Promise<void>)()).rejects.toThrow();
};

const lastEvent = () => {
  const event = emitted.at(-1);
  if (!event) {
    throw new Error("expected the job wrapper to flush a wide event");
  }
  return event;
};

describe("a cron job that fails because Redis is unreachable", () => {
  beforeEach(() => {
    emitted.length = 0;
    current = { fields: {}, values: {} };
  });

  it("labels the failure as Redis being unavailable rather than leaving it unlabelled", async () => {
    await runJob(new MaxRetriesPerRequestError(3));

    expect(lastEvent().fields.slug).toBe("redis-unavailable");
  });
});
