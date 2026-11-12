import { describe, expect, it } from "vitest";
import { createEmptyDraft } from "../../../src/features/setup/setup-draft";
import {
  clearSetupDraft,
  clearSetupSession,
  hasImportedLogin,
  LOGIN_IMPORT_KEY,
  markLoginImported,
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
    writeSetupDraft(storage, "user-a", draft);
    expect(readSetupDraft(storage, "user-a")).toEqual(draft);
    clearSetupDraft(storage);
    expect(readSetupDraft(storage, "user-a")).toBeNull();
  });

  it("only hands a draft back to the user who wrote it", () => {
    const storage = createStorage();
    writeSetupDraft(storage, "user-a", { ...createEmptyDraft(), sync: { ...createEmptyDraft().sync, skipTitleKeywords: ["Therapy"] } });
    expect(readSetupDraft(storage, "user-b")).toBeNull();
  });

  it("rejects malformed or outdated drafts", () => {
    const storage = createStorage();
    storage.setItem(SETUP_DRAFT_KEY, "{not json");
    expect(readSetupDraft(storage, "user-a")).toBeNull();
    storage.setItem(SETUP_DRAFT_KEY, JSON.stringify({ draft: { ...createEmptyDraft(), version: 4 }, userId: "user-a" }));
    expect(readSetupDraft(storage, "user-a")).toBeNull();
    storage.setItem(SETUP_DRAFT_KEY, JSON.stringify(createEmptyDraft()));
    expect(readSetupDraft(storage, "user-a")).toBeNull();
  });

  it("records the login import per user", () => {
    const storage = createStorage();
    markLoginImported(storage, "user-a");
    expect(hasImportedLogin(storage, "user-a")).toBe(true);
    expect(hasImportedLogin(storage, "user-b")).toBe(false);
  });

  it("clears the draft and the import flag together on sign-out", () => {
    const storage = createStorage();
    writeSetupDraft(storage, "user-a", createEmptyDraft());
    markLoginImported(storage, "user-a");
    clearSetupSession(storage);
    expect(storage.map.has(SETUP_DRAFT_KEY)).toBe(false);
    expect(storage.map.has(LOGIN_IMPORT_KEY)).toBe(false);
  });

  it("survives a storage that throws", () => {
    const storage: DraftStorage = {
      getItem: () => { throw new Error("blocked"); },
      removeItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
    };
    expect(readSetupDraft(storage, "user-a")).toBeNull();
    expect(() => writeSetupDraft(storage, "user-a", createEmptyDraft())).not.toThrow();
    expect(() => clearSetupDraft(storage)).not.toThrow();
    expect(() => clearSetupSession(storage)).not.toThrow();
    expect(hasImportedLogin(storage, "user-a")).toBe(false);
    expect(readSetupDraft(null, "user-a")).toBeNull();
  });
});
