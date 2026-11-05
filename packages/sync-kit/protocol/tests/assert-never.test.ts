import { describe, expect, test, vi } from "vitest";
import { assertNever } from "../src/index";

type StoredVariant =
  | { readonly kind: "mirrored"; readonly id: string }
  | { readonly kind: "retired"; readonly id: string };

const classify = (variant: StoredVariant): string => {
  switch (variant.kind) {
    case "mirrored": {
      return `mirrored:${variant.id}`;
    }
    case "retired": {
      return `retired:${variant.id}`;
    }
    default: {
      return assertNever(variant);
    }
  }
};

const decodeStoredVariant = (payload: string): StoredVariant => JSON.parse(payload);

const unhandledVariant = decodeStoredVariant('{"kind":"impossible","id":"evt-1"}');

const withDeadline = async (
  operation: () => Promise<string>,
  budgetMs: number,
): Promise<string> => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const deadline = new Promise<string>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("deadline exceeded")), budgetMs);
  });
  try {
    return await Promise.race([operation(), deadline]);
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
  }
};

const settleImmediately = (): Promise<string> => Promise.resolve("done");

describe("assertNever", () => {
  test("throws instead of returning, and names the variant nobody handled", () => {
    expect(() => classify(unhandledVariant)).toThrow(/impossible/);
  });

  test("carries the whole offending value so the wide event can identify it", () => {
    expect(() => classify(unhandledVariant)).toThrow(/"id":"evt-1"/);
  });

  test("still names the variant when the value holds a cycle", () => {
    const cyclic = decodeStoredVariant('{"kind":"impossible","id":"evt-1"}');
    Object.assign(cyclic, { self: cyclic });
    expect(() => classify(cyclic)).toThrow(/impossible/);
  });

  test("still names the variant when the value holds a bigint", () => {
    const withQuota = decodeStoredVariant('{"kind":"impossible","id":"evt-1"}');
    Object.assign(withQuota, { quota: 1n });
    expect(() => classify(withQuota)).toThrow(/impossible/);
  });

  test("does not leave a deadline timer armed after the operation wins the race", async () => {
    vi.useFakeTimers();
    try {
      await expect(withDeadline(settleImmediately, 30_000)).resolves.toBe("done");
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  test("rejects the enclosing operation rather than letting a tick complete having done nothing", async () => {
    const tick = async (): Promise<string> => {
      await Promise.resolve();
      return classify(unhandledVariant);
    };
    await expect(withDeadline(tick, 50)).rejects.toThrow(/impossible/);
  });
});
