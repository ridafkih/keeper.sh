import { describe, expect, it } from "vitest";
import { createEmptyDraft } from "../../../src/features/setup/setup-draft";
import {
  clearSetupDraft,
  readSetupDraft,
  SETUP_DRAFT_KEY,
  writeSetupDraft,
  type DraftStorage,
} from "../../../src/features/setup/setup-draft-storage";

const createStorage = (): DraftStorage & { map: Map<string, string> } => {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    map,
    removeItem: (key) => { map.delete(key); },
    setItem: (key, value) => { map.set(key, value); },
  };
};

describe("setup draft storage", () => {
  it("round-trips a draft", () => {
    const storage = createStorage();
    const draft = createEmptyDraft();
    writeSetupDraft(storage, draft);
    expect(readSetupDraft(storage)).toEqual(draft);
    clearSetupDraft(storage);
    expect(readSetupDraft(storage)).toBeNull();
  });

  it("rejects malformed or outdated drafts", () => {
    const storage = createStorage();
    storage.setItem(SETUP_DRAFT_KEY, "{not json");
    expect(readSetupDraft(storage)).toBeNull();
    storage.setItem(SETUP_DRAFT_KEY, JSON.stringify({ ...createEmptyDraft(), version: 1 }));
    expect(readSetupDraft(storage)).toBeNull();
    const legacy = { pending: null, rules: [{ detail: "busy", fromId: null, id: "r", toIds: [] }], version: 2 };
    storage.setItem(SETUP_DRAFT_KEY, JSON.stringify(legacy));
    expect(readSetupDraft(storage)).toBeNull();
  });

  it("survives a storage that throws", () => {
    const storage: DraftStorage = {
      getItem: () => { throw new Error("blocked"); },
      removeItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
    };
    expect(readSetupDraft(storage)).toBeNull();
    expect(() => writeSetupDraft(storage, createEmptyDraft())).not.toThrow();
    expect(() => clearSetupDraft(storage)).not.toThrow();
    expect(readSetupDraft(null)).toBeNull();
  });
});
