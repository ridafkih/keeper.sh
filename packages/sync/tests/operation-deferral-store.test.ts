import { describe, expect, it } from "vitest";
import { SYNC_DEFERRED_OPERATION_TTL_SECONDS } from "@keeper.sh/constants";
import { createRedisOperationDeferralLedger } from "../src/operation-deferral-store";

const createFakeRedis = () => {
  const sets = new Map<string, Set<string>>();
  const expirations = new Map<string, number>();
  const membersOf = (key: string): Set<string> => {
    const members = sets.get(key) ?? new Set<string>();
    sets.set(key, members);
    return members;
  };
  return {
    expirations,
    expire: (key: string, seconds: number) => {
      expirations.set(key, seconds);
      return Promise.resolve(1);
    },
    sadd: (key: string, ...members: string[]) => {
      for (const member of members) {
        membersOf(key).add(member);
      }
      return Promise.resolve(members.length);
    },
    smembers: (key: string) => Promise.resolve([...membersOf(key)]),
    srem: (key: string, ...members: string[]) => {
      for (const member of members) {
        membersOf(key).delete(member);
      }
      return Promise.resolve(members.length);
    },
  };
};

describe("createRedisOperationDeferralLedger", () => {
  it("keeps failed operation keys per destination until they succeed", async () => {
    const redis = createFakeRedis();
    const ledger = createRedisOperationDeferralLedger(redis, "destination-1");
    const otherLedger = createRedisOperationDeferralLedger(redis, "destination-2");

    await ledger.recordOperationOutcomes({ failed: ["event:a", "event:b"], succeeded: [] });
    expect(await ledger.readDeferredOperationKeys()).toEqual(new Set(["event:a", "event:b"]));
    expect(await otherLedger.readDeferredOperationKeys()).toEqual(new Set());
    expect(redis.expirations.get("sync:deferred-operations:destination-1"))
      .toBe(SYNC_DEFERRED_OPERATION_TTL_SECONDS);

    await ledger.recordOperationOutcomes({ failed: [], succeeded: ["event:a"] });
    expect(await ledger.readDeferredOperationKeys()).toEqual(new Set(["event:b"]));
  });
});
