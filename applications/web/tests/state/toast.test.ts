import { describe, expect, it } from "vitest";
import { createStore } from "jotai";
import { dismissToastAtom, showToastAtom, toastAtom } from "../../src/state/toast";

describe("toast state", () => {
  it("shows the latest message", () => {
    const store = createStore();
    store.set(showToastAtom, "Already connected");
    expect(store.get(toastAtom)?.message).toBe("Already connected");
  });

  it("keeps a newer toast when an older one is dismissed", () => {
    const store = createStore();
    store.set(showToastAtom, "First");
    const first = store.get(toastAtom);
    store.set(showToastAtom, "Second");

    store.set(dismissToastAtom, first?.id ?? 0);

    expect(store.get(toastAtom)?.message).toBe("Second");
  });

  it("clears the toast it was asked to dismiss", () => {
    const store = createStore();
    store.set(showToastAtom, "Already connected");
    store.set(dismissToastAtom, store.get(toastAtom)?.id ?? 0);
    expect(store.get(toastAtom)).toBeNull();
  });
});
