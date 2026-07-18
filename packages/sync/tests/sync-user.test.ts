import { describe, expect, it, vi } from "vitest";
import { readDestinationReconciliationState } from "../src/sync-user";

describe("readDestinationReconciliationState", () => {
  it("finishes remote I/O before entering the local snapshot transaction", async () => {
    const order: string[] = [];

    const state = await readDestinationReconciliationState(
      () => {
        order.push("remote");
        return Promise.resolve([]);
      },
      () => {
        order.push("local-transaction");
        return Promise.resolve({ existingMappings: [], localEvents: [] });
      },
    );

    expect(order).toEqual(["remote", "local-transaction"]);
    expect(state).toEqual({ existingMappings: [], localEvents: [], remoteEvents: [] });
  });

  it("does not open a local transaction when the remote read fails", async () => {
    const readLocalState = vi.fn(() => Promise.resolve({
      existingMappings: [],
      localEvents: [],
    }));

    await expect(readDestinationReconciliationState(
      () => Promise.reject(new Error("remote read failed")),
      readLocalState,
    )).rejects.toThrow("remote read failed");

    expect(readLocalState).not.toHaveBeenCalled();
  });
});
