import { describe, expect, it } from "vitest";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { createPremiumService } from "../src/subscription";

const makeDatabase = (plan: "free" | "pro"): BunSQLDatabase => ({
  select: () => ({
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve([{ plan }]),
      }),
    }),
  }),
} as unknown as BunSQLDatabase);

interface FeedLimitService {
  getFeedLimit: (plan: "free" | "pro") => number;
  canAddFeed: (userId: string, currentCount: number) => Promise<boolean>;
}

const makeService = (
  plan: "free" | "pro",
  commercialMode: boolean,
): FeedLimitService => createPremiumService({
  database: makeDatabase(plan),
  commercialMode,
}) as unknown as FeedLimitService;

describe("feed limits", () => {
  it("gives free plans one feed and pro plans unlimited feeds", () => {
    const service = makeService("free", true);

    expect(service.getFeedLimit("free")).toBe(1);
    expect(service.getFeedLimit("pro")).toBe(Infinity);
  });

  it("refuses a free user a second feed", async () => {
    const service = makeService("free", true);

    expect(await service.canAddFeed("user-1", 0)).toBe(true);
    expect(await service.canAddFeed("user-1", 1)).toBe(false);
    expect(await service.canAddFeed("user-1", 5)).toBe(false);
  });

  it("lets a pro user keep creating feeds", async () => {
    const service = makeService("pro", true);

    expect(await service.canAddFeed("user-1", 12)).toBe(true);
  });

  it("keeps self-hosted instances unlimited", async () => {
    const service = makeService("free", false);

    expect(await service.canAddFeed("user-1", 99)).toBe(true);
  });
});
